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
  function render(o) {
    var W = o.w, H = o.h, pad = o.pad || 60, L = LAYERS[o.layer] || LAYERS.osm;
    var font = o.font || 'Barlow Condensed, Tahoma, sans-serif';
    var lats = o.track.map(function (p) { return p[0]; }), lons = o.track.map(function (p) { return p[1]; });
    var n = Math.max.apply(null, lats), s = Math.min.apply(null, lats), e = Math.max.apply(null, lons), w = Math.min.apply(null, lons);
    var z = Math.min(L.max - 1, 17);
    for (; z > 3; z--) {
      var a = project(n, w, z), b = project(s, e, z);
      if (b.x - a.x <= W - 2 * pad && b.y - a.y <= H - 2 * pad) break;
    }
    var c1 = project(n, w, z), c2 = project(s, e, z);
    var ox = (c1.x + c2.x) / 2 - W / 2, oy = (c1.y + c2.y) / 2 - H / 2;
    var cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, W, H);
    var tx0 = Math.floor(ox / TILE), ty0 = Math.floor(oy / TILE), tx1 = Math.floor((ox + W) / TILE), ty1 = Math.floor((oy + H) / TILE);
    var jobs = [], max = Math.pow(2, z);
    if (!o.noTiles) for (var tx = tx0; tx <= tx1; tx++) for (var ty = ty0; ty <= ty1; ty++) {
      if (ty < 0 || ty >= max) continue;
      (function (tx, ty) {
        var url = L.url.replace('{z}', z).replace('{x}', ((tx % max) + max) % max).replace('{y}', ty);
        jobs.push(loadTile(url).then(function (im) { if (im) g.drawImage(im, tx * TILE - ox, ty * TILE - oy, TILE, TILE); return !!im; }));
      })(tx, ty);
    }
    return Promise.all(jobs).then(function (res) {
      var missing = res.filter(function (x) { return !x; }).length;
      var px = function (lat, lon) { var p = project(lat, lon, z); return { x: p.x - ox, y: p.y - oy }; };
      var pts = o.track.map(function (p) { return px(p[0], p[1]); });
      // route: white casing then stage colour
      g.lineJoin = 'round'; g.lineCap = 'round';
      [['#ffffff', 16], [o.color || '#0050B3', 9]].forEach(function (st) {
        g.strokeStyle = st[0]; g.lineWidth = st[1]; g.beginPath();
        pts.forEach(function (p, i) { if (i) g.lineTo(p.x, p.y); else g.moveTo(p.x, p.y); }); g.stroke();
      });
      // direction arrows every ~220 px along the drawn line
      var acc = 0, next = 160;
      for (var i = 1; i < pts.length; i++) {
        var A = pts[i - 1], B = pts[i], seg = Math.hypot(B.x - A.x, B.y - A.y);
        while (seg > 0 && acc + seg >= next) {
          var f = (next - acc) / seg, x = A.x + (B.x - A.x) * f, y = A.y + (B.y - A.y) * f, ang = Math.atan2(B.y - A.y, B.x - A.x);
          g.save(); g.translate(x, y); g.rotate(ang);
          g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(17, 0); g.lineTo(-10, -14); g.lineTo(-10, 14); g.closePath(); g.fill();
          g.fillStyle = '#000000'; g.beginPath(); g.moveTo(12, 0); g.lineTo(-7, -9.5); g.lineTo(-7, 9.5); g.closePath(); g.fill();
          g.restore(); next += 200;
        }
        acc += seg;
      }
      // labels
      var items = (o.labels || []).map(function (l) {
        var p = px(l.lat, l.lon);
        g.font = 'bold 26px ' + font; var w1 = g.measureText(l.title).width;
        g.font = '600 20px ' + font; var w2 = l.sub ? g.measureText(l.sub).width : 0;
        return { x: p.x, y: p.y, w: Math.max(w1, w2) + 20, h: l.sub ? 54 : 34, l: l };
      });
      var avoid = items.map(function (it) { return { x: it.x - 8, y: it.y - 8, w: 16, h: 16 }; });
      placeLabels(items, W, H, avoid);
      items.forEach(function (it) {
        var b = it.box, l = it.l, dark = l.kind === 'START' || l.kind === 'FINISH';
        var cx = Math.max(b.x + 6, Math.min(b.x + b.w - 6, it.x)), cy = it.y < b.y ? b.y : it.y > b.y + b.h ? b.y + b.h : b.y + b.h / 2;
        g.strokeStyle = '#000'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(it.x, it.y); g.lineTo(cx, cy); g.stroke();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(it.x, it.y, 7, 0, 7); g.fill(); g.lineWidth = 3; g.stroke();
        g.fillStyle = dark ? '#000' : l.kind === 'DANGER' ? '#fff' : '#FFE14D';
        g.fillRect(b.x, b.y, b.w, b.h); g.lineWidth = 2.5; g.strokeStyle = l.kind === 'DANGER' ? '#D0021B' : '#000'; g.strokeRect(b.x, b.y, b.w, b.h);
        g.fillStyle = dark ? '#fff' : l.kind === 'DANGER' ? '#D0021B' : '#000'; g.textAlign = 'center'; g.textBaseline = 'top';
        g.font = 'bold 26px ' + font; g.fillText(l.title, b.x + b.w / 2, b.y + 4);
        if (l.sub) { g.font = '600 20px ' + font; g.fillText(l.sub, b.x + b.w / 2, b.y + 31); }
      });
      // north arrow
      var nx = W - 46, ny = 54;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.arc(nx, ny, 32, 0, 7); g.fill();
      g.strokeStyle = '#000'; g.lineWidth = 2; g.stroke();
      g.fillStyle = '#000'; g.beginPath(); g.moveTo(nx, ny - 24); g.lineTo(nx + 11, ny + 10); g.lineTo(nx, ny + 4); g.lineTo(nx - 11, ny + 10); g.closePath(); g.fill();
      g.font = 'bold 18px ' + font; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText('N', nx, ny + 27);
      // scale bar
      var midLat = (n + s) / 2, mpp = 156543.03392 * Math.cos(midLat * Math.PI / 180) / Math.pow(2, z);
      var sc = niceScale(mpp, W / 4), sx = 20, sy = H - 30;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(sx - 8, sy - 30, sc.px + 16, 42);
      g.fillStyle = '#000'; g.fillRect(sx, sy, sc.px, 6); g.fillRect(sx, sy - 8, 3, 14); g.fillRect(sx + sc.px - 3, sy - 8, 3, 14);
      g.font = 'bold 18px ' + font; g.textAlign = 'left'; g.fillText(sc.label, sx, sy - 12);
      // map credit (required by the tile providers)
      if (!o.noTiles) {
      g.font = '14px sans-serif'; var cw = g.measureText(L.credit).width;
      g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - cw - 14, H - 22, cw + 14, 22);
      g.fillStyle = '#333'; g.textAlign = 'right'; g.fillText(L.credit, W - 7, H - 6);
      }
      // frame
      g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(1.5, 1.5, W - 3, H - 3);
      cv.missingTiles = missing; cv.zoom = z;
      return cv;
    });
  }

  root.RBO = { render: render, placeLabels: placeLabels, project: project };
})(this);
