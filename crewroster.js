/**
 * Crew Roster tab: upload staffing plan (paste TSV from Excel/Sheets).
 * Two machines + on-shift standby, 12 per shift per crew.
 * Columns: Crew, Shift, Section, Machine, Position, Qty, Assigned employee, Notes.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ctl-crew-roster';
  var PAY_STORAGE_KEY = 'ctl-crew-pay-rates';
  var EMPLOYEE_LIST_KEY = 'ctl-crew-employee-list';

  var rosterRows = [];
  var employeeList = [];

  var COL_ALIASES = {
    crew: ['crew'],
    shift: ['shift'],
    section: ['section'],
    machine: ['machine'],
    position: ['position'],
    qty: ['qty', 'quantity'],
    employee: ['assigned employee', 'assigned employee (name)', 'employee', 'name', 'assigned'],
    notes: ['notes'],
    fullName: ['full name', 'fullname', 'employee name'],
    hireDate: ['hire date', 'hiredate', 'hire date', 'date'],
    department: ['department', 'dept']
  };

  function normalizeHeader(name) {
    if (!name || typeof name !== 'string') return '';
    var s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    for (var key in COL_ALIASES) {
      for (var i = 0; i < COL_ALIASES[key].length; i++) {
        var alias = COL_ALIASES[key][i];
        if (s === alias || s.indexOf(alias) === 0) return key;
      }
    }
    return s.replace(/\s/g, '_') || ('col' + name.length);
  }

  function inferCrewShift(section) {
    var s = (section || '').trim();
    var m = s.match(/Crew\s*([A-Da-d])\s*\(?\s*(Day|Night)/i);
    if (m) return { crew: 'Crew ' + m[1].toUpperCase(), shift: m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() };
    return null;
  }

  function inferCrewFromSection(section) {
    var s = (section || '').trim();
    var m = s.match(/Team\s*([1-4])/i);
    if (m) {
      var crew = ['Crew A', 'Crew B', 'Crew C', 'Crew D'][parseInt(m[1], 10) - 1];
      return crew || '';
    }
    return '';
  }

  function looksLikeHeaderRow(firstCells) {
    if (!firstCells || firstCells.length < 3) return false;
    var normalized = firstCells.slice(0, 6).map(function (c) { return normalizeHeader(String(c).trim()); });
    return normalized.indexOf('section') >= 0 || normalized.indexOf('machine') >= 0 ||
      normalized.indexOf('position') >= 0 || normalized.indexOf('employee') >= 0 ||
      normalized.indexOf('assigned') >= 0;
  }

  function looksLikeDate(s) {
    if (!s || typeof s !== 'string') return false;
    var t = s.trim();
    return (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/).test(t) || (/^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/).test(t);
  }

  function looksLikeEmployeeListHeader(firstCells) {
    if (!firstCells || firstCells.length < 3) return false;
    var normalized = firstCells.slice(0, 6).map(function (c) { return normalizeHeader(String(c).trim()); });
    var hasFullName = normalized.indexOf('fullname') >= 0;
    var hasHireDate = normalized.indexOf('hiredate') >= 0;
    var hasDepartment = normalized.indexOf('department') >= 0;
    var hasPosition = normalized.indexOf('position') >= 0;
    return hasFullName && (hasHireDate || hasDepartment || hasPosition);
  }

  function looksLikeEmployeeListDataRow(cells) {
    if (!cells || cells.length < 4) return false;
    var second = String(cells[1] || '').trim();
    return looksLikeDate(second);
  }

  var DEFAULT_HEADERS = ['section', 'machine', 'position', 'qty', 'employee', 'notes'];
  var DEFAULT_EMPLOYEE_LIST_HEADERS = ['fullName', 'hireDate', 'department', 'position'];

  function parseEmployeeListFormat(lines, startIdx, sep) {
    var firstCells = lines[startIdx].split(sep).map(function (c) { return c.trim(); });
    var hasHeader = looksLikeEmployeeListHeader(firstCells);
    var headers;
    var dataStart;
    if (hasHeader) {
      headers = firstCells.map(function (h) { return normalizeHeader(h); });
      dataStart = startIdx + 1;
    } else if (looksLikeEmployeeListDataRow(firstCells)) {
      headers = DEFAULT_EMPLOYEE_LIST_HEADERS.slice();
      dataStart = startIdx;
    } else {
      return null;
    }
    var list = [];
    for (var i = dataStart; i < lines.length; i++) {
      var cells = lines[i].split(sep);
      var row = {};
      headers.forEach(function (key, idx) {
        var val = (cells[idx] != null ? String(cells[idx]).trim().replace(/\s+/g, ' ') : '');
        row[key] = val;
      });
      if (row.fullName || row.department || row.position) list.push(row);
    }
    return list;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 1) return { rows: [], employeeList: [], message: 'Paste at least one row.' };
    var startIdx = 0;
    var currentCrew = '';
    var currentShift = '';
    if (lines[0].indexOf('\t') < 0 && lines[0].indexOf(',') < 0) {
      var inferred = inferCrewShift(lines[0]);
      if (inferred) {
        currentCrew = inferred.crew;
        currentShift = inferred.shift;
        startIdx = 1;
      }
    }
    if (lines.length <= startIdx) return { rows: [], employeeList: [], message: 'No data rows.' };
    var sep = lines[startIdx].indexOf('\t') >= 0 ? '\t' : ',';
    var firstCells = lines[startIdx].split(sep).map(function (c) { return c.trim(); });

    var employeeListResult = parseEmployeeListFormat(lines, startIdx, sep);
    if (employeeListResult && employeeListResult.length > 0) {
      return { rows: [], employeeList: employeeListResult, message: null };
    }

    var hasHeaderRow = looksLikeHeaderRow(firstCells);
    var headers;
    var dataStart;
    if (hasHeaderRow) {
      headers = firstCells.map(function (h) { return normalizeHeader(h); });
      dataStart = startIdx + 1;
    } else {
      headers = DEFAULT_HEADERS.slice();
      dataStart = startIdx;
    }
    var hasCrewCol = headers.indexOf('crew') >= 0;
    var hasShiftCol = headers.indexOf('shift') >= 0;
    var rows = [];
    for (var i = dataStart; i < lines.length; i++) {
      var cells = lines[i].split(sep);
      var row = {};
      headers.forEach(function (key, idx) {
        var val = (cells[idx] != null ? String(cells[idx]).trim() : '');
        row[key] = val;
      });
      var sectionVal = (row.section || '').trim();
      if (!hasCrewCol || !hasShiftCol) {
        inferred = inferCrewShift(sectionVal);
        if (inferred) {
          currentCrew = inferred.crew;
          currentShift = inferred.shift;
          if (sectionVal.match(/^Crew\s+[A-D]\s*\(/i) {
            row.crew = currentCrew;
            row.shift = currentShift;
            if (!row.machine && !row.position && !row.employee) continue;
          } else {
            row.section = sectionVal;
          }
        }
        if (currentCrew) row.crew = row.crew || currentCrew;
        if (currentShift) row.shift = row.shift || currentShift;
        if (!row.crew && sectionVal) row.crew = inferCrewFromSection(sectionVal) || currentCrew;
      }
      if (sectionVal.toLowerCase().indexOf('total headcount') >= 0) continue;
      if (row.crew || row.section || row.employee || row.position || row.machine) rows.push(row);
    }
    return { rows: rows, employeeList: [], message: null };
  }

  function saveRoster(rows) {
    rosterRows = rows || [];
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rosterRows));
    } catch (e) {}
  }

  function saveEmployeeList(list) {
    employeeList = list || [];
    try {
      localStorage.setItem(EMPLOYEE_LIST_KEY, JSON.stringify(employeeList));
    } catch (e) {}
  }

  function loadRoster() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      rosterRows = raw ? JSON.parse(raw) : [];
    } catch (e) {
      rosterRows = [];
    }
    return rosterRows;
  }

  function loadEmployeeList() {
    try {
      var raw = localStorage.getItem(EMPLOYEE_LIST_KEY);
      employeeList = raw ? JSON.parse(raw) : [];
    } catch (e) {
      employeeList = [];
    }
    return employeeList;
  }

  function savePayRates(main, assistant) {
    try {
      localStorage.setItem(PAY_STORAGE_KEY, JSON.stringify({ mainOperator: main, assistantOperator: assistant }));
    } catch (e) {}
  }

  function loadPayRates() {
    try {
      var raw = localStorage.getItem(PAY_STORAGE_KEY);
      var o = raw ? JSON.parse(raw) : {};
      return { mainOperator: o.mainOperator != null ? o.mainOperator : '', assistantOperator: o.assistantOperator != null ? o.assistantOperator : '' };
    } catch (e) {
      return { mainOperator: '', assistantOperator: '' };
    }
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function getVal(row, key) {
    return (row[key] != null && row[key] !== '') ? String(row[key]).trim() : '—';
  }

  function renderRoster() {
    var wrap = document.getElementById('crewroster-tables');
    if (!wrap) return;

    loadRoster();
    loadEmployeeList();

    var parts = [];

    if (employeeList.length > 0) {
      var listRows = employeeList.map(function (r) {
        return '<tr>' +
          '<td class="crew-roster-employee">' + escapeHtml(getVal(r, 'fullName')) + '</td>' +
          '<td>' + escapeHtml(getVal(r, 'hireDate')) + '</td>' +
          '<td>' + escapeHtml(getVal(r, 'department')) + '</td>' +
          '<td>' + escapeHtml(getVal(r, 'position')) + '</td>' +
          '</tr>';
      }).join('');
      parts.push('<div class="crew-roster-crew-block">' +
        '<h4 class="crew-roster-crew-title">Employee list</h4>' +
        '<p class="section-note">Full Name, Hire Date, Department, Position.</p>' +
        '<div class="schedule-table-wrap">' +
        '<table class="order-matches-table schedule-table crew-roster-table">' +
        '<thead><tr><th>Full Name</th><th>Hire Date</th><th>Department</th><th>Position</th></tr></thead>' +
        '<tbody>' + listRows + '</tbody></table></div></div>');
    }

    if (rosterRows.length > 0) {
      var byCrewShift = {};
      rosterRows.forEach(function (row) {
        var crew = getVal(row, 'crew') || '—';
        var shift = getVal(row, 'shift') || '—';
        var key = crew + '|' + shift;
        if (!byCrewShift[key]) byCrewShift[key] = { crew: crew, shift: shift, rows: [] };
        byCrewShift[key].rows.push(row);
      });

      var order = ['Crew A|Day', 'Crew A|Night', 'Crew B|Day', 'Crew B|Night', 'Crew C|Day', 'Crew C|Night', 'Crew D|Day', 'Crew D|Night'];
      var keys = Object.keys(byCrewShift).sort(function (a, b) {
        var ia = order.indexOf(a);
        var ib = order.indexOf(b);
        if (ia >= 0 && ib >= 0) return ia - ib;
        if (ia >= 0) return -1;
        if (ib >= 0) return 1;
        return a.localeCompare(b);
      });

      keys.forEach(function (key) {
        var block = byCrewShift[key];
        var title = block.crew + ' (' + block.shift + ' Shift)';
        var rowsHtml = block.rows.map(function (r) {
          return '<tr>' +
            '<td>' + escapeHtml(getVal(r, 'section')) + '</td>' +
            '<td>' + escapeHtml(getVal(r, 'machine')) + '</td>' +
            '<td>' + escapeHtml(getVal(r, 'position')) + '</td>' +
            '<td>' + escapeHtml(getVal(r, 'qty')) + '</td>' +
            '<td class="crew-roster-employee">' + escapeHtml(getVal(r, 'employee')) + '</td>' +
            '<td>' + escapeHtml(getVal(r, 'notes')) + '</td>' +
            '</tr>';
        }).join('');
        parts.push('<div class="crew-roster-crew-block">' +
          '<h4 class="crew-roster-crew-title">' + escapeHtml(title) + '</h4>' +
          '<div class="schedule-table-wrap">' +
          '<table class="order-matches-table schedule-table crew-roster-table">' +
          '<thead><tr><th>Section</th><th>Machine</th><th>Position</th><th>Qty</th><th>Assigned employee</th><th>Notes</th></tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody></table></div></div>');
      });
    }

    if (parts.length === 0) {
      wrap.innerHTML = '<p class="section-note">No data loaded. Paste either: (1) <strong>Employee list</strong> — Full Name, Hire Date, Department, Position — or (2) <strong>Crew roster</strong> — Section, Machine, Position, Qty, Assigned employee, Notes. Then click Apply.</p>';
    } else {
      wrap.innerHTML = parts.join('');
    }
  }

  function applyPayRatesToInputs() {
    var rates = loadPayRates();
    var mainEl = document.getElementById('crewroster-pay-main');
    var assistantEl = document.getElementById('crewroster-pay-assistant');
    if (mainEl) mainEl.value = rates.mainOperator !== '' && rates.mainOperator != null ? rates.mainOperator : '';
    if (assistantEl) assistantEl.value = rates.assistantOperator !== '' && rates.assistantOperator != null ? rates.assistantOperator : '';
  }

  function init() {
    loadRoster();
    applyPayRatesToInputs();
    renderRoster();

    var applyBtn = document.getElementById('btn-apply-crewroster');
    var pasteEl = document.getElementById('crewroster-paste');
    if (applyBtn && pasteEl) {
      applyBtn.addEventListener('click', function () {
        var text = pasteEl.value || '';
        var result = parsePaste(text);
        var rows = result.rows || [];
        var list = result.employeeList || [];
        saveRoster(rows);
        saveEmployeeList(list);
        var mainEl = document.getElementById('crewroster-pay-main');
        var assistantEl = document.getElementById('crewroster-pay-assistant');
        var main = mainEl && mainEl.value !== '' ? parseFloat(mainEl.value, 10) : null;
        var assistant = assistantEl && assistantEl.value !== '' ? parseFloat(assistantEl.value, 10) : null;
        savePayRates(isNaN(main) ? null : main, isNaN(assistant) ? null : assistant);
        renderRoster();
        var status = document.getElementById('crewroster-status');
        if (status) {
          if (result.message) {
            status.textContent = result.message + ' Use header: Full Name, Hire Date, Department, Position — or Section, Machine, Position, Qty, Assigned employee, Notes.';
            status.className = 'paste-status paste-status-warn';
          } else if (list.length > 0) {
            status.textContent = 'Loaded employee list: ' + list.length + ' row(s).';
            status.className = 'paste-status';
          } else {
            status.textContent = 'Loaded roster: ' + rows.length + ' row(s).';
            status.className = 'paste-status';
          }
        }
      });
    }
  }

  window.ctlCrewRosterRefresh = function () {
    applyPayRatesToInputs();
    renderRoster();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
