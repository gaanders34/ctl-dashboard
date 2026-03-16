/**
 * Unit tests for manager-logic pure functions.
 * Run in Node: node manager-logic.test.js
 * Or in browser: load after manager-logic.js and call runManagerLogicTests().
 */
(function () {
  'use strict';

  var ManagerLogic = typeof window !== 'undefined' ? window.ManagerLogic : require('./manager-logic.js');

  function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
  }

  function assertEqual(a, b, msg) {
    if (a !== b) throw new Error(msg || 'Expected ' + a + ' === ' + b);
  }

  var tests = [
    function getMaterialReadiness_notOnBlockedList() {
      var job = { order: 'SO-1', item: '1' };
      var blocked = [];
      var r = ManagerLogic.getMaterialReadiness(job, blocked);
      assert(r.ready === true, 'should be ready when not on blocked list');
      assert(r.reasonCode === null);
    },
    function getMaterialReadiness_onBlockedList() {
      var job = { order: 'SO-2' };
      var blocked = [{ order: 'SO-2', status: 'No coil' }];
      var r = ManagerLogic.getMaterialReadiness(job, blocked);
      assert(r.ready === false);
      assert(r.reasonCode === ManagerLogic.REASON_CODES.COIL_NOT_FOUND || r.reasonCode === ManagerLogic.REASON_CODES.NO_COMPATIBLE_COIL);
      assert(r.actionText && r.actionText.length > 0);
    },
    function getMaterialReadiness_reasonMapping() {
      var blockedInbound = [{ order: 'X', status: 'Coil inbound ETA Friday' }];
      var r = ManagerLogic.getMaterialReadiness({ order: 'X' }, blockedInbound);
      assert(r.ready === false);
      assertEqual(r.reasonCode, ManagerLogic.REASON_CODES.COIL_INBOUND);

      var blockedHold = [{ order: 'Y', notes: 'Quality hold' }];
      var r2 = ManagerLogic.getMaterialReadiness({ order: 'Y' }, blockedHold);
      assert(r2.ready === false);
      assertEqual(r2.reasonCode, ManagerLogic.REASON_CODES.COIL_ON_HOLD);
    },
    function getPrimaryRisk_material() {
      var order = { order: 'A', dueDate: new Date(), balanceNum: 1000 };
      var risk = ManagerLogic.getPrimaryRisk(order, { isOnBlockedList: true });
      assertEqual(risk.reason, ManagerLogic.RISK_REASONS.MATERIAL);
      assert(risk.why && risk.why.indexOf('Material') >= 0);
    },
    function getPrimaryRisk_capacity() {
      var order = { order: 'B', dueDate: new Date(), balanceNum: 500 };
      var risk = ManagerLogic.getPrimaryRisk(order, { isScheduled: false });
      assertEqual(risk.reason, ManagerLogic.RISK_REASONS.CAPACITY);
    },
    function getPrimaryRisk_quality() {
      var order = { order: 'C' };
      var risk = ManagerLogic.getPrimaryRisk(order, { hasQualityHold: true });
      assertEqual(risk.reason, ManagerLogic.RISK_REASONS.QUALITY);
    },
    function getScheduleFeasibility48h_sortOrder() {
      var schedule = [
        { runDateObj: new Date(Date.now() + 24 * 3600000), lineName: '½ line', order: 'J1', weightNum: 10000 },
        { runDateObj: new Date(Date.now() + 12 * 3600000), lineName: 'Redbud', order: 'J2', weightNum: 8000 }
      ];
      var blocked = [{ order: 'J2', status: 'No coil' }];
      var out = ManagerLogic.getScheduleFeasibility48h(schedule, blocked, new Date());
      assert(out.jobs.length === 2);
      assert(out.jobs[0].materialReady === false && out.jobs[0].orderId === 'J2');
      assert(out.jobs[1].materialReady === true);
    },
    function getPastDueNotScheduledSplit() {
      var today = new Date();
      today.setHours(0, 0, 0, 0);
      var open = [
        { order: 'O1', item: '1', dueDate: new Date(today.getTime() - 86400000), balanceNum: 5000 },
        { order: 'O2', dueDate: new Date(today.getTime() - 86400000), balanceNum: 3000 }
      ];
      var schedule = [];
      var blocked = [{ order: 'O2', status: 'No coil' }];
      var split = ManagerLogic.getPastDueNotScheduledSplit(open, schedule, blocked, today);
      assert(split.materialReady.orders.length >= 1);
      assert(split.materialBlocked.orders.length >= 1);
      assert(split.materialReady.totalLbs === 5000);
      assert(split.materialBlocked.totalLbs === 3000);
    },
    function getLookahead_flags() {
      var open = [];
      for (var i = 0; i < 20; i++) {
        var d = new Date();
        d.setDate(d.getDate() + (i % 7));
        open.push({ order: 'O' + i, dueDate: d, balanceNum: 50000 });
      }
      var demand = 20 * 50000;
      var out = ManagerLogic.getLookahead(7, open, [], [], { runRateLbsPerHour: 1000, operatingHoursPerDayPerLine: 12 });
      assert(out.demandLbs > 0);
      assert(out.capacityLbs > 0);
      assert(typeof out.flags.CAPACITY_TIGHT === 'boolean');
      assert(typeof out.flags.COIL_COVERAGE_LOW === 'boolean');
      assert(Array.isArray(out.topGaps));
    }

    function getLookahead_capacityLbsPerDay() {
      var out = ManagerLogic.getLookahead(7, [], [], [], { capacityLbsPerDay: 100000 });
      assert(out.capacityLbs === 700000);
      var out14 = ManagerLogic.getLookahead(14, [], [], [], { capacityLbsPerDay: 50000 });
      assert(out14.capacityLbs === 700000);
    }
  ];

  function runManagerLogicTests() {
    var passed = 0;
    var failed = 0;
    tests.forEach(function (fn, i) {
      try {
        fn();
        passed++;
        if (typeof console !== 'undefined') console.log('OK ' + (fn.name || 'test ' + i));
      } catch (e) {
        failed++;
        if (typeof console !== 'undefined') console.error('FAIL ' + (fn.name || 'test ' + i) + ': ' + e.message);
      }
    });
    if (typeof console !== 'undefined') console.log('ManagerLogic tests: ' + passed + ' passed, ' + failed + ' failed');
    return { passed: passed, failed: failed };
  }

  if (typeof window !== 'undefined') window.runManagerLogicTests = runManagerLogicTests;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { runManagerLogicTests: runManagerLogicTests };
    if (require.main === module) runManagerLogicTests();
  }
})();
