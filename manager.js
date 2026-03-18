/**
 * Manager tab: performance command center. Aggregates Open Orders, Production Schedule,
 * Material Availability, and production/maintenance history. Surfaces prioritized tasks
 * with clear actions and impact so the manager can drive OTD, throughput, and downtime.
 */
(function () {
  'use strict';

  var HISTORY_KEY = 'ctl-report-history';
  var TARGETS_KEY = 'ctl-targets';
  var MANAGER_DONE_KEY = 'ctl-manager-focus-done';
  var DISPOSITIONS_KEY = 'ctl-pastdue-dispositions';

  /** Four disposition buckets for past-due not on schedule (control failure—fix the process). */
  var DISPOSITION_OPTIONS = [
    { value: '', label: '— Select —' },
    { value: 'schedule_12', label: 'Schedule in next 12 hours' },
    { value: 'schedule_24', label: 'Schedule next 24 hours' },
    { value: 'blocked', label: 'Blocked (material/credit/quality/coil break/etc.)' },
    { value: 'do_not_run', label: 'Do not run (cancel/hold/customer change) — must have an owner + note' }
  ];

  var drillView = null;
  var feasibilityFilter = 'all';
  var _lastOperationalData = null;

  /** Lbs per coil for capacity from MTD run data (coils × this = lbs). */
  var LBS_PER_COIL = 46500;
  var LBS_PER_TON = 2000;

  function formatLbsAndTons(lbs) {
    if (lbs == null || lbs === 0) return '0 lbs (0 t)';
    var tons = lbs / LBS_PER_TON;
    return lbs.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' lbs (' + (tons >= 1000 ? tons.toLocaleString(undefined, { maximumFractionDigits: 0 }) : tons.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })) + ' t)';
  }

  function getTargetsFromStorage() {
    try {
      var raw = localStorage.getItem(TARGETS_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      return { monthlyCoils: o.monthlyCoils != null ? o.monthlyCoils : null };
    } catch (e) {
      return {};
    }
  }

  function getDoneMap() {
    try {
      var raw = localStorage.getItem(MANAGER_DONE_KEY);
      if (!raw) return {};
      var o = JSON.parse(raw);
      var todayStr = dateKey(todayStart());
      if (o.date !== todayStr) return {};
      return o.items || {};
    } catch (e) {
      return {};
    }
  }

  function setDone(itemId, done) {
    var todayStr = dateKey(todayStart());
    var o = { date: todayStr, items: getDoneMap() };
    if (done) o.items[itemId] = true;
    else delete o.items[itemId];
    localStorage.setItem(MANAGER_DONE_KEY, JSON.stringify(o));
  }

  function getDispositionMap() {
    try {
      var raw = localStorage.getItem(DISPOSITIONS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function setDisposition(route, orderLine, disposition, ownerNote) {
    var map = getDispositionMap();
    var key = (route || '') + '|' + (orderLine || '');
    if (!disposition && !ownerNote) delete map[key];
    else map[key] = { disposition: disposition || '', ownerNote: (ownerNote || '').trim() };
    localStorage.setItem(DISPOSITIONS_KEY, JSON.stringify(map));
  }

  function getDispositionLabel(value) {
    for (var i = 0; i < DISPOSITION_OPTIONS.length; i++) {
      if (DISPOSITION_OPTIONS[i].value === value) return DISPOSITION_OPTIONS[i].label;
    }
    return value || '';
  }

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function todayStart() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getReportHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function getWeekStart(d) {
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = date.getDay();
    var diff = day === 0 ? 6 : day - 1;
    date.setDate(date.getDate() - diff);
    return date;
  }

  function isWeekOperatingDay(d) {
    return d.getDay() >= 1 && d.getDay() <= 6;
  }

  function countWeekOperatingDaysInRange(start, end) {
    var count = 0;
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (d.getTime() <= endDate.getTime()) {
      if (isWeekOperatingDay(d)) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  }

  /**
   * When forecast is behind 80% of WTD or MTD target, analyze daily output by line/shift
   * and return underperforming cells plus suggestions to improve performance.
   */
  function getForecastBehindAndSuggestions() {
    var history = getReportHistory();
    var now = new Date();
    var todayKey = dateKey(now);
    var monthStartStr = todayKey.slice(0, 7);
    var targets = getTargetsFromStorage();
    var weeklyTarget = 300;
    var monthlyTarget = (targets.monthlyCoils != null && targets.monthlyCoils > 0) ? targets.monthlyCoils : null;

    var weekStart = getWeekStart(now);
    var weekStartKey = dateKey(weekStart);
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5);

    var wtdCoils = 0;
    var wtdReportDates = [];
    var mtdCoils = 0;
    var mtdReportDates = [];

    var byLineShiftWTD = {};
    var byLineShiftMTD = {};
    var rowOrder = ['½ line|1st', '½ line|2nd', 'Redbud|1st', 'Redbud|2nd'];
    rowOrder.forEach(function (k) { byLineShiftWTD[k] = { coils: 0, shifts: 0 }; byLineShiftMTD[k] = { coils: 0, shifts: 0 }; });

    history.forEach(function (h) {
      var c = h.grandTotal != null ? h.grandTotal : 0;
      var inWeek = h.reportDate && h.reportDate >= weekStartKey && h.reportDate <= todayKey;
      var inMonth = h.reportDate && h.reportDate.slice(0, 7) === monthStartStr;
      if (inWeek) {
        wtdCoils += c;
        if (wtdReportDates.indexOf(h.reportDate) === -1) wtdReportDates.push(h.reportDate);
      }
      if (inMonth) {
        mtdCoils += c;
        if (mtdReportDates.indexOf(h.reportDate) === -1) mtdReportDates.push(h.reportDate);
      }
      (h.lines || []).forEach(function (line) {
        var lineName = line.name || '—';
        (line.shifts || []).forEach(function (s) {
          var shiftName = (s.shift || '').trim() || '—';
          var k = lineName + '|' + shiftName;
          var coils = s.coils != null ? s.coils : 0;
          if (inWeek && byLineShiftWTD[k] !== undefined) {
            byLineShiftWTD[k].coils += coils;
            byLineShiftWTD[k].shifts += 1;
          }
          if (inMonth && byLineShiftMTD[k] !== undefined) {
            byLineShiftMTD[k].coils += coils;
            byLineShiftMTD[k].shifts += 1;
          }
        });
      });
    });

    var operatingDaysWTD = wtdReportDates.filter(function (dateStr) {
      return isWeekOperatingDay(new Date(dateStr + 'T12:00:00'));
    }).length;
    var lastReportInWeek = wtdReportDates.length ? wtdReportDates.sort()[wtdReportDates.length - 1] : null;
    var dayAfter = lastReportInWeek ? new Date(lastReportInWeek + 'T12:00:00') : null;
    if (dayAfter) dayAfter.setDate(dayAfter.getDate() + 1);
    var remainingDaysWeek = dayAfter ? countWeekOperatingDaysInRange(dayAfter, weekEnd) : 0;
    var wtdAvgPerDay = operatingDaysWTD > 0 ? wtdCoils / operatingDaysWTD : 0;
    var forecastWeek = wtdCoils + (wtdAvgPerDay * remainingDaysWeek);

    var operatingDaysMTD = mtdReportDates.filter(function (dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      return d.getDay() >= 1 && d.getDay() <= 5;
    }).length;
    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var remainingDaysMonth = 0;
    for (var d = new Date(tomorrow); d.getTime() <= monthEnd.getTime(); d.setDate(d.getDate() + 1)) {
      if (d.getDay() >= 1 && d.getDay() <= 5) remainingDaysMonth++;
    }
    var mtdAvgPerDay = operatingDaysMTD > 0 ? mtdCoils / operatingDaysMTD : 0;
    var forecastMonth = mtdCoils + (mtdAvgPerDay * remainingDaysMonth);

    var behind80WTD = weeklyTarget > 0 && forecastWeek <= weeklyTarget * 0.8;
    var behind80MTD = monthlyTarget > 0 && forecastMonth <= monthlyTarget * 0.8;
    var behind = behind80WTD || behind80MTD;

    if (!behind) return { behind: false };

    function findUnderperforming(byLineShift, totalCoils) {
      var cells = rowOrder.map(function (k) {
        var rec = byLineShift[k] || { coils: 0, shifts: 1 };
        var avgPerDay = rec.shifts > 0 ? rec.coils / rec.shifts : 0;
        var pct = totalCoils > 0 ? (rec.coils / totalCoils) * 100 : 0;
        return { key: k, lineName: k.split('|')[0], shiftName: k.split('|')[1], coils: rec.coils, shifts: rec.shifts, avgPerDay: avgPerDay, pct: pct };
      });
      var avgPct = 25;
      var under = cells.filter(function (c) {
        return totalCoils > 0 && (c.pct < 15 || (c.avgPerDay < (totalCoils / (cells.length * Math.max(cells[0].shifts, 1))) * 0.7));
      });
      if (under.length === 0) {
        var minCell = cells[0];
        cells.forEach(function (c) { if (c.avgPerDay < minCell.avgPerDay) minCell = c; });
        under = [minCell];
      }
      return { cells: cells, underperforming: under, totalCoils: totalCoils };
    }

    var wtdAnalysis = findUnderperforming(byLineShiftWTD, wtdCoils);
    var mtdAnalysis = findUnderperforming(byLineShiftMTD, mtdCoils);

    function buildSuggestions(under, period) {
      var list = [];
      under.forEach(function (u) {
        list.push('• ' + u.lineName + ' ' + u.shiftName + ' is underperforming (' + u.coils + ' coils, ' + u.pct.toFixed(0) + '% of ' + period + ' total). Review Enter daily for downtime and crew; check for material or changeover issues.');
        list.push('• Compare ' + u.lineName + ' ' + u.shiftName + ' to the other shifts in Dashboard → MTD production analysis by shift. If downtime is high, schedule preventive maintenance or address recurring causes.');
        list.push('• Set a daily coil target for ' + u.lineName + ' ' + u.shiftName + ' to close the gap (e.g. match or exceed the best-performing shift).');
      });
      list.push('• Use Dashboard → View heat map to see which equipment is driving downtime on the underperforming line.');
      list.push('• Confirm material availability (Material Availability tab) is not blocking runs on the weak line/shift.');
      return list;
    }

    var suggestionsWTD = behind80WTD ? buildSuggestions(wtdAnalysis.underperforming, 'WTD') : [];
    var suggestionsMTD = behind80MTD ? buildSuggestions(mtdAnalysis.underperforming, 'MTD') : [];
    var suggestions = suggestionsWTD.length && suggestionsMTD.length ? (suggestionsWTD.slice(0, 2).concat(suggestionsMTD.slice(0, 2)).concat(suggestionsWTD.slice(2))) : (suggestionsWTD.length ? suggestionsWTD : suggestionsMTD);
    var seen = {};
    var uniqueSuggestions = [];
    suggestions.forEach(function (s) {
      var norm = s.replace(/\d+ coils/g, '').replace(/\d+%/, '');
      if (!seen[norm]) { seen[norm] = true; uniqueSuggestions.push(s); }
    });

    return {
      behind: true,
      behind80WTD: behind80WTD,
      behind80MTD: behind80MTD,
      forecastWeek: Math.round(forecastWeek),
      weeklyTarget: weeklyTarget,
      forecastMonth: Math.round(forecastMonth),
      monthlyTarget: monthlyTarget,
      wtdCoils: wtdCoils,
      mtdCoils: mtdCoils,
      wtdAnalysis: wtdAnalysis,
      mtdAnalysis: mtdAnalysis,
      suggestions: uniqueSuggestions
    };
  }

  function isInNext72Hours(dueDate, today, endOf72h) {
    if (!dueDate || !dueDate.getTime) return false;
    var dueOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    return dueOnly >= today && dueOnly <= endOf72h;
  }

  function isPastDue(dueDate, today) {
    if (!dueDate || !dueDate.getTime) return true;
    var dueOnly = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
    return dueOnly < today;
  }

  function totalDowntimeMinutes(report) {
    if (!report || !report.lines) return 0;
    var total = 0;
    report.lines.forEach(function (line) {
      (line.shifts || []).forEach(function (s) {
        (s.downtime || []).forEach(function (d) {
          total += d.durationMinutes || 0;
        });
      });
    });
    return total;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getVal(row, key) {
    if (row[key] != null && row[key] !== '') return row[key];
    var raw = row._raw || {};
    for (var r in raw) {
      if (r.toLowerCase().replace(/\s/g, '').indexOf(key.replace(/_/g, '')) >= 0) return raw[r];
    }
    return '—';
  }

  /** Returns past-due orders not on schedule, grouped by route, for drill-down. */
  function getPastDueNotOnScheduleByRoute() {
    var today = todayStart();
    var openData = typeof window.ctlOpenStatusGetData === 'function' ? window.ctlOpenStatusGetData() : null;
    var openRows = (openData && openData.rows) ? openData.rows : [];
    var scheduleRows = (typeof window.ctlScheduleRows !== 'undefined' && window.ctlScheduleRows) ? window.ctlScheduleRows : [];
    var blockedRows = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked() : [];

    var orderIdsOnSchedule = {};
    scheduleRows.forEach(function (row) {
      var o = (row.order || row.orderLine || '').toString().trim();
      if (o) orderIdsOnSchedule[o] = true;
      var o2 = row.order && row.item ? (row.order + '-' + row.item).toString().trim() : '';
      if (o2) orderIdsOnSchedule[o2] = true;
    });
    var orderIdsOnNoCoilList = {};
    blockedRows.forEach(function (row) {
      var o = (getVal(row, 'order') || row.order || '').toString().trim();
      if (o) orderIdsOnNoCoilList[o] = true;
    });

    var byRoute = {};
    var allOrders = [];

    openRows.forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      if (bal <= 0) return;
      var dueOnly = due && !isNaN(due.getTime()) ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;
      if (dueOnly >= today) return;
      var orderId = (row.order || '').toString().trim();
      var orderLineId = (row.item ? (orderId + '-' + row.item) : orderId).trim();
      var onSchedule = !!(orderId && orderIdsOnSchedule[orderId]) || !!(orderLineId && orderIdsOnSchedule[orderLineId]);
      if (onSchedule) return;

      var routeName = (row.route || '').toString().trim() || '— No route —';
      var onNoCoil = !!(orderIdsOnNoCoilList[orderId] || orderIdsOnNoCoilList[orderLineId]);
      var orderLine = orderLineId || orderId;
      var dueStr = dueOnly ? dueOnly.getFullYear() + '-' + String(dueOnly.getMonth() + 1).padStart(2, '0') + '-' + String(dueOnly.getDate()).padStart(2, '0') : '—';
      var rec = { route: routeName, orderLine: orderLine, order: row.order, item: row.item, balance: bal, customer: (row.customer || '').toString().trim() || '—', dueStr: dueStr, onNoCoil: onNoCoil };
      allOrders.push(rec);

      if (!byRoute[routeName]) byRoute[routeName] = { lbs: 0, count: 0, orders: [] };
      byRoute[routeName].lbs += bal;
      byRoute[routeName].count += 1;
      byRoute[routeName].orders.push(rec);
    });

    return { byRoute: byRoute, allOrders: allOrders };
  }

  function buildFocusList() {
    var today = todayStart();
    var todayStr = dateKey(today);
    var end72 = new Date(today);
    end72.setDate(end72.getDate() + 2); // next 3 days: today, today+1, today+2
    var focusItems = [];
    var summary = { materialBlocked72: 0, pastDueLbs: 0, next72Lbs: 0, scheduleDays: 0, avgCoilsPerDay: null };

    // 1) Open orders
    var openData = typeof window.ctlOpenStatusGetData === 'function' ? window.ctlOpenStatusGetData() : null;
    var openRows = (openData && openData.rows) ? openData.rows : [];

    var pastDueLbs = 0;
    var pastDueReady = 0;
    var next72Lbs = 0;
    var next72Lines = 0;
    openRows.forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      var ready = row.readyNum || 0;
      if (!due || isNaN(due.getTime())) {
        pastDueLbs += bal;
        pastDueReady += ready;
        return;
      }
      var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueOnly < today) {
        pastDueLbs += bal;
        pastDueReady += ready;
        return;
      }
      if (dueOnly <= end72) {
        next72Lbs += bal;
        next72Lines += 1;
      }
    });
    summary.pastDueLbs = pastDueLbs;
    summary.next72Lbs = next72Lbs;

    // Schedule: build set of order IDs on production schedule (any run date) for "not on schedule" check
    var scheduleRows = (typeof window.ctlScheduleRows !== 'undefined' && window.ctlScheduleRows) ? window.ctlScheduleRows : [];
    var orderIdsOnSchedule = {};
    scheduleRows.forEach(function (row) {
      var o = (row.order || row.orderLine || '').toString().trim();
      if (o) orderIdsOnSchedule[o] = true;
      // Also try order + '-' + item if schedule has separate columns (item may be in row from raw headers)
      var o2 = row.order && row.item ? (row.order + '-' + row.item).toString().trim() : '';
      if (o2) orderIdsOnSchedule[o2] = true;
    });

    // No-coil list: order IDs that are on material-not-available (or blocked) list
    var blockedRows = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked() : [];
    var orderIdsOnNoCoilList = {};
    blockedRows.forEach(function (row) {
      var o = (getVal(row, 'order') || row.order || '').toString().trim();
      if (o) orderIdsOnNoCoilList[o] = true;
    });

    // Past-due orders NOT on production schedule — split by no-coil list
    var pastDueNotOnSchedule = [];
    var pastDueNotOnScheduleLbs = 0;
    var pastDueOnNoCoilLbs = 0;
    var pastDueNotOnNoCoilLbs = 0;
    var pastDueOnNoCoilCount = 0;
    var pastDueNotOnNoCoilCount = 0;
    openRows.forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      if (bal <= 0) return;
      var dueOnly = due && !isNaN(due.getTime()) ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;
      if (dueOnly >= today) return;
      var orderId = (row.order || '').toString().trim();
      var orderLineId = (row.item ? (orderId + '-' + row.item) : orderId).trim();
      var onSchedule = !!(orderId && orderIdsOnSchedule[orderId]) || !!(orderLineId && orderIdsOnSchedule[orderLineId]);
      if (onSchedule) return;
      pastDueNotOnSchedule.push({ orderId: orderLineId || orderId, balance: bal, customer: row.customer, onNoCoil: !!(orderIdsOnNoCoilList[orderId] || orderIdsOnNoCoilList[orderLineId]) });
      pastDueNotOnScheduleLbs += bal;
      if (orderIdsOnNoCoilList[orderId] || orderIdsOnNoCoilList[orderLineId]) {
        pastDueOnNoCoilLbs += bal;
        pastDueOnNoCoilCount += 1;
      } else {
        pastDueNotOnNoCoilLbs += bal;
        pastDueNotOnNoCoilCount += 1;
      }
    });

    // Focus list #1: Past due orders not on production schedule — check no-coil, then ask why not scheduled
    if (pastDueNotOnScheduleLbs > 0) {
      if (pastDueOnNoCoilCount > 0) {
        var onNoCoilSample = pastDueNotOnSchedule.filter(function (x) { return x.onNoCoil; }).slice(0, 8).map(function (x) { return x.orderId; }).join(', ');
        if (pastDueOnNoCoilCount > 8) onNoCoilSample += ' …';
        focusItems.push({
          id: 'otd-pastdue-nocoil',
          priority: 1,
          category: 'OTD',
          tab: 'materialavailability',
          title: 'Past due not on schedule — on no-coil list',
          detail: pastDueOnNoCoilCount + ' order(s), ' + pastDueOnNoCoilLbs.toLocaleString() + ' lbs. Material not available / no coil. Examples: ' + onNoCoilSample,
          action: 'Resolve material (Material Availability tab), then add to Production Schedule.',
          impact: 'Improves OTD',
          severity: 'high'
        });
      }
      if (pastDueNotOnNoCoilCount > 0) {
        var notNoCoilSample = pastDueNotOnSchedule.filter(function (x) { return !x.onNoCoil; }).slice(0, 8).map(function (x) { return x.orderId; }).join(', ');
        if (pastDueNotOnNoCoilCount > 8) notNoCoilSample += ' …';
        focusItems.push({
          id: 'otd-pastdue-whynot',
          priority: 1,
          category: 'OTD',
          tab: 'schedule',
          title: 'Past due not on schedule — why not scheduled?',
          detail: pastDueNotOnNoCoilCount + ' order(s), ' + pastDueNotOnNoCoilLbs.toLocaleString() + ' lbs. Not on no-coil list. Examples: ' + notNoCoilSample,
          action: 'Add to Production Schedule or document why not scheduled.',
          impact: 'Improves OTD',
          severity: 'high'
        });
      }
    }

    if (pastDueLbs > 0 && pastDueNotOnScheduleLbs === 0) {
      focusItems.push({
        id: 'otd-expedite',
        priority: 1,
        category: 'OTD',
        tab: 'openstatus',
        title: 'Expedite past-due orders',
        detail: pastDueLbs.toLocaleString() + ' lbs past due' + (pastDueReady > 0 ? ', ' + pastDueReady.toLocaleString() + ' lbs ready to ship' : '') + '.',
        action: 'Run late-order report; prioritize shipments and coordinate with shipping.',
        impact: 'Improves OTD',
        severity: 'high'
      });
    } else if (pastDueLbs > 0) {
      focusItems.push({
        id: 'otd-expedite',
        priority: 1,
        category: 'OTD',
        tab: 'openstatus',
        title: 'Expedite past-due orders',
        detail: pastDueLbs.toLocaleString() + ' lbs past due total' + (pastDueReady > 0 ? ', ' + pastDueReady.toLocaleString() + ' lbs ready to ship' : '') + '.',
        action: 'Run late-order report; prioritize shipments and coordinate with shipping.',
        impact: 'Improves OTD',
        severity: 'high'
      });
    }

    if (next72Lbs > 0) {
      focusItems.push({
        id: 'orders-72h',
        priority: 2,
        category: 'Orders',
        tab: 'schedule',
        title: 'Orders due in next 72 hours',
        detail: next72Lbs.toLocaleString() + ' lbs across ' + next72Lines + ' line(s) due in next 3 days.',
        action: 'Confirm Production Schedule and line capacity; adjust sequence if needed.',
        impact: 'Improves OTD',
        severity: 'high'
      });
    }

    // 2) Material not available — blocked jobs due in next 72h
    var blockedRows = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked() : [];
    var blockedIn72 = blockedRows.filter(function (row) {
      var due = row.dueDateObj || (row.dueDate ? new Date(row.dueDate) : null);
      return isInNext72Hours(due, today, end72) || isPastDue(due, today);
    });
    summary.materialBlocked72 = blockedIn72.length;

    if (blockedIn72.length > 0) {
      var ordersList = blockedIn72.slice(0, 10).map(function (r) {
        var order = getVal(r, 'order') || r.order || '—';
        var due = r.dueDateObj ? dateKey(r.dueDateObj) : (r.dueDate || '—');
        return order + ' (' + due + ')';
      }).join('; ');
      if (blockedIn72.length > 10) ordersList += ' … +' + (blockedIn72.length - 10) + ' more';
      focusItems.push({
        id: 'material-blocked72',
        priority: 1,
        category: 'Material',
        tab: 'materialavailability',
        title: 'Material not available — jobs due in 72h or past due',
        detail: blockedIn72.length + ' job(s) blocked (no material, quality hold, credit hold, or coil break). ' + ordersList,
        action: 'Chase material and update status in Material Availability; add to schedule once released.',
        impact: 'Improves OTD & throughput',
        severity: 'high'
      });
    }

    // 3) Production schedule — next 3 days
    var scheduleRows = (typeof window.ctlScheduleRows !== 'undefined' && window.ctlScheduleRows) ? window.ctlScheduleRows : [];
    var tonsByDate = {};
    var pcsByDate = {};
    for (var d = 0; d < 3; d++) {
      var day = new Date(today);
      day.setDate(day.getDate() + d);
      var k = dateKey(day);
      tonsByDate[k] = 0;
      pcsByDate[k] = 0;
    }
    scheduleRows.forEach(function (row) {
      var k = row.runDateObj ? dateKey(row.runDateObj) : (row.runDate || '');
      if (!k || !tonsByDate.hasOwnProperty(k)) return;
      tonsByDate[k] += row.weightNum || 0;
      pcsByDate[k] += row.pcsNum || 0;
    });
    var scheduleDaysWithPlanned = Object.keys(tonsByDate).filter(function (k) { return tonsByDate[k] > 0 || pcsByDate[k] > 0; }).length;
    summary.scheduleDays = scheduleDaysWithPlanned;

    if (scheduleRows.length > 0) {
      var scheduleSummary = Object.keys(tonsByDate).sort().map(function (k) {
        var tons = (tonsByDate[k] / 2000).toFixed(1);
        var pcs = pcsByDate[k] || 0;
        return k + ': ' + tons + ' tons, ' + pcs + ' pcs';
      }).join('; ');
      focusItems.push({
        id: 'schedule-next3',
        priority: 3,
        category: 'Schedule',
        tab: 'schedule',
        title: 'Production schedule — next 3 days',
        detail: scheduleSummary + '.',
        action: 'Align with line capacity (Dashboard MTD analysis) and Material Availability; resequence if needed.',
        impact: 'Improves throughput & OTD',
        severity: 'medium'
      });
    }

    // 4) Production history — avg coils per day (last 7 report days) for capacity comparison
    var history = getReportHistory();
    var recentReports = history.slice(0, 7);
    var totalCoils = 0;
    var reportCount = 0;
    recentReports.forEach(function (h) {
      var c = h.grandTotal != null ? h.grandTotal : 0;
      if (c > 0 || h.lines) {
        if (c === 0 && h.lines) {
          h.lines.forEach(function (line) {
            totalCoils += line.lineTotal || 0;
          });
        } else {
          totalCoils += c;
        }
        reportCount++;
      }
    });
    var avgCoilsPerDay = reportCount > 0 ? Math.round(totalCoils / reportCount) : null;
    summary.avgCoilsPerDay = avgCoilsPerDay;

    if (avgCoilsPerDay != null && scheduleDaysWithPlanned > 0) {
      var plannedNext3 = Object.keys(tonsByDate).reduce(function (sum, k) { return sum + (pcsByDate[k] || 0); }, 0);
      if (plannedNext3 > avgCoilsPerDay * 3 * 1.1) {
        focusItems.push({
          id: 'capacity-over',
          priority: 3,
          category: 'Capacity',
          tab: 'dashboard',
          title: 'Schedule above recent capacity',
          detail: 'Planned next 3 days: ' + plannedNext3 + ' pcs vs recent avg ' + avgCoilsPerDay + ' coils/day.',
          action: 'Consider overtime or resequencing; review Dashboard MTD by shift for line-level gaps.',
          impact: 'Improves throughput',
          severity: 'medium'
        });
      }
    }

    // 5) Maintenance / downtime — top equipment by downtime in recent reports
    var equipmentMins = {};
    recentReports.forEach(function (h) {
      if (!h.lines) return;
      h.lines.forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          (s.downtime || []).forEach(function (d) {
            var eqId = d.equipmentId || d.equipment || 'Other';
            equipmentMins[eqId] = (equipmentMins[eqId] || 0) + (d.durationMinutes || 0);
          });
        });
      });
    });
    var topEquipment = Object.keys(equipmentMins)
      .map(function (id) { return { id: id, mins: equipmentMins[id] }; })
      .sort(function (a, b) { return b.mins - a.mins; })
      .slice(0, 3);
    if (topEquipment.length > 0 && topEquipment[0].mins >= 30) {
      var eqList = topEquipment.map(function (e) { return e.id + ' (' + e.mins + ' min)'; }).join('; ');
      focusItems.push({
        id: 'maint-equipment',
        priority: 4,
        category: 'Maintenance',
        tab: 'dashboard',
        title: 'Equipment to watch (recent downtime)',
        detail: eqList + '.',
        action: 'Schedule preventive checks or order parts; review heat map in Dashboard for patterns.',
        impact: 'Reduces downtime',
        severity: 'medium'
      });
    }

    // 5b) Forecast behind 80% WTD or MTD — underperforming line/shift and suggestions
    var forecastBehindData = getForecastBehindAndSuggestions();
    if (forecastBehindData.behind) {
      var periodLabel = forecastBehindData.behind80WTD && forecastBehindData.behind80MTD ? 'WTD & MTD' : (forecastBehindData.behind80WTD ? 'WTD' : 'MTD');
      var under = forecastBehindData.behind80WTD ? forecastBehindData.wtdAnalysis.underperforming : forecastBehindData.mtdAnalysis.underperforming;
      var underLabel = under.length ? under.map(function (u) { return u.lineName + ' ' + u.shiftName; }).join(', ') : 'one or more';
      focusItems.push({
        id: 'perf-forecast-behind80',
        priority: 1,
        category: 'Performance',
        tab: 'dashboard',
        title: 'Forecast behind target (>20% gap) — ' + periodLabel,
        detail: 'Forecast at or below 80% of target. Underperforming: ' + underLabel + '. See suggestions below to improve performance.',
        action: 'Review daily output by line/shift in the Performance suggestions section; use Copy for Claude to get AI suggestions.',
        impact: 'Improves throughput',
        severity: 'high',
        _forecastBehind: forecastBehindData
      });
    }

    // 6) Performance: MTD coils vs target (from Dashboard targets)
    var targets = getTargetsFromStorage();
    var monthStr = dateKey(today).slice(0, 7);
    var mtdCoils = 0;
    history.forEach(function (h) {
      if (h.reportDate && h.reportDate.slice(0, 7) === monthStr)
        mtdCoils += h.grandTotal != null ? h.grandTotal : 0;
    });
    var monthlyTarget = targets.monthlyCoils != null ? targets.monthlyCoils : 0;
    if (monthlyTarget > 0 && mtdCoils < monthlyTarget) {
      var gap = monthlyTarget - mtdCoils;
      var daysLeft = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - today.getDate();
      var runRateNeeded = daysLeft > 0 ? (gap / daysLeft).toFixed(0) : gap;
      focusItems.push({
        id: 'perf-mtd-target',
        priority: 2,
        category: 'Performance',
        tab: 'dashboard',
        title: 'MTD coils behind monthly target',
        detail: 'MTD: ' + mtdCoils + ' coils. Target: ' + monthlyTarget + '. Gap: ' + gap + ' coils. Need ~' + runRateNeeded + ' coils/day to hit target.',
        action: 'Review Dashboard MTD by shift; address downtime and staffing; set daily run targets.',
        impact: 'Improves throughput',
        severity: 'high'
      });
    }

    // 7) Performance: last report day below 7-day average by line
    if (recentReports.length >= 2) {
      var lastReport = recentReports[0];
      var prevSeven = recentReports.slice(1, 8);
      var avgByLine = { '½ line': 0, 'Redbud': 0 };
      var countByLine = { '½ line': 0, 'Redbud': 0 };
      prevSeven.forEach(function (h) {
        (h.lines || []).forEach(function (line) {
          var name = line.name || '';
          if (avgByLine[name] !== undefined) {
            avgByLine[name] += line.lineTotal || 0;
            countByLine[name]++;
          }
        });
      });
      ['½ line', 'Redbud'].forEach(function (lineName) {
        var n = countByLine[lineName] || 0;
        if (n === 0) return;
        var avg = avgByLine[lineName] / n;
        var lastLine = (lastReport.lines || []).find(function (l) { return l.name === lineName; });
        var lastTot = lastLine ? (lastLine.lineTotal || 0) : 0;
        if (lastTot < avg * 0.85 && avg > 0) {
          focusItems.push({
            id: 'perf-line-below-' + lineName.replace(/\s/g, ''),
            priority: 3,
            category: 'Performance',
            tab: 'dashboard',
            title: lineName + ' — last run below 7-day average',
            detail: 'Last: ' + lastTot + ' coils vs 7-day avg ' + avg.toFixed(0) + '.',
            action: 'Check Enter daily / Dashboard for causes (downtime, crew, material); correct today.',
            impact: 'Improves throughput',
            severity: 'medium'
          });
        }
      });
    }

    // 8) Data freshness
    var hasOpen = openRows.length > 0;
    var hasSchedule = scheduleRows.length > 0;
    if (!hasOpen && !hasSchedule) {
      focusItems.push({
        id: 'data-upload',
        priority: 5,
        category: 'Data',
        tab: 'openstatus',
        title: 'Upload Open Orders and Production Schedule',
        detail: 'Load data in Open Status and Production Schedule tabs to see demand and schedule impact.',
        action: 'Paste data in each tab and click Apply, then refresh this list.',
        impact: 'Data',
        severity: 'low'
      });
    } else if (!hasOpen) {
      focusItems.push({
        id: 'data-open',
        priority: 5,
        category: 'Data',
        tab: 'openstatus',
        title: 'Upload Open Orders',
        detail: 'Load open orders in the Open Status tab for OTD and 72h demand view.',
        action: 'Paste in Open Status tab and click Apply.',
        impact: 'Data',
        severity: 'low'
      });
    } else if (!hasSchedule) {
      focusItems.push({
        id: 'data-schedule',
        priority: 5,
        category: 'Data',
        tab: 'schedule',
        title: 'Upload Production Schedule',
        detail: 'Load production schedule in the Production Schedule tab.',
        action: 'Paste in Production Schedule tab and click Apply.',
        impact: 'Data',
        severity: 'low'
      });
    }

    // Ensure every item has an id for completion tracking
    focusItems.forEach(function (item, idx) {
      if (!item.id) item.id = 'item-' + idx + '-' + (item.category || '').toLowerCase().replace(/\s/g, '-');
    });

    // Sort by priority then category order
    focusItems.sort(function (a, b) {
      if (a.priority !== b.priority) return a.priority - b.priority;
      var order = { Material: 0, OTD: 1, Orders: 2, Performance: 3, Schedule: 4, Capacity: 5, Maintenance: 6, Data: 7 };
      return (order[a.category] || 8) - (order[b.category] || 8);
    });

    summary.mtdCoils = mtdCoils;
    summary.monthlyTarget = monthlyTarget;
    summary.readyToShip = pastDueReady;
    summary.pastDueReady = pastDueReady;
    return { focusItems: focusItems, summary: summary, todayStr: todayStr, forecastBehind: forecastBehindData };
  }

  /** Build a text context for the OTD/Throughput Agent (or external AI). */
  function getAgentContext() {
    var result = buildFocusList();
    var focusItems = result.focusItems || [];
    var summary = result.summary || {};
    var pastDueByRoute = getPastDueNotOnScheduleByRoute();
    var byRoute = pastDueByRoute.byRoute || {};
    var routeNames = Object.keys(byRoute).sort();
    var lines = [];
    lines.push('CTL Manager — Context (same data as the CTL Manager tab)');
    lines.push('Use this to act as the CTL Manager: drive daily priorities, OTD, and throughput.');
    lines.push('Generated: ' + new Date().toISOString().slice(0, 16));
    lines.push('');
    lines.push('--- Summary ---');
    if (summary.pastDueLbs != null && summary.pastDueLbs > 0) lines.push('Past due (lbs): ' + summary.pastDueLbs.toLocaleString());
    if (summary.next72Lbs != null && summary.next72Lbs > 0) lines.push('Due next 72h (lbs): ' + summary.next72Lbs.toLocaleString());
    if (summary.readyToShip != null && summary.readyToShip > 0) lines.push('Ready to ship (lbs): ' + summary.readyToShip.toLocaleString());
    if (summary.materialBlocked72 != null && summary.materialBlocked72 > 0) lines.push('Jobs blocked (no coil / material): ' + summary.materialBlocked72);
    if (summary.mtdCoils != null) lines.push('MTD coils: ' + summary.mtdCoils + (summary.monthlyTarget > 0 ? ' / ' + summary.monthlyTarget + ' target' : ''));
    if (typeof window.getOtdSummary === 'function') {
      var otd = window.getOtdSummary('month');
      if (otd && otd.total > 0 && otd.pct != null)
        lines.push('OTD (MTD): ' + otd.pct.toFixed(1) + '% (' + otd.onTime + '/' + otd.total + ') — target ' + (otd.targetPct != null ? otd.targetPct : 95) + '%' + (otd.gap > 0 ? ' — gap: ' + otd.gap + ' more on-time to hit target' : ''));
    }
    if (_lastOperationalData && _lastOperationalData.split) {
      var split = _lastOperationalData.split;
      if (split.materialReady && split.materialReady.orders && split.materialReady.orders.length > 0)
        lines.push('Past due — material READY (fast wins): ' + split.materialReady.orders.length + ' orders, ' + (split.materialReady.totalLbs || 0).toLocaleString() + ' lbs');
      if (split.materialBlocked && split.materialBlocked.orders && split.materialBlocked.orders.length > 0)
        lines.push('Past due — material BLOCKED (no coil): ' + split.materialBlocked.orders.length + ' orders, ' + (split.materialBlocked.totalLbs || 0).toLocaleString() + ' lbs');
    }
    lines.push('');
    lines.push('--- Past due not on schedule (by route) ---');
    if (routeNames.length === 0) lines.push('None.');
    else routeNames.forEach(function (r) {
      var rec = byRoute[r];
      lines.push(r + ': ' + (rec.count || 0) + ' orders, ' + (rec.lbs || 0).toLocaleString() + ' lbs');
    });
    lines.push('');
    lines.push('--- Prioritized focus items (next 3 days) ---');
    if (focusItems.length === 0) lines.push('No focus items. Load Open Status, Production Schedule, and Material Availability for full context.');
    else focusItems.slice(0, 25).forEach(function (item, i) {
      lines.push((i + 1) + '. [' + (item.severity || '') + '] ' + (item.title || ''));
      if (item.detail) lines.push('   Detail: ' + item.detail);
      if (item.action) lines.push('   Action: ' + item.action);
      if (item.impact) lines.push('   Impact: ' + item.impact);
      lines.push('');
    });
    lines.push('--- End context ---');
    return lines.join('\n');
  }

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function openDrill(view, route) {
    if (route) drillView = { view: 'past-due-route-detail', route: route };
    else drillView = view;
    render();
  }

  function renderDrillContent() {
    var wrap = document.getElementById('manager-drill-wrap');
    var titleEl = document.getElementById('manager-drill-title');
    var bodyEl = document.getElementById('manager-drill-body');
    if (!wrap || !titleEl || !bodyEl) return;

    if (drillView === 'past-due-by-route') {
      var exportBtnByRoute = document.getElementById('btn-manager-drill-export');
      if (exportBtnByRoute) exportBtnByRoute.style.display = 'none';
      var data = getPastDueNotOnScheduleByRoute();
      titleEl.textContent = 'Past due not on schedule — by route';
      var routes = data.byRoute;
      var routeNames = Object.keys(routes).sort();
      if (routeNames.length === 0) {
        bodyEl.innerHTML = '<p class="section-note">No past-due orders that are not on schedule.</p>';
      } else {
        function attrEscape(s) {
          return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        var rows = routeNames.map(function (r) {
          var rec = routes[r];
          var rAttr = attrEscape(r);
          return '<tr class="manager-drill-route-row" data-route="' + rAttr + '" role="button" tabindex="0">' +
            '<td>' + escapeHtml(r) + '</td>' +
            '<td>' + rec.count + '</td>' +
            '<td>' + rec.lbs.toLocaleString() + '</td>' +
            '<td><button type="button" class="btn-link manager-drill-view-route" data-route="' + rAttr + '">View line-by-line</button></td>' +
            '</tr>';
        }).join('');
        bodyEl.innerHTML = '<table class="order-matches-table schedule-table manager-drill-table"><thead><tr><th>Route</th><th>Orders</th><th>Past due (lbs)</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
        bodyEl.querySelectorAll('.manager-drill-view-route').forEach(function (btn) {
          btn.addEventListener('click', function (e) { e.stopPropagation(); openDrill(null, this.getAttribute('data-route')); });
        });
        bodyEl.querySelectorAll('.manager-drill-route-row').forEach(function (row) {
          row.addEventListener('click', function () { openDrill(null, this.getAttribute('data-route')); });
          row.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDrill(null, this.getAttribute('data-route')); } });
        });
      }
    } else if (drillView && drillView.view === 'past-due-route-detail' && drillView.route) {
      var dataRoute = getPastDueNotOnScheduleByRoute();
      var routeOrders = (dataRoute.byRoute[drillView.route] && dataRoute.byRoute[drillView.route].orders) ? dataRoute.byRoute[drillView.route].orders : [];
      titleEl.textContent = 'Past due not on schedule — ' + drillView.route;
      var exportBtn = document.getElementById('btn-manager-drill-export');
      if (exportBtn) exportBtn.style.display = '';
      if (routeOrders.length === 0) {
        bodyEl.innerHTML = '<p class="section-note">No orders for this route.</p>';
      } else {
        var dispMap = getDispositionMap();
        var routeKey = drillView.route;
        function attrEscapeD(s) {
          return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }
        var optionHtml = DISPOSITION_OPTIONS.map(function (opt) {
          return '<option value="' + attrEscapeD(opt.value) + '">' + escapeHtml(opt.label) + '</option>';
        }).join('');
        var lineRows = routeOrders.map(function (o) {
          var key = routeKey + '|' + (o.orderLine || '');
          var saved = dispMap[key] || {};
          var selVal = saved.disposition || '';
          var noteVal = saved.ownerNote || '';
          var orderLineAttr = attrEscapeD(o.orderLine);
          var row = '<tr data-order-line="' + orderLineAttr + '">' +
            '<td>' + escapeHtml(o.orderLine) + '</td><td>' + escapeHtml(o.customer) + '</td><td>' + (o.balance || 0).toLocaleString() + '</td><td>' + escapeHtml(o.dueStr) + '</td><td>' + (o.onNoCoil ? 'Yes' : 'No') + '</td>' +
            '<td><select class="manager-disposition-select" data-order-line="' + orderLineAttr + '" data-route="' + attrEscapeD(routeKey) + '" aria-label="Disposition">' + optionHtml + '</select></td>' +
            '<td><input type="text" class="manager-disposition-note input-text" placeholder="Owner + note (required if Do not run)" data-order-line="' + orderLineAttr + '" data-route="' + attrEscapeD(routeKey) + '" value="' + attrEscapeD(noteVal) + '" /></td>' +
            '</tr>';
          return row;
        }).join('');
        bodyEl.innerHTML = '<p class="section-note manager-drill-process-note">Not on schedule is a control failure—fix the process, not just the list. Assign every past-due order to one of the four dispositions below.</p>' +
          '<table class="order-matches-table schedule-table manager-drill-table"><thead><tr><th>Order / Line</th><th>Customer</th><th>Balance (lbs)</th><th>Due date</th><th>On no-coil list</th><th>Disposition</th><th>Owner / Note</th></tr></thead><tbody>' + lineRows + '</tbody></table>';
        bodyEl.querySelectorAll('.manager-disposition-select').forEach(function (sel) {
          var orderLine = sel.getAttribute('data-order-line');
          sel.value = (dispMap[routeKey + '|' + orderLine] || {}).disposition || '';
          sel.addEventListener('change', function () {
            var row = sel.closest('tr');
            var noteEl = row ? row.querySelector('.manager-disposition-note') : null;
            setDisposition(routeKey, orderLine, sel.value, noteEl ? noteEl.value : '');
          });
        });
        bodyEl.querySelectorAll('.manager-disposition-note').forEach(function (input) {
          var row = input.closest('tr');
          var selEl = row ? row.querySelector('.manager-disposition-select') : null;
          var orderLine = input.getAttribute('data-order-line');
          function saveNote() { setDisposition(routeKey, orderLine, selEl ? selEl.value : '', input.value); }
          input.addEventListener('change', saveNote);
          input.addEventListener('blur', saveNote);
        });
      }
    } else {
      var exportBtnHide = document.getElementById('btn-manager-drill-export');
      if (exportBtnHide) exportBtnHide.style.display = 'none';
    }
  }

  function render() {
    var listWrap = document.getElementById('manager-focus-list-wrap');
    var drillWrap = document.getElementById('manager-drill-wrap');
    var listEl = document.getElementById('manager-focus-list');
    var emptyNote = document.getElementById('manager-empty-note');
    var summaryCards = document.getElementById('manager-summary-cards');
    var kpiStrip = document.getElementById('manager-kpi-strip');
    var priorityCountEl = document.getElementById('manager-priority-count');
    if (!listEl) return;

    if (drillView) {
      if (listWrap) listWrap.hidden = true;
      if (drillWrap) { drillWrap.hidden = false; renderDrillContent(); }
      if (summaryCards) summaryCards.hidden = true;
      return;
    }
    if (listWrap) listWrap.hidden = false;
    if (drillWrap) drillWrap.hidden = true;
    if (summaryCards) summaryCards.hidden = false;

    var result = buildFocusList();
    var items = result.focusItems;
    var summary = result.summary;
    var doneMap = getDoneMap();

    var highCount = items.filter(function (i) { return (i.severity || '') === 'high'; }).length;
    var mediumCount = items.filter(function (i) { return (i.severity || '') === 'medium'; }).length;

    if (priorityCountEl) {
      if (items.length === 0) {
        priorityCountEl.textContent = '';
        priorityCountEl.className = 'manager-priority-count';
      } else {
        priorityCountEl.innerHTML = '<span class="manager-priority-high">' + highCount + ' critical</span>' +
          (mediumCount > 0 ? ' · <span class="manager-priority-medium">' + mediumCount + ' high</span>' : '') +
          ' — complete these to improve performance';
        priorityCountEl.className = 'manager-priority-count';
      }
    }

    if (kpiStrip) {
      var kpiParts = [];
      if (summary.mtdCoils != null) {
        var targetStr = summary.monthlyTarget > 0 ? ' / ' + summary.monthlyTarget + ' target' : '';
        kpiParts.push('<span class="manager-kpi-item"><span class="manager-kpi-label">MTD coils</span><span class="manager-kpi-value">' + summary.mtdCoils + targetStr + '</span></span>');
      }
      if (summary.pastDueLbs > 0) {
        kpiParts.push('<span class="manager-kpi-item manager-kpi-alert"><span class="manager-kpi-label">Past due</span><span class="manager-kpi-value">' + formatLbsAndTons(summary.pastDueLbs) + '</span></span>');
      }
      if (summary.readyToShip > 0) {
        kpiParts.push('<span class="manager-kpi-item"><span class="manager-kpi-label">Ready to ship</span><span class="manager-kpi-value">' + formatLbsAndTons(summary.readyToShip) + '</span></span>');
      }
      if (summary.materialBlocked72 > 0) {
        kpiParts.push('<span class="manager-kpi-item manager-kpi-alert"><span class="manager-kpi-label">No coil (72h)</span><span class="manager-kpi-value">' + summary.materialBlocked72 + ' jobs</span></span>');
      }
      if (summary.next72Lbs > 0) {
        kpiParts.push('<span class="manager-kpi-item"><span class="manager-kpi-label">Due next 72h</span><span class="manager-kpi-value">' + formatLbsAndTons(summary.next72Lbs) + '</span></span>');
      }
      if (typeof window.getOtdSummary === 'function') {
        var otd = window.getOtdSummary('month');
        if (otd && otd.total > 0 && otd.pct != null) {
          var otdTargetStr = (otd.targetPct != null ? otd.targetPct : 95) + '%';
          var otdVal = otd.pct.toFixed(1) + '% / ' + otdTargetStr + ' target';
          var otdClass = otd.gap > 0 ? ' manager-kpi-alert' : '';
          kpiParts.push('<span class="manager-kpi-item' + otdClass + '"><span class="manager-kpi-label">OTD (MTD)</span><span class="manager-kpi-value">' + otdVal + (otd.gap > 0 ? ' · gap ' + otd.gap : '') + '</span></span>');
        }
      }
      kpiStrip.innerHTML = kpiParts.length ? kpiParts.join('') : '<span class="manager-kpi-item"><span class="manager-kpi-label">Load data</span><span class="manager-kpi-value">in Open Status & Schedule for KPIs</span></span>';
    }

    if (items.length === 0) {
      listEl.innerHTML = '';
      if (emptyNote) emptyNote.hidden = false;
    } else {
      if (emptyNote) emptyNote.hidden = true;
      listEl.innerHTML = items.map(function (item) {
        var severityClass = 'manager-severity-' + (item.severity || 'medium');
        var id = item.id || ('item-' + item.category);
        var done = !!doneMap[id];
        var doneClass = done ? ' manager-focus-item-done' : '';
        var impactHtml = item.impact ? '<span class="manager-focus-impact">' + escapeHtml(item.impact) + '</span>' : '';
        var actionHtml = item.action ? '<p class="manager-focus-action"><strong>Do this:</strong> ' + escapeHtml(item.action) + '</p>' : '';
        var drillHtml = (item.id === 'otd-pastdue-nocoil' || item.id === 'otd-pastdue-whynot') ? '<p class="manager-focus-drill"><button type="button" class="btn-link manager-drill-link" data-drill="past-due-by-route">View details by route →</button></p>' : '';
        var tabAttr = item.tab ? ' data-tab="' + escapeHtml(item.tab) + '"' : '';
        return '<li class="manager-focus-item ' + severityClass + doneClass + '" data-priority="' + item.priority + '" data-id="' + escapeHtml(id) + '"' + tabAttr + '>' +
          '<label class="manager-focus-check-wrap">' +
          '<input type="checkbox" class="manager-focus-done-cb" aria-label="Mark done" ' + (done ? ' checked' : '') + ' data-id="' + escapeHtml(id) + '" />' +
          '<span class="manager-focus-check-label">Done</span>' +
          '</label>' +
          '<div class="manager-focus-body">' +
          '<span class="manager-focus-category">' + escapeHtml(item.category) + '</span> ' + impactHtml +
          '<strong class="manager-focus-title">' + escapeHtml(item.title) + '</strong>' +
          '<p class="manager-focus-detail">' + escapeHtml(item.detail) + '</p>' +
          actionHtml +
          drillHtml +
          '</div></li>';
      }).join('');
    }

    listEl.querySelectorAll('.manager-focus-done-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = this.getAttribute('data-id');
        if (id) setDone(id, this.checked);
        render();
      });
    });
    listEl.querySelectorAll('.manager-drill-link').forEach(function (link) {
      link.addEventListener('click', function () { openDrill(this.getAttribute('data-drill')); });
    });
    listEl.querySelectorAll('.manager-focus-item[data-tab]').forEach(function (li) {
      var body = li.querySelector('.manager-focus-body');
      var tabId = li.getAttribute('data-tab');
      if (body && tabId && typeof window.ctlSwitchTab === 'function') {
        body.style.cursor = 'pointer';
        body.addEventListener('click', function (e) {
          if (e.target.closest('.manager-focus-done-cb') || e.target.closest('.manager-drill-link')) return;
          window.ctlSwitchTab(tabId);
        });
      }
    });

    if (summaryCards) {
      var cards = [];
      if (summary.materialBlocked72 > 0) {
        cards.push('<div class="salvage-card stat-card"><span class="stat-label">Jobs blocked (material) — due in 72h</span><span class="stat-value">' + summary.materialBlocked72 + '</span></div>');
      }
      if (summary.pastDueLbs > 0) {
        cards.push('<div class="salvage-card stat-card"><span class="stat-label">Past due</span><span class="stat-value">' + formatLbsAndTons(summary.pastDueLbs) + '</span></div>');
      }
      if (summary.next72Lbs > 0) {
        cards.push('<div class="salvage-card stat-card"><span class="stat-label">Due next 72h</span><span class="stat-value">' + formatLbsAndTons(summary.next72Lbs) + '</span></div>');
      }
      if (summary.avgCoilsPerDay != null) {
        cards.push('<div class="salvage-card stat-card"><span class="stat-label">Recent avg coils/day</span><span class="stat-value">' + summary.avgCoilsPerDay + '</span></div>');
      }
      summaryCards.innerHTML = cards.length ? '<div class="schedule-summary-grid">' + cards.join('') + '</div>' : '';
    }

    var forecastSection = document.getElementById('manager-forecast-suggestions-section');
    var suggestionsTablesEl = document.getElementById('manager-suggestions-tables');
    var suggestionsListEl = document.getElementById('manager-suggestions-list');
    if (result.forecastBehind && result.forecastBehind.behind && forecastSection && suggestionsTablesEl && suggestionsListEl) {
      forecastSection.hidden = false;
      var fb = result.forecastBehind;
      var underKeys = {};
      (fb.wtdAnalysis.underperforming || []).forEach(function (u) { underKeys[u.key] = true; });
      (fb.mtdAnalysis.underperforming || []).forEach(function (u) { underKeys[u.key] = true; });
      function tableHtml(analysis, label) {
        if (!analysis || !analysis.cells.length) return '';
        var rows = analysis.cells.map(function (c) {
          var trClass = underKeys[c.key] ? ' manager-suggestion-row-under' : '';
          return '<tr class="' + trClass + '"><td>' + escapeHtml(c.lineName) + '</td><td>' + escapeHtml(c.shiftName) + '</td><td>' + c.coils + '</td><td>' + c.shifts + '</td><td>' + (c.avgPerDay != null ? c.avgPerDay.toFixed(1) : '—') + '</td><td>' + (c.pct != null ? c.pct.toFixed(0) + '%' : '—') + '</td></tr>';
        }).join('');
        return '<div class="manager-suggestion-table-wrap"><h4 class="manager-suggestions-subtitle">' + escapeHtml(label) + '</h4><table class="order-matches-table schedule-table manager-drill-table"><thead><tr><th>Line</th><th>Shift</th><th>Coils</th><th>Shifts</th><th>Avg/day</th><th>% of total</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      }
      var tablesHtml = '';
      if (fb.behind80WTD) tablesHtml += tableHtml(fb.wtdAnalysis, 'WTD — daily output by line & shift');
      if (fb.behind80MTD) tablesHtml += tableHtml(fb.mtdAnalysis, 'MTD — daily output by line & shift');
      suggestionsTablesEl.innerHTML = tablesHtml;
      suggestionsListEl.innerHTML = (fb.suggestions || []).map(function (s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('');
      window._lastForecastBehind = fb;
    } else {
      if (forecastSection) forecastSection.hidden = true;
      window._lastForecastBehind = null;
    }

    renderManagerOperationalPanels();
  }

  function copyForClaude() {
    var fb = window._lastForecastBehind;
    if (!fb || !fb.behind) {
      if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText)
        navigator.clipboard.writeText('No forecast-behind data. Open Manager tab and refresh when WTD or MTD forecast is at or below 80% of target.');
      return;
    }
    var lines = [
      'CTL production — forecast behind target. Please suggest concrete actions to improve performance.',
      '',
      'Summary:',
      '- WTD forecast: ' + (fb.forecastWeek || '—') + ' coils (target ' + (fb.weeklyTarget || '—') + '). Behind 80%: ' + (fb.behind80WTD ? 'Yes' : 'No') + '.',
      '- MTD forecast: ' + (fb.forecastMonth || '—') + ' coils (target ' + (fb.monthlyTarget || '—') + '). Behind 80%: ' + (fb.behind80MTD ? 'Yes' : 'No') + '.',
      '',
      'Daily output by line and shift (underperforming):'
    ];
    (fb.wtdAnalysis && fb.wtdAnalysis.underperforming || []).forEach(function (u) {
      lines.push('- WTD: ' + u.lineName + ' ' + u.shiftName + ' — ' + u.coils + ' coils, ' + u.pct.toFixed(0) + '% of total.');
    });
    (fb.mtdAnalysis && fb.mtdAnalysis.underperforming || []).forEach(function (u) {
      lines.push('- MTD: ' + u.lineName + ' ' + u.shiftName + ' — ' + u.coils + ' coils, ' + u.pct.toFixed(0) + '% of total.');
    });
    lines.push('', 'Current suggestions from the app:', '');
    (fb.suggestions || []).forEach(function (s) { lines.push(s); });
    lines.push('', 'Based on the above, what specific actions should the CTL manager take to get back on target?');
    var text = lines.join('\n');
    if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.getElementById('btn-manager-copy-for-claude');
        if (btn) { btn.textContent = 'Copied! Paste into Claude.'; setTimeout(function () { btn.textContent = 'Copy for Claude'; }, 3000); }
      });
    }
  }

  /**
   * Build options for Lookahead capacity: use MTD run data (coils × LBS_PER_COIL) when available,
   * else fall back to run-rate-based capacity.
   */
  function getLookaheadCapacityOptions() {
    var history = getReportHistory();
    var today = todayStart();
    var monthStr = dateKey(today).slice(0, 7);
    var mtdCoils = 0;
    var mtdReportDates = [];
    history.forEach(function (h) {
      if (!h.reportDate || h.reportDate.slice(0, 7) !== monthStr) return;
      mtdCoils += h.grandTotal != null ? h.grandTotal : 0;
      if (mtdReportDates.indexOf(h.reportDate) === -1) mtdReportDates.push(h.reportDate);
    });
    var operatingDaysMTD = mtdReportDates.filter(function (dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      return d.getDay() >= 1 && d.getDay() <= 5;
    }).length;
    if (operatingDaysMTD > 0 && mtdCoils > 0) {
      var capacityLbsPerDay = (mtdCoils / operatingDaysMTD) * LBS_PER_COIL;
      return { capacityLbsPerDay: capacityLbsPerDay };
    }
    return { runRateLbsPerHour: 20000 };
  }

  function renderManagerOperationalPanels() {
    if (typeof window.ManagerLogic === 'undefined') return;
    var Logic = window.ManagerLogic;
    var today = todayStart();
    var now = new Date();
    var openData = typeof window.ctlOpenStatusGetData === 'function' ? window.ctlOpenStatusGetData() : null;
    var openRows = (openData && openData.rows) ? openData.rows : [];
    var scheduleRows = (typeof window.ctlScheduleRows !== 'undefined' && window.ctlScheduleRows) ? window.ctlScheduleRows : [];
    var blockedList = typeof window.ctlMaterialAvailabilityGetBlocked === 'function' ? window.ctlMaterialAvailabilityGetBlocked() : [];
    var orderIdsOnSchedule = {};
    scheduleRows.forEach(function (r) {
      var o = (r.order || r.orderLine || '').toString().trim();
      if (o) orderIdsOnSchedule[o] = true;
      if (r.order && r.item) orderIdsOnSchedule[(r.order + '-' + r.item).toString().trim()] = true;
    });
    var blockedOrderIds = {};
    blockedList.forEach(function (b) {
      var o = Logic.normalizeOrderId(b);
      if (o) blockedOrderIds[o] = true;
    });

    var end72 = new Date(today);
    end72.setDate(end72.getDate() + 2);

    var feasibility = Logic.getScheduleFeasibility48h(scheduleRows, blockedList, now);
    var jobs = feasibility.jobs;
    var filtered = jobs.filter(function (j) {
      if (feasibilityFilter === 'all') return true;
      if (feasibilityFilter === 'not-ready') return !j.materialReady;
      if (feasibilityFilter === 'ready') return j.materialReady;
      if (feasibilityFilter === 'Line 1' || feasibilityFilter === 'Line 2') return j.lineId === feasibilityFilter;
      return true;
    });
    var tbody48 = document.getElementById('manager-feasibility-tbody');
    if (tbody48) {
      tbody48.innerHTML = filtered.length === 0 ? '<tr><td colspan="7">No jobs in next 48h or none match filter.</td></tr>' : filtered.map(function (j) {
        return '<tr>' +
          '<td>' + escapeHtml(j.lineId) + '</td>' +
          '<td>' + escapeHtml(j.runDateKey) + '</td>' +
          '<td>' + escapeHtml(j.orderId) + '</td>' +
          '<td>' + (j.weightLbs || 0).toLocaleString() + '</td>' +
          '<td>' + (j.materialReady ? 'Ready' : 'Not Ready') + '</td>' +
          '<td>' + (j.reasonCode ? escapeHtml(j.reasonCode) : '—') + '</td>' +
          '<td>' + (j.actionText ? escapeHtml(j.actionText) : '—') + '</td></tr>';
      }).join('');
    }

    var split = Logic.getPastDueNotScheduledSplit(openRows, scheduleRows, blockedList, today);
    var fastwinsSummary = document.getElementById('manager-fastwins-summary');
    if (fastwinsSummary) fastwinsSummary.textContent = 'Top 10 · Total ' + split.materialReady.totalLbs.toLocaleString() + ' lbs. Add to schedule (material ready).';
    var fastwinsTbody = document.getElementById('manager-fastwins-tbody');
    if (fastwinsTbody) {
      fastwinsTbody.innerHTML = split.materialReady.orders.length === 0 ? '<tr><td colspan="4">None</td></tr>' : split.materialReady.orders.map(function (o) {
        return '<tr><td>' + escapeHtml(o.orderId) + '</td><td>' + escapeHtml(o.customer) + '</td><td>' + (o.balance || 0).toLocaleString() + '</td><td>' + escapeHtml(o.dueStr) + '</td></tr>';
      }).join('');
    }
    var blockedSummary = document.getElementById('manager-blocked-summary');
    if (blockedSummary) blockedSummary.textContent = 'Top 10 · Total ' + split.materialBlocked.totalLbs.toLocaleString() + ' lbs. Top gaps: ' + (split.materialBlocked.topGaps.map(function (g) { return g.reasonCode; }).join(', ') || '—');
    var blockedTbody = document.getElementById('manager-blocked-tbody');
    if (blockedTbody) {
      var orderIdAttr = function (id) { return (id && String(id).trim()) ? ' data-order="' + escapeHtml(String(id).trim()) + '"' : ''; };
      blockedTbody.innerHTML = split.materialBlocked.orders.length === 0 ? '<tr><td colspan="6">None</td></tr>' : split.materialBlocked.orders.map(function (o) {
        return '<tr><td>' + escapeHtml(o.orderId) + '</td><td>' + escapeHtml(o.customer) + '</td><td>' + (o.balance || 0).toLocaleString() + '</td><td>' + escapeHtml(o.reasonCode || '—') + '</td><td>' + escapeHtml((o.actionText || '').slice(0, 60)) + '</td><td><span class="blocked-owner" contenteditable="true"' + orderIdAttr(o.orderId) + '></span></td></tr>';
      }).join('');
      if (typeof window.ctlRestoreBlockedOwners === 'function') window.ctlRestoreBlockedOwners(blockedTbody);
    }
    _lastOperationalData = { split: split };

    var lookaheadOptions = getLookaheadCapacityOptions();
    var lookahead7 = Logic.getLookahead(7, openRows, scheduleRows, blockedList, lookaheadOptions);
    var lookahead14 = Logic.getLookahead(14, openRows, scheduleRows, blockedList, lookaheadOptions);
    var lookahead30 = Logic.getLookahead(30, openRows, scheduleRows, blockedList, lookaheadOptions);
    var cardsEl = document.getElementById('manager-lookahead-cards');
    if (cardsEl) {
      var flags = function (h) {
        var f = [];
        if (h.flags.CAPACITY_TIGHT) f.push('CAPACITY_TIGHT');
        if (h.flags.COIL_COVERAGE_LOW) f.push('COIL_COVERAGE_LOW');
        if (h.flags.WAVE) f.push('WAVE');
        return f.length ? f.join(', ') : '—';
      };
      cardsEl.innerHTML =
        '<div class="manager-lookahead-card"><h4>' + lookahead7.horizonDays + ' days</h4><p>Demand: ' + lookahead7.demandLbs.toLocaleString() + ' lbs</p><p>Capacity: ' + lookahead7.capacityLbs.toLocaleString() + ' lbs</p><p>Flags: ' + flags(lookahead7) + '</p><p>Coil: on-hand ' + lookahead7.coilCoverage.onHandLbs.toLocaleString() + ' / inbound ' + lookahead7.coilCoverage.inboundLbs.toLocaleString() + ' / no-plan ' + lookahead7.coilCoverage.noPlanLbs.toLocaleString() + '</p><p>Top gaps: ' + (lookahead7.topGaps.map(function (g) { return g.spec + ' ' + g.lbs.toLocaleString() + ' lbs'; }).join('; ') || '—') + '</p></div>' +
        '<div class="manager-lookahead-card"><h4>' + lookahead14.horizonDays + ' days</h4><p>Demand: ' + lookahead14.demandLbs.toLocaleString() + ' lbs</p><p>Capacity: ' + lookahead14.capacityLbs.toLocaleString() + ' lbs</p><p>Flags: ' + flags(lookahead14) + '</p><p>Coil: on-hand ' + lookahead14.coilCoverage.onHandLbs.toLocaleString() + ' / inbound ' + lookahead14.coilCoverage.inboundLbs.toLocaleString() + ' / no-plan ' + lookahead14.coilCoverage.noPlanLbs.toLocaleString() + '</p><p>Top gaps: ' + (lookahead14.topGaps.map(function (g) { return g.spec + ' ' + g.lbs.toLocaleString() + ' lbs'; }).join('; ') || '—') + '</p></div>' +
        '<div class="manager-lookahead-card"><h4>' + lookahead30.horizonDays + ' days</h4><p>Demand: ' + lookahead30.demandLbs.toLocaleString() + ' lbs</p><p>Capacity: ' + lookahead30.capacityLbs.toLocaleString() + ' lbs</p><p>Flags: ' + flags(lookahead30) + '</p><p>Coil: on-hand ' + lookahead30.coilCoverage.onHandLbs.toLocaleString() + ' / inbound ' + lookahead30.coilCoverage.inboundLbs.toLocaleString() + ' / no-plan ' + lookahead30.coilCoverage.noPlanLbs.toLocaleString() + '</p><p>Top gaps: ' + (lookahead30.topGaps.map(function (g) { return g.spec + ' ' + g.lbs.toLocaleString() + ' lbs'; }).join('; ') || '—') + '</p></div>';
    }
  }

  function copyPastDueList(which) {
    var data = _lastOperationalData && _lastOperationalData.split;
    if (!data) return;
    var list = which === 'fastwins' ? data.materialReady.orders : data.materialBlocked.orders;
    var label = which === 'fastwins' ? 'Past due NOT scheduled — MATERIAL READY (fast wins)' : 'Past due NOT scheduled — MATERIAL BLOCKED';
    var totalLbs = which === 'fastwins' ? data.materialReady.totalLbs : data.materialBlocked.totalLbs;
    var lines = [label, 'Total lbs: ' + totalLbs.toLocaleString(), ''];
    list.forEach(function (o, i) {
      lines.push((i + 1) + '. ' + o.orderId + ' — ' + o.customer + ' — ' + (o.balance || 0).toLocaleString() + ' lbs — Due ' + o.dueStr);
      if (which === 'blocked' && o.reasonCode) lines.push('   Reason: ' + o.reasonCode + '. ' + (o.actionText || ''));
    });
    var text = lines.join('\n');
    if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.getElementById(which === 'fastwins' ? 'btn-copy-fastwins' : 'btn-copy-blocked');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy list'; }, 2000); }
      });
    }
  }

  function copyFocusListToClipboard() {
    var result = buildFocusList();
    var items = result.focusItems;
    if (items.length === 0) {
      if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
        navigator.clipboard.writeText('No focus items. Load Open Orders, Schedule, and Material Availability and refresh.');
      }
      return;
    }
    var lines = ['CTL Manager — Focus list (' + result.todayStr + ')', ''];
    items.forEach(function (item, i) {
      lines.push((i + 1) + '. [' + (item.category || '') + '] ' + (item.title || ''));
      lines.push('   ' + (item.detail || ''));
      if (item.action) lines.push('   Do this: ' + item.action);
      lines.push('');
    });
    var text = lines.join('\n');
    if (typeof navigator.clipboard !== 'undefined' && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        var btn = document.getElementById('btn-manager-copy');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy focus list'; }, 2000); }
      });
    }
  }

  window.ctlManagerRefresh = function () {
    render();
  };
  window.ctlManagerGetAgentContext = getAgentContext;

  function init() {
    function csvEscape(s) {
      var str = (s == null ? '' : String(s)).replace(/"/g, '""');
      if (/[,\r\n"]/.test(str)) return '"' + str + '"';
      return str;
    }
    function exportManagerFocusToCsv() {
      var result = buildFocusList();
      var items = result.focusItems || [];
      var rows = [['Category', 'Title', 'Detail', 'Action'].map(csvEscape).join(',')];
      items.forEach(function (item) {
        rows.push([item.category || '', item.title || '', item.detail || '', item.action || ''].map(csvEscape).join(','));
      });
      var csv = rows.join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ctl-manager-focus.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    }
    var btn = document.getElementById('btn-manager-refresh');
    if (btn) btn.addEventListener('click', function () { drillView = null; render(); });
    var copyBtn = document.getElementById('btn-manager-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyFocusListToClipboard);
    var exportCsvBtn = document.getElementById('btn-manager-export-csv');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportManagerFocusToCsv);
    var backBtn = document.getElementById('btn-manager-drill-back');
    if (backBtn) backBtn.addEventListener('click', function () {
      if (drillView && drillView.view === 'past-due-route-detail') drillView = 'past-due-by-route';
      else drillView = null;
      render();
    });
    var drillExportBtn = document.getElementById('btn-manager-drill-export');
    if (drillExportBtn) drillExportBtn.addEventListener('click', function () {
      if (!drillView || drillView.view !== 'past-due-route-detail' || !drillView.route) return;
      var bodyEl = document.getElementById('manager-drill-body');
      var tbody = bodyEl ? bodyEl.querySelector('tbody') : null;
      if (!tbody || !tbody.rows || tbody.rows.length === 0) return;
      function csvEscape(s) {
        var str = String(s == null ? '' : s);
        if (str.indexOf('"') >= 0) str = str.replace(/"/g, '""');
        if (/[,\r\n"]/.test(str)) return '"' + str + '"';
        return str;
      }
      var header = 'Order / Line,Customer,Balance (lbs),Due date,On no-coil list,Disposition,Owner / Note';
      var rows = [];
      for (var i = 0; i < tbody.rows.length; i++) {
        var tr = tbody.rows[i];
        var cells = tr.cells;
        if (cells.length < 7) continue;
        var orderLine = (cells[0] && cells[0].textContent) ? cells[0].textContent.trim() : '';
        var customer = (cells[1] && cells[1].textContent) ? cells[1].textContent.trim() : '';
        var balance = (cells[2] && cells[2].textContent) ? cells[2].textContent.trim() : '';
        var dueStr = (cells[3] && cells[3].textContent) ? cells[3].textContent.trim() : '';
        var onNoCoil = (cells[4] && cells[4].textContent) ? cells[4].textContent.trim() : '';
        var sel = tr.querySelector('.manager-disposition-select');
        var dispLabel = sel && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
        var noteInput = tr.querySelector('.manager-disposition-note');
        var ownerNote = noteInput ? noteInput.value.trim() : '';
        rows.push(csvEscape(orderLine) + ',' + csvEscape(customer) + ',' + csvEscape(balance) + ',' + csvEscape(dueStr) + ',' + csvEscape(onNoCoil) + ',' + csvEscape(dispLabel) + ',' + csvEscape(ownerNote));
      }
      var csv = header + '\r\n' + rows.join('\r\n');
      var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'past-due-not-on-schedule-' + (drillView.route || 'route').replace(/[^\w\-]/g, '_') + '.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    });
    var copyClaudeBtn = document.getElementById('btn-manager-copy-for-claude');
    if (copyClaudeBtn) copyClaudeBtn.addEventListener('click', copyForClaude);
    var feasibilityHeader = document.getElementById('manager-feasibility-header');
    var feasibilityBody = document.getElementById('manager-feasibility-body');
    var feasibilityToggleIcon = document.getElementById('manager-feasibility-toggle-icon');
    if (feasibilityHeader && feasibilityBody) {
      function toggleFeasibilityPanel() {
        var expanded = feasibilityHeader.getAttribute('aria-expanded') === 'true';
        feasibilityHeader.setAttribute('aria-expanded', !expanded);
        feasibilityBody.hidden = expanded;
        if (feasibilityToggleIcon) feasibilityToggleIcon.textContent = expanded ? '▶' : '▼';
      }
      feasibilityHeader.addEventListener('click', function (e) { e.preventDefault(); toggleFeasibilityPanel(); });
      feasibilityHeader.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleFeasibilityPanel(); }
      });
    }
    document.querySelectorAll('#manager-feasibility-chips .manager-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#manager-feasibility-chips .manager-chip').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        feasibilityFilter = chip.getAttribute('data-filter') || 'all';
        renderManagerOperationalPanels();
      });
    });
    var btnFastwins = document.getElementById('btn-copy-fastwins');
    if (btnFastwins) btnFastwins.addEventListener('click', function () { copyPastDueList('fastwins'); });
    var btnBlocked = document.getElementById('btn-copy-blocked');
    if (btnBlocked) btnBlocked.addEventListener('click', function () { copyPastDueList('blocked'); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
