/**
 * Pure logic for Manager tab: material readiness, primary risk, lookahead.
 * Uses existing data shapes: schedule (runDateObj, lineName, order, weightNum), orders (order, dueDate, balanceNum), blocked list (order, status/notes).
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) define([], factory);
  else if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ManagerLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var REASON_CODES = {
    NO_COMPATIBLE_COIL: 'NO_COMPATIBLE_COIL',
    COIL_INBOUND: 'COIL_INBOUND',
    COIL_NOT_FOUND: 'COIL_NOT_FOUND',
    COIL_ON_HOLD: 'COIL_ON_HOLD',
    RESERVED_ELSEWHERE: 'RESERVED_ELSEWHERE',
    DATA_MISSING: 'DATA_MISSING'
  };

  var ACTIONS_BY_REASON = {
    NO_COMPATIBLE_COIL: 'Source compatible coil; update spec or release from inventory.',
    COIL_INBOUND: 'Track inbound ETA; slot when received or resequence schedule.',
    COIL_NOT_FOUND: 'Locate coil or create material requisition; escalate if missing.',
    COIL_ON_HOLD: 'Clear hold with QC or credit; release for production.',
    RESERVED_ELSEWHERE: 'Confirm reservation; release for this order or swap.',
    DATA_MISSING: 'Complete order or coil data in system; confirm material status.'
  };

  var RISK_REASONS = {
    MATERIAL: 'MATERIAL',
    CAPACITY: 'CAPACITY',
    SHIPPING: 'SHIPPING',
    QUALITY: 'QUALITY',
    DATA: 'DATA',
    UNKNOWN: 'UNKNOWN'
  };

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function normalizeOrderId(row) {
    var o = (row.order || '').toString().trim();
    var item = (row.item || '').toString().trim();
    return item ? o + '-' + item : o;
  }

  function getBlockedReasonFromStatus(statusText) {
    if (!statusText || typeof statusText !== 'string') return REASON_CODES.DATA_MISSING;
    var s = statusText.toLowerCase();
    if (/\binbound\b|\bin transit\b|eta\b/.test(s)) return REASON_CODES.COIL_INBOUND;
    if (/\bhold\b|quality hold|credit hold/.test(s)) return REASON_CODES.COIL_ON_HOLD;
    if (/\breserved\b/.test(s)) return REASON_CODES.RESERVED_ELSEWHERE;
    if (/\bcoil break|coil broken|no coil\b|no material|material not available|material unavailable/.test(s)) return REASON_CODES.COIL_NOT_FOUND;
    if (/\bno compatible|wrong spec|spec\b/.test(s)) return REASON_CODES.NO_COMPATIBLE_COIL;
    return REASON_CODES.COIL_NOT_FOUND;
  }

  /**
   * Material readiness for a job or order.
   * @param {object} jobOrOrder - Schedule row (order, lineName, runDateObj) or order row (order, item)
   * @param {array} blockedList - Rows from no-coil list, each with order and status/notes
   * @returns {{ ready: boolean, reasonCode: string, actionText: string, evidence: string }}
   */
  function getMaterialReadiness(jobOrOrder, blockedList) {
    var orderId = normalizeOrderId(jobOrOrder);
    if (!orderId) return { ready: false, reasonCode: REASON_CODES.DATA_MISSING, actionText: ACTIONS_BY_REASON.DATA_MISSING, evidence: 'Order/id missing' };

    var blocked = (blockedList || []).find(function (b) {
      var bid = normalizeOrderId(b);
      return bid && (bid === orderId || (b.order && b.order.toString().trim() === (jobOrOrder.order || '').toString().trim()));
    });
    if (!blocked) return { ready: true, reasonCode: null, actionText: null, evidence: 'Not on blocked list' };

    var statusParts = [blocked.status, blocked.notes, blocked.reason, blocked.holdReason, blocked.comment];
    if (blocked._raw) { for (var k in blocked._raw) statusParts.push(blocked._raw[k]); }
    var statusText = statusParts.filter(Boolean).join(' ');
    var reasonCode = getBlockedReasonFromStatus(statusText);
    return {
      ready: false,
      reasonCode: reasonCode,
      actionText: ACTIONS_BY_REASON[reasonCode] || ACTIONS_BY_REASON.COIL_NOT_FOUND,
      evidence: statusText.slice(0, 80) || reasonCode
    };
  }

  /**
   * Single primary risk reason for an order (OTD at-risk next 72h).
   * @param {object} order - Order row (order, dueDate, balanceNum, customer, etc.)
   * @param {object} context - { isOnBlockedList, isScheduled, scheduledCompletionDate, hasQualityHold, hasShippingConstraint }
   * @returns {{ reason: string, why: string }}
   */
  function getPrimaryRisk(order, context) {
    context = context || {};
    if (context.hasQualityHold) return { reason: RISK_REASONS.QUALITY, why: 'Order or material on quality hold.' };
    if (context.hasDataMissing) return { reason: RISK_REASONS.DATA, why: 'Missing critical fields (order, due date, or balance).' };
    if (context.isOnBlockedList) return { reason: RISK_REASONS.MATERIAL, why: 'Material not ready (no coil / hold / inbound).' };
    if (context.hasShippingConstraint) return { reason: RISK_REASONS.SHIPPING, why: 'Shipping constraint or capacity limit.' };
    if (context.isScheduled === false && context.capacityTight) return { reason: RISK_REASONS.CAPACITY, why: 'Not scheduled and capacity is tight.' };
    if (context.isScheduled === false) return { reason: RISK_REASONS.CAPACITY, why: 'Order not on production schedule.' };
    if (context.scheduledCompletionDate && order.dueDate && context.scheduledCompletionDate > order.dueDate)
      return { reason: RISK_REASONS.CAPACITY, why: 'Scheduled completion after due date.' };
    if (context.insufficientPlannedHours) return { reason: RISK_REASONS.CAPACITY, why: 'Insufficient planned hours to complete by due date.' };
    return { reason: RISK_REASONS.UNKNOWN, why: 'No specific risk identified.' };
  }

  /**
   * 48-hour schedule feasibility by line. Jobs in next 48 hours with material readiness and reason/action.
   * @param {array} scheduleRows - Rows with runDateObj, lineName, order, weightNum
   * @param {array} blockedList - No-coil list
   * @param {Date} now - Reference time
   * @returns {{ jobs: array, lineMap: object }} jobs sorted: Not Ready first, then by start time
   */
  function getScheduleFeasibility48h(scheduleRows, blockedList, now) {
    now = now || new Date();
    var cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    var lineMap = { 'Line 1': [], 'Line 2': [] };
    function toLineId(lineName) {
      if (!lineName) return 'Line 1';
      var n = (lineName + '').toLowerCase();
      if (n.indexOf('redbud') >= 0) return 'Line 2';
      return 'Line 1';
    }

    var jobs = [];
    (scheduleRows || []).forEach(function (row) {
      var runDate = row.runDateObj || (row.runDate ? new Date(row.runDate) : null);
      if (!runDate || runDate.getTime() > cutoff.getTime()) return;
      var startTime = runDate.getTime();
      var readiness = getMaterialReadiness(row, blockedList);
      var lineId = toLineId(row.lineName || row.line);
      var job = {
        job: row,
        lineId: lineId,
        lineName: (row.lineName || row.line || '').toString().trim() || '—',
        startTime: startTime,
        runDateKey: dateKey(runDate),
        orderId: normalizeOrderId(row),
        weightLbs: row.weightNum != null ? row.weightNum : 0,
        materialReady: readiness.ready,
        reasonCode: readiness.reasonCode,
        actionText: readiness.actionText,
        evidence: readiness.evidence
      };
      jobs.push(job);
      if (lineMap[lineId]) lineMap[lineId].push(job);
    });

    jobs.sort(function (a, b) {
      if (a.materialReady !== b.materialReady) return a.materialReady ? 1 : -1;
      return a.startTime - b.startTime;
    });

    return { jobs: jobs, lineMap: lineMap };
  }

  /**
   * Past-due not scheduled split into material-ready (fast wins) vs material-blocked, with top 10 and reason/action.
   * @param {array} openRows - Open orders
   * @param {array} scheduleRows - Production schedule
   * @param {array} blockedList - No-coil list (with status for reason)
   * @param {Date} today
   */
  function getPastDueNotScheduledSplit(openRows, scheduleRows, blockedList, today) {
    today = today || new Date();
    today.setHours(0, 0, 0, 0);
    var onSchedule = {};
    (scheduleRows || []).forEach(function (r) {
      var o = normalizeOrderId(r);
      if (o) onSchedule[o] = true;
    });

    var blockedByOrder = {};
    (blockedList || []).forEach(function (b) {
      var o = normalizeOrderId(b);
      if (o) blockedByOrder[o] = b;
    });

    var materialReady = { orders: [], totalLbs: 0 };
    var materialBlocked = { orders: [], totalLbs: 0, topGaps: [] };

    (openRows || []).forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      if (bal <= 0) return;
      var dueOnly = due && !isNaN(due.getTime()) ? new Date(due.getFullYear(), due.getMonth(), due.getDate()) : null;
      if (dueOnly >= today) return;
      var orderId = normalizeOrderId(row);
      if (onSchedule[orderId]) return;

      var blocked = blockedByOrder[orderId];
      var readiness = getMaterialReadiness(row, blocked ? [blocked] : []);
      var rec = {
        orderId: orderId,
        order: row.order,
        item: row.item,
        customer: (row.customer || '').toString().trim() || '—',
        balance: bal,
        dueStr: dueOnly ? dateKey(dueOnly) : '—',
        reasonCode: readiness.reasonCode,
        actionText: readiness.actionText
      };

      if (readiness.ready) {
        materialReady.orders.push(rec);
        materialReady.totalLbs += bal;
      } else {
        materialBlocked.orders.push(rec);
        materialBlocked.totalLbs += bal;
      }
    });

    materialReady.orders.sort(function (a, b) { return b.balance - a.balance; });
    materialBlocked.orders.sort(function (a, b) { return b.balance - a.balance; });

    var reasonCounts = {};
    materialBlocked.orders.forEach(function (o) {
      reasonCounts[o.reasonCode] = (reasonCounts[o.reasonCode] || 0) + 1;
    });
    materialBlocked.topGaps = Object.keys(reasonCounts).map(function (code) {
      return { reasonCode: code, count: reasonCounts[code], actionText: ACTIONS_BY_REASON[code] || ACTIONS_BY_REASON.COIL_NOT_FOUND };
    }).sort(function (a, b) { return b.count - a.count; }).slice(0, 5);

    return {
      materialReady: { orders: materialReady.orders.slice(0, 10), totalLbs: materialReady.totalLbs },
      materialBlocked: { orders: materialBlocked.orders.slice(0, 10), totalLbs: materialBlocked.totalLbs, topGaps: materialBlocked.topGaps }
    };
  }

  /**
   * Lookahead metrics for a horizon (7, 14, or 30 days).
   * @param {number} horizonDays - 7, 14, or 30
   * @param {array} openRows - Orders with dueDate, balanceNum
   * @param {array} scheduleRows - Planned runs (runDateObj, weightNum)
   * @param {array} blockedList - For no-plan lbs
   * @param {object} options - { capacityLbsPerDay, runRateLbsPerHour, pmHoursPerDayPerLine, operatingHoursPerDayPerLine }
   *   If capacityLbsPerDay is provided and > 0, it is used (e.g. from MTD run data). Otherwise capacity is derived from run rate.
   */
  function getLookahead(horizonDays, openRows, scheduleRows, blockedList, options) {
    options = options || {};
    var totalCapacityLbs;
    if (options.capacityLbsPerDay != null && options.capacityLbsPerDay > 0) {
      totalCapacityLbs = options.capacityLbsPerDay * horizonDays;
    } else {
      var runRate = options.runRateLbsPerHour != null ? options.runRateLbsPerHour : 20000;
      var pmHoursPerDay = options.pmHoursPerDayPerLine != null ? options.pmHoursPerDayPerLine : 0;
      var operatingHoursPerDay = options.operatingHoursPerDayPerLine != null ? options.operatingHoursPerDayPerLine : 12;
      var lines = 2;
      var capacityPerDay = lines * (operatingHoursPerDay - pmHoursPerDay) * runRate;
      totalCapacityLbs = capacityPerDay * horizonDays;
    }

    var now = new Date();
    now.setHours(0, 0, 0, 0);
    var horizonEnd = new Date(now);
    horizonEnd.setDate(horizonEnd.getDate() + horizonDays);

    var demandLbs = 0;
    var dueByDay = {};
    (openRows || []).forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      if (bal <= 0 || !due || isNaN(due.getTime())) return;
      var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueOnly >= now && dueOnly < horizonEnd) {
        demandLbs += bal;
        var k = dateKey(dueOnly);
        dueByDay[k] = (dueByDay[k] || 0) + bal;
      }
    });

    var plannedLbs = 0;
    (scheduleRows || []).forEach(function (row) {
      var runDate = row.runDateObj || (row.runDate ? new Date(row.runDate) : null);
      if (!runDate) return;
      var d = new Date(runDate.getFullYear(), runDate.getMonth(), runDate.getDate());
      if (d >= now && d < horizonEnd) plannedLbs += row.weightNum || 0;
    });

    var avgDailyDue = demandLbs / horizonDays;
    var waveDays = Object.keys(dueByDay).filter(function (k) {
      return dueByDay[k] > avgDailyDue * 1.75;
    });

    var blockedLbs = 0;
    (blockedList || []).forEach(function (b) {
      blockedLbs += (b.weightNum || 0);
    });
    var onHandLbs = Math.max(0, demandLbs - blockedLbs);
    var noPlanLbs = blockedLbs;
    var inboundLbs = 0;

    var capacityTight = totalCapacityLbs > 0 && demandLbs > totalCapacityLbs * 0.9;
    var coilCoverageLow = (onHandLbs + inboundLbs) < demandLbs * 0.8 && demandLbs > 0;
    var wave = waveDays.length > 0;

    var reasonCounts = {};
    (blockedList || []).forEach(function (b) {
      var statusParts = [b.status, b.notes, b.reason].filter(Boolean).join(' ');
      var code = getBlockedReasonFromStatus(statusParts);
      reasonCounts[code] = (reasonCounts[code] || 0) + (b.weightNum || 0);
    });
    var topGaps = Object.keys(reasonCounts).map(function (code) {
      return { spec: code, lbs: reasonCounts[code], ordersBehind: 0 };
    }).sort(function (a, b) { return b.lbs - a.lbs; }).slice(0, 5);

    return {
      horizonDays: horizonDays,
      demandLbs: demandLbs,
      capacityLbs: totalCapacityLbs,
      plannedLbs: plannedLbs,
      flags: {
        CAPACITY_TIGHT: capacityTight,
        COIL_COVERAGE_LOW: coilCoverageLow,
        WAVE: wave
      },
      coilCoverage: { onHandLbs: onHandLbs, inboundLbs: inboundLbs, noPlanLbs: noPlanLbs },
      topGaps: topGaps,
      waveDays: waveDays
    };
  }

  return {
    REASON_CODES: REASON_CODES,
    RISK_REASONS: RISK_REASONS,
    ACTIONS_BY_REASON: ACTIONS_BY_REASON,
    getMaterialReadiness: getMaterialReadiness,
    getPrimaryRisk: getPrimaryRisk,
    getScheduleFeasibility48h: getScheduleFeasibility48h,
    getPastDueNotScheduledSplit: getPastDueNotScheduledSplit,
    getLookahead: getLookahead,
    getBlockedReasonFromStatus: getBlockedReasonFromStatus,
    normalizeOrderId: normalizeOrderId,
    dateKey: dateKey
  };
});
