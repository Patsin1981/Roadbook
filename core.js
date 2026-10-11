/* Rally Roadbook core — pure functions, no DOM. Works in browser (window.RB) and node (module.exports). */
(function (root) {
  'use strict';
  var R = 6371008.8, D2R = Math.PI / 180;

  function hav(a, b) {
    var dLat = (b[0] - a[0]) * D2R, dLon = (b[1] - a[1]) * D2R;
    var s = Math.sin(dLat / 2), t = Math.sin(dLon / 2);
    var h = s * s + Math.cos(a[0] * D2R) * Math.cos(b[0] * D2R) * t * t;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    var p1 = a[0] * D2R, p2 = b[0] * D2R, dl = (b[1] - a[1]) * D2R;
    var y = Math.sin(dl) * Math.cos(p2);
    var x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) / D2R + 360) % 360;
  }

  function normAngle(a) { a = ((a + 180) % 360 + 360) % 360 - 180; return a === -180 ? 180 : a; }

  // Drop consecutive points closer than minGap metres (GPS jitter while stopped inflates distance)
  function cleanTrack(pts, minGap) {
    minGap = minGap == null ? 2 : minGap;
    var out = [];
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (!isFinite(p[0]) || !isFinite(p[1])) continue;
      if (!out.length || hav(out[out.length - 1], p) >= minGap) out.push([+p[0].toFixed(7), +p[1].toFixed(7)]);
    }
    if (pts.length > 1 && out.length) {
      var last = pts[pts.length - 1], ol = out[out.length - 1];
      if (ol[0] !== last[0] || ol[1] !== last[1]) { if (hav(ol, last) > 0.2) out.push([+last[0].toFixed(7), +last[1].toFixed(7)]); }
    }
    return out;
  }

  function buildCum(track) {
    var c = new Float64Array(track.length);
    for (var i = 1; i < track.length; i++) c[i] = c[i - 1] + hav(track[i - 1], track[i]);
    return c;
  }

  // largest index i with cum[i] <= d
  function idxAt(cum, d) {
    var lo = 0, hi = cum.length - 1;
    if (d <= 0) return 0;
    if (d >= cum[hi]) return Math.max(0, hi - 1);
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    return lo;
  }

  function pointAt(track, cum, d) {
    if (track.length === 1) return track[0].slice();
    var i = idxAt(cum, d), seg = cum[i + 1] - cum[i];
    var f = seg > 0 ? Math.max(0, Math.min(1, (d - cum[i]) / seg)) : 0;
    var a = track[i], b = track[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  }

  // Project lat/lon onto track between indices i0..i1. Returns {d, off, lat, lon, i}
  function project(track, cum, lat, lon, i0, i1) {
    var n = track.length;
    if (n === 0) return null;
    if (n === 1) return { d: 0, off: hav(track[0], [lat, lon]), lat: track[0][0], lon: track[0][1], i: 0 };
    i0 = Math.max(0, i0 || 0); i1 = Math.min(n - 2, i1 == null ? n - 2 : i1);
    var kx = Math.cos(lat * D2R) * R * D2R, ky = R * D2R;
    var best = null;
    for (var i = i0; i <= i1; i++) {
      var a = track[i], b = track[i + 1];
      var ax = (a[1] - lon) * kx, ay = (a[0] - lat) * ky, bx = (b[1] - lon) * kx, by = (b[0] - lat) * ky;
      var dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      var t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
      var px = ax + dx * t, py = ay + dy * t, dist2 = px * px + py * py;
      if (!best || dist2 < best.d2) best = { d2: dist2, i: i, t: t };
    }
    var A = track[best.i], B = track[best.i + 1];
    var plat = A[0] + (B[0] - A[0]) * best.t, plon = A[1] + (B[1] - A[1]) * best.t;
    return { d: cum[best.i] + (cum[best.i + 1] - cum[best.i]) * best.t, off: Math.sqrt(best.d2), lat: plat, lon: plon, i: best.i };
  }

  // Turn angle at distance d, measured with bearings over +-win metres. Positive = right.
  function angleAt(track, cum, d, win) {
    win = win || 30;
    var total = cum[cum.length - 1];
    if (total < 2 * win) return 0;
    var dd = Math.max(win, Math.min(total - win, d));
    var p0 = pointAt(track, cum, dd - win), p1 = pointAt(track, cum, dd), p2 = pointAt(track, cum, dd + win);
    return normAngle(bearing(p1, p2) - bearing(p0, p1));
  }

  // Find candidate turns: |angle| >= threshold, keep peak within each cluster, min separation sep metres.
  function detectTurns(track, cum, opts) {
    opts = opts || {};
    var thr = opts.threshold || 35, win = opts.win || 30, step = opts.step || 5, sep = opts.sep || 80;
    var total = cum[cum.length - 1], res = [];
    if (!track.length || total < 2 * win + step) return res;
    var cur = null;
    for (var d = win; d <= total - win; d += step) {
      var a = angleAt(track, cum, d, win);
      if (Math.abs(a) >= thr) {
        if (cur && d - cur.end <= step * 2 && Math.sign(a) === Math.sign(cur.angle)) {
          cur.end = d; if (Math.abs(a) > Math.abs(cur.angle)) { cur.angle = a; cur.d = d; }
        } else { if (cur) res.push(cur); cur = { d: d, angle: a, end: d }; }
      } else if (cur && d - cur.end > step * 2) { res.push(cur); cur = null; }
    }
    if (cur) res.push(cur);
    var out = [];
    res.forEach(function (r) {
      var prev = out[out.length - 1];
      if (prev && r.d - prev.d < sep) { if (Math.abs(r.angle) > Math.abs(prev.angle)) out[out.length - 1] = r; }
      else out.push(r);
    });
    return out.map(function (r) {
      var p = pointAt(track, cum, r.d);
      return { d: r.d, angle: Math.round(r.angle / 5) * 5, lat: p[0], lon: p[1] };
    });
  }

  // ---------- GPX ----------
  function attr(s, name) {
    var m = new RegExp('\\b' + name + '\\s*=\\s*["\']([^"\']+)["\']').exec(s);
    return m ? parseFloat(m[1]) : NaN;
  }
  function tagText(s, tag) {
    var m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>').exec(s);
    return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
  }
  function pointsOf(block, tag) {
    var re = new RegExp('<' + tag + '\\b([^>]*)>', 'g'), m, pts = [];
    while ((m = re.exec(block))) {
      var la = attr(m[1], 'lat'), lo = attr(m[1], 'lon');
      if (isFinite(la) && isFinite(lo)) pts.push([la, lo]);
    }
    return pts;
  }
  // Returns {tracks:[{name, pts}], waypoints:[{name, lat, lon}]}
  function parseGPX(text) {
    var tracks = [], wpts = [], m;
    var reTrk = /<trk\b[^>]*>([\s\S]*?)<\/trk>/g;
    while ((m = reTrk.exec(text))) {
      var body = m[1];
      var nm = tagText(body.replace(/<trkseg[\s\S]*$/, ''), 'name');
      var pts = pointsOf(body, 'trkpt');
      if (pts.length > 1) tracks.push({ name: nm, pts: pts });
    }
    var reRte = /<rte\b[^>]*>([\s\S]*?)<\/rte>/g;
    while ((m = reRte.exec(text))) {
      var rb = m[1], rp = pointsOf(rb, 'rtept');
      if (rp.length > 1) tracks.push({ name: tagText(rb.replace(/<rtept[\s\S]*$/, ''), 'name'), pts: rp });
    }
    var reW = /<wpt\b([^>]*)>([\s\S]*?)<\/wpt>/g;
    while ((m = reW.exec(text))) {
      var la = attr(m[1], 'lat'), lo = attr(m[1], 'lon');
      if (isFinite(la) && isFinite(lo)) wpts.push({ name: tagText(m[2], 'name'), lat: la, lon: lo });
    }
    return { tracks: tracks, waypoints: wpts };
  }

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  // ---------- Directions ----------
  var PRESETS = [
    { a: -135, th: 'เลี้ยวซ้ายหักศอก', en: 'Sharp left' },
    { a: -90, th: 'เลี้ยวซ้าย', en: 'Turn left' },
    { a: -45, th: 'เฉียงซ้าย', en: 'Bear left' },
    { a: -20, th: 'ชิดซ้าย', en: 'Keep left' },
    { a: 0, th: 'ตรงไป', en: 'Straight on' },
    { a: 20, th: 'ชิดขวา', en: 'Keep right' },
    { a: 45, th: 'เฉียงขวา', en: 'Bear right' },
    { a: 90, th: 'เลี้ยวขวา', en: 'Turn right' },
    { a: 135, th: 'เลี้ยวขวาหักศอก', en: 'Sharp right' },
    { a: 180, th: 'กลับรถ', en: 'U-turn' }
  ];
  function nearestPreset(angle) {
    if (angle == null) return null;
    var best = PRESETS[0];
    PRESETS.forEach(function (p) { if (Math.abs(normAngle(angle - p.a)) < Math.abs(normAngle(angle - best.a))) best = p; });
    return best;
  }

  // Tulip SVG. angle: 0 = straight, + = right, 180 = U-turn, null = no arrow (entry only)
  // opts.round: roundabout (angle = exit direction); opts.gravel: dashed route line (unsealed road)
  function tulipSVG(angle, branches, opts) {
    opts = opts || {};
    var size = opts.size || 64, ink = opts.ink || '#000', w = opts.stroke || 6;
    var dash = opts.gravel ? ' stroke-dasharray="' + (w * 1.6).toFixed(1) + ' ' + (w * 1.3).toFixed(1) + '"' : '';
    var line = function (d) { return '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="' + w + '" stroke-linecap="' + (dash ? 'butt' : 'round') + '" stroke-linejoin="round"' + dash + '/>'; };
    var head = function (ex, ey, ax, ay) {
      var px = -ay, py = ax, h = 13, hw = 9, bx = ex - ax * h, by = ey - ay * h;
      return { bx: bx, by: by, svg: '<path d="M' + ex.toFixed(1) + ',' + ey.toFixed(1) + ' L' + (bx + px * hw).toFixed(1) + ',' + (by + py * hw).toFixed(1) + ' L' + (bx - px * hw).toFixed(1) + ',' + (by - py * hw).toFixed(1) + ' Z" fill="' + ink + '"/>' };
    };
    var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="' + size + '" height="' + size + '" aria-hidden="true">';
    var R = opts.round ? 13 : 0;
    (branches || []).forEach(function (b) {
      var sx = Math.sin(b * D2R), sy = -Math.cos(b * D2R);
      s += '<line x1="' + (sx * R).toFixed(1) + '" y1="' + (sy * R).toFixed(1) + '" x2="' + (sx * 34).toFixed(1) + '" y2="' + (sy * 34).toFixed(1) + '" stroke="' + ink + '" stroke-width="' + (w * 0.45) + '" stroke-linecap="round"/>';
    });
    s += '<circle cx="0" cy="40" r="' + (w * 0.9) + '" fill="' + ink + '"/>';
    if (opts.round) {
      s += '<circle cx="0" cy="0" r="' + R + '" fill="none" stroke="' + ink + '" stroke-width="' + (w * 0.55) + '"/>';
      var a = angle == null ? 0 : angle, ax = Math.sin(a * D2R), ay = -Math.cos(a * D2R);
      var hd = head(ax * 40, ay * 40, ax, ay);
      // entry to the ring, around it clockwise (left-hand traffic in Thailand = clockwise), out to the exit
      var a0 = 180, a1 = ((a % 360) + 360) % 360; if (a1 <= a0) a1 += 360;
      // draw the ring part in two halves so a full loop (U-turn at the roundabout) still shows
      var am = (a0 + a1) / 2, mx = Math.sin(am * D2R) * R, my = -Math.cos(am * D2R) * R, ex = Math.sin(a1 * D2R) * R, ey = -Math.cos(a1 * D2R) * R;
      s += line('M0,40 L0,' + R + ' A' + R + ',' + R + ' 0 0 1 ' + mx.toFixed(1) + ',' + my.toFixed(1) + ' A' + R + ',' + R + ' 0 0 1 ' + ex.toFixed(1) + ',' + ey.toFixed(1) + ' L' + hd.bx.toFixed(1) + ',' + hd.by.toFixed(1));
      s += hd.svg;
    } else if (angle == null) {
      s += line('M0,40 L0,0');
    } else if (Math.abs(angle) >= 170) {
      s += line('M0,40 L0,-12 A13,13 0 0 0 -26,-12 L-26,22');
      s += '<path d="M-36,16 L-26,34 L-16,16 Z" fill="' + ink + '"/>';
    } else {
      var ax2 = Math.sin(angle * D2R), ay2 = -Math.cos(angle * D2R), h2 = head(ax2 * 38, ay2 * 38, ax2, ay2);
      s += line('M0,40 L0,0 L' + h2.bx.toFixed(1) + ',' + h2.by.toFixed(1));
      s += h2.svg;
    }
    if (opts.ref) {
      // WRC style: a short thin leader ending in an open circle; it runs right into the road line at the spot where the distance is measured
      var my2 = opts.round ? R : 0, side = angle != null && (angle < 0 || Math.abs(angle) >= 170) ? 1 : -1; // keep clear of the arrow (U-turn loops to the left)
      var lw = Math.max(1.2, w * 0.28), cr = Math.max(2.6, w * 0.53), ang = Math.atan2(26, 30 * side), ux = Math.cos(ang), uy = Math.sin(ang), len = 20;
      var cx = ux * len, cy = my2 + uy * len;
      s += '<line x1="0" y1="' + my2 + '" x2="' + (cx - ux * cr).toFixed(1) + '" y2="' + (cy - uy * cr).toFixed(1) + '" stroke="' + ink + '" stroke-width="' + lw.toFixed(1) + '"/>';
      s += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + cr.toFixed(1) + '" fill="none" stroke="' + ink + '" stroke-width="' + lw.toFixed(1) + '"/>';
      // on a plain straight-on box there is no corner to point at, so mark the spot with a short bar across the road
      if (!opts.round && (angle == null || angle === 0) && !(branches || []).length) s += '<line x1="-7" y1="0" x2="7" y2="0" stroke="' + ink + '" stroke-width="' + (w * 0.6).toFixed(1) + '"/>';
    }
    return s + '</svg>';
  }
  var REF = true; // measuring-point marker on roadbook tulips (setting)
  function setRef(on) { REF = !!on; }
  function tulipOf(p, opts) {
    opts = Object.assign({ ref: REF }, opts || {}, { round: !!p.round, gravel: p.road === 'gravel' });
    return tulipSVG(p.angle, p.branches, opts);
  }

  // ---------- TSD ----------
  // segs: [{fromKm, kmh}] (roadbook km). Ideal elapsed seconds to reach km.
  function tsdIdeal(segs, km) {
    if (!segs || !segs.length) return null;
    var s = segs.slice().filter(function (x) { return x.kmh > 0; }).sort(function (a, b) { return a.fromKm - b.fromKm; });
    if (!s.length || km < s[0].fromKm) return 0;
    var t = 0;
    for (var i = 0; i < s.length; i++) {
      var from = s[i].fromKm, to = i + 1 < s.length ? s[i + 1].fromKm : Infinity;
      if (km <= from) break;
      var seg = Math.min(km, to) - from;
      t += seg / s[i].kmh * 3600;
    }
    return t;
  }
  function tsdSpeedAt(segs, km) {
    var cur = null;
    (segs || []).slice().sort(function (a, b) { return a.fromKm - b.fromKm; }).forEach(function (x) { if (km >= x.fromKm - 1e-9) cur = x; });
    return cur ? cur.kmh : null;
  }

  // ---------- Map matching for navigator ----------
  function Matcher(track, cum, opts) {
    this.track = track; this.cum = cum; this.o = opts || {};
    this.maxOff = this.o.maxOff || 40; this.maxAcc = this.o.maxAcc || 50;
    this.d = null; this.pending = null; this.offRoute = false;
  }
  Matcher.prototype.reset = function () { this.d = null; this.pending = null; this.offRoute = false; };
  Matcher.prototype.update = function (lat, lon, acc, speed) {
    var tr = this.track, cum = this.cum;
    if (tr.length < 2) return null;
    if (acc != null && acc > this.maxAcc) return { d: this.d, poor: true, offRoute: this.offRoute };
    var r = null;
    if (this.d != null) {
      var ahead = Math.max(500, (speed || 0) * 15);
      var i0 = idxAt(cum, this.d - 150), i1 = idxAt(cum, this.d + ahead) + 1;
      r = project(tr, cum, lat, lon, i0, i1);
      if (r.off <= this.maxOff) { this.d = r.d; this.pending = null; this.offRoute = false; return { d: r.d, off: r.off, lat: r.lat, lon: r.lon, offRoute: false }; }
    }
    var g = project(tr, cum, lat, lon);
    if (g.off <= this.maxOff) {
      if (this.d == null) { this.d = g.d; this.offRoute = false; return { d: g.d, off: g.off, lat: g.lat, lon: g.lon, offRoute: false, relocated: true }; }
      // relocation needs 2 consecutive agreeing fixes (avoid jumping to a parallel/overlapping part)
      if (this.pending != null && Math.abs(g.d - this.pending) < 200) {
        this.d = g.d; this.pending = null; this.offRoute = false;
        return { d: g.d, off: g.off, lat: g.lat, lon: g.lon, offRoute: false, relocated: true };
      }
      this.pending = g.d;
    }
    this.offRoute = true;
    return { d: this.d, off: (r || g).off, offRoute: true };
  };

  // ---------- Export ----------
  function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var CONTROL_TYPES = ['START', 'FINISH', 'TC', 'PC', 'CP', 'SVCIN', 'SVCOUT', 'PFIN', 'PFOUT', 'RGIN', 'RGOUT'];
  var ZONE_CODES = { SVCIN: 'SERVICE IN', SVCOUT: 'SERVICE OUT', PFIN: 'PARC FERME IN', PFOUT: 'PARC FERME OUT', RGIN: 'REGROUP IN', RGOUT: 'REGROUP OUT' };
  function isControl(p) { return CONTROL_TYPES.indexOf(p.type) >= 0; }
  function typeLabel(p) {
    if (p.code) return p.code;
    if (p.type === 'DANGER') return 'DANGER ' + '!'.repeat(p.danger || 1);
    return p.type;
  }
  // Suggest next code for a control point: TC0,TC1.. / PC1.. / CP1..
  function suggestCode(points, p) {
    if (p.type === 'START' || p.type === 'FINISH') return p.type;
    if (ZONE_CODES[p.type]) return ZONE_CODES[p.type];
    if (['TC', 'PC', 'CP'].indexOf(p.type) < 0) return '';
    var used = {}, re = new RegExp('^' + p.type + '\\s*(\\d+)', 'i');
    points.forEach(function (q) { if (q !== p && q.id !== p.id && q.code) { var m = re.exec(q.code); if (m) used[+m[1]] = 1; } });
    var n = p.type === 'TC' ? 0 : 1; while (used[n]) n++;
    return p.type + n;
  }
  // ---------- Splitting a day route into legs (WRC style: each leg runs TC to TC, distance restarts at 0) ----------
  // What a segment becomes depends on the control that opens it.
  var AFTER = { START: 'ss', FINISH: 'liaison', SVCIN: 'service', SVCOUT: 'liaison', PFIN: 'pf', PFOUT: 'liaison', RGIN: 'pf', RGOUT: 'liaison' };
  function sliceStage(stage, a, b) { // copy of [a, b] metres; points on the boundaries are kept in both neighbours
    var tr = stage.track, cum = buildCum(tr);
    var out = [pointAt(tr, cum, a)];
    for (var i = 0; i < tr.length; i++) if (cum[i] > a && cum[i] < b) out.push(tr[i]);
    out.push(pointAt(tr, cum, b));
    var pts = (stage.points || []).filter(function (p) { return p.d >= a - 0.5 && p.d <= b + 0.5; })
      .map(function (p) { var q = JSON.parse(JSON.stringify(p)); q.d = Math.max(0, Math.min(b - a, p.d - a)); return q; });
    return { track: out.map(function (p) { return [+p[0].toFixed(7), +p[1].toFixed(7)]; }), points: pts };
  }
  function planSplit(stage) {
    var len = buildCum(stage.track); len = len[len.length - 1];
    var ps = sortedPoints(stage), bounds = ps.filter(function (p) { return AFTER[p.type] && p.d > 5 && p.d < len - 5; });
    var first = ps[0] && ps[0].d <= 5 ? ps[0] : null;
    var kind = first && AFTER[first.type] ? AFTER[first.type] : 'liaison';
    var segs = [], a = 0, startP = first;
    bounds.forEach(function (bp) {
      segs.push({ a: a, b: bp.d, kind: kind, startP: startP, endP: bp });
      a = bp.d; kind = AFTER[bp.type]; startP = bp;
    });
    var last = ps.length ? ps[ps.length - 1] : null;
    segs.push({ a: a, b: len, kind: kind, startP: startP, endP: last && last.d >= len - 5 ? last : null });
    return segs.filter(function (sg) { return sg.b - sg.a > 1; });
  }

  // Cut track to [fromD, toD] metres; points outside are dropped, kept points shift.
  function trimStage(stage, fromD, toD) {
    var tr = stage.track, cum = buildCum(tr), total = cum[cum.length - 1];
    fromD = Math.max(0, Math.min(total, fromD)); toD = Math.max(fromD, Math.min(total, toD));
    var out = [pointAt(tr, cum, fromD)];
    for (var i = 0; i < tr.length; i++) if (cum[i] > fromD && cum[i] < toD) out.push(tr[i]);
    out.push(pointAt(tr, cum, toD));
    out = out.map(function (p) { return [+p[0].toFixed(7), +p[1].toFixed(7)]; });
    var pts = (stage.points || []).filter(function (p) { return p.d >= fromD - 0.5 && p.d <= toD + 0.5; });
    pts.forEach(function (p) { p.d = Math.max(0, p.d - fromD); });
    return { track: out, points: pts };
  }
  function stageCSV(stage) {
    var f = stage.factor || 1, rows = [['Stage', 'No', 'Total km', 'Partial km', 'Type', 'Code', 'Place', 'Time', 'Angle', 'Instruction TH', 'Instruction EN', 'Note', 'Symbols', 'Road', 'Lat', 'Lon']];
    var prev = 0;
    sortedPoints(stage).forEach(function (p, i) {
      var km = p.d * f / 1000;
      rows.push([stage.name, i + 1, km.toFixed(3), (km - prev).toFixed(3), p.type === 'DANGER' ? 'DANGER ' + '!'.repeat(p.danger || 1) : p.type, p.code || '', p.place || '', p.time || '', p.angle == null ? '' : p.angle, p.th || '', p.en || '', p.note || '', (p.sym || []).join(' '), (p.round ? 'roundabout ' : '') + (p.road === 'gravel' ? 'gravel' : ''), p.lat.toFixed(6), p.lon.toFixed(6)]);
      prev = km;
    });
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
  }
  function sortedPoints(stage) { return (stage.points || []).slice().sort(function (a, b) { return a.d - b.d; }); }
  function stageGPX(stages) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rally Roadbook" xmlns="http://www.topografix.com/GPX/1/1">\n';
    stages.forEach(function (st) {
      var f = st.factor || 1;
      sortedPoints(st).forEach(function (p, i) {
        s += '<wpt lat="' + p.lat.toFixed(7) + '" lon="' + p.lon.toFixed(7) + '"><name>' + esc(st.name + ' #' + (i + 1) + ' ' + typeLabel(p)) + '</name><desc>' + esc((p.d * f / 1000).toFixed(3) + ' km ' + (p.time ? p.time + ' ' : '') + (p.th || '') + (p.en ? ' / ' + p.en : '')) + '</desc></wpt>\n';
      });
    });
    stages.forEach(function (st) {
      s += '<trk><name>' + esc(st.name) + '</name><trkseg>\n';
      st.track.forEach(function (p) { s += '<trkpt lat="' + p[0] + '" lon="' + p[1] + '"/>\n'; });
      s += '</trkseg></trk>\n';
    });
    return s + '</gpx>\n';
  }
  function logGPX(name, log) {
    var s = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Rally Roadbook" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>' + esc(name) + '</name><trkseg>\n';
    log.forEach(function (p) { s += '<trkpt lat="' + p[0].toFixed(7) + '" lon="' + p[1].toFixed(7) + '"><time>' + new Date(p[2]).toISOString() + '</time></trkpt>\n'; });
    return s + '</trkseg></trk>\n</gpx>\n';
  }

  var api = {
    hav: hav, bearing: bearing, normAngle: normAngle, cleanTrack: cleanTrack, buildCum: buildCum, idxAt: idxAt,
    pointAt: pointAt, project: project, angleAt: angleAt, detectTurns: detectTurns, parseGPX: parseGPX,
    PRESETS: PRESETS, nearestPreset: nearestPreset, tulipSVG: tulipSVG, tulipOf: tulipOf, tsdIdeal: tsdIdeal, tsdSpeedAt: tsdSpeedAt,
    Matcher: Matcher, stageCSV: stageCSV, stageGPX: stageGPX, logGPX: logGPX, sortedPoints: sortedPoints,
    typeLabel: typeLabel, esc: esc, isControl: isControl, suggestCode: suggestCode, trimStage: trimStage, CONTROL_TYPES: CONTROL_TYPES,
    ZONE_CODES: ZONE_CODES, sliceStage: sliceStage, planSplit: planSplit, setRef: setRef
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RB = api;
})(this);
