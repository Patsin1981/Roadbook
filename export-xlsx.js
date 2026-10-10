/* Roadbook → Excel in the event's "SS Form" layout (one sheet per stage).
   Columns: B No. | C Total | D Partial | E Direction (tulip image) | F:J Information | K Distance regress
   Total and regress are live formulas, so editing a Partial value in Excel updates the rest. */
(function (root) {
  'use strict';
  var FONT = 'Tahoma';
  var THIN = { style: 'thin', color: { argb: 'FF000000' } };
  var BOX = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  var ROWS_PER_PAGE = 5;      // matches the printed form and the WRC roadbook
  var DATA_ROW_H = 120;       // points, same as the form
  var FIRST = 8;              // first data row

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ddm(v, pos, neg) {
    var h = v >= 0 ? pos : neg, a = Math.abs(v), d = Math.floor(a), m = (a - d) * 60;
    return h + ' ' + d + '° ' + (m < 10 ? '0' : '') + m.toFixed(3) + "'";
  }
  function coordText(p, fmt) {
    return fmt === 'dec' ? p.lat.toFixed(6) + ', ' + p.lon.toFixed(6) : ddm(p.lat, 'N', 'S') + '\n' + ddm(p.lon, 'E', 'W');
  }
  function sheetName(name, used) {
    var base = String(name || 'Stage').replace(/[\\\/\?\*\[\]:]/g, ' ').trim().slice(0, 28) || 'Stage', n = base, i = 2;
    while (used[n.toLowerCase()]) n = base.slice(0, 26) + ' ' + (i++);
    used[n.toLowerCase()] = 1; return n;
  }
  function minutesBetween(a, b) {
    if (!/^\d{1,2}:\d{2}/.test(a || '') || !/^\d{1,2}:\d{2}/.test(b || '')) return null;
    var x = a.split(':'), y = b.split(':');
    var m = (+y[0] * 60 + +y[1]) - (+x[0] * 60 + +x[1]);
    if (m <= 0) m += 1440;
    return m;
  }
  function cellStyle(c, o) {
    c.font = { name: FONT, size: o.size || 12, bold: !!o.bold, color: o.color ? { argb: o.color } : undefined };
    c.alignment = { horizontal: o.h || 'center', vertical: o.v || 'middle', wrapText: true };
    if (o.border !== false) c.border = BOX;
    if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
    if (o.fmt) c.numFmt = o.fmt;
  }
  function boxRange(ws, r1, c1, r2, c2) {
    for (var r = r1; r <= r2; r++) for (var c = c1; c <= c2; c++) ws.getCell(r, c).border = BOX;
  }

  // ctx: { project, stages, cfg, t, tulipPng(point) -> Promise<base64>, isControl, typeLabel }
  function build(ExcelJS, ctx) {
    var wb = new ExcelJS.Workbook();
    wb.creator = 'Rally Roadbook';
    wb.created = new Date();
    wb.calcProperties = { fullCalcOnLoad: true };
    var used = {}, t = ctx.t, cfg = ctx.cfg;
    var fmt = cfg.navDec === 3 ? '0.000' : '0.00';
    var jobs = [];

    var ev = ctx.event || { logos: [] };
    ctx.stages.forEach(function (st) {
      var f = st.factor > 0 ? st.factor : 1;
      // ---- Overview sheet (same order as the event book: overview, then the stage roadbook) ----
      if (ctx.overview) {
        var ov = wb.addWorksheet(sheetName('Overview ' + st.name, used), {
          pageSetup: {
            paperSize: cfg.paper === 'A4' ? 9 : 11, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 1, horizontalCentered: true,
            margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 }
          },
          views: [{ showGridLines: false }]
        });
        ov.columns = [{ width: 2 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 11 }, { width: 2 }];
        ov.getRow(1).height = 60; // logo strip
        var tl = [['B2', ev.title, 15, true], ['B3', ev.date, 12, false], ['B4', ev.place, 12, false]];
        tl.forEach(function (x) {
          var r = +x[0].slice(1); ov.mergeCells('B' + r + ':H' + r); var c = ov.getCell(x[0]);
          c.value = x[1] || ''; cellStyle(c, { size: x[2], bold: x[3], border: false });
        });
        ov.mergeCells('B6:H6');
        var tc = ov.getCell('B6'); tc.value = 'Overview ' + st.name; cellStyle(tc, { size: 18, bold: true, border: false });
        ov.mergeCells('B7:H7');
        var sc = ov.getCell('B7');
        sc.value = ((st._len || 0) * f / 1000).toFixed(cfg.navDec === 3 ? 3 : 2) + ' km' + (st.section ? '   Section ' + st.section : '');
        cellStyle(sc, { size: 12, border: false });
        // logos spread across the strip, keeping their proportions
        var logos = ev.logos || [], stripW = 7 * 11 * 7.2, gapX = 12, hh = 64;
        var widths = logos.map(function (l) { return hh * l.w / Math.max(1, l.h); }), totalW = widths.reduce(function (a, b) { return a + b; }, 0) + gapX * Math.max(0, logos.length - 1);
        var k = totalW > stripW ? stripW / totalW : 1, x0 = (stripW - totalW * k) / 2;
        logos.forEach(function (l, i) {
          var id = wb.addImage({ base64: l.b64, extension: 'png' });
          ov.addImage(id, { tl: { col: 1 + x0 / 79, row: 0.08 }, ext: { width: widths[i] * k, height: hh * k }, editAs: 'oneCell' });
          x0 += (widths[i] + gapX) * k;
        });
        (function (ov, st) {
          jobs.push(ctx.overview(st).then(function (img) {
            if (!img) { ov.getCell('B9').value = t('xl.noOverview'); return; }
            var id = wb.addImage({ base64: img.b64, extension: 'png' }), W = stripW, H = W * img.h / img.w;
            ov.addImage(id, { tl: { col: 1, row: 8.2 }, ext: { width: W, height: H }, editAs: 'oneCell' });
          }));
        })(ov, st);
      }
      var ps = st.points.slice().sort(function (a, b) { return a.d - b.d; });
      var ws = wb.addWorksheet(sheetName(st.name, used), {
        pageSetup: {
          paperSize: cfg.paper === 'A4' ? 9 : 11, orientation: 'portrait',
          fitToPage: true, fitToWidth: 1, fitToHeight: 0, horizontalCentered: true,
          margins: { left: 0.25, right: 0.25, top: 0.3, bottom: 0.4, header: 0.15, footer: 0.15 }
        },
        views: [{ state: 'frozen', ySplit: 7, showGridLines: false }]
      });
      ws.pageSetup.printTitlesRow = '2:7';
      ws.headerFooter.oddFooter = '&C&"Tahoma"&9' + (ctx.project.name || '') + '  ' + st.name + '   &P / &N';
      ws.columns = [
        { width: 1.5 }, { width: 9.9 }, { width: 13.6 }, { width: 11 }, { width: 21.4 },
        { width: 2.4 }, { width: 16.3 }, { width: 9.2 }, { width: 9 }, { width: 11 }, { width: 13 }
      ];
      // ---- header block (rows 2-4) ----
      var ctrls = ps.filter(ctx.isControl);
      var from = ps[0], to = ctrls.length ? ctrls[ctrls.length - 1] : ps[ps.length - 1];
      var label = function (p) {
        if (!p) return '';
        var s = p.code || (ctx.isControl(p) ? p.type : '');
        var txt = p.th || p.en || '';
        return (s && txt && txt.indexOf(s) < 0 ? s + ' ' + txt : s || txt).trim();
      };
      var total = st.track && st.track.length ? (st._len || 0) * f / 1000 : 0;
      var timeA = from && to ? minutesBetween(from.time, to.time) : null;
      var speed = st.tsd && st.tsd.length ? st.tsd[0].kmh : null;
      [2, 3, 4].forEach(function (r) { ws.getRow(r).height = 44.4; });
      ws.mergeCells('C2:E2'); ws.mergeCells('C3:E3'); ws.mergeCells('C4:E4');
      ws.mergeCells('J2:J3'); ws.mergeCells('K2:K3');
      var hv = [
        ['B2', 'From', { size: 11, h: 'left' }], ['C2', label(from), { size: 16, bold: true, h: 'left' }],
        ['B3', 'To', { size: 11, h: 'left' }], ['C3', label(to), { size: 16, bold: true, h: 'left' }],
        ['B4', 'Special stage No.', { size: 9, h: 'left' }], ['C4', st.name, { size: 16, bold: true, h: 'left' }],
        ['G2', 'Distance', { size: 11, h: 'left' }], ['H2', +total.toFixed(3), { size: 16, bold: true, fmt: fmt }], ['I2', 'KM', { size: 11 }],
        ['G3', 'Time Allowed', { size: 11, h: 'left' }], ['H3', timeA, { size: 16, bold: true }], ['I3', 'Min', { size: 11 }],
        ['G4', 'Average speed', { size: 11, h: 'left' }], ['I4', 'km/h', { size: 11 }],
        ['J2', 'Leg No.', { size: 10 }], ['K2', st.leg || '', { size: 16, bold: true }],
        ['J4', 'Section\nNo.', { size: 10 }], ['K4', st.section || '', { size: 16, bold: true }]
      ];
      hv.forEach(function (x) { var c = ws.getCell(x[0]); if (x[1] != null && x[1] !== '') c.value = x[1]; cellStyle(c, x[2]); });
      // leg distance = Total of the last box, so it follows any Partial edited in Excel
      if (ps.length) {
        var lastKm = (ps[ps.length - 1].d - 0) * f / 1000;
        ws.getCell('H2').value = { formula: 'C' + (FIRST + ps.length - 1), result: +lastKm.toFixed(3) };
        total = lastKm;
      }
      var avg = ws.getCell('H4');
      // same rule as the old form: distance / (time / 60); fall back to the TSD speed set in the app
      avg.value = timeA ? { formula: 'IF(H3>0,H2/(H3/60),"")', result: +(total / (timeA / 60)).toFixed(2) } : speed;
      cellStyle(avg, { size: 16, bold: true, fmt: '0.00' });
      boxRange(ws, 2, 2, 4, 11);
      // ---- table header (rows 6-7) ----
      ws.getRow(6).height = 20; ws.getRow(7).height = 20;
      ws.mergeCells('B6:B7'); ws.mergeCells('C6:D6'); ws.mergeCells('E6:E7'); ws.mergeCells('F6:J7'); ws.mergeCells('K6:K7');
      [['B6', 'คำสั่ง'], ['C6', 'ระยะทาง'], ['C7', 'Total'], ['D7', 'Partial'], ['E6', 'Direction'], ['F6', 'Information'], ['K6', 'Distance\nregress']]
        .forEach(function (x) { var c = ws.getCell(x[0]); c.value = x[1]; cellStyle(c, { size: 12, bold: true, fill: 'FFF2F2F2' }); });
      boxRange(ws, 6, 2, 7, 11);

      // ---- one row per roadbook point ----
      var last = FIRST + ps.length - 1, prevKm = 0;
      ps.forEach(function (p, i) {
        var r = FIRST + i, km = p.d * f / 1000, part = i ? km - prevKm : km;
        prevKm = km;
        ws.getRow(r).height = DATA_ROW_H;
        // cumulative total is rebuilt from rounded partials so the printed column always adds up
        var cTotal = ws.getCell(r, 3), cPart = ws.getCell(r, 4), cReg = ws.getCell(r, 11), cNo = ws.getCell(r, 2);
        cPart.value = +part.toFixed(3);
        cTotal.value = i ? { formula: 'C' + (r - 1) + '+D' + r, result: +km.toFixed(3) } : { formula: 'D' + r, result: +part.toFixed(3) };
        cReg.value = r === last ? 0 : { formula: 'K' + (r + 1) + '+D' + (r + 1), result: +((ps[ps.length - 1].d - p.d) * f / 1000).toFixed(3) };
        cellStyle(cTotal, { size: 20, bold: true, fmt: fmt });
        cellStyle(cPart, { size: 16, fmt: fmt });
        cellStyle(cReg, { size: 16, fmt: fmt });
        // box number; on the last box of a printed page also show the distance to the next box (WRC "Next")
        var noTxt = String(i + 1), pageEnd = (i + 1) % ROWS_PER_PAGE === 0 && i < ps.length - 1;
        if (pageEnd) {
          var nx = (ps[i + 1].d - p.d) * f / 1000;
          noTxt += '\n\nNext\n' + nx.toFixed(cfg.navDec === 3 ? 3 : 2) + (nx <= 0.2 ? '\nTURN\nQUICKLY' : '');
        }
        cNo.value = noTxt;
        cellStyle(cNo, { size: pageEnd ? 11 : 14, bold: true, v: pageEnd ? 'top' : 'middle' });
        if (pageEnd) ws.getRow(r).addPageBreak();
        ws.getCell(r, 5).border = BOX;
        // information: danger marks, control code + time, instruction, note, GPS at controls
        ws.mergeCells(r, 6, r, 10);
        var lines = [];
        var main = ctx.lang === 'en' ? (p.en || p.th) : (p.th || p.en);
        var code = p.code || (ctx.isControl(p) ? p.type : '');
        // don't repeat the code when the instruction already says it (e.g. code START, text "START SS1")
        if (code && main && main.toUpperCase().indexOf(code.toUpperCase()) >= 0) code = '';
        var head = (p.type === 'DANGER' ? '!'.repeat(p.danger || 1) + ' ' : '') + code;
        if (head.trim() || p.time) lines.push((head.trim() + (p.time ? '  ' + p.time : '')).trim());
        if (main) lines.push(main);
        if (p.note) lines.push(p.note);
        if (ctx.isControl(p)) lines.push(coordText(p, cfg.coordFmt));
        var info = ws.getCell(r, 6);
        info.value = lines.join('\n');
        cellStyle(info, { size: 16, bold: false, color: p.type === 'DANGER' ? 'FFD0021B' : undefined });
        boxRange(ws, r, 6, r, 10);
        if (ctx.symbolsPng && p.sym && p.sym.length) {
          info.alignment = { horizontal: 'center', vertical: 'top', wrapText: true };
          jobs.push(ctx.symbolsPng(p).then(function (im) {
            if (!im) return;
            // symbols sit along the bottom of the information box, like the WRC book
            var hh = 46, ww = im.w * hh / im.h, boxW = 2.4 * 7 + 16.3 * 7 + 9.2 * 7 + 9 * 7 + 11 * 7;
            if (ww > boxW - 12) { hh = hh * (boxW - 12) / ww; ww = boxW - 12; }
            var id = wb.addImage({ base64: im.b64, extension: 'png' });
            ws.addImage(id, { tl: { col: 6.04, row: r - 1 + (160 - hh - 8) / 160 }, ext: { width: ww, height: hh }, editAs: 'oneCell' });
          }));
        }
        jobs.push(ctx.tulipPng(p).then(function (b64) {
          var id = wb.addImage({ base64: b64, extension: 'png' });
          // E column ≈ 155 px wide, 120 pt row = 160 px high
          ws.addImage(id, { tl: { col: 4.08, row: r - 1 + 0.06 }, ext: { width: 145, height: 145 }, editAs: 'oneCell' });
        }));
      });
      if (!ps.length) { ws.getCell('F8').value = t('xl.noPoints'); }
    });
    return Promise.all(jobs).then(function () { return wb.xlsx.writeBuffer(); });
  }

  root.RBX = { build: build, ddm: ddm, coordText: coordText, minutesBetween: minutesBetween };
})(this);
