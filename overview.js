/* Stage overview picture: map tiles + route + direction arrows + control labels (placed so they don't overlap)
   + north arrow + scale bar + map credit. Returns a canvas. Used for the Excel "Overview" sheet and PNG export. */
(function (root) {
  'use strict';
  var TILE = 256;
  var LAYERS = {
    osm: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', max: 19, credit: '© OpenStreetMap contributors' },
    sat: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', max: 18, credit: 'Imagery © Esri' }
  };

  function project(lat, lon, z) { // Web Mercator → world pixel at zoom z
    var s = TILE * Math.pow(2, z), sin = Math.sin(lat * Math.PI / 180);
    return { x: (lon + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  function loadTile(url) {
    return new Promise(function (ok) {
      var im = new Image(); im.crossOrigin = 'anonymous';
      var done = false, to = setTimeout(function () { if (!done) { done = true; ok(null); } }, 12000);
      im.onload = function () { if (!done) { done = true; clearTimeout(to); ok(im); } };
      im.onerror = function () { if (!done) { done = true; clearTimeout(to); ok(null); } };
      im.src = url;
    });
  }
  function rectsHit(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }

  // Place label boxes next to their points so none overlap: try above, below, right, left, then further out.
  function placeLabels(items, W, H, avoid) {
    var placed = (avoid || []).slice();
    items.forEach(function (it) {
      var gap = it.gap || 14, w = it.w, h = it.h, x = it.x, y = it.y, best = null;
      var cand = [];
      [1, 2.4, 4].forEach(function (k) {
        var g = gap * k;
        cand.push({ x: x - w / 2, y: y - g - h }, { x: x - w / 2, y: y + g }, { x: x + g, y: y - h / 2 }, { x: x - g - w, y: y - h / 2 },
          { x: x + g * 0.7, y: y - g * 0.7 - h }, { x: x - g * 0.7 - w, y: y - g * 0.7 - h }, { x: x + g * 0.7, y: y + g * 0.7 }, { x: x - g * 0.7 - w, y: y + g * 0.7 });
      });
      for (var i = 0; i < cand.length; i++) {
        var r = { x: cand[i].x, y: cand[i].y, w: w, h: h };
        if (r.x < 4 || r.y < 4 || r.x + w > W - 4 || r.y + h > H - 4) continue;
        if (placed.some(function (p) { return rectsHit(r, p); })) continue;
        best = r; break;
      }
      if (!best) best = { x: Math.max(4, Math.min(W - w - 4, x - w / 2)), y: Math.max(4, y - gap - h), w: w, h: h, forced: true };
      it.box = best; placed.push(best);
    });
    return items;
  }

  function niceScale(mpp, maxPx) {
    var steps = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
    var best = steps[0];
    steps.forEach(function (s) { if (s / mpp <= maxPx) best = s; });
    return { m: best, px: best / mpp, label: best >= 1000 ? best / 1000 + ' km' : best + ' m' };
  }

  // o: { track:[[lat,lon]], labels:[{lat,lon,title,sub,kind}], color, layer:'osm'|'sat', w, h, pad, font }
  //    whole event: o.lines = [{track, color, width}] instead of track/color; o.k scales text, lines and arrows;
  //    o.zoom forces the map zoom; o.onTile(done, total) reports progress while the map loads
  function render(o) {
    var W = o.w, H = o.h, pad = o.pad || 60, L = LAYERS[o.layer] || LAYERS.osm, K = o.k || 1;
    var font = o.font || 'Barlow Condensed, Tahoma, sans-serif';
    var all = o.lines ? [].concat.apply([], o.lines.map(function (l) { return l.track; })) : o.track;
    var lats = all.map(function (p) { return p[0]; }), lons = all.map(function (p) { return p[1]; });
    var n = Math.max.apply(null, lats), s = Math.min.apply(null, lats), e = Math.max.apply(null, lons), w = Math.min.apply(null, lons);
    var z = Math.min(L.max - 1, 17);
    if (o.zoom) z = o.zoom; else for (; z > 3; z--) {
      var a = project(n, w, z), b = project(s, e, z);
      if (b.x - a.x <= W - 2 * pad && b.y - a.y <= H - 2 * pad) break;
    }
    // o.fit (0.5..1) draws zoom z a little smaller, so a big picture can be any size and still use sharp tiles
    var FS = o.fit || 1, T = TILE * FS, proj = function (la, lo) { var q = project(la, lo, z); return { x: q.x * FS, y: q.y * FS }; };
    var c1 = proj(n, w), c2 = proj(s, e);
    var ox = (c1.x + c2.x) / 2 - W / 2, oy = (c1.y + c2.y) / 2 - H / 2;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, W, H);
    var tx0 = Math.floor(ox / T) - 1, ty0 = Math.floor(oy / T) - 1, tx1 = Math.floor((ox + W) / T) + 1, ty1 = Math.floor((oy + H) / T) + 1;
    var jobs = [], max = Math.pow(2, z), tiles = [];
    // satellite pictures that sit a few metres off in this area are moved to line up with the route (o.shift in metres east / north)
    var ppm = FS * Math.pow(2, z) / (156543.03392 * Math.cos((n + s) / 2 * Math.PI / 180)), shx = o.shift ? o.shift.e * ppm : 0, shy = o.shift ? -o.shift.n * ppm : 0;
    if (!o.noTiles) for (var tx = tx0; tx <= tx1; tx++) for (var ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= max) continue;
      tiles.push([tx, ty]);
    }
    // a few tiles at a time: a big picture needs hundreds and the map servers ask apps not to flood them
    var done = 0, res = [];
    function worker() {
      var tt = tiles.shift(); if (!tt) return Promise.resolve();
      var url = L.url.replace('{z}', z).replace('{x}', ((tt[0] % max) + max) % max).replace('{y}', tt[1]);
      return loadTile(url).then(function (im) {
        if (im) g.drawImage(im, tt[0] * T - ox + shx, tt[1] * T - oy + shy, T + 0.5, T + 0.5);
        res.push(!!im); done++; if (o.onTile) o.onTile(done, done + tiles.length);
        return worker();
      });
    }
    for (var wk = 0; wk < 6; wk++) jobs.push(worker());
    return Promise.all(jobs).then(function () {
      var missing = res.filter(function (x) { return !x; }).length;
      var px = function (lat, lon) { var p = proj(lat, lon); return { x: p.x - ox, y: p.y - oy }; };
      // neighbouring road sections (free run before/after the SS), drawn underneath like the WRC SS maps
      (o.extra || []).forEach(function (ex) {
        var ep = ex.track.map(function (p) { return px(p[0], p[1]); });
        [['#ffffff', 11], [ex.color, 5]].forEach(function (st) {
          g.strokeStyle = st[0]; g.lineWidth = st[1]; g.lineJoin = 'round'; g.lineCap = 'round'; g.beginPath();
          ep.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }); g.stroke();
        });
      });
      // route(s): white casing then the leg colour, arrows every ~200 px along each
      var lines = o.lines || [{ track: o.track, color: o.color || '#0050B3', width: 9 }];
      g.lineJoin = 'round'; g.lineCap = 'round';
      lines.forEach(function (ln) {
        var lw = (ln.width || 9) * K, pts = ln.track.map(function (p) { return px(p[0], p[1]); });
        [['#ffffff', lw + 7 * K], [ln.color || '#0050B3', lw]].forEach(function (st) {
          g.strokeStyle = st[0]; g.lineWidth = st[1]; g.beginPath();
          pts.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }); g.stroke();
        });
        ln.pts = pts;
      });
      lines.forEach(function (ln) {
        var pts = ln.pts, acc = 0, next = 160 * K, s = K * (ln.width || 9) / 9;
        for (var i = 1; i < pts.length; i++) {
          var A = pts[i - 1], B = pts[i], seg = Math.hypot(B.x - A.x, B.y - A.y);
          while (seg > 0 && acc + seg >= next) {
            var f = (next - acc) / seg, x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f, ang = Math.atan2(B.y - A.y, B.x - A.x);
            g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
            g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(17, 0); g.lineTo(-10, -14); g.lineTo(-10, 14); g.closePath(); g.fill();
            g.fillStyle = '#000000'; g.beginPath(); g.moveTo(12, 0); g.lineTo(-7, -9.5); g.lineTo(-7, 9.5); g.closePath(); g.fill();
            g.restore(); next += 200 * K;
          }
          acc += seg;
        }
      });
      // labels
      var items = (o.labels || []).map(function (l) {
        var p = px(l.lat, l.lon);
        g.font = 'bold ' + 26 * K + 'px ' + font; var w1 = g.measureText(l.title).width;
        g.font = '600 ' + 20 * K + 'px ' + font; var w2 = l.sub ? g.measureText(l.sub).width : 0;
        return { x: p.x, y: p.y, w: Math.max(w1, w2) + 20 * K, h: (l.sub ? 54 : 34) * K, gap: 14 * K, l: l };
      });
      var avoid = items.map(function (it) { return { x: it.x - 8 * K, y: it.y - 8 * K, w: 16 * K, h: 16 * K }; });
      placeLabels(items, W, H, avoid);
      items.forEach(function (it) {
        var b = it.box, l = it.l, dark = l.kind === 'START' || l.kind === 'FINISH';
        var cx = Math.max(b.x + 6, Math.min(b.x + b.w - 6, it.x)), cy = it.y < b.y ? b.y : it.y > b.y + b.h ? b.y + b.h : b.y + b.h / 2;
        g.strokeStyle = '#000'; g.lineWidth = 2.5 * K; g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(cx, cy); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(it.x, it.y, 7 * K, 0, 7); g.fill(); g.lineWidth = 3 * K; g.stroke();
        g.fillStyle = l.fill || (dark ? '#000' : l.kind === 'DANGER' ? '#fff' : '#FFE14D');
        g.fillRect(b.x, b.y, b.w, b.h); g.lineWidth = 2.5 * K; g.strokeStyle = l.fill ? '#fff' : l.kind === 'DANGER' ? '#D0021B' : '#000'; g.strokeRect(b.x, b.y, b.w, b.h);
        g.fillStyle = l.ink || (dark ? '#fff' : l.kind === 'DANGER' ? '#D0021B' : '#000'); g.textAlign = 'center'; g.textBaseline = 'top';
        g.font = 'bold ' + 26 * K + 'px ' + font; g.fillText(l.title, b.x + b.w / 2, b.y + 4 * K);
        if (l.sub) { g.font = '600 ' + 20 * K + 'px ' + font; g.fillText(l.sub, b.x + b.w / 2, b.y + 31 * K); }
      });
      // north arrow
      var nx = W - 46 * K, ny = 54 * K;
      g.save(); g.translate(nx, ny); g.scale(K, K);
      g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(0, 0, 32, 0, 7); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#000'; g.beginPath(); g.moveTo(0, -24); g.lineTo(11, 10); g.lineTo(0, 4); g.lineTo(-11, 10); g.closePath(); g.fill();
      g.font = 'bold 18px ' + font; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('N', 0, 27);
      g.restore();
      // scale bar
      var midLat = (n + s) / 2, mpp = 156543.03392 * Math.cos(midLat * Math.PI / 180) / Math.pow(2, z) / FS;
      var sc = niceScale(mpp, W / 4), sx = 20 * K, sy = H - 30 * K;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(sx - 8 * K, sy - 30 * K, sc.px + 16 * K, 42 * K);
      g.fillStyle = '#000'; g.fillRect(sx, sy, sc.px, 6 * K); g.fillRect(sx, sy - 8 * K, 3 * K, 14 * K); g.fillRect(sx + sc.px - 3 * K, sy - 8 * K, 3 * K, 14 * K);
      g.font = 'bold ' + 18 * K + 'px ' + font; g.textAlign = 'left'; g.fillText(sc.label, sx, sy - 12 * K);
      // map credit (required by the tile providers)
      if (!o.noTiles) {
      g.font = 14 * K + 'px sans-serif'; var cw = g.measureText(L.credit).width;
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - cw - 14 * K, H - 22 * K, cw + 14 * K, 22 * K);
      g.fillStyle = '#333'; g.textAlign = 'right'; g.fillText(L.credit, W - 7 * K, H - 6 * K);
      }
      // frame
      g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3);
      cv.missingTiles = missing; cv.zoom = z;
      return cv;
    });
  }

  root.RBO = { render: render, placeLabels: placeLabels, project: project, LAYERS: LAYERS };
})(this);
