/**
 * CTL Dashboard — Supabase shared storage.
 * Loads shared data from Supabase before the app runs, and pushes changes back.
 * If supabase-config.js is not present or empty, the app runs with localStorage only.
 */
(function () {
  'use strict';

  var SYNC_KEYS = [
    'ctl-openstatus-data',
    'ctl-orderpivot-data',
    'ctl-materialavailability-data',
    'ctl-schedule-data',
    'ctl-report-history',
    'ctl-targets',
    'ctl-manager-focus-done',
    'ctl-pastdue-dispositions',
    'ctl-equipment-list',
    'ctl-issue-types',
    'ctl-report-date',
    'ctl-theme',
    'ctl-process-delay-types',
    'ctl-otd-tracker-rows',
    'ctl-siop-demand-supply',
    'ctl-siop-paste',
    'ctl-agent-siop-plan',
    'ctl-crew-roster',
    'ctl-crew-pay-rates',
    'ctl-crew-employee-list'
  ];

  var loadingFromSupabase = false;
  var originalSetItem = localStorage.setItem.bind(localStorage);

  localStorage.setItem = function (key, value) {
    originalSetItem(key, value);
    if (loadingFromSupabase || SYNC_KEYS.indexOf(key) === -1) return;
    var url = window.CTL_SUPABASE_URL;
    var anonKey = window.CTL_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return;
    var payload = { key: key, value: parseValue(value) };
    fetch(url + '/rest/v1/app_data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(payload)
    }).catch(function () {});
  };

  function parseValue(v) {
    if (v == null) return null;
    if (typeof v !== 'string') return v;
    try {
      return JSON.parse(v);
    } catch (e) {
      return v;
    }
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  function loadFromSupabase() {
    var url = window.CTL_SUPABASE_URL;
    var anonKey = window.CTL_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return Promise.resolve();
    return fetch(url + '/rest/v1/app_data?select=key,value', {
      headers: {
        'apikey': anonKey,
        'Authorization': 'Bearer ' + anonKey
      }
    })
      .then(function (res) { return res.json(); })
      .then(function (rows) {
        loadingFromSupabase = true;
        try {
          for (var i = 0; i < rows.length; i++) {
            var r = rows[i];
            var val = r.value;
            originalSetItem(r.key, typeof val === 'string' ? val : JSON.stringify(val));
          }
        } finally {
          loadingFromSupabase = false;
        }
      })
      .catch(function () {});
  }

  var APP_SCRIPTS = [
    'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js',
    'https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2.2.0/dist/chartjs-plugin-datalabels.min.js',
    'data.js',
    'operations.js',
    'schedule.js',
    'openstatus.js',
    'order-status-pivot.js',
    'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js',
    'material-availability.js',
    'manager-logic.js',
    'manager.js',
    'agent.js',
    'app.js'
  ];

  (async function () {
    await loadFromSupabase();
    for (var i = 0; i < APP_SCRIPTS.length; i++) {
      await loadScript(APP_SCRIPTS[i]);
    }
  })();
})();
