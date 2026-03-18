/**
 * Production Schedule tab: paste schedule (header + rows), show tons per day, PCS by line, on time / late %.
 */
(function () {
  'use strict';

  var SCHEDULE_STORAGE_KEY = 'ctl-schedule-data';
  var scheduleRows = [];
  window.ctlScheduleRows = scheduleRows;

  var COL_ALIASES = {
    runDate: ['run date', 'run_date', 'rundate', 'run date ', 'date', 'ord_proddate', 'ord proddate', 'prod date', 'prod_date'],
    dueDate: ['due date', 'due_date', 'duedate', 'due dt', 'due'],
    plannedWeight: ['plannedweight', 'planned weight', 'planned_weight', 'tons', 'weight', 'lbs', 'plannedweight (lbs)', 'place', 'plannedweight (tons)'],
    plannedPcs: ['plannedpcs', 'planned pcs', 'planned_pc', 'planned pc', 'pcs', 'pieces', 'qty'],
    line: ['pwc name', 'pwc_name', 'line', 'pwc', 'line name', 'linename', 'warehouse'],
    order: ['order', 'order id', 'order #', 'order#', 'order/line', 'orderline', 'orderitem', 'order item', 'job', 'job #', 'work order', 'work order #', 'wo', 'work order number', 'bucket id', 'bucketid']
  };

  function normalizeHeader(name) {
    if (!name || typeof name !== 'string') return '';
    var s = name.toLowerCase().trim().replace(/\s+/g, ' ');
    for (var key in COL_ALIASES) {
      for (var i = 0; i < COL_ALIASES[key].length; i++) {
        if (s.indexOf(COL_ALIASES[key][i]) === 0 || s === COL_ALIASES[key][i]) return key;
      }
    }
    return s.replace(/\s/g, '_') || 'col';
  }

  function excelSerialToDate(serial) {
    if (serial == null || isNaN(serial)) return null;
    var n = Number(serial);
    if (n > 1000000 || n < 0) return new Date(n);
    return new Date((n - 25569) * 86400 * 1000);
  }

  var MONTH_ABBR = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  function parseDate(s) {
    if (s == null || s === '') return null;
    if (typeof s === 'number' && !isNaN(s)) {
      if (s > 1000 && s < 1000000) return excelSerialToDate(s);
      return new Date(s);
    }
    var str = String(s).trim();
    if (!str) return null;
    if (str.match(/^\d{4,5}$/)) {
      var n = parseInt(str, 10);
      if (n > 1000 && n < 1000000) return excelSerialToDate(n);
    }
    var m = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      var y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      return new Date(y, parseInt(m[1], 10) - 1, parseInt(m[2], 10));
    }
    var dmy = str.match(/^(\d{1,2})\s+([a-z]{3})\s*$/i);
    if (dmy) {
      var day = parseInt(dmy[1], 10);
      var mon = MONTH_ABBR[(dmy[2] || '').toLowerCase().slice(0, 3)];
      if (mon != null) return new Date(new Date().getFullYear(), mon, day);
    }
    var d = new Date(str);
    return isNaN(d.getTime()) ? null : d;
  }

  function numVal(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number' && !isNaN(v)) return v;
    var n = parseFloat(String(v).replace(/[^\d.-]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  function dateKey(d) {
    if (!d) return '';
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  /** If runDate is only a day number (1-31), build a full date key using current month/year so tables show full date. */
  function runDateDisplayKey(row) {
    if (row.runDateObj && !isNaN(row.runDateObj.getTime())) return dateKey(row.runDateObj);
    var raw = (row.runDate != null ? String(row.runDate).trim() : '') || '';
    var dayNum = parseInt(raw, 10);
    if (raw === String(dayNum) && dayNum >= 1 && dayNum <= 31) {
      var now = new Date();
      return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(dayNum).padStart(2, '0');
    }
    return raw || '';
  }

  function findColIndex(headerRow, aliases) {
    for (var i = 0; i < headerRow.length; i++) {
      var h = (headerRow[i] != null ? String(headerRow[i]) : '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/_/g, ' ');
      for (var a = 0; a < aliases.length; a++) {
        if (h.indexOf(aliases[a]) >= 0 || aliases[a].indexOf(h) >= 0) return i;
      }
    }
    return -1;
  }

  /** Normalize header for wide-table matching */
  function normHeaderCell(h) {
    return (h != null ? String(h).trim().toLowerCase().replace(/_/g, ' ') : '').replace(/\s+/g, ' ');
  }

  /**
   * Map wide exports (many columns): planned_weight, planned_pc, date, due_date, PWC Name, Tons, etc.
   * Prefers planned_weight (lbs) over a separate Tons column so both can exist without overwriting.
   */
  function resolveScheduleColumnIndices(headerCells) {
    var H = headerCells.map(normHeaderCell);
    function idxExact(want) {
      var w = normHeaderCell(want);
      for (var i = 0; i < H.length; i++) if (H[i] === w) return i;
      return -1;
    }
    function idxFirst(candidates) {
      for (var c = 0; c < candidates.length; c++) {
        var w = normHeaderCell(candidates[c]);
        for (var i = 0; i < H.length; i++) {
          if (H[i] === w) return i;
        }
      }
      for (var c = 0; c < candidates.length; c++) {
        var w = normHeaderCell(candidates[c]);
        if (w.length < 4) continue;
        for (var i = 0; i < H.length; i++) {
          if (H[i].indexOf(w) === 0 || H[i] === w) return i;
        }
      }
      return -1;
    }
    var idxRun = idxExact('date');
    if (idxRun < 0) idxRun = idxFirst(['run date', 'production date', 'schedule date', 'ord proddate', 'prod date', 'rundate', 'start date']);
    var idxDue = idxFirst(['due date', 'duedate', 'due dt', 'due']);
    if (idxDue === idxRun) idxDue = idxFirst(['due date', 'due dt']);
    var idxPlannedLbs = idxFirst(['planned weight', 'plannedweight']);
    var idxTonsCol = idxExact('tons');
    var idxWeightGeneric = idxFirst(['place', 'weight lbs', 'lbs', 'plannedweight']);
    var idxWeight = idxPlannedLbs >= 0 ? idxPlannedLbs : (idxWeightGeneric >= 0 ? idxWeightGeneric : -1);
    var weightFromTonsOnly = idxWeight < 0 && idxTonsCol >= 0;
    if (weightFromTonsOnly) idxWeight = idxTonsCol;
    var weightIsTons = weightFromTonsOnly || (idxWeight >= 0 && H[idxWeight] === 'tons');
    if (idxWeight >= 0 && idxPlannedLbs >= 0) {
      idxWeight = idxPlannedLbs;
      weightIsTons = false;
    }
    var idxPcs = idxFirst(['planned pc', 'plannedpcs', 'planned pcs', 'pieces', 'qty', 'planned_pc']);
    var idxLine = idxFirst(['pwc name', 'line', 'warehouse', 'line name']);
    var idxOrder = idxFirst(['order', 'order id', 'order line', 'job', 'work order', 'bucket id']);
    var idxYear = idxExact('year');
    return {
      idxRun: idxRun,
      idxDue: idxDue,
      idxWeight: idxWeight,
      weightIsTons: weightIsTons,
      idxPcs: idxPcs,
      idxLine: idxLine,
      idxOrder: idxOrder,
      idxYear: idxYear,
      headerNorm: H
    };
  }

  function buildScheduleRowFromCells(rawCells, map, yearFallback) {
    function cell(i) {
      if (i < 0 || i >= rawCells.length) return '';
      var v = rawCells[i];
      if (v == null) return '';
      if (typeof v === 'number' && !isNaN(v)) return String(v);
      return String(v).trim();
    }
    function rawNum(i) {
      if (i < 0 || i >= rawCells.length) return null;
      return rawCells[i];
    }
    var runDateStr = cell(map.idxRun);
    var dueDateStr = cell(map.idxDue);
    var runRaw = map.idxRun >= 0 ? rawNum(map.idxRun) : null;
    var dueRaw = map.idxDue >= 0 ? rawNum(map.idxDue) : null;
    if (typeof runRaw === 'number' && runRaw > 1000 && runRaw < 1000000) {
      var rd = excelSerialToDate(runRaw);
      runDateStr = rd ? (rd.getMonth() + 1) + '/' + rd.getDate() + '/' + rd.getFullYear() : runDateStr;
    } else if (typeof runRaw === 'number' && runRaw >= 1 && runRaw <= 31 && runRaw === Math.floor(runRaw) && (!runDateStr || runDateStr === String(runRaw))) {
      var nowR = new Date();
      runDateStr = (nowR.getMonth() + 1) + '/' + Math.floor(runRaw) + '/' + nowR.getFullYear();
    }
    if (typeof dueRaw === 'number' && dueRaw > 1000 && dueRaw < 1000000) {
      var dd = excelSerialToDate(dueRaw);
      dueDateStr = dd ? (dd.getMonth() + 1) + '/' + dd.getDate() + '/' + dd.getFullYear() : dueDateStr;
    } else if (typeof dueRaw === 'number' && dueRaw >= 1 && dueRaw <= 31 && dueRaw === Math.floor(dueRaw) && (!dueDateStr || dueDateStr === String(dueRaw))) {
      var nowD = new Date();
      dueDateStr = (nowD.getMonth() + 1) + '/' + Math.floor(dueRaw) + '/' + nowD.getFullYear();
    }
    var yearVal = map.idxYear >= 0 ? cell(map.idxYear) : (yearFallback || '');
    if (dueDateStr && dueDateStr.match(/^\d{1,2}\s+[a-z]{3}\s*$/i) && yearVal) {
      var ym = dueDateStr.match(/^(\d{1,2})\s+([a-z]{3})\s*$/i);
      if (ym) {
        var y = parseInt(yearVal, 10) || new Date().getFullYear();
        var mon = MONTH_ABBR[(ym[2] || '').toLowerCase().slice(0, 3)];
        if (mon != null) dueDateStr = (mon + 1) + '/' + ym[1] + '/' + y;
      }
    }
    var weightVal = cell(map.idxWeight);
    var rawW = numVal(weightVal);
    var wNum = map.weightIsTons ? rawW * 2000 : rawW;
    return {
      runDate: runDateStr,
      dueDate: dueDateStr,
      plannedWeight: weightVal,
      plannedPcs: map.idxPcs >= 0 ? cell(map.idxPcs) : '',
      line: map.idxLine >= 0 ? cell(map.idxLine) : '',
      order: map.idxOrder >= 0 ? cell(map.idxOrder) : '',
      runDateObj: parseDate(runDateStr),
      dueDateObj: parseDate(dueDateStr),
      weightNum: wNum,
      pcsNum: numVal(map.idxPcs >= 0 ? rawCells[map.idxPcs] : 0),
      lineName: (map.idxLine >= 0 ? cell(map.idxLine) : '').trim() || '—'
    };
  }

  function parseExcelWorkbook(workbook) {
    var rows = [];
    if (typeof XLSX === 'undefined') return rows;
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return rows;
    var data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!data || data.length < 2) return rows;
    var headerRow = data[0].map(function (c) { return c != null ? String(c).trim() : ''; });
    var map = resolveScheduleColumnIndices(headerRow);

    for (var r = 1; r < data.length; r++) {
      var raw = data[r];
      if (!raw || !raw.length) continue;
      var yearVal = map.idxYear >= 0 && raw[map.idxYear] != null ? String(raw[map.idxYear]).trim() : '';
      rows.push(buildScheduleRowFromCells(raw, map, yearVal));
    }
    return rows;
  }

  function parsePaste(text) {
    var lines = (text || '').split(/\r?\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (lines.length < 2) return { rows: [] };
    var sep = lines[0].indexOf('\t') >= 0 ? '\t' : ',';
    var headerLine = lines[0].split(sep).map(function (h) { return h.trim(); });
    var map = resolveScheduleColumnIndices(headerLine);
    var useWideParser = map.idxRun >= 0 && map.idxWeight >= 0;
    if (useWideParser) {
      var out = [];
      for (var i = 1; i < lines.length; i++) {
        var cells = lines[i].split(sep).map(function (c) { return c.trim(); });
        while (cells.length < headerLine.length) cells.push('');
        var yearVal = map.idxYear >= 0 ? cells[map.idxYear] : '';
        out.push(buildScheduleRowFromCells(cells, map, yearVal));
      }
      return { rows: out };
    }
    var headers = headerLine.map(function (h) { return normalizeHeader(h); });
    var weightIdx = headers.indexOf('plannedWeight');
    var weightHeaderLower = (weightIdx >= 0 && headerLine[weightIdx]) ? headerLine[weightIdx].toLowerCase() : '';
    var weightIsTons = weightHeaderLower.indexOf('ton') >= 0 && weightHeaderLower.indexOf('lb') < 0 && weightHeaderLower.indexOf('pound') < 0;

    var rows = [];
    for (var j = 1; j < lines.length; j++) {
      var cells2 = lines[j].split(sep).map(function (c) { return c.trim(); });
      var row = {};
      headers.forEach(function (key, idx) {
        row[key] = cells2[idx];
      });
      row.runDateObj = parseDate(row.runDate);
      row.dueDateObj = parseDate(row.dueDate);
      var rawWeight = numVal(row.plannedWeight);
      row.weightNum = weightIsTons ? rawWeight * 2000 : rawWeight;
      row.pcsNum = numVal(row.plannedPcs);
      row.lineName = (row.line || '').trim() || '—';
      rows.push(row);
    }
    return { rows: rows };
  }

  function setEl(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function escapeHtml(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function renderSchedule() {
    // Tons per day: group by run date, sum weight
    var tonsByDate = {};
    scheduleRows.forEach(function (row) {
      var k = runDateDisplayKey(row);
      if (!k) return;
      if (!tonsByDate[k]) tonsByDate[k] = 0;
      tonsByDate[k] += row.weightNum;
    });
    var tonsRows = Object.keys(tonsByDate).sort().map(function (k) {
      var lbs = tonsByDate[k];
      var tons = (lbs / 2000).toFixed(2);
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + tons + '</td><td>' + Math.round(lbs).toLocaleString() + '</td></tr>';
    });
    var tonsBody = document.getElementById('schedule-tons-body');
    if (tonsBody) tonsBody.innerHTML = tonsRows.length ? tonsRows.join('') : '<tr><td colspan="3">No data</td></tr>';

    // PCS per day by line: group by run date and line, pivot Line 1 / Line 2 / Total
    var pcsByDateLine = {};
    var allLines = {};
    scheduleRows.forEach(function (row) {
      var k = runDateDisplayKey(row);
      if (!k) return;
      var line = row.lineName || '—';
      allLines[line] = true;
      if (!pcsByDateLine[k]) pcsByDateLine[k] = {};
      if (!pcsByDateLine[k][line]) pcsByDateLine[k][line] = 0;
      pcsByDateLine[k][line] += row.pcsNum;
    });
    var lineNames = Object.keys(allLines).sort();
    var line1 = lineNames[0] || 'Line 1';
    var line2 = lineNames[1] || 'Line 2';
    var theadRow = document.getElementById('schedule-pcs-thead-row');
    if (theadRow) {
      theadRow.innerHTML = '<th>Run date</th><th>' + escapeHtml(line1) + '</th><th>' + escapeHtml(line2) + '</th><th>Total</th>';
    }
    var pcsRows = Object.keys(pcsByDateLine).sort().map(function (k) {
      var line1Pcs = pcsByDateLine[k][line1] || 0;
      var line2Pcs = pcsByDateLine[k][line2] || 0;
      var total = (line1Pcs + line2Pcs) || Object.keys(pcsByDateLine[k]).reduce(function (sum, ln) { return sum + (pcsByDateLine[k][ln] || 0); }, 0);
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + line1Pcs + '</td><td>' + line2Pcs + '</td><td>' + total + '</td></tr>';
    });
    var pcsBody = document.getElementById('schedule-pcs-body');
    if (pcsBody) pcsBody.innerHTML = pcsRows.length ? pcsRows.join('') : '<tr><td colspan="4">No data</td></tr>';

    // On time / late % per day: run date vs due_date
    var onTimeByDate = {};
    var lateByDate = {};
    scheduleRows.forEach(function (row) {
      var runK = runDateDisplayKey(row);
      if (!runK) return;
      if (!onTimeByDate[runK]) onTimeByDate[runK] = 0;
      if (!lateByDate[runK]) lateByDate[runK] = 0;
      var runD = row.runDateObj;
      var dueD = row.dueDateObj;
      if (!runD || !dueD) {
        onTimeByDate[runK] += 1;
        return;
      }
      var runOnly = new Date(runD.getFullYear(), runD.getMonth(), runD.getDate());
      var dueOnly = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate());
      if (runOnly <= dueOnly) onTimeByDate[runK] += 1;
      else lateByDate[runK] += 1;
    });
    var allDates = {};
    Object.keys(onTimeByDate).forEach(function (k) { allDates[k] = true; });
    Object.keys(lateByDate).forEach(function (k) { allDates[k] = true; });
    var onTimeRows = Object.keys(allDates).sort().map(function (k) {
      var onTime = onTimeByDate[k] || 0;
      var late = lateByDate[k] || 0;
      var jobs = onTime + late;
      var onPct = jobs > 0 ? ((onTime / jobs) * 100).toFixed(1) : '0';
      var latePct = jobs > 0 ? ((late / jobs) * 100).toFixed(1) : '0';
      return '<tr><td>' + escapeHtml(k) + '</td><td>' + jobs + '</td><td>' + onPct + '%</td><td>' + latePct + '%</td></tr>';
    });
    var onTimeBody = document.getElementById('schedule-ontime-body');
    if (onTimeBody) onTimeBody.innerHTML = onTimeRows.length ? onTimeRows.join('') : '<tr><td colspan="4">No data</td></tr>';
  }

  function setUploadStatus(message, isComplete) {
    var el = document.getElementById('schedule-upload-status');
    if (el) {
      el.textContent = message;
      el.className = 'paste-status' + (isComplete ? ' upload-complete' : '');
    }
  }

  function restoreScheduleDateObjects() {
    scheduleRows.forEach(function (row) {
      row.runDateObj = parseDate(row.runDate);
      row.dueDateObj = parseDate(row.dueDate);
    });
  }

  function loadScheduleFromStorage() {
    try {
      var raw = localStorage.getItem(SCHEDULE_STORAGE_KEY);
      if (!raw) return;
      var loaded = JSON.parse(raw);
      if (Array.isArray(loaded) && loaded.length > 0) {
        scheduleRows = loaded;
        window.ctlScheduleRows = scheduleRows;
        restoreScheduleDateObjects();
        setEl('schedule-rows-count', scheduleRows.length);
        renderSchedule();
      }
    } catch (e) {}
  }

  function saveScheduleToStorage() {
    try {
      localStorage.setItem(SCHEDULE_STORAGE_KEY, JSON.stringify(scheduleRows));
    } catch (e) {}
  }

  function applyScheduleFromParsed(rows) {
    scheduleRows = rows || [];
    window.ctlScheduleRows = scheduleRows;
    restoreScheduleDateObjects();
    setEl('schedule-rows-count', scheduleRows.length);
    renderSchedule();
    saveScheduleToStorage();
  }

  function formatScheduleMapSummary(map, headerLine) {
    if (!map || !headerLine || !headerLine.length) return '';
    function lab(idx) {
      return idx >= 0 && headerLine[idx] != null ? '"' + String(headerLine[idx]).trim() + '"' : '';
    }
    var p = [];
    if (map.idxRun >= 0) p.push('Run date ← ' + lab(map.idxRun));
    if (map.idxDue >= 0) p.push('Due ← ' + lab(map.idxDue));
    if (map.idxWeight >= 0) p.push((map.weightIsTons ? 'Weight (tons→lbs)' : 'Weight (lbs)') + ' ← ' + lab(map.idxWeight));
    if (map.idxPcs >= 0) p.push('PCS ← ' + lab(map.idxPcs));
    if (map.idxLine >= 0) p.push('Line ← ' + lab(map.idxLine));
    if (map.idxOrder >= 0) p.push('Order ← ' + lab(map.idxOrder));
    return p.length ? 'Columns used: ' + p.join(' · ') : '';
  }

  function init() {
    loadScheduleFromStorage();

    var fileInput = document.getElementById('schedule-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = this.files && this.files[0];
        if (!file) return;
        setUploadStatus('Reading Excel…', false);
        var reader = new FileReader();
        reader.onload = function (e) {
          try {
            var ab = e.target && e.target.result;
            if (!ab || typeof XLSX === 'undefined') {
              setUploadStatus('Excel library not loaded or file empty.', true);
              return;
            }
            var workbook = XLSX.read(ab, { type: 'array' });
            var rows = parseExcelWorkbook(workbook);
            applyScheduleFromParsed(rows);
            setUploadStatus('Loaded ' + rows.length + ' rows from Excel.', true);
          } catch (err) {
            setUploadStatus(err.message || 'Failed to parse Excel.', true);
          }
          fileInput.value = '';
        };
        reader.onerror = function () {
          setUploadStatus('Could not read file.', true);
          fileInput.value = '';
        };
        reader.readAsArrayBuffer(file);
      });
    }

    var btn = document.getElementById('btn-apply-schedule');
    if (btn) {
      btn.addEventListener('click', function () {
        var textarea = document.getElementById('schedule-paste');
        var text = textarea ? textarea.value : '';
        var firstLine = (text || '').split(/\r?\n/).filter(function (l) { return l.trim(); })[0] || '';
        var sepHint = firstLine.indexOf('\t') >= 0 ? '\t' : ',';
        var headerCellsHint = firstLine ? firstLine.split(sepHint).map(function (h) { return h.trim(); }) : [];
        setUploadStatus('', false);
        setTimeout(function () {
          var parsed = parsePaste(text);
          var n = (parsed.rows || []).length;
          applyScheduleFromParsed(parsed.rows || []);
          var map = resolveScheduleColumnIndices(headerCellsHint);
          var sum = formatScheduleMapSummary(map, headerCellsHint);
          setUploadStatus(n ? ('Loaded ' + n + ' rows. ' + sum) : 'No rows parsed — need header row + data (try paste from Excel with tabs).', !!n);
        }, 0);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
