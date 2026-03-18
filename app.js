/**
 * CTL Daily Production Report — main app logic.
 * Renders summary, line cards, charts; report date; history; paste-from-email; panels.
 */

(function () {
  'use strict';

  var HISTORY_KEY = 'ctl-report-history';
  var TARGETS_KEY = 'ctl-targets';
  var REPORT_DATE_KEY = 'ctl-report-date';
  var EQUIPMENT_KEY = 'ctl-equipment-list';
  var ISSUES_KEY = 'ctl-issue-types';
  var THEME_KEY = 'ctl-theme';
  var BLOCKED_OWNERS_KEY = 'ctl-blocked-owners';

  var currentReport = null;
  var chartCoils = null;
  var chartDowntime = null;
  var chartDailyCoils = null;
  var chartStaffing = null;

  function getHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveDayToHistory(day) {
    var history = getHistory();
    var dateStr = day.reportDate;
    var idx = history.findIndex(function (h) { return h.reportDate === dateStr; });
    if (idx >= 0) history[idx] = day;
    else history.push(day);
    history.sort(function (a, b) { return a.reportDate < b.reportDate ? 1 : -1; });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  }

  function getTargets() {
    try {
      var raw = localStorage.getItem(TARGETS_KEY);
      var def = { monthlyCoils: null, maxDowntimeCost: null, costPerHourHalfLine: null, costPerHourRedbud: null, hoursBudgetedHalfLine: null, hoursBudgetedRedbud: null, otdTargetPct: 95 };
      if (!raw) return def;
      var o = JSON.parse(raw);
      return {
        monthlyCoils: o.monthlyCoils != null ? o.monthlyCoils : null,
        maxDowntimeCost: o.maxDowntimeCost != null ? o.maxDowntimeCost : null,
        costPerHourHalfLine: o.costPerHourHalfLine != null ? o.costPerHourHalfLine : null,
        costPerHourRedbud: o.costPerHourRedbud != null ? o.costPerHourRedbud : null,
        hoursBudgetedHalfLine: o.hoursBudgetedHalfLine != null ? o.hoursBudgetedHalfLine : null,
        hoursBudgetedRedbud: o.hoursBudgetedRedbud != null ? o.hoursBudgetedRedbud : null,
        otdTargetPct: o.otdTargetPct != null && o.otdTargetPct > 0 ? o.otdTargetPct : 95
      };
    } catch (e) {
      return { monthlyCoils: null, maxDowntimeCost: null, costPerHourHalfLine: null, costPerHourRedbud: null, hoursBudgetedHalfLine: null, hoursBudgetedRedbud: null, otdTargetPct: 95 };
    }
  }

  function saveTargets(t) {
    localStorage.setItem(TARGETS_KEY, JSON.stringify(t));
  }

  function getEquipmentList() {
    try {
      var raw = localStorage.getItem(EQUIPMENT_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return typeof DEFAULT_EQUIPMENT_LIST !== 'undefined' && DEFAULT_EQUIPMENT_LIST
      ? DEFAULT_EQUIPMENT_LIST.slice()
      : [];
  }

  function getIssueTypes() {
    try {
      var raw = localStorage.getItem(ISSUES_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    return typeof DEFAULT_ISSUE_TYPES !== 'undefined' && DEFAULT_ISSUE_TYPES
      ? DEFAULT_ISSUE_TYPES.slice()
      : [];
  }

  function getProcessDelayTypes() {
    var def = (typeof DEFAULT_PROCESS_DELAY_TYPES !== 'undefined' && DEFAULT_PROCESS_DELAY_TYPES) ? DEFAULT_PROCESS_DELAY_TYPES.slice() : [];
    try {
      var raw = localStorage.getItem('ctl-process-delay-types');
      if (raw) {
        var saved = JSON.parse(raw);
        def.forEach(function (d) {
          if (saved.indexOf(d) === -1) saved.push(d);
        });
        return saved;
      }
    } catch (e) {}
    return def;
  }

  var SHIFT_NAMES = ['1st', '2nd'];
  var CREW_IDS = (typeof CREW_IDS !== 'undefined' && CREW_IDS) ? CREW_IDS : ['A', 'B', 'C', 'D'];

  function getZeroReport(dateStr) {
    return {
      reportDate: dateStr,
      reportLabel: 'Daily production',
      lines: [
        { name: '½ line', shifts: [{ shift: '1st', crewId: 'A', coils: 0, downtime: [], processDelays: [], crew: 0, shiftHours: 12 }, { shift: '2nd', crewId: 'B', coils: 0, downtime: [], processDelays: [], crew: 0, shiftHours: 12 }], lineTotal: 0 },
        { name: 'Redbud', shifts: [{ shift: '1st', crewId: 'A', coils: 0, downtime: [], processDelays: [], crew: 0, shiftHours: 12 }, { shift: '2nd', crewId: 'B', coils: 0, downtime: [], processDelays: [], crew: 0, shiftHours: 12 }], lineTotal: 0 }
      ],
      grandTotal: 0
    };
  }

  /** Ensure every line has exactly 2 shifts (1st, 2nd) and crewId for Enter daily form and display. */
  function ensureTwoShifts(report) {
    if (!report || !report.lines) return;
    report.lines.forEach(function (line) {
      var shifts = line.shifts || [];
      var byName = {};
      shifts.forEach(function (s) {
        var name = (s.shift || '').trim();
        if (name) byName[name] = s;
      });
      var out = [];
      SHIFT_NAMES.forEach(function (name, idx) {
        if (byName[name]) {
          var sh = byName[name];
          if (!sh.processDelays) sh.processDelays = [];
          if (sh.crewId == null) sh.crewId = CREW_IDS[idx] || 'A';
          out.push(sh);
        } else if (shifts[idx]) {
          shifts[idx].shift = name;
          if (!shifts[idx].processDelays) shifts[idx].processDelays = [];
          if (shifts[idx].crewId == null) shifts[idx].crewId = CREW_IDS[idx] || 'A';
          out.push(shifts[idx]);
        } else {
          out.push({ shift: name, crewId: CREW_IDS[idx] || 'A', coils: 0, downtime: [], processDelays: [], crew: 0, shiftHours: 12 });
        }
      });
      line.shifts = out;
    });
  }

  function totalDowntimeMinutes(report) {
    if (!report || !report.lines) return 0;
    var total = 0;
    report.lines.forEach(function (line) {
      (line.shifts || []).forEach(function (s) {
        (s.downtime || []).forEach(function (d) {
          total += d.durationMinutes || 0;
        });
        (s.processDelays || []).forEach(function (d) {
          total += d.durationMinutes || 0;
        });
      });
    });
    return total;
  }

  function totalManHours(report) {
    if (!report || !report.lines) return 0;
    var total = 0;
    report.lines.forEach(function (line) {
      (line.shifts || []).forEach(function (s) {
        total += (s.crew || 0) * (s.shiftHours || 12);
      });
    });
    return total;
  }

  function renderSummary() {
    var r = currentReport;
    if (!r) return;
    var halfLine = 0;
    var redbud = 0;
    (r.lines || []).forEach(function (line) {
      if (line.name === '½ line') halfLine = line.lineTotal || 0;
      if (line.name === 'Redbud') redbud = line.lineTotal || 0;
    });
    setEl('#total-coils', String(r.grandTotal != null ? r.grandTotal : '—'));
    setEl('#half-line-total', String(halfLine));
    setEl('#redbud-total', String(redbud));
    var mins = totalDowntimeMinutes(r);
    setEl('#total-downtime', mins > 0 ? mins + ' min' : '—');
    var totalCrew = 0;
    var totalHoursScheduled = 0;
    (r.lines || []).forEach(function (line) {
      (line.shifts || []).forEach(function (s) {
        totalCrew += s.crew || 0;
        totalHoursScheduled += s.shiftHours || 0;
      });
    });
    setEl('#operators-day', totalCrew > 0 ? String(totalCrew) : '—');
    setEl('#hours-scheduled-day', totalHoursScheduled > 0 ? String(totalHoursScheduled) : '—');
    setEl('#man-hours', String(totalManHours(r)));
  }

  function renderAvgOperators() {
    var grid = document.getElementById('avg-operators-grid');
    if (!grid) return;
    var history = getHistory();
    if (!history.length) {
      grid.innerHTML = '<div class="tracking-item"><span class="label">No history</span><span class="value">—</span></div>';
      return;
    }
    var sums = {};
    var counts = {};
    history.forEach(function (h) {
      (h.lines || []).forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          var key = (line.name || '') + '|' + (s.shift || '');
          if (!sums[key]) { sums[key] = 0; counts[key] = 0; }
          sums[key] += s.crew != null ? s.crew : 0;
          counts[key]++;
        });
      });
    });
    var html = '';
    ['½ line|1st', '½ line|2nd', 'Redbud|1st', 'Redbud|2nd'].forEach(function (key) {
      var n = counts[key] || 0;
      var avg = n > 0 ? (sums[key] / n).toFixed(1) : '—';
      var label = key.replace('|', ' ');
      html += '<div class="tracking-item"><span class="label">' + escapeHtml(label) + '</span><span class="value">' + avg + '</span></div>';
    });
    grid.innerHTML = html;
  }

  function renderLines() {
    var wrap = document.getElementById('lines-section');
    if (!wrap) return;
    if (!currentReport || !currentReport.lines || currentReport.lines.length === 0) {
      wrap.innerHTML = '';
      return;
    }
    var html = '';
    currentReport.lines.forEach(function (line) {
      html += '<div class="line-card"><h3>' + escapeHtml(line.name) + '</h3>';
      (line.shifts || []).forEach(function (s) {
        html += '<div class="shift-row"><span class="shift-label">' + escapeHtml(s.shift || '') + '</span><span class="shift-coils">' + (s.coils != null ? s.coils : '—') + ' coils</span></div>';
        if (s.crew != null || s.shiftHours != null) {
          html += '<div class="shift-row shift-meta"><span class="shift-label">Operators / hours</span><span>' + (s.crew != null ? s.crew : '—') + ' / ' + (s.shiftHours != null ? s.shiftHours : '—') + ' hr</span></div>';
        }
        if (s.downtime && s.downtime.length > 0) {
          html += '<ul class="downtime-list">';
          var eqList = getEquipmentList();
          s.downtime.forEach(function (d) {
            var label = '';
            if (d.equipmentId) {
              var eq = eqList.find(function (e) { return e.id === d.equipmentId; });
              label = (d.planned ? '[Planned] ' : '') + (eq ? eq.name : d.equipmentId) + (d.issueType ? ' (' + d.issueType + ')' : '') + ' — ' + (d.durationMinutes != null ? d.durationMinutes + ' min' : '') + (d.reason ? ' — ' + d.reason : '');
            } else {
              label = (d.planned ? '[Planned] ' : '') + (d.durationText || (d.durationMinutes != null ? d.durationMinutes + ' min' : '')) + (d.reason ? ' — ' + d.reason : '');
            }
            html += '<li class="' + (d.planned ? 'downtime-planned' : '') + '">' + escapeHtml(label) + '</li>';
          });
          html += '</ul>';
        }
        if (s.processDelays && s.processDelays.length > 0) {
          html += '<ul class="downtime-list process-delay-list">';
          s.processDelays.forEach(function (d) {
            var label = (d.type || 'Process delay') + ' — ' + (d.durationMinutes != null ? d.durationMinutes + ' min' : '') + (d.notes ? ' — ' + d.notes : '');
            html += '<li class="downtime-process-delay">' + escapeHtml(label) + '</li>';
          });
          html += '</ul>';
        }
        if (s.notes) html += '<p class="section-note" style="margin-top:0.25rem">' + escapeHtml(s.notes) + '</p>';
      });
      html += '<div class="line-total-row">Line total: ' + (line.lineTotal != null ? line.lineTotal : '—') + ' coils</div></div>';
    });
    wrap.innerHTML = html;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function setEl(sel, text) {
    var el = document.querySelector(sel);
    if (el) el.textContent = text;
  }

  function destroyCharts() {
    if (chartCoils) { chartCoils.destroy(); chartCoils = null; }
    if (chartDowntime) { chartDowntime.destroy(); chartDowntime = null; }
    if (chartDailyCoils) { chartDailyCoils.destroy(); chartDailyCoils = null; }
    if (chartStaffing) { chartStaffing.destroy(); chartStaffing = null; }
  }

  function initCharts() {
    destroyCharts();
    if (typeof Chart === 'undefined') return;

    var r = currentReport;
    var labels = [];
    var coilsData = [];
    if (r && r.lines) {
      r.lines.forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          labels.push(line.name + ' ' + (s.shift || ''));
          coilsData.push(s.coils != null ? s.coils : 0);
        });
      });
    }
    var ctxCoils = document.getElementById('chart-coils');
    if (ctxCoils) {
      chartCoils = new Chart(ctxCoils, {
        type: 'bar',
        data: {
          labels: labels.length ? labels : ['½ line 1st', '½ line 2nd', 'Redbud 1st', 'Redbud 2nd'],
          datasets: [{ label: 'Coils', data: coilsData.length ? coilsData : [0, 0, 0, 0], backgroundColor: 'rgba(91, 141, 239, 0.7)', borderColor: 'rgb(91, 141, 239)', borderWidth: 1 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    }

    var lineLabels = [];
    var downtimeData = [];
    if (r && r.lines) {
      r.lines.forEach(function (line) {
        var mins = 0;
        (line.shifts || []).forEach(function (s) {
          (s.downtime || []).forEach(function (d) { mins += d.durationMinutes || 0; });
          (s.processDelays || []).forEach(function (d) { mins += d.durationMinutes || 0; });
        });
        lineLabels.push(line.name);
        downtimeData.push(mins);
      });
    }
    var ctxDowntime = document.getElementById('chart-downtime');
    if (ctxDowntime) {
      chartDowntime = new Chart(ctxDowntime, {
        type: 'bar',
        data: {
          labels: lineLabels.length ? lineLabels : ['½ line', 'Redbud'],
          datasets: [{ label: 'Minutes', data: downtimeData.length ? downtimeData : [0, 0], backgroundColor: 'rgba(245, 166, 35, 0.7)', borderColor: 'rgb(245, 166, 35)', borderWidth: 1 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: { y: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    }

    var history = getHistory();
    var startDateEl = document.getElementById('chart-daily-start-date');
    var daysEl = document.getElementById('chart-daily-days');
    var chartDays = (daysEl && daysEl.value !== '') ? Math.min(90, Math.max(1, parseInt(daysEl.value, 10))) : 31;
    var startDateVal = startDateEl && startDateEl.value ? startDateEl.value : null;
    var sliceHistory = history;
    if (startDateVal) {
      sliceHistory = history.filter(function (h) { return h.reportDate >= startDateVal; }).sort(function (a, b) { return a.reportDate.localeCompare(b.reportDate); }).slice(0, chartDays);
    } else {
      sliceHistory = history.slice(0, chartDays).reverse();
    }
    var lastN = sliceHistory;
    var dailyLabels = lastN.map(function (h) { return h.reportDate; });
    var halfLineDaily = [];
    var redbudDaily = [];
    lastN.forEach(function (h) {
      var half = 0, red = 0;
      (h.lines || []).forEach(function (line) {
        if (line.name === '½ line') half = line.lineTotal || 0;
        if (line.name === 'Redbud') red = line.lineTotal || 0;
      });
      halfLineDaily.push(half);
      redbudDaily.push(red);
    });
    if (dailyLabels.length === 0) { dailyLabels = [r ? r.reportDate : '']; halfLineDaily = [0]; redbudDaily = [0]; }
    var ctxDaily = document.getElementById('chart-daily-coils');
    if (ctxDaily) {
      chartDailyCoils = new Chart(ctxDaily, {
        type: 'bar',
        data: {
          labels: dailyLabels,
          datasets: [
            { label: '½ line', data: halfLineDaily, backgroundColor: 'rgba(91, 141, 239, 0.7)', borderColor: 'rgb(91, 141, 239)', borderWidth: 1 },
            { label: 'Redbud', data: redbudDaily, backgroundColor: 'rgba(52, 199, 89, 0.7)', borderColor: 'rgb(52, 199, 89)', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: { beginAtZero: true },
            x: { stacked: false }
          },
          plugins: {
            legend: { display: true },
            datalabels: {
              anchor: 'end',
              align: 'top',
              formatter: function (v) { return v; },
              color: '#e0e0e0',
              font: { size: 11 }
            }
          }
        }
      });
    }

    var historyForStaffing = getHistory();
    var crewShiftSums = {};
    var crewShiftCounts = {};
    historyForStaffing.forEach(function (h) {
      (h.lines || []).forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          var cid = (s.crewId || '').trim() || 'A';
          var shiftName = (s.shift || '').trim() || '1st';
          var key = cid + '|' + shiftName;
          if (!crewShiftSums[key]) { crewShiftSums[key] = 0; crewShiftCounts[key] = 0; }
          crewShiftSums[key] += (s.crew != null ? s.crew : 0);
          crewShiftCounts[key]++;
        });
      });
    });
    var staffingLabels = [];
    var staffingData = [];
    CREW_IDS.forEach(function (cid) {
      SHIFT_NAMES.forEach(function (sn) {
        var key = cid + '|' + sn;
        staffingLabels.push('Crew ' + cid + ' ' + sn);
        var n = crewShiftCounts[key] || 0;
        staffingData.push(n > 0 ? Math.round((crewShiftSums[key] / n) * 10) / 10 : 0);
      });
    });
    var ctxStaffing = document.getElementById('chart-staffing');
    if (ctxStaffing && typeof Chart !== 'undefined') {
      if (chartStaffing) { chartStaffing.destroy(); chartStaffing = null; }
      chartStaffing = new Chart(ctxStaffing, {
        type: 'bar',
        data: {
          labels: staffingLabels.length ? staffingLabels : ['Crew A 1st', 'Crew A 2nd', 'Crew B 1st', 'Crew B 2nd', 'Crew C 1st', 'Crew C 2nd', 'Crew D 1st', 'Crew D 2nd'],
          datasets: [{ label: 'Avg staffing', data: staffingData.length ? staffingData : [0, 0, 0, 0, 0, 0, 0, 0], backgroundColor: 'rgba(52, 199, 89, 0.7)', borderColor: 'rgb(52, 199, 89)', borderWidth: 1 }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          indexAxis: 'y',
          scales: { x: { beginAtZero: true } },
          plugins: { legend: { display: false } }
        }
      });
    }
  }

  function loadReportForDate(dateStr) {
    var history = getHistory();
    var found = history.find(function (h) { return h.reportDate === dateStr; });
    if (found) {
      currentReport = JSON.parse(JSON.stringify(found));
    } else {
      currentReport = dateStr === (typeof CTL_REPORT !== 'undefined' && CTL_REPORT ? CTL_REPORT.reportDate : '') && typeof CTL_REPORT !== 'undefined'
        ? JSON.parse(JSON.stringify(CTL_REPORT))
        : getZeroReport(dateStr);
    }
    ensureTwoShifts(currentReport);
    renderSummary();
    renderLines();
    renderAvgOperators();
    initCharts();
    renderTrackingSections();
    renderWeekSelector();
  }

  function setReportDateInput(val) {
    var dateStr = (val || '').toString().trim();
    var el = document.getElementById('report-date-select');
    if (el) el.value = dateStr || '';
    try {
      if (dateStr) localStorage.setItem(REPORT_DATE_KEY, dateStr);
    } catch (e) {}
  }

  /** Week starts Sunday. Return Sunday (YYYY-MM-DD) for the week containing the given date string. */
  function getSundayForDate(dateStr) {
    if (!dateStr) return null;
    var d = new Date(dateStr + 'T12:00:00');
    var day = d.getDay();
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }

  /** Week number for the year (Sunday-based). Week 1 = week containing Jan 1. */
  function getWeekNumber(sundayStr) {
    if (!sundayStr) return 0;
    var sun = new Date(sundayStr + 'T12:00:00');
    var y = sun.getFullYear();
    var jan1 = new Date(y, 0, 1);
    var jan1Day = jan1.getDay();
    var week1Sun = new Date(jan1);
    week1Sun.setDate(1 - jan1Day);
    var diff = Math.round((sun - week1Sun) / (7 * 24 * 60 * 60 * 1000));
    return diff + 1;
  }

  /** Format week range as "Sun Mar 2 – Sat Mar 8, 2026". */
  function getWeekRangeLabel(sundayStr) {
    if (!sundayStr) return '—';
    var sun = new Date(sundayStr + 'T12:00:00');
    var sat = new Date(sun);
    sat.setDate(sat.getDate() + 6);
    var opts = { month: 'short', day: 'numeric', year: 'numeric' };
    return 'Sun ' + sun.toLocaleDateString('en-US', opts) + ' – Sat ' + sat.toLocaleDateString('en-US', opts);
  }

  function renderWeekSelector() {
    var dateRangeEl = document.getElementById('week-date-range');
    var weekSelectEl = document.getElementById('week-select');
    if (!dateRangeEl || !weekSelectEl) return;
    var reportDate = (currentReport && currentReport.reportDate) || '';
    var sundayStr = getSundayForDate(reportDate);
    if (sundayStr) {
      dateRangeEl.textContent = getWeekRangeLabel(sundayStr);
    } else {
      dateRangeEl.textContent = '—';
    }
    var selectedValue = weekSelectEl.value || sundayStr || getSundayForDate(new Date().toISOString().slice(0, 10));
    var options = [];
    var centerSunday = selectedValue || getSundayForDate(new Date().toISOString().slice(0, 10));
    for (var i = -12; i <= 2; i++) {
      var d = new Date(centerSunday + 'T12:00:00');
      d.setDate(d.getDate() + i * 7);
      var sun = d.toISOString().slice(0, 10);
      var weekNum = getWeekNumber(sun);
      var fullLabel = 'Week ' + weekNum + ' (' + getWeekRangeLabel(sun) + ')';
      options.push({ value: sun, fullLabel: fullLabel });
    }
    if (selectedValue && !options.some(function (o) { return o.value === selectedValue; })) {
      var wn = getWeekNumber(selectedValue);
      options.push({ value: selectedValue, fullLabel: 'Week ' + wn + ' (' + getWeekRangeLabel(selectedValue) + ')' });
      options.sort(function (a, b) { return a.value.localeCompare(b.value); });
    }
    weekSelectEl.innerHTML = options.map(function (o) {
      var sel = o.value === selectedValue ? ' selected' : '';
      return '<option value="' + escapeHtml(o.value) + '"' + sel + '>' + escapeHtml(o.fullLabel) + '</option>';
    }).join('');
  }

  function onWeekSelectChange() {
    var weekSelectEl = document.getElementById('week-select');
    if (!weekSelectEl) return;
    var sundayStr = weekSelectEl.value;
    if (!sundayStr) return;
    var history = getHistory();
    var sun = new Date(sundayStr + 'T12:00:00');
    var sat = new Date(sun);
    sat.setDate(sat.getDate() + 6);
    var satStr = sat.toISOString().slice(0, 10);
    var inWeek = history.filter(function (h) {
      return h.reportDate && h.reportDate >= sundayStr && h.reportDate <= satStr;
    }).sort(function (a, b) { return b.reportDate.localeCompare(a.reportDate); });
    var dateToLoad = inWeek.length > 0 ? inWeek[0].reportDate : sundayStr;
    setReportDateInput(dateToLoad);
    loadReportForDate(dateToLoad);
  }

  function renderEntriesTable() {
    var tbody = document.getElementById('entries-table-body');
    if (!tbody) return;
    var history = getHistory();
    var rows = history.slice(0, 90).map(function (h) {
      var half1 = 0, half2 = 0, halfTot = 0, red1 = 0, red2 = 0, redTot = 0, tot = 0, down = 0, crew = 0;
      (h.lines || []).forEach(function (line) {
        if (line.name === '½ line') {
          (line.shifts || []).forEach(function (s, i) {
            if (i === 0) half1 = s.coils != null ? s.coils : 0;
            else if (i === 1) half2 = s.coils != null ? s.coils : 0;
            crew += s.crew || 0;
            (s.downtime || []).forEach(function (d) { down += d.durationMinutes || 0; });
            (s.processDelays || []).forEach(function (d) { down += d.durationMinutes || 0; });
          });
          halfTot = line.lineTotal != null ? line.lineTotal : half1 + half2;
        }
        if (line.name === 'Redbud') {
          (line.shifts || []).forEach(function (s, i) {
            if (i === 0) red1 = s.coils != null ? s.coils : 0;
            else if (i === 1) red2 = s.coils != null ? s.coils : 0;
            crew += s.crew || 0;
            (s.downtime || []).forEach(function (d) { down += d.durationMinutes || 0; });
            (s.processDelays || []).forEach(function (d) { down += d.durationMinutes || 0; });
          });
          redTot = line.lineTotal != null ? line.lineTotal : red1 + red2;
        }
      });
      tot = h.grandTotal != null ? h.grandTotal : halfTot + redTot;
      return '<tr><td>' + escapeHtml(h.reportDate) + '</td><td>' + half1 + '</td><td>' + half2 + '</td><td>' + halfTot + '</td><td>' + red1 + '</td><td>' + red2 + '</td><td>' + redTot + '</td><td>' + tot + '</td><td>' + down + ' min</td><td>' + crew + '</td></tr>';
    });
    tbody.innerHTML = rows.join('');
  }

  function getWeekStart(d) {
    var date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var day = date.getDay();
    var diff = day === 0 ? 6 : day - 1;
    date.setDate(date.getDate() - diff);
    return date;
  }

  function isWeekday(d) {
    var day = d.getDay();
    return day >= 1 && day <= 5;
  }

  function isWeekOperatingDay(d) {
    var day = d.getDay();
    return day >= 1 && day <= 6;
  }

  function countWeekdaysInRange(start, end) {
    var count = 0;
    var d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    var endDate = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    while (d.getTime() <= endDate.getTime()) {
      if (isWeekday(d)) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
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

  function renderTrackingSections() {
    var history = getHistory();
    var r = currentReport;
    var totalCoils = 0;
    var now = new Date();
    var todayKey = dateKeyFromDate(now);
    var monthStartStr = now.toISOString().slice(0, 7);
    var mtdCoils = 0;
    var monthReportDates = [];
    var mtdHalfLine = 0, mtdRedbud = 0, mtdDowntime = 0, mtdOperators = 0, mtdHoursScheduled = 0, mtdManHours = 0;
    history.forEach(function (h) {
      var c = h.grandTotal != null ? h.grandTotal : 0;
      totalCoils += c;
      if (h.reportDate && h.reportDate.slice(0, 7) === monthStartStr) {
        mtdCoils += c;
        if (monthReportDates.indexOf(h.reportDate) === -1) monthReportDates.push(h.reportDate);
        (h.lines || []).forEach(function (line) {
          var lineCoils = line.lineTotal != null ? line.lineTotal : 0;
          if (line.name === '½ line') mtdHalfLine += lineCoils;
          if (line.name === 'Redbud') mtdRedbud += lineCoils;
          (line.shifts || []).forEach(function (s) {
            mtdOperators += s.crew != null ? s.crew : 0;
            var hrs = s.actualHours != null ? s.actualHours : (s.shiftHours != null ? s.shiftHours : 0);
            mtdHoursScheduled += hrs;
            mtdManHours += (s.crew != null ? s.crew : 0) * (hrs || 0);
            (s.downtime || []).forEach(function (d) { mtdDowntime += d.durationMinutes || 0; });
            (s.processDelays || []).forEach(function (d) { mtdDowntime += d.durationMinutes || 0; });
          });
        });
      }
    });

    var weekStart = getWeekStart(now);
    var weekStartKey = dateKeyFromDate(weekStart);
    var weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 5);
    var wtdCoils = 0;
    var weekReportDates = [];
    history.forEach(function (h) {
      if (h.reportDate && h.reportDate >= weekStartKey && h.reportDate <= todayKey) {
        wtdCoils += h.grandTotal != null ? h.grandTotal : 0;
        if (weekReportDates.indexOf(h.reportDate) === -1) weekReportDates.push(h.reportDate);
      }
    });
    var operatingDaysWithDataWeek = weekReportDates.filter(function (dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      return isWeekOperatingDay(d);
    }).length;
    var lastReportDateInWeek = weekReportDates.length > 0 ? weekReportDates.sort()[weekReportDates.length - 1] : null;
    var dayAfterLatest = null;
    if (lastReportDateInWeek) {
      dayAfterLatest = new Date(lastReportDateInWeek + 'T12:00:00');
      dayAfterLatest.setDate(dayAfterLatest.getDate() + 1);
    }
    var todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var tomorrow = new Date(todayDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    var operatingDaysRemainingWeek = dayAfterLatest ? countWeekOperatingDaysInRange(dayAfterLatest, weekEnd) : 0;
    var wtdAvgPerDay = operatingDaysWithDataWeek > 0 ? wtdCoils / operatingDaysWithDataWeek : 0;
    var forecastWeek = wtdCoils + (wtdAvgPerDay * operatingDaysRemainingWeek);
    var weeklyTarget = 300;
    var weekOnTarget = forecastWeek >= weeklyTarget;
    var weekStatusClass = weekOnTarget ? 'forecast-on-target' : 'forecast-off-target';

    var monthStartDate = new Date(now.getFullYear(), now.getMonth(), 1);
    var monthEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    var operatingDaysWithDataMonth = monthReportDates.filter(function (dateStr) {
      var d = new Date(dateStr + 'T12:00:00');
      return isWeekday(d);
    }).length;
    var operatingDaysRemainingMonth = countWeekdaysInRange(tomorrow, monthEndDate);
    var mtdAvgPerDay = operatingDaysWithDataMonth > 0 ? mtdCoils / operatingDaysWithDataMonth : 0;
    var forecastMonth = mtdCoils + (mtdAvgPerDay * operatingDaysRemainingMonth);
    var targets = getTargets();
    var monthlyTarget = targets.monthlyCoils != null ? targets.monthlyCoils : 0;
    var monthOnTarget = monthlyTarget > 0 ? forecastMonth >= monthlyTarget : null;
    var monthStatusClass = monthOnTarget === null ? '' : (monthOnTarget ? 'forecast-on-target' : 'forecast-off-target');

    setEl('#banner-week-forecast', Math.round(forecastWeek).toLocaleString());
    setEl('#banner-month-forecast', Math.round(forecastMonth).toLocaleString());
    var weekStatusEl = document.getElementById('banner-week-status');
    var monthStatusEl = document.getElementById('banner-month-status');
    var banner = document.getElementById('dashboard-banner');
    if (weekStatusEl) {
      weekStatusEl.textContent = weekOnTarget ? 'On target' : 'Off target';
      weekStatusEl.className = 'banner-status ' + (weekOnTarget ? 'banner-status-ok' : 'banner-status-off');
    }
    if (monthStatusEl) {
      monthStatusEl.textContent = monthOnTarget === null ? '—' : (monthOnTarget ? 'On target' : 'Off target');
      monthStatusEl.className = 'banner-status ' + (monthOnTarget === null ? '' : (monthOnTarget ? 'banner-status-ok' : 'banner-status-off'));
    }
    if (banner) {
      banner.classList.remove('banner-ok', 'banner-off');
      if (weekOnTarget && (monthOnTarget === null || monthOnTarget)) banner.classList.add('banner-ok');
      else if (!weekOnTarget || monthOnTarget === false) banner.classList.add('banner-off');
    }

    var mtdActualHours = 0;
    history.forEach(function (h) {
      if (!h.reportDate || h.reportDate.slice(0, 7) !== monthStartStr) return;
      (h.lines || []).forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          var hrs = s.actualHours != null ? s.actualHours : (s.shiftHours != null ? s.shiftHours : 0);
          mtdActualHours += hrs;
        });
      });
    });
    var expectedHours = (targets.hoursBudgetedHalfLine || 0) + (targets.hoursBudgetedRedbud || 0);
    var performancePct = expectedHours > 0 ? (mtdActualHours / expectedHours * 100) : null;
    setEl('#performance-pct', performancePct != null ? performancePct.toFixed(1) + '%' : (mtdActualHours > 0 && expectedHours === 0 ? mtdActualHours + ' hrs (set budget for %)' : '—'));
    var perfWrap = document.getElementById('summary-performance-wrap');
    if (perfWrap) {
      perfWrap.classList.remove('summary-perf-ok', 'summary-perf-off');
      if (performancePct != null) {
        if (performancePct >= 100) perfWrap.classList.add('summary-perf-ok');
        else perfWrap.classList.add('summary-perf-off');
      }
    }

    setEl('#mtd-total-coils', mtdCoils > 0 ? String(mtdCoils) : '—');
    setEl('#mtd-half-line-total', mtdHalfLine > 0 ? String(mtdHalfLine) : '—');
    setEl('#mtd-redbud-total', mtdRedbud > 0 ? String(mtdRedbud) : '—');
    setEl('#mtd-total-downtime', mtdDowntime > 0 ? mtdDowntime + ' min' : '—');
    setEl('#mtd-operators', mtdOperators > 0 ? String(mtdOperators) : '—');
    setEl('#mtd-hours-scheduled', mtdHoursScheduled > 0 ? String(mtdHoursScheduled) : '—');
    setEl('#mtd-man-hours', mtdManHours > 0 ? String(mtdManHours) : '—');

    var forecastGrid = document.getElementById('forecast-target-grid');
    if (forecastGrid) {
      forecastGrid.innerHTML =
        '<div class="forecast-card ' + weekStatusClass + '">' +
          '<h3 class="forecast-card-title">Week</h3>' +
          '<div class="forecast-card-body">' +
            '<div class="forecast-row"><span class="label">WTD coils</span><span class="value">' + wtdCoils + '</span></div>' +
            '<div class="forecast-row"><span class="label">WTD avg (days w/ data)</span><span class="value">' + (operatingDaysWithDataWeek > 0 ? wtdAvgPerDay.toFixed(1) : '—') + '</span></div>' +
            '<div class="forecast-row"><span class="label">Forecast (week)</span><span class="value">' + Math.round(forecastWeek) + '</span></div>' +
            '<div class="forecast-row"><span class="label">Target</span><span class="value">' + weeklyTarget + '</span></div>' +
            '<div class="forecast-row forecast-status"><span class="label">Status</span><span class="value">' + (weekOnTarget ? 'On target' : 'Off target') + '</span></div>' +
          '</div></div>' +
        '<div class="forecast-card ' + monthStatusClass + '">' +
          '<h3 class="forecast-card-title">Month</h3>' +
          '<div class="forecast-card-body">' +
            '<div class="forecast-row"><span class="label">MTD coils</span><span class="value">' + mtdCoils + '</span></div>' +
            '<div class="forecast-row"><span class="label">MTD avg (Mon–Fri)</span><span class="value">' + (operatingDaysWithDataMonth > 0 ? mtdAvgPerDay.toFixed(1) : '—') + '</span></div>' +
            '<div class="forecast-row"><span class="label">Forecast (month)</span><span class="value">' + Math.round(forecastMonth) + '</span></div>' +
            '<div class="forecast-row"><span class="label">Target</span><span class="value">' + (monthlyTarget > 0 ? monthlyTarget : '—') + '</span></div>' +
            '<div class="forecast-row forecast-status"><span class="label">Status</span><span class="value">' + (monthOnTarget === null ? '—' : (monthOnTarget ? 'On target' : 'Off target')) + '</span></div>' +
          '</div></div>';
    }

    var grid = document.getElementById('running-totals');
    if (grid) grid.innerHTML = '<div class="tracking-item"><span class="label">Total coils (all saved)</span><span class="value">' + totalCoils + '</span></div><div class="tracking-item"><span class="label">MTD coils</span><span class="value">' + mtdCoils + '</span></div>';

    var forecastEl = document.getElementById('forecast-coils');
    if (forecastEl) forecastEl.innerHTML = '<div class="tracking-item"><span class="label">MTD coils</span><span class="value">' + mtdCoils + '</span></div><div class="tracking-item"><span class="label">Month target</span><span class="value">' + (targets.monthlyCoils != null ? targets.monthlyCoils : '—') + '</span></div>';
    var targetVs = document.getElementById('target-vs-actual');
    if (targetVs) targetVs.innerHTML = targets.monthlyCoils != null ? '<p class="section-note">Target: ' + targets.monthlyCoils + ' coils this month. MTD: ' + mtdCoils + '.</p>' : '<p class="section-note">Set a monthly target in Targets to see vs actual.</p>';

    var monthSelect = document.getElementById('budget-month-select');
    var selectedMonthStr = monthStartStr;
    if (monthSelect && monthSelect.value) selectedMonthStr = monthSelect.value;
    else if (monthSelect) {
      var y = new Date().getFullYear();
      var m = String(new Date().getMonth() + 1).padStart(2, '0');
      monthSelect.value = y + '-' + m;
    }
    var selectedYear = selectedMonthStr ? parseInt(selectedMonthStr.slice(0, 4), 10) : now.getFullYear();
    var selectedMonth = selectedMonthStr ? parseInt(selectedMonthStr.slice(5, 7), 10) - 1 : now.getMonth();
    var daysInSelectedMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    var monthStartDate = new Date(selectedYear, selectedMonth, 1);
    var monthEndDate = new Date(selectedYear, selectedMonth + 1, 0);
    var operatingDaysInMonth = countWeekdaysInRange(monthStartDate, monthEndDate);
    var hoursPerLinePerDay = typeof HOURS_AVAILABLE_PER_LINE_PER_DAY !== 'undefined' ? HOURS_AVAILABLE_PER_LINE_PER_DAY : 36;
    var hoursAvailableInMonth = hoursPerLinePerDay * 2 * operatingDaysInMonth;
    var monthlyBudgetPct = typeof MONTHLY_BUDGET_PCT !== 'undefined' ? MONTHLY_BUDGET_PCT : 0.75;
    var monthlyBudgetHr = Math.round(hoursAvailableInMonth * monthlyBudgetPct);
    var monthLabel = selectedMonthStr ? (new Date(selectedYear, selectedMonth, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })) : '';

    var combinedHoursScheduledMTD = 0;
    var mtdHoursHalfLine = 0;
    var mtdHoursRedbud = 0;
    var mtdCoilsHalfLine = 0;
    var mtdCoilsRedbud = 0;
    history.forEach(function (h) {
      if (!h.reportDate || h.reportDate.slice(0, 7) !== selectedMonthStr) return;
      (h.lines || []).forEach(function (line) {
        var lineHours = 0;
        var lineCoils = 0;
        (line.shifts || []).forEach(function (s) {
          var hrs = s.actualHours != null ? s.actualHours : (s.shiftHours != null ? s.shiftHours : 0);
          lineHours += hrs;
          lineCoils += s.coils != null ? s.coils : 0;
        });
        combinedHoursScheduledMTD += lineHours;
        if (line.name === '½ line') { mtdHoursHalfLine += lineHours; mtdCoilsHalfLine += lineCoils; }
        if (line.name === 'Redbud') { mtdHoursRedbud += lineHours; mtdCoilsRedbud += lineCoils; }
      });
    });

    var todayInSelected = (now.getFullYear() === selectedYear && now.getMonth() === selectedMonth);
    var operatingDaysMTD;
    if (todayInSelected) {
      var mtdEndDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      operatingDaysMTD = countWeekdaysInRange(monthStartDate, mtdEndDate);
    } else if (selectedMonthStr < monthStartStr) {
      operatingDaysMTD = operatingDaysInMonth;
    } else {
      operatingDaysMTD = 0;
    }
    var hoursAvailableMTD = hoursPerLinePerDay * 2 * operatingDaysMTD;
    var pctScheduledVsAvailableMTD = hoursAvailableMTD > 0 ? Math.round((combinedHoursScheduledMTD / hoursAvailableMTD) * 100) : 0;

    var budgetGrid = document.getElementById('monthly-budget');
    if (budgetGrid) {
      budgetGrid.innerHTML =
        '<div class="tracking-item budget-card">' +
          '<span class="label">Hours available in month (combined)</span>' +
          '<span class="value">' + hoursAvailableInMonth.toLocaleString() + '</span>' +
          '<span class="context">' + escapeHtml(monthLabel) + ' · ½ line + Redbud (' + operatingDaysInMonth + ' weekdays)</span>' +
        '</div>' +
        '<div class="tracking-item budget-card">' +
          '<span class="label">Monthly budget (' + (monthlyBudgetPct * 100) + '%)</span>' +
          '<span class="value">' + monthlyBudgetHr + ' hr</span>' +
          '<span class="context">Combined ½ line + Redbud</span>' +
        '</div>' +
        '<div class="tracking-item budget-card">' +
          '<span class="label">Combined hours scheduled MTD</span>' +
          '<span class="value">' + combinedHoursScheduledMTD + ' hr</span>' +
          '<span class="context">½ line: ' + mtdHoursHalfLine + ' hr — Redbud: ' + mtdHoursRedbud + ' hr</span>' +
        '</div>' +
        '<div class="tracking-item budget-card">' +
          '<span class="label">Combined % scheduled vs available MTD</span>' +
          '<span class="value">' + pctScheduledVsAvailableMTD + '%</span>' +
        '</div>';
    }

    var costHalfLine = 0;
    var costRedbud = 0;
    history.forEach(function (h) {
      if (!h.lines) return;
      h.lines.forEach(function (line) {
        var mins = 0;
        (line.shifts || []).forEach(function (s) {
          (s.downtime || []).forEach(function (d) { mins += d.durationMinutes || 0; });
          (s.processDelays || []).forEach(function (d) { mins += d.durationMinutes || 0; });
        });
        var t = getTargets();
        var rate = (line.name === '½ line' && t.costPerHourHalfLine != null) ? t.costPerHourHalfLine : (line.name === 'Redbud' && t.costPerHourRedbud != null) ? t.costPerHourRedbud : (typeof DOWNTIME_COST_PER_HOUR !== 'undefined' ? DOWNTIME_COST_PER_HOUR[line.name] : 0) || 0;
        var cost = (mins / 60) * rate;
        if (line.name === '½ line') costHalfLine += cost;
        if (line.name === 'Redbud') costRedbud += cost;
      });
    });
    var costCombined = costHalfLine + costRedbud;
    var costGrid = document.getElementById('downtime-cost');
    if (costGrid) {
      costGrid.innerHTML =
        '<div class="tracking-item stat-card">' +
          '<span class="label">½ line downtime cost</span>' +
          '<span class="value">$' + Math.round(costHalfLine).toLocaleString() + '</span>' +
        '</div>' +
        '<div class="tracking-item stat-card">' +
          '<span class="label">Redbud downtime cost</span>' +
          '<span class="value">$' + Math.round(costRedbud).toLocaleString() + '</span>' +
        '</div>' +
        '<div class="tracking-item stat-card stat-card-accent">' +
          '<span class="label">Combined downtime cost</span>' +
          '<span class="value">$' + Math.round(costCombined).toLocaleString() + '</span>' +
        '</div>';
    }

    var paretoList = document.getElementById('pareto-list');
    if (paretoList) {
      var reasons = {};
      var eqList = getEquipmentList();
      if (r && r.lines) {
        r.lines.forEach(function (line) {
          (line.shifts || []).forEach(function (s) {
            (s.downtime || []).forEach(function (d) {
              var label = (d.reason || 'Other').trim() || 'Other';
              if (d.equipmentId) {
                var eq = eqList.find(function (e) { return e.id === d.equipmentId; });
                label = (eq ? eq.id + ' - ' + (eq.processArea || '') + ' - ' + (eq.name || eq.id) : d.equipmentId) + (d.reason ? ': ' + d.reason : '');
              }
              reasons[label] = (reasons[label] || 0) + (d.durationMinutes || 0);
            });
            (s.processDelays || []).forEach(function (d) {
              var label = 'Process delay: ' + (d.type || 'Other');
              reasons[label] = (reasons[label] || 0) + (d.durationMinutes || 0);
            });
          });
        });
      }
      var entries = Object.keys(reasons).map(function (k) { return { reason: k, mins: reasons[k] }; }).sort(function (a, b) { return b.mins - a.mins; });
      var totalParetoMins = entries.reduce(function (sum, e) { return sum + e.mins; }, 0);
      if (entries.length && totalParetoMins > 0) {
        paretoList.innerHTML = entries.slice(0, 10).map(function (e) {
          var pct = Math.round((e.mins / totalParetoMins) * 100);
          return '<li class="pareto-row">' +
            '<span class="pareto-label">' + escapeHtml(e.reason) + '</span>' +
            '<div class="pareto-bar"><div class="pareto-bar-fill" style="width:' + pct + '%"></div></div>' +
            '<span class="pareto-mins">' + e.mins + ' min</span>' +
            '<span class="pareto-pct">' + pct + '%</span>' +
          '</li>';
        }).join('');
      } else {
        paretoList.innerHTML = '<li>— No downtime reasons for this date</li>';
      }
    }

    var coilsPerHrHalf = mtdHoursHalfLine > 0 ? (mtdCoilsHalfLine / mtdHoursHalfLine).toFixed(1) : '—';
    var coilsPerHrRedbud = mtdHoursRedbud > 0 ? (mtdCoilsRedbud / mtdHoursRedbud).toFixed(1) : '—';
    var totalHoursMTD = mtdHoursHalfLine + mtdHoursRedbud;
    var coilsPerHrCombined = totalHoursMTD > 0 ? ((mtdCoilsHalfLine + mtdCoilsRedbud) / totalHoursMTD).toFixed(1) : '—';
    var perfGrid = document.getElementById('performance');
    if (perfGrid) {
      perfGrid.innerHTML =
        '<div class="tracking-item stat-card">' +
          '<span class="label">½ line coils/hr (MTD)</span>' +
          '<span class="value">' + coilsPerHrHalf + '</span>' +
          '<span class="context">% sched. MTD: ' + pctScheduledVsAvailableMTD + '%</span>' +
        '</div>' +
        '<div class="tracking-item stat-card">' +
          '<span class="label">Redbud coils/hr (MTD)</span>' +
          '<span class="value">' + coilsPerHrRedbud + '</span>' +
          '<span class="context">% sched. MTD: ' + pctScheduledVsAvailableMTD + '%</span>' +
        '</div>' +
        '<div class="tracking-item stat-card stat-card-accent">' +
          '<span class="label">Combined coils/hr (MTD)</span>' +
          '<span class="value">' + coilsPerHrCombined + '</span>' +
          '<span class="context">% sched. MTD: ' + pctScheduledVsAvailableMTD + '%</span>' +
        '</div>';
    }

    renderMTDShiftAnalysis();
  }

  function renderMTDShiftAnalysis() {
    var history = getHistory();
    var monthEl = document.getElementById('mtd-shift-month-select');
    var now = new Date();
    var monthStr = (monthEl && monthEl.value) ? monthEl.value : now.toISOString().slice(0, 7);
    if (monthEl && !monthEl.value) monthEl.value = monthStr;

    var mtdHistory = history.filter(function (h) { return h.reportDate && h.reportDate.slice(0, 7) === monthStr; });
    var prevMonth = monthStr.slice(0, 4) + '-' + String(parseInt(monthStr.slice(5, 7), 10) - 1).padStart(2, '0');
    if (monthStr.slice(5, 7) === '01') prevMonth = String(parseInt(monthStr.slice(0, 4), 10) - 1) + '-12';
    var prevHistory = history.filter(function (h) { return h.reportDate && h.reportDate.slice(0, 7) === prevMonth; });

    function aggregateByLineShift(hist) {
      var key = {};
      hist.forEach(function (h) {
        (h.lines || []).forEach(function (line) {
          var lineName = line.name || '—';
          (line.shifts || []).forEach(function (s) {
            var shiftName = (s.shift || '').trim() || '—';
            var k = lineName + '|' + shiftName;
            if (!key[k]) key[k] = { lineName: lineName, shiftName: shiftName, days: 0, totalCoils: 0, totalManHours: 0, totalCrew: 0, totalDowntimeMins: 0, shiftCount: 0 };
            var coils = s.coils != null ? s.coils : 0;
            var hrs = s.actualHours != null ? s.actualHours : (s.shiftHours != null ? s.shiftHours : 12);
            var crew = s.crew != null ? s.crew : 0;
            var manHrs = crew * hrs;
            var down = 0;
            (s.downtime || []).forEach(function (d) { down += d.durationMinutes || 0; });
            (s.processDelays || []).forEach(function (d) { down += d.durationMinutes || 0; });
            key[k].shiftCount += 1;
            key[k].totalCoils += coils;
            key[k].totalManHours += manHrs;
            key[k].totalCrew += crew;
            key[k].totalDowntimeMins += down;
            if (coils > 0 || crew > 0 || down > 0) key[k].days += 1;
          });
        });
      });
      return key;
    }

    var mtdAgg = aggregateByLineShift(mtdHistory);
    var prevAgg = aggregateByLineShift(prevHistory);

    var rowOrder = ['½ line|1st', '½ line|2nd', 'Redbud|1st', 'Redbud|2nd'];
    var tbody = document.getElementById('mtd-shift-tbody');
    var trendsList = document.getElementById('mtd-shift-trends-list');
    var emptyNote = document.getElementById('mtd-shift-empty-note');

    if (!tbody) return;

    var rows = rowOrder.map(function (k) {
      var a = mtdAgg[k];
      if (!a) a = { lineName: k.split('|')[0], shiftName: k.split('|')[1], days: 0, totalCoils: 0, totalManHours: 0, totalCrew: 0, totalDowntimeMins: 0, shiftCount: 0 };
      var shifts = a.shiftCount || 1;
      var avgCoils = shifts > 0 ? (a.totalCoils / shifts).toFixed(1) : '0';
      var avgCrew = shifts > 0 ? (a.totalCrew / shifts).toFixed(1) : '—';
      var avgDown = shifts > 0 ? Math.round(a.totalDowntimeMins / shifts) : 0;
      return {
        lineName: a.lineName,
        shiftName: a.shiftName,
        days: a.days,
        totalCoils: a.totalCoils,
        avgCoils: avgCoils,
        manHours: Math.round(a.totalManHours * 10) / 10,
        avgCrew: avgCrew,
        downtimeMins: a.totalDowntimeMins,
        avgDown: avgDown
      };
    });

    if (rows.every(function (r) { return r.days === 0; })) {
      tbody.innerHTML = '';
      if (trendsList) trendsList.innerHTML = '';
      if (emptyNote) emptyNote.hidden = false;
      return;
    }
    if (emptyNote) emptyNote.hidden = true;

    tbody.innerHTML = rows.map(function (r) {
      return '<tr>' +
        '<td>' + escapeHtml(r.lineName) + '</td>' +
        '<td>' + escapeHtml(r.shiftName) + '</td>' +
        '<td>' + r.days + '</td>' +
        '<td>' + r.totalCoils + '</td>' +
        '<td>' + r.avgCoils + '</td>' +
        '<td>' + r.manHours + '</td>' +
        '<td>' + r.avgCrew + '</td>' +
        '<td>' + r.downtimeMins + '</td>' +
        '<td>' + r.avgDown + '</td>' +
      '</tr>';
    }).join('');

    var trendItems = [];
    rowOrder.forEach(function (k) {
      var cur = mtdAgg[k];
      var prev = prevAgg[k];
      if (!cur || cur.days === 0) return;
      var label = (cur.lineName || k.split('|')[0]) + ' ' + (cur.shiftName || k.split('|')[1]);
      var shifts = cur.shiftCount || 1;
      var curAvgCoils = cur.totalCoils / shifts;
      var curAvgDown = cur.totalDowntimeMins / shifts;
      var curAvgCrew = (cur.shiftCount > 0) ? cur.totalCrew / cur.shiftCount : 0;
      var parts = [];
      if (prev && prev.shiftCount > 0) {
        var prevAvgCoils = prev.totalCoils / prev.shiftCount;
        var prevAvgDown = prev.totalDowntimeMins / prev.shiftCount;
        var prevAvgCrew = prev.shiftCount > 0 ? prev.totalCrew / prev.shiftCount : 0;
        if (prevAvgCoils > 0) {
          var pctCoils = Math.round(((curAvgCoils / prevAvgCoils) - 1) * 100);
          parts.push('throughput ' + curAvgCoils.toFixed(1) + ' coils/shift (' + (pctCoils >= 0 ? '↑' : '↓') + ' ' + Math.abs(pctCoils) + '% vs prior month)');
        } else {
          parts.push('throughput ' + curAvgCoils.toFixed(1) + ' coils/shift');
        }
        if (prevAvgDown > 0 || curAvgDown > 0) {
          var pctDown = prevAvgDown > 0 ? Math.round(((curAvgDown / prevAvgDown) - 1) * 100) : (curAvgDown > 0 ? 100 : 0);
          parts.push('downtime ' + Math.round(curAvgDown) + ' min/shift (' + (pctDown <= 0 ? '↓' : '↑') + ' ' + Math.abs(pctDown) + '% vs prior month)');
        } else {
          parts.push('downtime ' + Math.round(curAvgDown) + ' min/shift');
        }
        parts.push('avg crew ' + curAvgCrew.toFixed(1));
      } else {
        parts.push('throughput ' + curAvgCoils.toFixed(1) + ' coils/shift');
        parts.push('downtime ' + Math.round(curAvgDown) + ' min/shift');
        parts.push('avg crew ' + curAvgCrew.toFixed(1));
      }
      trendItems.push('<li class="mtd-shift-trend-item"><strong>' + escapeHtml(label) + ':</strong> ' + parts.join('; ') + '.</li>');
    });
    if (trendsList) trendsList.innerHTML = trendItems.length ? trendItems.join('') : '<li class="section-note">No trend comparison (no prior month data).</li>';
  }

  function dateKeyFromDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function totalDowntimeForReport(report) {
    if (!report || !report.lines) return 0;
    var total = 0;
    report.lines.forEach(function (line) {
      (line.shifts || []).forEach(function (s) {
        (s.downtime || []).forEach(function (d) { total += d.durationMinutes || 0; });
        (s.processDelays || []).forEach(function (d) { total += d.durationMinutes || 0; });
      });
    });
    return total;
  }

  function renderHeatmap() {
    var wrap = document.getElementById('heatmap-grid-wrap');
    if (!wrap) return;
    var startEl = document.getElementById('heatmap-start-date');
    var daysEl = document.getElementById('heatmap-days');
    var filterEl = document.getElementById('heatmap-filter');
    var startVal = startEl && startEl.value ? startEl.value : (function () {
      var d = new Date();
      d.setDate(d.getDate() - 30);
      return d.toISOString().slice(0, 10);
    })();
    if (startEl && !startEl.value) startEl.value = startVal;
    var days = (daysEl && daysEl.value !== '') ? Math.min(90, Math.max(1, parseInt(daysEl.value, 10))) : 31;
    var filter = filterEl && filterEl.value ? filterEl.value : 'all';

    var history = getHistory();
    var historyByDate = {};
    var byEquipmentByDate = {};
    history.forEach(function (h) {
      historyByDate[h.reportDate] = totalDowntimeForReport(h);
      (h.lines || []).forEach(function (line) {
        (line.shifts || []).forEach(function (s) {
          (s.downtime || []).forEach(function (d) {
            var eqId = d.equipmentId || d.equipment;
            var mins = d.durationMinutes != null ? d.durationMinutes : 0;
            if (eqId && mins > 0) {
              if (!byEquipmentByDate[h.reportDate]) byEquipmentByDate[h.reportDate] = {};
              byEquipmentByDate[h.reportDate][eqId] = (byEquipmentByDate[h.reportDate][eqId] || 0) + mins;
            }
          });
        });
      });
    });

    var dateLabels = [];
    for (var i = 0; i < days; i++) {
      var d = new Date(startVal);
      d.setDate(d.getDate() + i);
      dateLabels.push(dateKeyFromDate(d));
    }

    var equipment = getEquipmentList();
    var processAreas = {};
    equipment.forEach(function (eq) {
      var pa = eq.processArea || 'Other';
      if (!processAreas[pa]) processAreas[pa] = [];
      processAreas[pa].push(eq);
    });

    var maxMins = 0;
    dateLabels.forEach(function (k) { if ((historyByDate[k] || 0) > maxMins) maxMins = historyByDate[k]; });
    equipment.forEach(function (eq) {
      dateLabels.forEach(function (k) {
        var m = (byEquipmentByDate[k] && byEquipmentByDate[k][eq.id]) ? byEquipmentByDate[k][eq.id] : 0;
        if (m > maxMins) maxMins = m;
      });
    });

    function cellClass(mins) {
      if (mins <= 0) return 'heatmap-cell heatmap-cell-0';
      if (maxMins <= 0) return 'heatmap-cell heatmap-cell-0';
      var pct = Math.min(1, mins / Math.max(maxMins, 1));
      if (pct >= 0.8) return 'heatmap-cell heatmap-cell-4';
      if (pct >= 0.5) return 'heatmap-cell heatmap-cell-3';
      if (pct >= 0.25) return 'heatmap-cell heatmap-cell-2';
      return 'heatmap-cell heatmap-cell-1';
    }

    var html = '<p class="section-note">Total downtime (min) per day from saved report history. Equipment rows show minutes from Enter daily when you record downtime by equipment.</p>';
    html += '<div class="heatmap-table-wrap"><table class="heatmap-table"><thead><tr><th>Equipment / Date</th>';
    dateLabels.forEach(function (k) { html += '<th>' + escapeHtml(k) + '</th>'; });
    html += '</tr></thead><tbody>';

    var totalRow = '<tr><td class="heatmap-label">Total (min)</td>';
    dateLabels.forEach(function (k) {
      var mins = historyByDate[k] || 0;
      totalRow += '<td class="' + cellClass(mins) + '" title="' + mins + ' min">' + (mins > 0 ? mins : '—') + '</td>';
    });
    totalRow += '</tr>';
    html += totalRow;

    var processEl = document.getElementById('heatmap-process');
    var equipmentEl = document.getElementById('heatmap-equipment');
    var filterProcess = processEl && processEl.value ? processEl.value : '';
    var filterEquipment = equipmentEl && equipmentEl.value ? equipmentEl.value : '';

    var rowsAdded = 0;
    equipment.forEach(function (eq) {
      if (filter === 'process' && (eq.processArea || '') !== filterProcess) return;
      if (filter === 'equipment' && eq.id !== filterEquipment) return;
      rowsAdded++;
      html += '<tr><td class="heatmap-label">' + escapeHtml(eq.name || eq.id) + '</td>';
      dateLabels.forEach(function (k) {
        var mins = (byEquipmentByDate[k] && byEquipmentByDate[k][eq.id]) ? byEquipmentByDate[k][eq.id] : 0;
        html += '<td class="' + cellClass(mins) + '" title="' + mins + ' min">' + (mins > 0 ? mins : '—') + '</td>';
      });
      html += '</tr>';
    });

    if (rowsAdded === 0 && (filter === 'process' || filter === 'equipment')) {
      html += '<tr><td colspan="' + (dateLabels.length + 1) + '" class="section-note">No equipment match the filter.</td></tr>';
    }
    html += '</tbody></table></div>';
    wrap.innerHTML = html;
  }

  function refreshHeatmapDropdowns() {
    var equipment = getEquipmentList();
    var processAreas = {};
    equipment.forEach(function (eq) {
      var pa = eq.processArea || 'Other';
      processAreas[pa] = true;
    });
    var processEl = document.getElementById('heatmap-process');
    var equipmentEl = document.getElementById('heatmap-equipment');
    if (processEl) {
      var sel = processEl.value;
      processEl.innerHTML = Object.keys(processAreas).sort().map(function (pa) {
        return '<option value="' + escapeHtml(pa) + '">' + escapeHtml(pa) + '</option>';
      }).join('');
      if (sel && processAreas[sel]) processEl.value = sel;
    }
    if (equipmentEl) {
      var selEq = equipmentEl.value;
      equipmentEl.innerHTML = equipment.map(function (eq) {
        return '<option value="' + escapeHtml(eq.id) + '">' + escapeHtml(eq.name || eq.id) + '</option>';
      }).join('');
      if (selEq) equipmentEl.value = selEq;
    }
  }

  function togglePanel(btnId, panelId) {
    var btn = document.getElementById(btnId);
    var panel = document.getElementById(panelId);
    if (!btn || !panel) return;
    var open = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', !open);
    panel.hidden = open;
    if (!open) {
      if (panelId === 'entries-table-panel') renderEntriesTable();
      if (panelId === 'heatmap-panel') {
        var startEl = document.getElementById('heatmap-start-date');
        if (startEl && !startEl.value) {
          var d = new Date();
          d.setDate(d.getDate() - 30);
          startEl.value = d.toISOString().slice(0, 10);
        }
        refreshHeatmapDropdowns();
        renderHeatmap();
      }
    }
  }

  function parseEmailText(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var report = getZeroReport(new Date().toISOString().slice(0, 10));
    var currentLine = null;
    var currentShift = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/½\s*line|half\s*line/i.test(line)) {
        currentLine = report.lines[0];
        if (/1st|first/i.test(line)) currentShift = currentLine.shifts[0];
        else if (/2nd|second|3rd|third/i.test(line)) currentShift = currentLine.shifts[1];
        else currentShift = currentLine.shifts[0];
        var coilMatch = line.match(/(\d+)\s*coils?/i);
        if (coilMatch && currentShift) currentShift.coils = parseInt(coilMatch[1], 10);
      } else if (/redbud/i.test(line)) {
        currentLine = report.lines[1];
        if (/1st|first/i.test(line)) currentShift = currentLine.shifts[0];
        else if (/2nd|second|3rd|third/i.test(line)) currentShift = currentLine.shifts[1];
        else currentShift = currentLine.shifts[0];
        var coilMatch2 = line.match(/(\d+)\s*coils?/i);
        if (coilMatch2 && currentShift) currentShift.coils = parseInt(coilMatch2[1], 10);
      } else if (currentLine && currentShift && /(\d+)\s*coils?/i.test(line)) {
        currentShift.coils = parseInt(line.match(/(\d+)/)[1], 10);
      }
    }
    report.lines.forEach(function (ln) {
      ln.lineTotal = (ln.shifts || []).reduce(function (sum, s) { return sum + (s.coils || 0); }, 0);
      ln.shifts.forEach(function (s, idx) { s.crew = s.crew || 6; s.shiftHours = 12; s.crewId = s.crewId || CREW_IDS[idx] || 'A'; });
    });
    report.grandTotal = report.lines[0].lineTotal + report.lines[1].lineTotal;
    return report;
  }

  function applyParsedReport(parsed, dateStr) {
    parsed.reportDate = dateStr || parsed.reportDate || new Date().toISOString().slice(0, 10);
    saveDayToHistory(parsed);
    setReportDateInput(parsed.reportDate);
    loadReportForDate(parsed.reportDate);
  }

  function buildDowntimeRowHtml(equipmentList, issueTypes, existing) {
    var eqOpts = (equipmentList || []).map(function (eq) {
      var sel = existing && existing.equipmentId === eq.id ? ' selected' : '';
      return '<option value="' + escapeHtml(eq.id) + '"' + sel + '>' + escapeHtml(eq.name || eq.id) + '</option>';
    }).join('');
    var issueOpts = (issueTypes || []).map(function (t) {
      var sel = existing && existing.issueType === t ? ' selected' : '';
      return '<option value="' + escapeHtml(t) + '"' + sel + '>' + escapeHtml(t) + '</option>';
    }).join('');
    var mins = existing && (existing.durationMinutes != null) ? existing.durationMinutes : '';
    var reason = existing && existing.reason ? escapeHtml(existing.reason) : '';
    var plannedVal = existing && existing.planned === true ? 'planned' : 'unplanned';
    var plannedSel = plannedVal === 'planned' ? ' selected' : '';
    var unplannedSel = plannedVal === 'unplanned' ? ' selected' : '';
    return '<div class="downtime-row">' +
      '<select class="input-select downtime-equipment" aria-label="Equipment">' +
      '<option value="">— Equipment —</option>' + eqOpts + '</select>' +
      '<select class="input-select downtime-type" aria-label="Planned or unplanned">' +
      '<option value="planned"' + plannedSel + '>Planned</option>' +
      '<option value="unplanned"' + unplannedSel + '>Unplanned</option>' +
      '</select>' +
      '<select class="input-select downtime-issue" aria-label="Issue type">' +
      '<option value="">— Type —</option>' + issueOpts + '</select>' +
      '<input type="number" class="input-num downtime-mins" min="0" placeholder="Min" value="' + mins + '" aria-label="Minutes" />' +
      '<input type="text" class="input-text downtime-reason" placeholder="Reason (optional)" value="' + reason + '" aria-label="Reason" />' +
      '<button type="button" class="btn btn-secondary btn-remove-downtime" aria-label="Remove">Remove</button></div>';
  }

  function buildProcessDelayRowHtml(processDelayTypes, existing) {
    var typeOpts = (processDelayTypes || []).map(function (t) {
      var sel = existing && existing.type === t ? ' selected' : '';
      return '<option value="' + escapeHtml(t) + '"' + sel + '>' + escapeHtml(t) + '</option>';
    }).join('');
    var mins = existing && (existing.durationMinutes != null) ? existing.durationMinutes : '';
    var notes = existing && existing.notes ? escapeHtml(existing.notes) : '';
    return '<div class="process-delay-row">' +
      '<select class="input-select process-delay-type" aria-label="Process delay">' +
      '<option value="">— Process delay —</option>' + typeOpts + '</select>' +
      '<input type="number" class="input-num process-delay-mins" min="0" placeholder="Min" value="' + mins + '" aria-label="Minutes" />' +
      '<input type="text" class="input-text process-delay-notes" placeholder="Notes (optional)" value="' + notes + '" aria-label="Notes" />' +
      '<button type="button" class="btn btn-secondary btn-remove-process-delay" aria-label="Remove">Remove</button></div>';
  }

  function buildDailyShiftsForm() {
    var grid = document.getElementById('daily-shifts-form');
    if (!grid || !currentReport) return;
    var equipmentList = getEquipmentList();
    var issueTypes = getIssueTypes();
    var processDelayTypes = getProcessDelayTypes();
    var html = '';
    (currentReport.lines || []).forEach(function (line, lineIdx) {
      html += '<div class="daily-line-row">';
      html += '<h3 class="daily-line-row-title">' + escapeHtml(line.name) + '</h3>';
      (line.shifts || []).forEach(function (s, shiftIdx) {
        var id = 'daily-' + line.name.replace(/\s/g, '') + '-' + (s.shift || '').replace(/\s/g, '');
        var idOp = id + '-operators';
        var idHrs = id + '-hours';
        html += '<div class="daily-shift-block">';
        html += '<label for="' + id + '">' + escapeHtml(s.shift || '') + ' coils</label>';
        html += '<input type="number" id="' + id + '" class="input-num" min="0" value="' + (s.coils != null ? s.coils : 0) + '" />';
        var idCrew = id + '-crew';
        var crewVal = (s.crewId || 'A').toString();
        html += '<label for="' + idCrew + '">Crew</label>';
        html += '<select id="' + idCrew + '" class="input-select" aria-label="Crew">';
        CREW_IDS.forEach(function (c) {
          html += '<option value="' + escapeHtml(c) + '"' + (crewVal === c ? ' selected' : '') + '>Crew ' + escapeHtml(c) + '</option>';
        });
        html += '</select>';
        html += '<label for="' + idOp + '">Operators</label>';
        html += '<input type="number" id="' + idOp + '" class="input-num" min="0" value="' + (s.crew != null ? s.crew : 6) + '" />';
        html += '<label for="' + idHrs + '">Hours scheduled</label>';
        html += '<input type="number" id="' + idHrs + '" class="input-num" min="0" step="0.5" value="' + (s.shiftHours != null ? s.shiftHours : 12) + '" />';
        var idActual = id + '-actual-hours';
        html += '<label for="' + idActual + '">Actual hours (worked)</label>';
        html += '<input type="number" id="' + idActual + '" class="input-num" min="0" step="0.5" value="' + (s.actualHours != null ? s.actualHours : '') + '" placeholder="e.g. 11.5" />';
        html += '<div class="daily-shift-downtime" data-line-index="' + lineIdx + '" data-shift-index="' + shiftIdx + '">';
        html += '<span class="downtime-section-label">Downtime (optional)</span>';
        var downtimes = s.downtime || [];
        downtimes.forEach(function (d) {
          var existing = {
            equipmentId: d.equipmentId || '',
            issueType: d.issueType || '',
            durationMinutes: d.durationMinutes != null ? d.durationMinutes : '',
            reason: d.reason || '',
            planned: d.planned === true
          };
          html += buildDowntimeRowHtml(equipmentList, issueTypes, existing);
        });
        html += '<button type="button" class="btn btn-secondary btn-add-downtime" data-line-index="' + lineIdx + '" data-shift-index="' + shiftIdx + '">+ Add downtime</button>';
        html += '</div>';
        html += '<div class="daily-shift-process-delay" data-line-index="' + lineIdx + '" data-shift-index="' + shiftIdx + '">';
        html += '<span class="downtime-section-label">Process delay (optional)</span>';
        var processDelays = s.processDelays || [];
        if (processDelays.length > 0) {
          processDelays.forEach(function (d) {
            html += buildProcessDelayRowHtml(processDelayTypes, { type: d.type || '', durationMinutes: d.durationMinutes != null ? d.durationMinutes : '', notes: d.notes || '' });
          });
        } else {
          html += buildProcessDelayRowHtml(processDelayTypes, null);
        }
        html += '<button type="button" class="btn btn-secondary btn-add-process-delay" data-line-index="' + lineIdx + '" data-shift-index="' + shiftIdx + '">+ Add process delay</button>';
        html += '</div></div>';
      });
      html += '</div>';
    });
    grid.innerHTML = html;
  }

  function validateDailyForm() {
    var errors = [];
    var grid = document.getElementById('daily-shifts-form');
    if (!grid) return [];
    var blocks = grid.querySelectorAll('.daily-shift-block');
    blocks.forEach(function (block) {
      var coilsEl = block.querySelector('input[type="number"]:not(.downtime-mins):not(.process-delay-mins)');
      if (!coilsEl) return;
      var coils = coilsEl.value !== '' ? parseInt(coilsEl.value, 10) : 0;
      if (isNaN(coils) || coils < 0) errors.push('Coils must be 0 or more.');
      var opEl = coilsEl.id ? document.getElementById(coilsEl.id + '-operators') : null;
      var hrsEl = coilsEl.id ? document.getElementById(coilsEl.id + '-hours') : null;
      var actualEl = coilsEl.id ? document.getElementById(coilsEl.id + '-actual-hours') : null;
      if (hrsEl && hrsEl.value !== '') {
        var hrs = parseFloat(hrsEl.value, 10);
        if (isNaN(hrs) || hrs < 0 || hrs > 24) errors.push('Hours scheduled must be 0–24.');
      }
      if (actualEl && actualEl.value !== '') {
        var actual = parseFloat(actualEl.value, 10);
        if (isNaN(actual) || actual < 0 || actual > 24) errors.push('Actual hours must be 0–24.');
      }
      block.querySelectorAll('.downtime-mins').forEach(function (el) {
        if (el.value !== '' && (isNaN(parseInt(el.value, 10)) || parseInt(el.value, 10) < 0)) errors.push('Downtime minutes must be 0 or more.');
      });
      block.querySelectorAll('.process-delay-mins').forEach(function (el) {
        if (el.value !== '' && (isNaN(parseInt(el.value, 10)) || parseInt(el.value, 10) < 0)) errors.push('Process delay minutes must be 0 or more.');
      });
    });
    return errors;
  }

  function saveDailyFromForm() {
    var dateInput = document.getElementById('daily-date-input');
    var dateStr = dateInput && dateInput.value ? dateInput.value : (currentReport && currentReport.reportDate) || new Date().toISOString().slice(0, 10);
    var validationErrors = validateDailyForm();
    if (validationErrors.length > 0) {
      var status = document.getElementById('enter-daily-status');
      if (status) {
        status.textContent = validationErrors[0];
        status.className = 'paste-status paste-status-warn';
      }
      return;
    }
    var day = getZeroReport(dateStr);
    var grid = document.getElementById('daily-shifts-form');
    for (var li = 0; li < day.lines.length; li++) {
      var line = day.lines[li];
      for (var si = 0; si < (line.shifts || []).length; si++) {
        var s = line.shifts[si];
        var id = 'daily-' + line.name.replace(/\s/g, '') + '-' + (s.shift || '').replace(/\s/g, '');
        var input = document.getElementById(id);
        var coils = input && input.value !== '' ? parseInt(input.value, 10) : 0;
        var crewEl = document.getElementById(id + '-crew');
        var opEl = document.getElementById(id + '-operators');
        var hrsEl = document.getElementById(id + '-hours');
        var actualHrsEl = document.getElementById(id + '-actual-hours');
        var crewId = (crewEl && crewEl.value) ? crewEl.value : 'A';
        var crew = opEl && opEl.value !== '' ? parseInt(opEl.value, 10) : 6;
        var shiftHours = hrsEl && hrsEl.value !== '' ? parseFloat(hrsEl.value, 10) : 12;
        var actualHours = actualHrsEl && actualHrsEl.value !== '' ? parseFloat(actualHrsEl.value, 10) : null;
        line.shifts[si].coils = coils;
        line.shifts[si].crewId = crewId;
        line.shifts[si].crew = isNaN(crew) ? 6 : crew;
        line.shifts[si].shiftHours = isNaN(shiftHours) ? 12 : shiftHours;
        line.shifts[si].actualHours = (actualHours != null && !isNaN(actualHours)) ? actualHours : undefined;
        line.shifts[si].downtime = [];
        var container = grid && grid.querySelector('.daily-shift-downtime[data-line-index="' + li + '"][data-shift-index="' + si + '"]');
        if (container) {
          var rows = container.querySelectorAll('.downtime-row');
          rows.forEach(function (row) {
            var eqEl = row.querySelector('.downtime-equipment');
            var issueEl = row.querySelector('.downtime-issue');
            var minsEl = row.querySelector('.downtime-mins');
            var reasonEl = row.querySelector('.downtime-reason');
            var equipmentId = eqEl && eqEl.value ? eqEl.value : '';
            if (!equipmentId) return;
            var typeEl = row.querySelector('.downtime-type');
            var planned = typeEl && typeEl.value === 'planned';
            var mins = minsEl && minsEl.value !== '' ? parseInt(minsEl.value, 10) : 0;
            line.shifts[si].downtime.push({
              equipmentId: equipmentId,
              planned: planned,
              issueType: (issueEl && issueEl.value) || '',
              durationMinutes: isNaN(mins) ? 0 : mins,
              reason: (reasonEl && reasonEl.value) || ''
            });
          });
        }
        line.shifts[si].processDelays = [];
        var processDelayContainer = grid && grid.querySelector('.daily-shift-process-delay[data-line-index="' + li + '"][data-shift-index="' + si + '"]');
        if (processDelayContainer) {
          var pdRows = processDelayContainer.querySelectorAll('.process-delay-row');
          pdRows.forEach(function (row) {
            var typeEl = row.querySelector('.process-delay-type');
            var minsEl = row.querySelector('.process-delay-mins');
            var notesEl = row.querySelector('.process-delay-notes');
            var type = typeEl && typeEl.value ? typeEl.value : '';
            if (!type) return;
            var mins = minsEl && minsEl.value !== '' ? parseInt(minsEl.value, 10) : 0;
            line.shifts[si].processDelays.push({
              type: type,
              durationMinutes: isNaN(mins) ? 0 : mins,
              notes: (notesEl && notesEl.value) || ''
            });
          });
        }
      }
      line.lineTotal = (line.shifts || []).reduce(function (sum, s) { return sum + (s.coils || 0); }, 0);
    }
    day.grandTotal = day.lines[0].lineTotal + day.lines[1].lineTotal;
    saveDayToHistory(day);
    loadReportForDate(day.reportDate);
    setReportDateInput(day.reportDate);
    renderEntriesTable();
    var status = document.getElementById('enter-daily-status');
    if (status) {
      status.textContent = 'Saved for ' + day.reportDate;
      status.className = 'paste-status';
    }
  }

  function copyFromPreviousDay() {
    var dateInput = document.getElementById('daily-date-input');
    var dateStr = (dateInput && dateInput.value ? dateInput.value : (currentReport && currentReport.reportDate) || new Date().toISOString().slice(0, 10)).trim();
    if (!dateStr) return;
    var history = getHistory();
    var previous = history.filter(function (h) { return h.reportDate && h.reportDate < dateStr; }).sort(function (a, b) { return b.reportDate.localeCompare(a.reportDate); })[0];
    if (!previous) {
      var status = document.getElementById('enter-daily-status');
      if (status) { status.textContent = 'No earlier report found.'; status.className = 'paste-status paste-status-warn'; }
      return;
    }
    var day = getZeroReport(dateStr);
    day.lines = (previous.lines || []).map(function (line) {
      var copy = { name: line.name, shifts: [], lineTotal: line.lineTotal || 0 };
      (line.shifts || []).forEach(function (s) {
        copy.shifts.push({
          shift: s.shift,
          crewId: s.crewId || 'A',
          coils: s.coils != null ? s.coils : 0,
          downtime: (s.downtime || []).map(function (d) { return { equipmentId: d.equipmentId, planned: d.planned, issueType: d.issueType, durationMinutes: d.durationMinutes, reason: d.reason }; }),
          processDelays: (s.processDelays || []).map(function (d) { return { type: d.type, durationMinutes: d.durationMinutes, notes: d.notes }; }),
          crew: s.crew != null ? s.crew : 6,
          shiftHours: s.shiftHours != null ? s.shiftHours : 12,
          actualHours: s.actualHours
        });
      });
      return copy;
    });
    ensureTwoShifts(day);
    day.lines.forEach(function (line) {
      line.lineTotal = (line.shifts || []).reduce(function (sum, s) { return sum + (s.coils || 0); }, 0);
    });
    day.grandTotal = day.lines.reduce(function (sum, line) { return sum + (line.lineTotal || 0); }, 0);
    currentReport = day;
    buildDailyShiftsForm();
    var status = document.getElementById('enter-daily-status');
    if (status) { status.textContent = 'Copied from ' + previous.reportDate + '. Click Save day to save for ' + dateStr + '.'; status.className = 'paste-status'; }
  }

  function updateClock() {
    var now = new Date();
    setEl('#current-time', now.toLocaleTimeString());
    setEl('#current-date', now.toLocaleDateString());
  }

  function switchTab(tabId) {
    ['dashboard', 'operations', 'schedule', 'openstatus', 'orderpivot', 'materialavailability', 'manager', 'agent', 'otdtracker', 'siop'].forEach(function (id) {
      var content = document.getElementById(id + '-content');
      var btn = document.getElementById('tab-' + id);
      if (content) content.hidden = id !== tabId;
      if (btn) {
        btn.classList.toggle('active', id === tabId);
        btn.setAttribute('aria-selected', id === tabId ? 'true' : 'false');
      }
    });
    if (tabId === 'materialavailability' && typeof window.ctlMaterialAvailabilityRefresh === 'function') {
      window.ctlMaterialAvailabilityRefresh();
    }
    if (tabId === 'manager' && typeof window.ctlManagerRefresh === 'function') {
      window.ctlManagerRefresh();
    }
    if (tabId === 'agent' && typeof window.ctlManagerGetAgentContext === 'function') {
      var agentTa = document.getElementById('agent-context');
      if (agentTa) agentTa.value = window.ctlManagerGetAgentContext();
    }
    if (tabId === 'siop') {
      try {
        var plan = localStorage.getItem('ctl-agent-siop-plan');
        var wrap = document.getElementById('siop-plan-from-agent-wrap');
        var pre = document.getElementById('siop-plan-from-agent-text');
        if (wrap && pre) {
          if (plan) {
            wrap.hidden = false;
            pre.textContent = plan;
          } else {
            wrap.hidden = true;
          }
        }
      } catch (e) {}
    }
  }

  function csvEscape(s) {
    var str = (s == null ? '' : String(s)).replace(/"/g, '""');
    if (/[,\r\n"]/.test(str)) return '"' + str + '"';
    return str;
  }

  function downloadCsv(csvString, filename) {
    var blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename || 'export.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportTableToCsv(tableIdOrEl, filename) {
    var table = typeof tableIdOrEl === 'string' ? document.getElementById(tableIdOrEl) : tableIdOrEl;
    if (!table || table.tagName !== 'TABLE') return;
    var rows = [];
    var thead = table.querySelector('thead');
    if (thead) {
      thead.querySelectorAll('tr').forEach(function (tr) {
        var cells = [];
        tr.querySelectorAll('th, td').forEach(function (cell) { cells.push(csvEscape(cell.textContent.trim())); });
        if (cells.length) rows.push(cells.join(','));
      });
    }
    table.querySelectorAll('tbody tr').forEach(function (tr) {
      var cells = [];
      tr.querySelectorAll('th, td').forEach(function (cell) { cells.push(csvEscape(cell.textContent.trim())); });
      if (cells.length) rows.push(cells.join(','));
    });
    if (rows.length === 0) return;
    downloadCsv(rows.join('\r\n'), filename || 'export.csv');
  }

  window.ctlExportTableToCsv = exportTableToCsv;

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
    } else {
      root.removeAttribute('data-theme');
    }
    var btn = document.getElementById('btn-theme-toggle');
    if (btn) {
      btn.textContent = theme === 'light' ? 'Light' : 'Dark';
      btn.setAttribute('aria-label', 'Theme: ' + (theme === 'light' ? 'light' : 'dark'));
    }
  }

  function init() {
    var todayStr = new Date().toISOString().slice(0, 10);
    try {
      var savedTheme = localStorage.getItem(THEME_KEY);
      if (savedTheme === 'light' || savedTheme === 'dark') applyTheme(savedTheme);
    } catch (e) {}
    var storedDate = null;
    try {
      storedDate = localStorage.getItem(REPORT_DATE_KEY);
    } catch (e) {}
    var initialDate = storedDate && /^\d{4}-\d{2}-\d{2}$/.test(storedDate)
      ? storedDate
      : (typeof CTL_REPORT !== 'undefined' && CTL_REPORT && CTL_REPORT.reportDate
          ? CTL_REPORT.reportDate
          : todayStr);
    setReportDateInput(initialDate);
    loadReportForDate(initialDate);
    renderEntriesTable();

    document.querySelectorAll('.main-tab').forEach(function (btn) {
      var tab = btn.getAttribute('data-tab');
      if (tab) btn.addEventListener('click', function () { switchTab(tab); });
    });

    document.querySelectorAll('.start-of-shift-link').forEach(function (link) {
      var tab = link.getAttribute('data-tab');
      if (tab) link.addEventListener('click', function (e) { e.preventDefault(); switchTab(tab); });
    });

    function getBlockedOwners() {
      try {
        var raw = localStorage.getItem(BLOCKED_OWNERS_KEY);
        return raw ? JSON.parse(raw) : {};
      } catch (e) { return {}; }
    }
    function saveBlockedOwner(orderId, name) {
      var o = getBlockedOwners();
      if (name && name.trim()) o[orderId] = name.trim(); else delete o[orderId];
      try { localStorage.setItem(BLOCKED_OWNERS_KEY, JSON.stringify(o)); } catch (e) {}
    }
    window.ctlRestoreBlockedOwners = function (container) {
      if (!container) return;
      var saved = getBlockedOwners();
      container.querySelectorAll('.blocked-owner[data-order]').forEach(function (el) {
        var id = el.getAttribute('data-order');
        if (id && saved[id]) el.textContent = saved[id];
      });
    };
    document.body.addEventListener('input', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('blocked-owner')) {
        var id = e.target.getAttribute('data-order');
        if (id) saveBlockedOwner(id, e.target.textContent);
      }
    });
    document.body.addEventListener('blur', function (e) {
      if (e.target && e.target.classList && e.target.classList.contains('blocked-owner')) {
        var id = e.target.getAttribute('data-order');
        if (id) saveBlockedOwner(id, e.target.textContent);
      }
    }, true);

    var reportDateSelect = document.getElementById('report-date-select');
    if (reportDateSelect) reportDateSelect.addEventListener('change', function () {
      var v = this.value || todayStr;
      setReportDateInput(v);
      loadReportForDate(v);
    });

    var weekSelectEl = document.getElementById('week-select');
    if (weekSelectEl) weekSelectEl.addEventListener('change', onWeekSelectChange);

    window.ctlSwitchTab = switchTab;

    var themeToggle = document.getElementById('btn-theme-toggle');
    if (themeToggle) {
      themeToggle.addEventListener('click', function () {
        var root = document.documentElement;
        var isLight = root.getAttribute('data-theme') === 'light';
        var next = isLight ? 'dark' : 'light';
        try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
        applyTheme(next);
      });
    }

    var budgetMonthSelect = document.getElementById('budget-month-select');
    if (budgetMonthSelect) budgetMonthSelect.addEventListener('change', function () {
      renderTrackingSections();
    });
    var mtdShiftMonthSelect = document.getElementById('mtd-shift-month-select');
    if (mtdShiftMonthSelect) mtdShiftMonthSelect.addEventListener('change', function () {
      renderMTDShiftAnalysis();
    });

    var chartDailyStart = document.getElementById('chart-daily-start-date');
    var chartDailyDays = document.getElementById('chart-daily-days');
    if (chartDailyStart) chartDailyStart.addEventListener('change', function () { initCharts(); });
    if (chartDailyDays) chartDailyDays.addEventListener('change', function () { initCharts(); });

    var panelToggles = [
      ['btn-targets-toggle', 'targets-panel'],
      ['btn-enter-daily-toggle', 'enter-daily-panel'],
      ['btn-paste-toggle', 'paste-panel'],
      ['btn-entries-toggle', 'entries-table-panel'],
      ['btn-heatmap-toggle', 'heatmap-panel'],
      ['btn-reset-all', null]
    ];
    panelToggles.forEach(function (pair) {
      var btn = document.getElementById(pair[0]);
      if (!btn) return;
      if (pair[1]) {
        btn.addEventListener('click', function () {
          if (pair[0] === 'btn-enter-daily-toggle') {
            var dailyDate = document.getElementById('daily-date-input');
            if (dailyDate) dailyDate.value = (currentReport && currentReport.reportDate) || new Date().toISOString().slice(0, 10);
            buildDailyShiftsForm();
          }
          togglePanel(pair[0], pair[1]);
        });
      } else {
        btn.addEventListener('click', function () {
          if (confirm('Reset all saved report data and reload default?')) {
            localStorage.removeItem(HISTORY_KEY);
            currentReport = typeof CTL_REPORT !== 'undefined' ? JSON.parse(JSON.stringify(CTL_REPORT)) : getZeroReport(new Date().toISOString().slice(0, 10));
            setReportDateInput(currentReport.reportDate);
            loadReportForDate(currentReport.reportDate);
            renderEntriesTable();
          }
        });
      }
    });

    var pasteBtn = document.getElementById('btn-parse-email');
    if (pasteBtn) pasteBtn.addEventListener('click', function () {
      var textarea = document.getElementById('paste-textarea');
      var dateInput = document.getElementById('report-date-input');
      var text = textarea && textarea.value ? textarea.value : '';
      var dateStr = dateInput && dateInput.value ? dateInput.value : new Date().toISOString().slice(0, 10);
      var parsed = parseEmailText(text);
      applyParsedReport(parsed, dateStr);
      setEl('#paste-status', 'Updated for ' + dateStr);
    });

    var saveDailyBtn = document.getElementById('btn-save-daily');
    if (saveDailyBtn) saveDailyBtn.addEventListener('click', saveDailyFromForm);
    var copyPreviousBtn = document.getElementById('btn-copy-previous-day');
    if (copyPreviousBtn) copyPreviousBtn.addEventListener('click', copyFromPreviousDay);

    function bindExportBtn(id, tableId, filename) {
      var btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', function () { exportTableToCsv(tableId, filename); });
    }
    bindExportBtn('btn-export-entries-csv', 'entries-table', 'ctl-entries.csv');
    bindExportBtn('btn-export-mtd-csv', 'mtd-shift-table', 'ctl-mtd-shift.csv');
    bindExportBtn('btn-export-openstatus-csv', 'openstatus-balance-per-day-table', 'ctl-open-status.csv');
    bindExportBtn('btn-export-schedule-csv', 'schedule-tons-table', 'ctl-schedule.csv');
    bindExportBtn('btn-export-material-csv', 'materialavailability-table', 'ctl-material-availability.csv');

    var enterDailyPanel = document.getElementById('enter-daily-panel');
    if (enterDailyPanel) {
      enterDailyPanel.addEventListener('click', function (e) {
        var addBtn = e.target.closest('.btn-add-downtime');
        var removeBtn = e.target.closest('.btn-remove-downtime');
        var addProcessDelayBtn = e.target.closest('.btn-add-process-delay');
        var removeProcessDelayBtn = e.target.closest('.btn-remove-process-delay');
        if (addBtn) {
          e.preventDefault();
          var container = addBtn.closest('.daily-shift-downtime');
          if (container) {
            var rowHtml = buildDowntimeRowHtml(getEquipmentList(), getIssueTypes(), null);
            var div = document.createElement('div');
            div.innerHTML = rowHtml;
            container.insertBefore(div.firstElementChild, addBtn);
          }
        }
        if (removeBtn) {
          e.preventDefault();
          var row = removeBtn.closest('.downtime-row');
          if (row) row.remove();
        }
        if (addProcessDelayBtn) {
          e.preventDefault();
          var container = addProcessDelayBtn.closest('.daily-shift-process-delay');
          if (container) {
            var rowHtml = buildProcessDelayRowHtml(getProcessDelayTypes(), null);
            var div = document.createElement('div');
            div.innerHTML = rowHtml;
            container.insertBefore(div.firstElementChild, addProcessDelayBtn);
          }
        }
        if (removeProcessDelayBtn) {
          e.preventDefault();
          var row = removeProcessDelayBtn.closest('.process-delay-row');
          if (row) row.remove();
        }
      });
    }

    var saveTargetsBtn = document.getElementById('btn-save-targets');
    if (saveTargetsBtn) saveTargetsBtn.addEventListener('click', function () {
      var coils = document.getElementById('target-monthly-coils');
      var cost = document.getElementById('target-max-downtime-cost');
      var costHalf = document.getElementById('target-cost-half-line');
      var costRed = document.getElementById('target-cost-redbud');
      var hoursHalf = document.getElementById('target-hours-budgeted-half-line');
      var hoursRed = document.getElementById('target-hours-budgeted-redbud');
      function numVal(el) { return el && el.value !== '' ? parseFloat(el.value, 10) : null; }
      var hoursHalf = document.getElementById('target-hours-budgeted-half-line');
      var hoursRed = document.getElementById('target-hours-budgeted-redbud');
      var otdPctEl = document.getElementById('target-otd-pct');
      saveTargets({
        monthlyCoils: coils && coils.value !== '' ? parseInt(coils.value, 10) : null,
        maxDowntimeCost: cost && cost.value !== '' ? parseInt(cost.value, 10) : null,
        costPerHourHalfLine: numVal(costHalf),
        costPerHourRedbud: numVal(costRed),
        hoursBudgetedHalfLine: numVal(hoursHalf),
        hoursBudgetedRedbud: numVal(hoursRed),
        otdTargetPct: otdPctEl && otdPctEl.value !== '' ? parseFloat(otdPctEl.value, 10) : 95
      });
      setEl('#targets-status', 'Saved');
    });

    var targets = getTargets();
    var targetCoilsEl = document.getElementById('target-monthly-coils');
    var targetCostEl = document.getElementById('target-max-downtime-cost');
    var targetCostHalfEl = document.getElementById('target-cost-half-line');
    var targetCostRedEl = document.getElementById('target-cost-redbud');
    if (targetCoilsEl && targets.monthlyCoils != null) targetCoilsEl.value = targets.monthlyCoils;
    if (targetCostEl && targets.maxDowntimeCost != null) targetCostEl.value = targets.maxDowntimeCost;
    if (targetCostHalfEl && targets.costPerHourHalfLine != null) targetCostHalfEl.value = targets.costPerHourHalfLine;
    if (targetCostRedEl && targets.costPerHourRedbud != null) targetCostRedEl.value = targets.costPerHourRedbud;
    var targetHoursHalfEl = document.getElementById('target-hours-budgeted-half-line');
    var targetHoursRedEl = document.getElementById('target-hours-budgeted-redbud');
    if (targetHoursHalfEl && targets.hoursBudgetedHalfLine != null) targetHoursHalfEl.value = targets.hoursBudgetedHalfLine;
    if (targetHoursRedEl && targets.hoursBudgetedRedbud != null) targetHoursRedEl.value = targets.hoursBudgetedRedbud;
    var targetOtdEl = document.getElementById('target-otd-pct');
    if (targetOtdEl && targets.otdTargetPct != null) targetOtdEl.value = targets.otdTargetPct;

    var heatmapStart = document.getElementById('heatmap-start-date');
    var heatmapDays = document.getElementById('heatmap-days');
    var heatmapFilter = document.getElementById('heatmap-filter');
    var heatmapProcessWrap = document.getElementById('heatmap-filter-process-wrap');
    var heatmapEquipmentWrap = document.getElementById('heatmap-filter-equipment-wrap');
    if (heatmapStart) heatmapStart.addEventListener('change', renderHeatmap);
    if (heatmapDays) heatmapDays.addEventListener('change', renderHeatmap);
    if (heatmapFilter) {
      heatmapFilter.addEventListener('change', function () {
        var v = this.value;
        if (heatmapProcessWrap) heatmapProcessWrap.hidden = v !== 'process';
        if (heatmapEquipmentWrap) heatmapEquipmentWrap.hidden = v !== 'equipment';
        refreshHeatmapDropdowns();
        renderHeatmap();
      });
    }
    var heatmapProcess = document.getElementById('heatmap-process');
    var heatmapEquipment = document.getElementById('heatmap-equipment');
    if (heatmapProcess) heatmapProcess.addEventListener('change', renderHeatmap);
    if (heatmapEquipment) heatmapEquipment.addEventListener('change', renderHeatmap);

    var btnEditEquipment = document.getElementById('btn-edit-equipment');
    var managePanel = document.getElementById('manage-equipment-panel');
    if (btnEditEquipment && managePanel) {
      btnEditEquipment.addEventListener('click', function () {
        document.getElementById('heatmap-panel').hidden = true;
        document.getElementById('btn-heatmap-toggle').setAttribute('aria-expanded', 'false');
        managePanel.hidden = false;
        renderManageEquipment();
      });
    }
    var btnCloseManage = document.getElementById('btn-close-manage');
    if (btnCloseManage && managePanel) {
      btnCloseManage.addEventListener('click', function () {
        managePanel.hidden = true;
        refreshHeatmapDropdowns();
      });
    }
    var manageTabs = document.querySelectorAll('.manage-tab');
    manageTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var t = this.getAttribute('data-tab');
        manageTabs.forEach(function (x) { x.classList.toggle('active', x === tab); });
        document.getElementById('manage-equipment-content').hidden = t !== 'equipment';
        document.getElementById('manage-issues-content').hidden = t !== 'issues';
        if (t === 'equipment') renderManageEquipment();
        if (t === 'issues') renderManageIssues();
      });
    });
    function renderManageEquipment() {
      var wrap = document.getElementById('manage-equipment-content');
      if (!wrap) return;
      var list = getEquipmentList();
      wrap.innerHTML = '<p class="section-note">' + list.length + ' equipment items. Edit in data.js or add localStorage key ' + EQUIPMENT_KEY + '.</p><ul class="manage-list">' +
        list.map(function (eq) {
          return '<li>' + escapeHtml(eq.id) + ' — ' + escapeHtml(eq.processArea || '') + ' — ' + escapeHtml(eq.name || '') + '</li>';
        }).join('') + '</ul>';
    }
    function renderManageIssues() {
      var wrap = document.getElementById('manage-issues-content');
      if (!wrap) return;
      var list = getIssueTypes();
      wrap.innerHTML = '<p class="section-note">' + list.length + ' issue types.</p><ul class="manage-list">' +
        list.map(function (x) { return '<li>' + escapeHtml(x) + '</li>'; }).join('') + '</ul>';
    }

    (function initOtdTracker() {
      var OTD_STORAGE_KEY = 'ctl-otd-tracker-rows';
      var CAUSE_OPTIONS = ['', 'Capacity', 'Scheduling', 'Shipping Delay', 'QA Hold', 'Credit Hold', 'Lead time violation', 'Maint Delay', 'No Coil'];

      function getOtdData() {
        try {
          var raw = localStorage.getItem(OTD_STORAGE_KEY);
          if (!raw) return [];
          var arr = JSON.parse(raw);
          return Array.isArray(arr) ? arr : [];
        } catch (e) { return []; }
      }
      function setOtdData(arr) {
        try {
          localStorage.setItem(OTD_STORAGE_KEY, JSON.stringify(arr));
        } catch (e) {}
      }
      function todayStr() {
        return new Date().toISOString().slice(0, 10);
      }
      function rowId() {
        return 'otd-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9);
      }
      function parseReportDate(d) {
        if (!d || d.length < 10) return null;
        var y = parseInt(d.slice(0, 4), 10);
        var m = parseInt(d.slice(5, 7), 10);
        var day = parseInt(d.slice(8, 10), 10);
        var date = new Date(y, m - 1, day);
        return isNaN(date.getTime()) ? null : date;
      }
      function filterOtdRows(rows, filterValue) {
        if (filterValue === 'all' || !rows.length) return rows;
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return rows.filter(function (r) {
          var d = parseReportDate(r.report_date);
          if (!d) return true;
          if (filterValue === '7') {
            var diff = (today - d) / (24 * 60 * 60 * 1000);
            return diff >= 0 && diff <= 7;
          }
          if (filterValue === '30') {
            var diff = (today - d) / (24 * 60 * 60 * 1000);
            return diff >= 0 && diff <= 30;
          }
          if (filterValue === 'month') {
            return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
          }
          return true;
        });
      }

      function isOnTime(r) {
        var d = (r.days_late != null ? String(r.days_late) : '').trim();
        if (d === '') return true;
        var n = parseFloat(d.replace(/[^\d.-]/g, ''));
        return isNaN(n) || n <= 0;
      }

      function computeOtdStats(rows) {
        var total = rows.length;
        var onTime = 0;
        for (var i = 0; i < rows.length; i++) if (isOnTime(rows[i])) onTime++;
        var late = total - onTime;
        var pct = total > 0 ? (onTime / total) * 100 : null;
        return { total: total, onTime: onTime, late: late, pct: pct };
      }

      function getOtdSummaryForPeriod(period) {
        var rows = getOtdData();
        var filtered = filterOtdRows(rows, period);
        var stats = computeOtdStats(filtered);
        var targets = getTargets();
        var targetPct = targets.otdTargetPct != null ? targets.otdTargetPct : 95;
        var gap = 0;
        if (stats.total > 0 && stats.pct != null && stats.pct < targetPct) {
          var requiredOnTime = Math.ceil((stats.total * targetPct) / 100);
          gap = Math.max(0, requiredOnTime - stats.onTime);
        }
        return {
          total: stats.total,
          onTime: stats.onTime,
          late: stats.late,
          pct: stats.pct,
          targetPct: targetPct,
          gap: gap
        };
      }

      window.getOtdSummary = function (period) {
        period = period || 'mtd';
        if (period === 'mtd' || period === 'month') period = 'month';
        return getOtdSummaryForPeriod(period);
      };

      function renderOtdSummary() {
        var el = document.getElementById('otd-tracker-summary');
        if (!el) return;
        var targetPct = (getTargets().otdTargetPct != null ? getTargets().otdTargetPct : 95) + '%';
        var s7 = getOtdSummaryForPeriod('7');
        var s30 = getOtdSummaryForPeriod('30');
        var sm = getOtdSummaryForPeriod('month');
        function line(label, s) {
          if (!s || s.total === 0) return label + ': —';
          var pctStr = (s.pct != null ? s.pct.toFixed(1) : '—') + '%';
          var gapStr = s.gap > 0 ? ' (gap: ' + s.gap + ' on-time to reach ' + targetPct + ')' : ' (on target)';
          return label + ': ' + pctStr + ' (' + s.onTime + '/' + s.total + ')' + gapStr;
        }
        el.textContent = '';
        el.className = 'otd-summary-strip';
        var parts = [line('Last 7d', s7), line('Last 30d', s30), line('MTD', sm)];
        var span = document.createElement('span');
        span.setAttribute('aria-live', 'polite');
        span.textContent = 'OTD target ' + targetPct + ' · ' + parts.join(' · ');
        el.appendChild(span);
      }

      function makeCauseSelect(selectedValue) {
        var sel = document.createElement('select');
        sel.className = 'input-select otd-cause-select';
        sel.setAttribute('aria-label', 'Cause');
        var val = (selectedValue || '').toString().trim();
        CAUSE_OPTIONS.forEach(function (opt, i) {
          var o = document.createElement('option');
          o.value = i === 0 ? '' : opt;
          o.textContent = i === 0 ? '(select cause)' : opt;
          if (opt === val || (i === 0 && !val)) o.selected = true;
          sel.appendChild(o);
        });
        return sel;
      }
      function escapeOtdHtml(s) {
        if (s == null || s === '') return '';
        var div = document.createElement('div');
        div.textContent = String(s);
        return div.innerHTML;
      }
      function addOtdTrackerRow(rowObj, isEmpty) {
        var tbody = document.getElementById('otd-tracker-tbody');
        if (!tbody) return;
        var id = (rowObj && rowObj.id) ? rowObj.id : rowId();
        var reportDate = (rowObj && rowObj.report_date) ? rowObj.report_date : todayStr();
        var so = (rowObj && rowObj.so != null) ? escapeOtdHtml(rowObj.so) : '';
        var soLn = (rowObj && rowObj.so_ln != null) ? escapeOtdHtml(rowObj.so_ln) : '';
        var customer = (rowObj && rowObj.customer != null) ? escapeOtdHtml(rowObj.customer) : '';
        var credRlsDt = (rowObj && rowObj.cred_rls_dt != null) ? escapeOtdHtml(rowObj.cred_rls_dt) : '';
        var dueDate = (rowObj && rowObj.due_date != null) ? escapeOtdHtml(rowObj.due_date) : '';
        var shipDate = (rowObj && rowObj.ship_date != null) ? escapeOtdHtml(rowObj.ship_date) : '';
        var daysLate = (rowObj && rowObj.days_late != null) ? escapeOtdHtml(rowObj.days_late) : '';
        var cause = (rowObj && rowObj.cause != null) ? String(rowObj.cause).trim() : '';
        var tr = document.createElement('tr');
        tr.setAttribute('data-row-id', id);
        tr.setAttribute('data-report-date', reportDate);
        tr.innerHTML =
          '<td class="otd-report-date-cell">' + escapeOtdHtml(reportDate) + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + so + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + soLn + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + customer + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + credRlsDt + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + dueDate + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + shipDate + '</td>' +
          '<td class="otd-paste-cell" contenteditable="true">' + daysLate + '</td>' +
          '<td class="otd-cause-cell"></td>';
        tr.querySelector('.otd-cause-cell').appendChild(makeCauseSelect(cause));
        tbody.appendChild(tr);
      }
      function collectRowsFromTable() {
        var tbody = document.getElementById('otd-tracker-tbody');
        if (!tbody) return [];
        var rows = [];
        var trs = tbody.querySelectorAll('tr');
        for (var i = 0; i < trs.length; i++) {
          var tr = trs[i];
          var id = tr.getAttribute('data-row-id') || rowId();
          var reportDate = tr.getAttribute('data-report-date') || todayStr();
          var cells = tr.querySelectorAll('.otd-paste-cell');
          var causeCell = tr.querySelector('.otd-cause-cell select');
          var cause = causeCell ? causeCell.value : '';
          var so = cells[0] ? (cells[0].textContent || '').trim() : '';
          var soLn = cells[1] ? (cells[1].textContent || '').trim() : '';
          var customer = cells[2] ? (cells[2].textContent || '').trim() : '';
          var credRlsDt = cells[3] ? (cells[3].textContent || '').trim() : '';
          var dueDate = cells[4] ? (cells[4].textContent || '').trim() : '';
          var shipDate = cells[5] ? (cells[5].textContent || '').trim() : '';
          var daysLate = cells[6] ? (cells[6].textContent || '').trim() : '';
          rows.push({ id: id, report_date: reportDate, so: so, so_ln: soLn, customer: customer, cred_rls_dt: credRlsDt, due_date: dueDate, ship_date: shipDate, days_late: daysLate, cause: cause });
        }
        return rows;
      }
      function renderOtdTable(dataRows) {
        var tbody = document.getElementById('otd-tracker-tbody');
        if (!tbody) return;
        tbody.innerHTML = '';
        (dataRows || []).forEach(function (r) { addOtdTrackerRow(r, false); });
        for (var i = 0; i < 5; i++) addOtdTrackerRow({ id: rowId(), report_date: todayStr() }, true);
        applyOtdFilter();
        renderOtdSummary();
      }
      function applyOtdFilter() {
        var filterEl = document.getElementById('otd-filter-range');
        var filterValue = filterEl ? filterEl.value : 'all';
        renderOtdSummary();
        var tbody = document.getElementById('otd-tracker-tbody');
        if (!tbody) return;
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        tbody.querySelectorAll('tr').forEach(function (tr) {
          var dStr = tr.getAttribute('data-report-date');
          var d = parseReportDate(dStr);
          var hide = false;
          if (filterValue !== 'all' && d) {
            if (filterValue === '7') { var diff = (today - d) / (24 * 60 * 60 * 1000); hide = diff < 0 || diff > 7; }
            else if (filterValue === '30') { var diff = (today - d) / (24 * 60 * 60 * 1000); hide = diff < 0 || diff > 30; }
            else if (filterValue === 'month') hide = d.getFullYear() !== now.getFullYear() || d.getMonth() !== now.getMonth();
          }
          tr.classList.toggle('otd-row-hidden', hide);
        });
      }
      function normalizeHeader(h) {
        return (h || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
      }
      function findColumnIndex(headers, names) {
        for (var i = 0; i < headers.length; i++) {
          var n = normalizeHeader(headers[i]);
          for (var j = 0; j < names.length; j++) {
            if (n === names[j].toLowerCase() || n.indexOf(names[j].toLowerCase()) !== -1) return i;
          }
        }
        return -1;
      }
      function parseOtdPaste(text) {
        var lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
        if (lines.length === 0) return { headers: [], rows: [] };
        var first = lines[0];
        var delimiter = first.indexOf('\t') !== -1 ? '\t' : ',';
        var headers = first.split(delimiter).map(function (c) { return c.trim(); });
        var rows = [];
        for (var i = 1; i < lines.length; i++) {
          rows.push(lines[i].split(delimiter).map(function (c) { return c.trim(); }));
        }
        return { headers: headers, rows: rows };
      }
      function importOtdData() {
        var ta = document.getElementById('otd-tracker-paste');
        var statusEl = document.getElementById('otd-tracker-status');
        var reportDateInput = document.getElementById('otd-report-date');
        var modeSelect = document.getElementById('otd-import-mode');
        if (!ta || !statusEl) return;
        var text = (ta.value || '').trim();
        if (!text) {
          statusEl.textContent = 'Paste data first, then click Import.';
          return;
        }
        var reportDate = (reportDateInput && reportDateInput.value) ? reportDateInput.value : todayStr();
        var parsed = parseOtdPaste(text);
        var headers = parsed.headers;
        var rows = parsed.rows;
        var idxSo = findColumnIndex(headers, ['order', 'so', 'so no', 'order #']) >= 0 ? findColumnIndex(headers, ['order', 'so', 'so no', 'order #']) : 0;
        var idxSoLn = findColumnIndex(headers, ['item', 'so_ln', 'so ln', 'line_no', 'line no', 'line']) >= 0 ? findColumnIndex(headers, ['item', 'so_ln', 'so ln', 'line_no', 'line no', 'line']) : 1;
        var idxCustomer = findColumnIndex(headers, ['customer dm', 'customer', 'cus name', 'cust name']) >= 0 ? findColumnIndex(headers, ['customer dm', 'customer', 'cus name', 'cust name']) : 2;
        var idxCredRls = findColumnIndex(headers, ['entry dt', 'cred_rls_dt', 'cred rls', 'credit release']) >= 0 ? findColumnIndex(headers, ['entry dt', 'cred_rls_dt', 'cred rls', 'credit release']) : 3;
        var idxDue = findColumnIndex(headers, ['due dt', 'due_date', 'due date', 'due']) >= 0 ? findColumnIndex(headers, ['due dt', 'due_date', 'due date', 'due']) : 4;
        var idxShip = findColumnIndex(headers, ['ship_date', 'ship date', 'act_ship_date', 'ship']) >= 0 ? findColumnIndex(headers, ['ship_date', 'ship date', 'act_ship_date', 'ship']) : 5;
        var idxDaysLate = findColumnIndex(headers, ['days late', 'days_late']) >= 0 ? findColumnIndex(headers, ['days late', 'days_late']) : 6;
        var idxCause = findColumnIndex(headers, ['cause']);
        if (idxCause < 0) idxCause = 99;
        var newRows = [];
        for (var r = 0; r < rows.length; r++) {
          var row = rows[r];
          if (row.every(function (c) { return !c; })) continue;
          var cause = (idxCause >= 0 && idxCause < row.length) ? row[idxCause] : '';
          newRows.push({
            id: rowId(),
            report_date: reportDate,
            so: row[idxSo],
            so_ln: row[idxSoLn],
            customer: row[idxCustomer],
            cred_rls_dt: row[idxCredRls],
            due_date: row[idxDue],
            ship_date: row[idxShip],
            days_late: row[idxDaysLate],
            cause: cause
          });
        }
        var data = modeSelect && modeSelect.value === 'replace' ? newRows : getOtdData().concat(newRows);
        setOtdData(data);
        renderOtdTable(data);
        statusEl.textContent = 'Imported ' + newRows.length + ' rows. ' + (modeSelect && modeSelect.value === 'append' ? 'Appended to existing.' : 'Replaced all.');
      }
      function saveOtdTable() {
        var statusEl = document.getElementById('otd-tracker-status');
        var rows = collectRowsFromTable();
        var merged = [];
        rows.forEach(function (r) {
          if (!r.so && !r.customer && !r.ship_date && !r.due_date) return;
          merged.push({
            id: r.id || rowId(),
            report_date: r.report_date || todayStr(),
            so: r.so, so_ln: r.so_ln, customer: r.customer,
            cred_rls_dt: r.cred_rls_dt, due_date: r.due_date, ship_date: r.ship_date,
            days_late: r.days_late, cause: r.cause
          });
        });
        setOtdData(merged);
        renderOtdTable(merged);
        if (statusEl) statusEl.textContent = 'Saved.';
      }
      function exportOtdCsv() {
        var filterEl = document.getElementById('otd-filter-range');
        var filterValue = filterEl ? filterEl.value : 'all';
        var data = filterOtdRows(getOtdData(), filterValue);
        var statusEl = document.getElementById('otd-tracker-status');
        if (!data.length) {
          if (statusEl) statusEl.textContent = 'No data to export for this range. Try "All data" or import first.';
          return;
        }
        var header = 'Report date,SO,SO_LN,Customer,cred_rls_dt,due_date,ship_date,Days Late,Cause';
        var csv = header + '\n' + data.map(function (r) {
          return [r.report_date, r.so, r.so_ln, r.customer, r.cred_rls_dt, r.due_date, r.ship_date, r.days_late, r.cause].map(function (c) {
            var s = (c == null ? '' : String(c)).replace(/"/g, '""');
            if (/[,\r\n"]/.test(s)) return '"' + s + '"';
            return s;
          }).join(',');
        }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'otd-tracker-' + (filterValue !== 'all' ? filterValue + '-' : '') + todayStr() + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        if (statusEl) statusEl.textContent = 'Exported ' + data.length + ' rows.';
      }

      var reportDateInput = document.getElementById('otd-report-date');
      if (reportDateInput) reportDateInput.value = todayStr();
      var data = getOtdData();
      renderOtdTable(data.length ? data : []);
      var filterEl = document.getElementById('otd-filter-range');
      if (filterEl) filterEl.addEventListener('change', function () {
        applyOtdFilter();
        var statusEl = document.getElementById('otd-tracker-status');
        if (statusEl) statusEl.textContent = '';
      });
      document.getElementById('otd-tracker-import').addEventListener('click', importOtdData);
      document.getElementById('otd-tracker-save').addEventListener('click', saveOtdTable);
      document.getElementById('otd-tracker-add-rows').addEventListener('click', function () {
        var tbody = document.getElementById('otd-tracker-tbody');
        if (tbody) for (var i = 0; i < 10; i++) addOtdTrackerRow({ id: rowId(), report_date: todayStr() }, true);
        var statusEl = document.getElementById('otd-tracker-status');
        if (statusEl) statusEl.textContent = '';
      });
      document.getElementById('otd-tracker-export-csv').addEventListener('click', exportOtdCsv);
    })();

    var siopClearBtn = document.getElementById('siop-clear-agent-plan');
    if (siopClearBtn) {
      siopClearBtn.addEventListener('click', function () {
        try {
          localStorage.removeItem('ctl-agent-siop-plan');
          var wrap = document.getElementById('siop-plan-from-agent-wrap');
          var pre = document.getElementById('siop-plan-from-agent-text');
          if (wrap) wrap.hidden = true;
          if (pre) pre.textContent = '';
        } catch (e) {}
      });
    }

    (function initSiopDemandSupply() {
      var SIOP_DATA_KEY = 'ctl-siop-demand-supply';
      var SIOP_PASTE_KEY = 'ctl-siop-paste';
      var tbody = document.getElementById('siop-tbody');
      var pasteEl = document.getElementById('siop-paste');
      var statusEl = document.getElementById('siop-plan-status');
      function num(v) {
        if (v == null || v === '') return 0;
        var n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
        return isNaN(n) ? 0 : n;
      }
      function findCol(headers, names) {
        var h = headers.map(function (x) { return (x || '').toLowerCase().trim(); });
        for (var i = 0; i < h.length; i++) {
          for (var j = 0; j < names.length; j++) {
            if (h[i].indexOf(names[j]) >= 0 || names[j].indexOf(h[i]) >= 0) return i;
          }
        }
        return -1;
      }
      function escapeSiopHtml(s) {
        if (s == null) return '';
        var div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
      }
      function renderSiopTable(rows) {
        if (!tbody) return;
        if (!rows || rows.length === 0) {
          tbody.innerHTML = '<tr><td colspan="5" class="siop-empty-msg">Paste demand and supply data above and click Apply plan to see the table.</td></tr>';
          return;
        }
        tbody.innerHTML = rows.map(function (r) {
          return '<tr><td>' + escapeSiopHtml(r.period) + '</td><td>' + escapeSiopHtml(r.demand) + '</td><td>' + escapeSiopHtml(r.supply) + '</td><td>' + escapeSiopHtml(r.gap) + '</td><td>' + escapeSiopHtml(r.cumulativeGap) + '</td></tr>';
        }).join('');
      }
      function parseSiopLine(line, sep) {
        var cells = line.split(sep).map(function (c) { return (c || '').trim(); });
        if (sep === '|') {
          if (cells.length && cells[0] === '') cells.shift();
          if (cells.length && cells[cells.length - 1] === '') cells.pop();
        }
        return cells;
      }
      function formatNum(n) {
        if (n == null || isNaN(n)) return '0';
        var s = Math.round(n).toString();
        var neg = s.charAt(0) === '-';
        if (neg) s = s.slice(1);
        var out = '';
        for (var i = s.length - 1, c = 0; i >= 0; i--, c++) {
          if (c && c % 3 === 0) out = ',' + out;
          out = s.charAt(i) + out;
        }
        return neg ? '-' + out : out;
      }
      function applySiopPlan() {
        var text = (pasteEl && pasteEl.value) ? pasteEl.value.trim() : '';
        if (!text) {
          if (statusEl) statusEl.textContent = 'Paste data first, then click Apply plan.';
          return;
        }
        var lines = text.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
        if (lines.length < 2) {
          if (statusEl) statusEl.textContent = 'Include a header row and at least one data row.';
          return;
        }
        var first = lines[0];
        var sep = first.indexOf('\t') >= 0 ? '\t' : (first.indexOf('|') >= 0 ? '|' : ',');
        var headers = parseSiopLine(first, sep);
        var idxPeriod = findCol(headers, ['period', 'week', 'month', 'date']);
        var idxDemand = findCol(headers, ['demand']);
        var idxSupply = findCol(headers, ['supply']);
        if (idxPeriod < 0) idxPeriod = 0;
        if (idxDemand < 0) idxDemand = 1;
        if (idxSupply < 0) idxSupply = 2;
        var rows = [];
        var cumulative = 0;
        for (var i = 1; i < lines.length; i++) {
          var cells = parseSiopLine(lines[i], sep);
          var period = (cells[idxPeriod] != null ? String(cells[idxPeriod]) : '').trim();
          var demandNum = num(cells[idxDemand]);
          var supplyNum = num(cells[idxSupply]);
          var gap = demandNum - supplyNum;
          cumulative += gap;
          rows.push({
            period: period,
            demand: cells[idxDemand] != null ? String(cells[idxDemand]) : '',
            supply: cells[idxSupply] != null ? String(cells[idxSupply]) : '',
            gap: gap,
            cumulativeGap: cumulative,
            gapStr: formatNum(gap),
            cumulativeStr: formatNum(cumulative)
          });
        }
        var displayRows = rows.map(function (r) {
          return { period: r.period, demand: r.demand, supply: r.supply, gap: r.gapStr, cumulativeGap: r.cumulativeStr };
        });
        renderSiopTable(displayRows);
        try { localStorage.setItem(SIOP_DATA_KEY, JSON.stringify(displayRows)); } catch (e) {}
        if (statusEl) statusEl.textContent = 'Plan applied. ' + rows.length + ' period(s). Gap = Demand − Supply.';
      }
      function loadSiopSaved() {
        try {
          var saved = localStorage.getItem(SIOP_DATA_KEY);
          if (saved) {
            var rows = JSON.parse(saved);
            if (Array.isArray(rows) && rows.length > 0) renderSiopTable(rows);
          }
          var pasteSaved = localStorage.getItem(SIOP_PASTE_KEY);
          if (pasteEl && pasteSaved) pasteEl.value = pasteSaved;
        } catch (e) {}
      }
      var applyBtn = document.getElementById('siop-apply-plan');
      var saveBtn = document.getElementById('siop-save-plan');
      if (applyBtn) applyBtn.addEventListener('click', applySiopPlan);
      if (saveBtn) {
        saveBtn.addEventListener('click', function () {
          if (pasteEl) try { localStorage.setItem(SIOP_PASTE_KEY, pasteEl.value); } catch (e) {}
          if (statusEl) statusEl.textContent = 'Draft saved.';
        });
      }
      loadSiopSaved();
    })();

    updateClock();
    setInterval(updateClock, 1000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
