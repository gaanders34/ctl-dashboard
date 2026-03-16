/**
 * Shipping Forecast tab: potential late orders from Open Status + shipping capacity (trucks/day × avg coil).
 */
(function () {
  'use strict';

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

  function getOpenStatusData() {
    if (typeof window.ctlOpenStatusGetData === 'function') {
      return window.ctlOpenStatusGetData();
    }
    return { rows: [], todayKey: dateKey(todayStart()) };
  }

  function getInputNum(id, defaultVal) {
    var el = document.getElementById(id);
    if (!el || el.value === '') return defaultVal;
    var n = parseInt(el.value, 10);
    return isNaN(n) ? defaultVal : n;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function render() {
    var today = todayStart();
    var todayK = dateKey(today);
    var data = getOpenStatusData();
    var rows = data.rows || [];
    var avgCoil = getInputNum('sf-avg-coil', 46500);
    var trucksAvg = getInputNum('sf-trucks-avg', 55);
    var trucksMax = getInputNum('sf-trucks-max', 65);
    var dailyCapacityLbs = trucksAvg * avgCoil;

    var pastDueLbs = 0;
    var byDate = {};
    rows.forEach(function (row) {
      var due = row.dueDate;
      var bal = row.balanceNum || 0;
      if (!due || isNaN(due.getTime())) {
        pastDueLbs += bal;
        return;
      }
      var dueOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      if (dueOnly < today) {
        pastDueLbs += bal;
        return;
      }
      var k = dateKey(dueOnly);
      if (!byDate[k]) byDate[k] = 0;
      byDate[k] += bal;
    });

    var dateLabels = [];
    for (var i = 0; i < 14; i++) {
      var d = new Date(today);
      d.setDate(d.getDate() + i);
      dateLabels.push(dateKey(d));
    }

    var forecastBody = document.getElementById('sf-forecast-body');
    if (forecastBody) {
      var cumDemand = pastDueLbs;
      var cumCapacity = 0;
      var html = '';
      if (pastDueLbs > 0) {
        cumCapacity = 0;
        var gap = cumDemand - cumCapacity;
        html += '<tr class="' + (gap > 0 ? 'openstatus-over-capacity' : '') + '"><td>Past due</td><td>' + pastDueLbs.toLocaleString() + '</td><td>' + cumDemand.toLocaleString() + '</td><td>—</td><td>0</td><td>' + (gap > 0 ? gap.toLocaleString() : '0') + '</td><td>' + (gap > 0 ? 'Behind' : '—') + '</td></tr>';
      }
      dateLabels.forEach(function (k) {
        var lbsDay = byDate[k] || 0;
        cumDemand += lbsDay;
        cumCapacity += dailyCapacityLbs;
        var gap = cumDemand - cumCapacity;
        var status = gap > 0 ? 'At risk' : 'On track';
        html += '<tr class="' + (gap > 0 ? 'openstatus-over-capacity' : '') + '"><td>' + escapeHtml(k) + '</td><td>' + lbsDay.toLocaleString() + '</td><td>' + cumDemand.toLocaleString() + '</td><td>' + dailyCapacityLbs.toLocaleString() + '</td><td>' + cumCapacity.toLocaleString() + '</td><td>' + (gap > 0 ? gap.toLocaleString() : '0') + '</td><td>' + status + '</td></tr>';
      });
      forecastBody.innerHTML = html || '<tr><td colspan="7">Load Open Status and Apply to see demand. Set assumptions above.</td></tr>';
    }

    var ordersByDue = rows.filter(function (r) {
      return r.dueDate && !isNaN(r.dueDate.getTime()) && r.dueDate >= today;
    }).sort(function (a, b) {
      return a.dueDate.getTime() - b.dueDate.getTime();
    });

    var lateBody = document.getElementById('sf-late-orders-body');
    if (lateBody) {
      var cumDemandForLate = pastDueLbs;
      var lastDueK = null;
      var lateOrdersList = [];
      ordersByDue.forEach(function (row) {
        var dueK = dateKey(row.dueDate);
        if (dueK !== lastDueK) {
          cumDemandForLate += (byDate[dueK] || 0);
          lastDueK = dueK;
        }
        var daysToDue = Math.max(0, Math.ceil((row.dueDate - today) / (24 * 60 * 60 * 1000)));
        var capByDue = daysToDue * dailyCapacityLbs;
        if (cumDemandForLate > capByDue) {
          lateOrdersList.push({ row: row, cumDemand: cumDemandForLate, cumCap: capByDue, gap: cumDemandForLate - capByDue });
        }
      });
      if (lateOrdersList.length > 0) {
        lateBody.innerHTML = lateOrdersList.map(function (o) {
          return '<tr class="openstatus-over-capacity"><td>' + escapeHtml(o.row.order) + '</td><td>' + escapeHtml(o.row.dueDt) + '</td><td>' + (o.row.balanceNum || 0).toLocaleString() + '</td><td>' + o.cumDemand.toLocaleString() + '</td><td>' + o.cumCap.toLocaleString() + '</td><td>' + o.gap.toLocaleString() + '</td></tr>';
        }).join('');
      } else {
        lateBody.innerHTML = '<tr><td colspan="6">No potential late orders based on current capacity and demand.</td></tr>';
      }
    }
  }

  function init() {
    window.ctlShippingForecastRefresh = render;
    var avgEl = document.getElementById('sf-avg-coil');
    var trucksAvgEl = document.getElementById('sf-trucks-avg');
    var trucksMaxEl = document.getElementById('sf-trucks-max');
    if (avgEl) avgEl.addEventListener('change', render);
    if (trucksAvgEl) trucksAvgEl.addEventListener('change', render);
    if (trucksMaxEl) trucksMaxEl.addEventListener('change', render);
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
