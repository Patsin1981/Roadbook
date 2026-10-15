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
    if (!text || typeof text !== 'string') {
      console.warn('parseGPX: invalid input');
      return { tracks: [], waypoints: [] };
    }

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

    if (tracks.length === 0 && wpts.length === 0) {
      console.warn('parseGPX: no tracks or waypoints found in GPX');
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
  // Tulip drawing. opts: size, ink, stroke, round, gravel,
  //   curve: 'sharp' | 'soft' | 'wide'  (how the turn is drawn), shape: [[x,y]...] road shape from GPS in tulip units + shapeAt (index of the km point),
  //   ref: measuring-point marker, lead: 'auto' | bearing of the marker, bar: line across the road (controls)
  function tulipSVG(angle, branches, opts) {
    opts = opts || {};
    var size = opts.size || 64, ink = opts.ink || '#000', w = opts.stroke || 6;
    var dash = opts.gravel ? ' stroke-dasharray="' + (w * 1.6).toFixed(1) + ' ' + (w * 1.3).toFixed(1) + '"' : '';
    var f1 = function (v) { return (+v).toFixed(1); };
    var line = function (d) { return '<path d="' + d + '" fill="none" stroke="' + ink + '" stroke-width="' + w + '" stroke-linecap="' + (dash ? 'butt' : 'round') + '" stroke-linejoin="round"' + dash + '/>'; };
    var head = function (ex, ey, ax, ay) {
      var px = -ay, py = ax, h = 13, hw = 9, bx = ex - ax * h, by = ey - ay * h;
      return { bx: bx, by: by, svg: '<path d="M' + f1(ex) + ',' + f1(ey) + ' L' + f1(bx + px * hw) + ',' + f1(by + py * hw) + ' L' + f1(bx - px * hw) + ',' + f1(by - py * hw) + ' Z" fill="' + ink + '"/>' };
    };
    var brg = function (x, y) { return Math.atan2(x, -y) / D2R; }; // 0 = up, clockwise
    var unit = function (x, y) { var l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
    var R = opts.round ? 13 : 0, main = '', start = [0, 40];
    var cpt = [0, R], dirIn = [0, -1], dirOut = null, occ = [180]; // km point, travel direction there (in / out), bearings already used by lines
    var shape = !opts.round && opts.shape && opts.shape.length > 3 ? opts.shape : null;
    if (shape) {
      // real road shape: smooth line through the points, arrow on the last one
      var n = shape.length, k = Math.max(1, Math.min(n - 2, opts.shapeAt | 0)), E = shape[n - 1], P2 = shape[Math.max(0, n - 5)];
      var u = unit(E[0] - P2[0], E[1] - P2[1]), hdS = head(E[0], E[1], u[0], u[1]);
      var d = 'M' + f1(shape[0][0]) + ',' + f1(shape[0][1]), last = n - 2;
      while (last > k && Math.hypot(shape[last][0] - E[0], shape[last][1] - E[1]) < 15) last--; // the line stops at the arrow head, never runs back past it
      for (var i = 1; i < last; i++) d += ' Q' + f1(shape[i][0]) + ',' + f1(shape[i][1]) + ' ' + f1((shape[i][0] + shape[i + 1][0]) / 2) + ',' + f1((shape[i][1] + shape[i + 1][1]) / 2);
      d += ' L' + f1(hdS.bx) + ',' + f1(hdS.by);
      main = line(d) + hdS.svg;
      start = shape[0]; cpt = shape[k];
      var pb = shape[Math.max(0, k - 2)], pa = shape[Math.min(n - 1, k + 2)];
      dirIn = unit(cpt[0] - pb[0], cpt[1] - pb[1]); dirOut = unit(pa[0] - cpt[0], pa[1] - cpt[1]);
      occ = [brg(pb[0] - cpt[0], pb[1] - cpt[1]), brg(pa[0] - cpt[0], pa[1] - cpt[1])];
    } else if (opts.round) {
      var a = angle == null ? 0 : angle, ax = Math.sin(a * D2R), ay = -Math.cos(a * D2R);
      var hd = head(ax * 40, ay * 40, ax, ay);
      // entry to the ring, around it clockwise (left-hand traffic in Thailand = clockwise), out to the exit
      var a0 = 180, a1 = ((a % 360) + 360) % 360; if (a1 <= a0) a1 += 360;
      // draw the ring part in two halves so a full loop (U-turn at the roundabout) still shows
      var am = (a0 + a1) / 2, mx = Math.sin(am * D2R) * R, my = -Math.cos(am * D2R) * R, ex = Math.sin(a1 * D2R) * R, ey = -Math.cos(a1 * D2R) * R;
      main = '<circle cx="0" cy="0" r="' + R + '" fill="none" stroke="' + ink + '" stroke-width="' + (w * 0.55) + '"/>' +
        line('M0,40 L0,' + R + ' A' + R + ',' + R + ' 0 0 1 ' + f1(mx) + ',' + f1(my) + ' A' + R + ',' + R + ' 0 0 1 ' + f1(ex) + ',' + f1(ey) + ' L' + f1(hd.bx) + ',' + f1(hd.by)) + hd.svg;
      occ = [180, -90, 90];
    } else if (angle == null) {
      main = line('M0,40 L0,0'); cpt = [0, 0];
    } else if (Math.abs(angle) >= 170) {
      main = line('M0,40 L0,-12 A13,13 0 0 0 -26,-12 L-26,22') + '<path d="M-36,16 L-26,34 L-16,16 Z" fill="' + ink + '"/>';
      cpt = [0, 0]; occ = [180, 0, -45, -90, -130];
    } else {
      var ax2 = Math.sin(angle * D2R), ay2 = -Math.cos(angle * D2R), h2 = head(ax2 * 38, ay2 * 38, ax2, ay2);
      var r = opts.curve === 'wide' ? 24 : opts.curve === 'soft' ? 14 : 0;
      if (r && Math.abs(angle) > 8) {
        // rounded turn: straight in, a smooth bend through the junction, straight out; the km point is the middle of the bend
        main = line('M0,40 L0,' + r + ' Q0,0 ' + f1(ax2 * r) + ',' + f1(ay2 * r) + ' L' + f1(h2.bx) + ',' + f1(h2.by)) + h2.svg;
        cpt = [ax2 * r / 4, (r + ay2 * r) / 4];
        dirIn = unit(ax2 * r, ay2 * r - r); dirOut = [ax2, ay2];
      } else {
        main = line('M0,40 L0,0 L' + f1(h2.bx) + ',' + f1(h2.by)) + h2.svg; cpt = [0, 0];
      }
      dirOut = dirOut || [ax2, ay2];
      occ = [180, angle];
    }
    // other roads leave from the km point, turned with the road when it is drawn from GPS
    var hdg = brg(dirIn[0], dirIn[1]), s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 100 100" width="' + size + '" height="' + size + '" aria-hidden="true">';
    var bo = opts.round ? [0, 0] : cpt, dOut = dirOut || dirIn;
    // roads taken from the map (OpenStreetMap) around the point, drawn under everything else
    (opts.side || []).forEach(function (sd) {
      var q = sd.p; if (!q || q.length < 2) return;
      var d2 = 'M' + f1(q[0][0]) + ',' + f1(q[0][1]);
      for (var i = 1; i < q.length - 1; i++) d2 += ' Q' + f1(q[i][0]) + ',' + f1(q[i][1]) + ' ' + f1((q[i][0] + q[i + 1][0]) / 2) + ',' + f1((q[i][1] + q[i + 1][1]) / 2);
      d2 += ' L' + f1(q[q.length - 1][0]) + ',' + f1(q[q.length - 1][1]);
      s += '<path d="' + d2 + '" fill="none" stroke="' + ink + '" stroke-width="' + f1(w * (sd.major ? 0.85 : 0.45)) + '" stroke-linecap="round" stroke-linejoin="round"' + (sd.gravel ? ' stroke-dasharray="' + f1(w) + ' ' + f1(w * 0.9) + '"' : '') + '/>';
      var far = q[Math.min(q.length - 1, 3)], near = q[0]; occ.push(brg(far[0] - near[0], far[1] - near[1]));
    });
    (branches || []).forEach(function (b) {
      // per road: o = { c: curved, t: thick (main road), g: gravel, o: shift along our road (− before the km point, + after it) }
      var o = (opts.bopt && opts.bopt[b]) || {};
      var ab = (shape ? hdg : 0) + b, sx = Math.sin(ab * D2R), sy = -Math.cos(ab * D2R);
      var org = bo;
      if (o.o && !opts.round) org = o.o < 0 ? [bo[0] + dirIn[0] * o.o, bo[1] + dirIn[1] * o.o] : [bo[0] + dOut[0] * o.o, bo[1] + dOut[1] * o.o];
      var x0 = org[0] + sx * R, y0 = org[1] + sy * R, x1 = org[0] + sx * 34, y1 = org[1] + sy * 34, bw = w * (o.t ? 0.9 : 0.45);
      var bd = o.g ? ' stroke-dasharray="' + f1(w) + ' ' + f1(w * 0.9) + '"' : '';
      if (o.c && b % 180) {
        // curved: leaves our road almost alongside it, then swings out to its own direction
        var ca = ab - (b > 0 ? 1 : -1) * 40, cxp = org[0] + Math.sin(ca * D2R) * 16, cyp = org[1] - Math.cos(ca * D2R) * 16;
        s += '<path d="M' + f1(x0) + ',' + f1(y0) + ' Q' + f1(cxp) + ',' + f1(cyp) + ' ' + f1(x1) + ',' + f1(y1) + '" fill="none" stroke="' + ink + '" stroke-width="' + f1(bw) + '" stroke-linecap="round"' + bd + '/>';
      } else {
        s += '<line x1="' + f1(x0) + '" y1="' + f1(y0) + '" x2="' + f1(x1) + '" y2="' + f1(y1) + '" stroke="' + ink + '" stroke-width="' + f1(bw) + '" stroke-linecap="round"' + bd + '/>';
      }
      occ.push(ab);
      if (o.o) occ.push(brg(org[0] + sx * 17 - cpt[0], org[1] + sy * 17 - cpt[1])); // a road shifted along ours still takes up room next to the km point
    });
    s += '<circle cx="' + f1(start[0]) + '" cy="' + f1(start[1]) + '" r="' + (w * 0.9) + '" fill="' + ink + '"/>' + main;
    if (opts.bar) {
      // control: a line across the road at the km point (start line, finish line, control board)
      var qx = -dirIn[1], qy = dirIn[0];
      s += '<line x1="' + f1(cpt[0] - qx * 8) + '" y1="' + f1(cpt[1] - qy * 8) + '" x2="' + f1(cpt[0] + qx * 8) + '" y2="' + f1(cpt[1] + qy * 8) + '" stroke="' + ink + '" stroke-width="' + f1(w * 0.6) + '"/>';
    }
    if (opts.ref) {
      // WRC style: a short thin leader ending in an open circle, running right into the road at the km point
      (opts.stk || []).forEach(function (k) { var dx = k.x - cpt[0], dy = k.y - cpt[1]; if (Math.hypot(dx, dy) < 34) occ.push(brg(dx, dy)); }); // keep clear of signs too
      var lb = typeof opts.lead === 'number' ? opts.lead : pickLeader(occ, angle != null && (angle < 0 || Math.abs(angle) >= 170) ? 1 : -1);
      var lx = Math.sin(lb * D2R), ly = -Math.cos(lb * D2R), lw = Math.max(1.2, w * 0.28), cr = Math.max(2.6, w * 0.53), len = 20;
      var cx = cpt[0] + lx * len, cy = cpt[1] + ly * len;
      s += '<line x1="' + f1(cpt[0]) + '" y1="' + f1(cpt[1]) + '" x2="' + f1(cx - lx * cr) + '" y2="' + f1(cy - ly * cr) + '" stroke="' + ink + '" stroke-width="' + f1(lw) + '"/>';
      s += '<circle cx="' + f1(cx) + '" cy="' + f1(cy) + '" r="' + f1(cr) + '" fill="none" stroke="' + ink + '" stroke-width="' + f1(lw) + '"/>';
    }
    // things drawn in the box: symbols and road signs where they stand, and yellow name boards
    var SYM = (root.RBS || (typeof globalThis !== 'undefined' && globalThis.RBS) || {}).BY;
    (opts.stk || []).forEach(function (k, i) {
      var z = k.s || 18, da = opts.interactive ? ' data-stk="' + i + '"' : '', bw2 = z, bh2 = z;
      if (k.id === 'label') {
        var txt = esc(k.t || ''); bh2 = z * 0.5; bw2 = Math.max(14, (k.t || '').length * bh2 * 0.47 + 5);
        var lx0 = Math.max(-49 + bw2 / 2, Math.min(49 - bw2 / 2, k.x)); // a name board always stays inside the box
        s += '<g' + da + ' transform="translate(' + f1(lx0) + ',' + f1(k.y) + ')"><rect x="' + f1(-bw2 / 2) + '" y="' + f1(-bh2 / 2) + '" width="' + f1(bw2) + '" height="' + f1(bh2) + '" fill="var(--mark)" stroke="#000" stroke-width="0.8"/>' +
          '<text x="0" y="' + f1(bh2 * 0.26) + '" font-family="Arial,sans-serif" font-weight="700" font-size="' + f1(bh2 * 0.72) + '" textLength="' + f1(bw2 - 4) + '" lengthAdjust="spacingAndGlyphs" text-anchor="middle" fill="#000">' + txt + '</text></g>';
      } else if (SYM && SYM[k.id]) {
        s += '<g' + da + ' transform="translate(' + f1(k.x - z / 2) + ',' + f1(k.y - z / 2) + ') scale(' + (z / 100).toFixed(3) + ')">' + SYM[k.id].svg + '</g>';
      } else return;
      if (opts.interactive && opts.selStk === i) s += '<rect x="' + f1((k.id === 'label' ? lx0 : k.x) - bw2 / 2 - 1.5) + '" y="' + f1(k.y - bh2 / 2 - 1.5) + '" width="' + f1(bw2 + 3) + '" height="' + f1(bh2 + 3) + '" fill="none" stroke="#0050B3" stroke-width="1.2" stroke-dasharray="2 1.5"/>';
    });
    return s + '</svg>';
  }
  // leader direction: the usual lower-left (lower-right for left turns) unless a road is in the way, then the widest free gap
  function pickLeader(occ, side) {
    var diff = function (a, b) { return Math.abs(((a - b) % 360 + 540) % 360 - 180); };
    var pref = side > 0 ? 131 : -131, best = null;
    for (var c = -175; c <= 180; c += 5) {
      var clear = Math.min.apply(null, occ.map(function (o) { return diff(c, o); }));
      var score = Math.min(clear, 40) * 10 - diff(c, pref) * 0.5;
      if (!best || score > best.s) best = { s: score, c: c };
    }
    return best.c;
  }
  // road shape around a point for the tulip: track from `before` m ahead of the point to `after` m past it,
  // smoothed (GPS wobble), turned so the car comes in from below, scaled into the box. Returns { pts, at }.
  function roadShape(track, cum, d, len) {
    var total = cum[cum.length - 1], before = Math.min(len * 0.3, 60), after = len - before;
    var a = Math.max(0, d - before), b = Math.min(total, d + after), N = 32;
    if (b - a < 20) return null;
    var raw = [], at = 0;
    for (var i = 0; i <= N; i++) { var x = a + (b - a) * i / N; raw.push(pointAt(track, cum, x)); if (x <= d) at = i; }
    var lat0 = raw[at][0] * D2R, xy = raw.map(function (p) { return [(p[1] - raw[at][1]) * D2R * 6371000 * Math.cos(lat0), -(p[0] - raw[at][0]) * D2R * 6371000]; });
    // the recording may carry on past the point and come back the same way (car turned round after the finish):
    // stop where the line folds back onto itself, so the arrow keeps the direction the rally goes
    var stepM = (b - a) / N, gapIdx = Math.ceil(40 / stepM), end = xy.length - 1;
    outer: for (var fi = at + 1; fi < xy.length; fi++) for (var fj = 0; fj < fi - gapIdx; fj++) {
      if (Math.hypot(xy[fi][0] - xy[fj][0], xy[fi][1] - xy[fj][1]) < 8) { end = Math.max(at, Math.floor((fi + fj) / 2) - 1); break outer; }
    }
    xy = xy.slice(0, end + 1);
    // little or no road after the point (end of the route, or cut above): carry on straight the way we came in
    var want = Math.min(60, Math.round(len * 0.3 / stepM));
    if ((xy.length - 1 - at) * stepM < len * 0.2 && at > 0) {
      var q0 = xy[Math.max(0, at - 4)], q1 = xy[at], vl = Math.hypot(q1[0] - q0[0], q1[1] - q0[1]) || 1, vx = (q1[0] - q0[0]) / vl, vy = (q1[1] - q0[1]) / vl;
      xy = xy.slice(0, at + 1);
      for (var e = 1; e <= want; e++) xy.push([q1[0] + vx * stepM * e, q1[1] + vy * stepM * e]);
    }
    // two passes of a moving average about 25 m wide: bends stay, the zig-zag of a wandering GPS (±5 m) goes
    var step = (b - a) / N, hw = Math.max(2, Math.round(12.5 / step));
    var smooth = function (src) {
      return src.map(function (p, i) {
        var h = Math.min(hw, i, src.length - 1 - i), sx = 0, sy = 0, c = 0; // window shrinks at the ends so the line still starts and ends in place
        for (var j = i - h; j <= i + h; j++) { sx += src[j][0]; sy += src[j][1]; c++; }
        return [sx / c, sy / c];
      });
    };
    var sm = smooth(smooth(xy));
    // turn so the approach (start → km point) points straight up
    var s0 = sm[0], c0 = sm[at];
    var ang = at > 0 ? Math.atan2(c0[0] - s0[0], -(c0[1] - s0[1])) : Math.atan2(sm[2][0] - c0[0], -(sm[2][1] - c0[1]));
    var co = Math.cos(-ang), si = Math.sin(-ang);
    var rot = sm.map(function (p) { var x = p[0] - c0[0], y = p[1] - c0[1]; return [x * co - y * si, x * si + y * co]; });
    var xs = rot.map(function (p) { return p[0]; }), ys = rot.map(function (p) { return p[1]; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs), miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var k = 78 / Math.max(maxx - minx, maxy - miny, 1);
    var ox = -(minx + maxx) / 2, oy = -(miny + maxy) / 2;
    return { pts: rot.map(function (p) { return [+((p[0] + ox) * k).toFixed(1), +((p[1] + oy) * k).toFixed(1)]; }), at: at,
      tf: { lat: raw[at][0], lon: raw[at][1], c: Math.cos(lat0), cx: c0[0], cy: c0[1], co: co, si: si, ox: ox, oy: oy, k: k } };
  }
  // any lat/lon into the same tulip units as a road shape (used for side roads from the map)
  function shapeXY(tf, lat, lon) {
    var x = (lon - tf.lon) * D2R * 6371000 * tf.c - tf.cx, y = -(lat - tf.lat) * D2R * 6371000 - tf.cy;
    return [+((x * tf.co - y * tf.si + tf.ox) * tf.k).toFixed(1), +((x * tf.si + y * tf.co + tf.oy) * tf.k).toFixed(1)];
  }
  var REF = true; // measuring-point marker on roadbook tulips (setting)
  function setRef(on) { REF = !!on; }
  function tulipOf(p, opts) {
    opts = Object.assign({ ref: REF }, opts || {}, {
      round: !!p.round, gravel: p.road === 'gravel', curve: p.curve || 'sharp',
      shape: p.curve === 'gps' && p.shape ? p.shape.pts : null, shapeAt: p.shape ? p.shape.at : 0,
      side: p.curve === 'gps' && p.shape ? p.shape.side : null, bopt: p.bopt, stk: p.stk,
      lead: typeof p.lead === 'number' ? p.lead : 'auto', bar: isControl(p)
    });
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
    ZONE_CODES: ZONE_CODES, sliceStage: sliceStage, planSplit: planSplit, setRef: setRef, roadShape: roadShape, shapeXY: shapeXY
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RB = api;
})(this);
