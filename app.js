/* Rally Roadbook — app logic v1.2 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var APP_VER = '1.7.1';
  var KEY = 'rb.project.v1', NKEY = 'rb.nav.v1', RKEY = 'rb.rec.v1', LKEY = 'rb.lang', SKEY = 'rb.settings.v1', MKEY = 'rb.meta.v1';
  var COLORS = ['#0050B3', '#D0021B', '#007A3D', '#7A3EB1', '#E07000', '#00838F'];
  var TYPES = ['START', 'TULIP', 'TC', 'PC', 'CP', 'DANGER', 'INFO', 'FINISH', 'SVCIN', 'SVCOUT', 'PFIN', 'PFOUT', 'RGIN', 'RGOUT'];
  // WRC map colours: special stage red, road section blue, evacuation yellow; service / parc fermé are marked by their controls
  var KINDS = ['ss', 'liaison', 'service', 'pf', 'evac'];
  var KIND_COLOR = { ss: '#D0021B', liaison: '#0050B3', service: '#0050B3', pf: '#0050B3', evac: '#E6B800' };
  function kindOf(st) { return st && KINDS.indexOf(st.kind) >= 0 ? st.kind : 'ss'; }
  function stageColor(st) { return KIND_COLOR[kindOf(st)]; }
  var BRANCH_SET = [-135, -90, -45, 0, 45, 90, 135];
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';

  // ---------- Storage ----------
  var store = (function () {
    try { localStorage.setItem('rb.t', '1'); localStorage.removeItem('rb.t'); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = v; }, removeItem: function (k) { delete m[k]; }, mem: true }; }
  })();

  // ---------- Settings ----------
  var DEF = {
    lang: null, night: 'off', navDec: 2, alerts: [300, 100, 50], sound: true, vib: true, map: true, rec: true,
    offRoute: 40, navAcc: 50, recAcc: 30, markFx: true, layer: 'osm', drawSnap: true,
    clockOffset: 0, tsdFmt: 's', partial: 'point', hold: true, backup: true,
    paper: 'A5', coordFmt: 'ddm', xlPhotos: true, refMark: true, curve: 'sharp'
  };
  var CFG = (function () {
    var raw = null, c = {};
    try { raw = store.getItem(SKEY); c = JSON.parse(raw || '{}') || {}; } catch (e) {}
    var o = Object.assign({}, DEF, c);
    if (!raw) { // carry over options saved by v1.1
      try {
        var n = JSON.parse(store.getItem(NKEY) || 'null');
        if (n) { ['sound', 'vib', 'map', 'rec'].forEach(function (k) { if (k in n) o[k] = n[k]; }); if (n.night) o.night = 'on'; }
        o.lang = store.getItem(LKEY) || null;
      } catch (e) {}
    }
    return o;
  })();
  function saveCfg() { try { store.setItem(SKEY, JSON.stringify(CFG)); } catch (e) {} }
  var META = (function () { try { return JSON.parse(store.getItem(MKEY) || 'null') || {}; } catch (e) { return {}; } })();
  function saveMeta() { try { store.setItem(MKEY, JSON.stringify(META)); } catch (e) {} }
  function isNight() {
    if (CFG.night === 'on') return true;
    if (CFG.night === 'auto') { var h = new Date().getHours(); return h >= 18 || h < 6; }
    return false;
  }
  function applyNight() { document.body.classList.toggle('night', S.mode !== 'org' && isNight()); }
  function alerts() { return (CFG.alerts || []).map(Number).filter(function (x) { return x > 0; }).sort(function (a, b) { return b - a; }); }

  // ---------- i18n ----------
  var LANG = CFG.lang || ((navigator.language || 'th').slice(0, 2) === 'th' ? 'th' : 'en');
  if (!I18N[LANG]) LANG = 'th';
  function t(k, v) {
    var s = (I18N[LANG] && I18N[LANG][k]) || I18N.th[k] || k;
    if (v) Object.keys(v).forEach(function (n) { s = s.split('{' + n + '}').join(v[n]); });
    return s;
  }
  function applyI18n() {
    document.documentElement.lang = LANG;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-aria]').forEach(function (el) { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
    $('fLayer').textContent = S.sat ? t('fab.map') : t('fab.sat');
    buildDlgLabels();
  }
  function setLang(l) { LANG = l; CFG.lang = l; saveCfg(); applyI18n(); renderAll(); if ($('setDlg').open) renderSettings(); }

  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  // roadbook distances use 3 decimals; the driving display uses the chosen setting
  function fmtKm(km, dec) { dec = dec == null ? 3 : dec; return km == null || !isFinite(km) ? '--.' + '---'.slice(0, dec) : km.toFixed(dec); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function rallyNow() { return Date.now() + (CFG.clockOffset || 0); }
  function fmtTod(ms) { var d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()); }

  // Buttons that change distance or timing mid-stage need a press-and-hold when that setting is on
  function act(el, fn, holdable) {
    var timer = null, fired = false;
    var need = function () { return holdable && CFG.hold; };
    el.addEventListener('click', function (e) {
      if (!need() || e.detail === 0) { fn.call(el, e); return; }
      if (!fired) toast(t('hold.hint'), 1500);
      fired = false;
    });
    el.addEventListener('pointerdown', function () {
      if (!need()) return;
      fired = false; el.classList.remove('holding'); void el.offsetWidth; el.classList.add('holding');
      timer = setTimeout(function () { fired = true; el.classList.remove('holding'); if (navigator.vibrate) navigator.vibrate(40); fn.call(el); }, 500);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
      el.addEventListener(ev, function () { clearTimeout(timer); el.classList.remove('holding'); });
    });
  }
  function topDialog() { var d = document.querySelectorAll('dialog[open]'); return d.length ? d[d.length - 1] : null; }
  function toast(msg, ms) {
    var el = $('toast'), host = topDialog() || document.body;
    if (el.parentNode !== host) host.appendChild(el); // an open dialog sits above the page, so the message must live inside it
    el.textContent = msg; el.hidden = false; el.onclick = null;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }
  // In-app replacement for confirm()/prompt(): resolves true / the typed text, or null when cancelled
  var askState = null;
  function ask(o) {
    if (askState) { askState.resolve(null); askState = null; }
    $('askTitle').textContent = o.title || '';
    $('askBody').textContent = o.body || ''; $('askBody').hidden = !o.body;
    $('askField').hidden = o.input == null;
    if (o.input != null) { $('askLbl').textContent = o.label || ''; $('askIn').value = o.input; }
    $('askOk').textContent = o.ok || t('common.ok'); $('askNo').textContent = o.cancel || t('common.cancel');
    $('askOk').className = o.danger ? 'danger-fill' : 'primary';
    return new Promise(function (resolve) {
      askState = { resolve: resolve, input: o.input != null };
      $('askDlg').showModal();
      if (o.input != null) setTimeout(function () { $('askIn').focus(); $('askIn').select(); }, 50);
    });
  }
  function askDone(v) { var st = askState; askState = null; if ($('askDlg').open) $('askDlg').close(); if (st) st.resolve(v); }
  $('askOk').onclick = function () { askDone(askState && askState.input ? $('askIn').value : true); };
  $('askNo').onclick = function () { askDone(null); };
  $('askIn').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('askOk').click(); } };
  $('askDlg').addEventListener('cancel', function (e) { e.preventDefault(); askDone(null); });

  function typeName(type) { return type === 'TULIP' ? 'Tulip' : type === 'DANGER' ? t('type.danger') : type === 'INFO' ? 'Info' : RB.ZONE_CODES[type] ? t('type.' + type) : type; }
  function fmtClock(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + (m < 10 && h ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  // ---------- Project ----------
  function newProject() { return { v: 1, name: t('proj.new'), stages: [] }; }
  function load() { try { var s = store.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  var saveT;
  function save() {
    clearTimeout(saveT);
    if (!META.dirtySince) { META.dirtySince = Date.now(); saveMeta(); }
    saveT = setTimeout(function () { try { store.setItem(KEY, JSON.stringify(P)); } catch (e) { toast(t('err.storageFull'), 5000); } }, 300);
    gcPhotos();
  }
  var S = { mode: 'org', stageId: null, sel: null, addMode: false, suggest: [], sat: false, ctrlOnly: false, draw: null };
  var P = load() || newProject();
  // reopen on the stage that was in use last time (falls back to the first one)
  S.stageId = (function () {
    var last = null; try { last = store.getItem('rb.lastStage'); } catch (e) {}
    return P.stages.some(function (x) { return x.id === last; }) ? last : P.stages[0] ? P.stages[0].id : null;
  })();
  function rememberStage() { try { if (S.stageId) store.setItem('rb.lastStage', S.stageId); } catch (e) {} }
  var cumCache = new WeakMap();
  function stage() { return P.stages.filter(function (s) { return s.id === S.stageId; })[0] || null; }
  function cumOf(st) { var c = cumCache.get(st.track); if (!c) { c = RB.buildCum(st.track); cumCache.set(st.track, c); } return c; }
  function lenOf(st) { var c = cumOf(st); return c.length ? c[c.length - 1] : 0; }
  function fac(st) { return st && st.factor > 0 ? st.factor : 1; }
  function pts(st) { return RB.sortedPoints(st); }
  function addStage(name, track, points) {
    var st = { id: uid(), name: name, kind: 'ss', track: track, factor: 1, tsd: [], points: points || [] };
    P.stages.push(st); save(); return st;
  }
  function nextStageName() { return 'SS' + (P.stages.length + 1); }

  // ---------- Map ----------
  var map = L.map('map', { zoomControl: false, preferCanvas: true }).setView([13.75, 100.5], 6);
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap' }).addTo(map);
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 18, crossOrigin: 'anonymous', attribution: 'Imagery &copy; Esri' });
  var gTracks = L.layerGroup().addTo(map), gPins = L.layerGroup().addTo(map), gSug = L.layerGroup().addTo(map), gNav = L.layerGroup().addTo(map), gRec = L.layerGroup().addTo(map), gDraw = L.layerGroup().addTo(map);
  var draftMarker = null;
  function dot() { return L.divIcon({ className: '', html: '<div class="gpsdot"></div>', iconSize: [20, 20] }); }

  function setLayer(on) {
    if (on === S.sat) return;
    S.sat = on;
    if (on) { map.removeLayer(osm); sat.addTo(map); } else { map.removeLayer(sat); osm.addTo(map); }
    $('fLayer').textContent = on ? t('fab.map') : t('fab.sat');
  }
  $('fLayer').onclick = function () { setLayer(!S.sat); };
  $('fFit').onclick = fitStage;
  function fitStage() { var st = stage(); if (st && st.track.length) map.fitBounds(L.latLngBounds(st.track), { padding: [24, 24] }); }
  $('fAdd').onclick = function () { setAdd(!S.addMode); };
  function setAdd(on) {
    S.addMode = on; $('fAdd').setAttribute('aria-pressed', on); $('addHint').hidden = !on;
    map.getContainer().style.cursor = on ? 'crosshair' : '';
  }
  $('fFilter').onclick = function () { S.ctrlOnly = !S.ctrlOnly; this.setAttribute('aria-pressed', S.ctrlOnly); drawPins(); };
  $('fLocate').onclick = function () {
    if (!navigator.geolocation) return toast(t('err.noGps'));
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      gNav.clearLayers(); L.marker(ll, { icon: dot(), interactive: false }).addTo(gNav);
      map.setView(ll, Math.max(map.getZoom(), 16));
    }, function (e) { toast(t('err.locate') + ': ' + e.message); }, { enableHighAccuracy: true, timeout: 15000 });
  };

  map.on('click', function (e) {
    if (S.mode !== 'org') return;
    if (S.draw) return drawAdd(e.latlng.lat, e.latlng.lng);
    if (!S.addMode) return;
    var st = stage(); if (!st) return toast(t('err.needGpx'));
    var r = RB.project(st.track, cumOf(st), e.latlng.lat, e.latlng.lng);
    if (r.off > 60) return toast(t('err.farFromTrack', { m: Math.round(r.off) }));
    openPoint(newPointAt(st, r.d), true);
  });

  function newPointAt(st, d, angle, type) {
    var p = RB.pointAt(st.track, cumOf(st), d);
    var a = angle != null ? angle : RB.angleAt(st.track, cumOf(st), d, 30);
    type = type || (pts(st).length ? 'TULIP' : 'START');
    var ang = type === 'START' ? null : (Math.abs(a) < 12 ? 0 : Math.round(a / 5) * 5);
    var pre = type === 'TULIP' ? RB.nearestPreset(ang) : null;
    var pt = { id: uid(), d: d, lat: p[0], lon: p[1], type: type, danger: 1, angle: ang, branches: [], th: pre ? pre.th : '', en: pre ? pre.en : '', note: '', code: '', time: '' };
    if (RB.isControl(pt)) pt.code = RB.suggestCode(st.points, pt);
    if (CFG.curve && CFG.curve !== 'sharp') { pt.curve = CFG.curve; if (pt.curve === 'gps') refreshShape(st, pt, 200); }
    return pt;
  }
  // tulip from the real road: recomputed whenever the point moves along the route
  function refreshShape(st, p, len) {
    if (p.curve !== 'gps') return;
    len = len || (p.shape && p.shape.len) || 200;
    var r = RB.roadShape(st.track, cumOf(st), p.d, len);
    if (r) { r.len = len; p.shape = r; } else { p.curve = 'sharp'; delete p.shape; }
  }

  function drawTracks() {
    gTracks.clearLayers();
    // every leg in its WRC colour; where one leg ends away from where the next starts (recording paused at
    // service / parc fermé) a thin dashed grey line shows the connection — it is never counted as distance
    P.stages.forEach(function (st, i) {
      var nx = P.stages[i + 1];
      if (nx && st.track.length && nx.track.length) {
        var a = st.track[st.track.length - 1], b = nx.track[0], gap = RB.hav(a, b);
        if (gap > 20 && gap < 50000) L.polyline([a, b], { color: '#555', weight: 2, dashArray: '4 6', opacity: .8, interactive: false }).addTo(gTracks);
      }
      if (st.id === S.stageId) return;
      L.polyline(st.track, { color: '#fff', weight: 6, opacity: .7, interactive: false }).addTo(gTracks);
      L.polyline(st.track, { color: stageColor(st), weight: 3.5, opacity: .85, interactive: false }).addTo(gTracks);
    });
    var st = stage();
    if (st) {
      L.polyline(st.track, { color: '#fff', weight: 10, opacity: .95, interactive: false }).addTo(gTracks);
      L.polyline(st.track, { color: stageColor(st), weight: 6, interactive: false }).addTo(gTracks);
    }
  }
  // ---------- Map pins with label decluttering ----------
  // Control labels are laid out in screen space each time the zoom changes:
  // 1) full label (code + km + time) placed where it doesn't overlap, with a leader line to the point
  // 2) if anything still overlaps: code-only labels
  // 3) if still overlapping: nearby controls share one label ("START / FINISH"); tapping it zooms in
  // Numbered tulip pins that would sit on top of another pin or a label are hidden until you zoom in.
  var OFF = 100000; // layout is done in shifted, unbounded space so labels of off-screen points still get placed
  function labelSize(code, lines) {
    var w = Math.max(code.length * 10.5, Math.max.apply(null, lines.map(function (l) { return l.length * 7.6; }).concat([0]))) + 18;
    return { w: Math.ceil(w), h: 24 + lines.length * 16 };
  }
  function layoutControls(st, ctrls) {
    var f = fac(st), z = map.getZoom();
    var base = ctrls.map(function (p) { var q = map.project([p.lat, p.lon], z); return { p: p, x: q.x + OFF, y: q.y + OFF }; });
    var dots = base.map(function (b) { return { x: b.x - 9, y: b.y - 9, w: 18, h: 18 }; });
    function attempt(mode, groups) {
      var items = groups.map(function (g) {
        var code = g.map(function (b) { return b.p.code || b.p.type; }).join(' / ');
        var lines = mode === 'full' && g.length === 1 ? [fmtKm(g[0].p.d * f / 1000) + ' km'].concat(g[0].p.time ? [g[0].p.time] : []) : [];
        var sz = labelSize(code, lines), cx = 0, cy = 0;
        g.forEach(function (b) { cx += b.x; cy += b.y; });
        return { g: g, code: code, lines: lines, x: cx / g.length, y: cy / g.length, w: sz.w, h: sz.h, gap: 12 };
      });
      RBO.placeLabels(items, 1e12, 1e12, dots);
      return { items: items, forced: items.filter(function (i) { return i.box.forced || items.some(function (o) { return o !== i && rectsOverlap(i.box, o.box); }); }).length };
    }
    var single = base.map(function (b) { return [b]; });
    var r = attempt('full', single);
    if (r.forced) r = attempt('code', single);
    if (r.forced) {
      // merge controls whose points are within 70 px of each other
      var groups = [], used = [];
      base.forEach(function (b, i) {
        if (used[i]) return; var g = [b]; used[i] = true;
        base.forEach(function (o, j) { if (!used[j] && Math.hypot(o.x - b.x, o.y - b.y) < 70) { g.push(o); used[j] = true; } });
        groups.push(g);
      });
      r = attempt('code', groups);
    }
    return r.items;
  }
  function rectsOverlap(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
  function ctrlIcon(it) {
    var b = it.box, lx = b.x - it.x, ly = b.y - it.y, single = it.g.length === 1, p = it.g[0].p;
    var cls = single ? p.type : 'MULTI';
    var ex = Math.max(lx + 6, Math.min(lx + b.w - 6, 0)), ey = ly > 0 ? ly : ly + b.h < 0 ? ly + b.h : ly + b.h / 2;
    var html = '<svg class="lead" width="1" height="1"><line x1="0" y1="0" x2="' + ex.toFixed(1) + '" y2="' + ey.toFixed(1) + '"/></svg>' +
      '<i class="cdot ' + cls + '"></i>' +
      '<div class="ctl-tag ' + cls + (single && S.sel === p.id ? ' sel' : '') + '" style="left:' + lx.toFixed(1) + 'px;top:' + ly.toFixed(1) + 'px;min-width:' + b.w + 'px;height:' + b.h + 'px">' +
      '<b>' + RB.esc(it.code) + (it.g.some(function (g) { return phList(g.p).length; }) ? '<i class="phm"></i>' : '') + '</b>' + it.lines.map(function (l) { return '<span>' + RB.esc(l) + '</span>'; }).join('') + '</div>';
    return L.divIcon({ className: 'ctl-icon', html: html, iconSize: [0, 0], iconAnchor: [0, 0] });
  }
  function drawPins() {
    gPins.clearLayers();
    var st = stage(); if (!st || S.draw) return;
    var all = pts(st), ctrls = all.filter(RB.isControl), z = map.getZoom();
    var items = layoutControls(st, ctrls), blocked = [];
    items.forEach(function (it) {
      blocked.push(it.box);
      var single = it.g.length === 1, p = it.g[0].p, b0 = it.g[0];
      var ll = single ? [p.lat, p.lon] : map.unproject([it.x - OFF, it.y - OFF], z);
      var m = L.marker(ll, { draggable: single && S.mode === 'org', autoPan: true, icon: ctrlIcon(it), zIndexOffset: 500 }).addTo(gPins);
      if (single) {
        m.on('click', function () { if (S.mode === 'org' && !S.draw) { S.sel = p.id; renderRB(); drawPins(); openPoint(p, false); } });
        m.on('dragend', function () {
          var q = m.getLatLng(), r = RB.project(st.track, cumOf(st), q.lat, q.lng);
          p.d = r.d; p.lat = r.lat; p.lon = r.lon; refreshShape(st, p); save(); drawPins(); renderRB();
          toast(t('toast.moved', { km: fmtKm(p.d * fac(st) / 1000) }));
        });
      } else {
        m.on('click', function () { map.fitBounds(L.latLngBounds(it.g.map(function (g) { return [g.p.lat, g.p.lon]; })), { padding: [80, 80], maxZoom: 18 }); });
      }
      void b0;
    });
    if (S.ctrlOnly && S.mode === 'org') return;
    var shown = [];
    all.forEach(function (p, i) {
      if (RB.isControl(p)) return;
      var q = map.project([p.lat, p.lon], z), x = q.x + OFF, y = q.y + OFF, r = { x: x - 15, y: y - 15, w: 30, h: 30 };
      var keep = p.id === S.sel || !(shown.some(function (o) { return Math.hypot(o.x - x, o.y - y) < 26; }) || blocked.some(function (bx) { return rectsOverlap(r, bx); }));
      if (!keep) return;
      shown.push({ x: x, y: y });
      var m = L.marker([p.lat, p.lon], { draggable: S.mode === 'org', autoPan: true, icon: L.divIcon({ className: '', html: '<div class="pin ' + p.type + (S.sel === p.id ? ' sel' : '') + (phList(p).length ? ' hasph' : '') + '">' + (i + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(gPins);
      m.on('click', function () { if (S.mode === 'org' && !S.draw) { S.sel = p.id; renderRB(); drawPins(); openPoint(p, false); } });
      m.on('dragend', function () {
        var ll = m.getLatLng(), r2 = RB.project(st.track, cumOf(st), ll.lat, ll.lng);
        p.d = r2.d; p.lat = r2.lat; p.lon = r2.lon; refreshShape(st, p); save(); drawPins(); renderRB();
        toast(t('toast.moved', { km: fmtKm(p.d * fac(st) / 1000) }));
      });
    });
  }
  map.on('zoomend', function () { drawPins(); });
  function drawSuggest() {
    gSug.clearLayers();
    var st = stage(); if (!st || S.mode !== 'org') return;
    S.suggest.forEach(function (s) {
      var c = L.circleMarker([s.lat, s.lon], { radius: 11, color: '#000', weight: 2, dashArray: '3 3', fillColor: '#FFE14D', fillOpacity: .5 }).addTo(gSug);
      c.on('click', function () { openPoint(newPointAt(st, s.d, s.angle), true); });
    });
  }

  // ---------- Header / modes ----------
  function renderStageSel() {
    var sel = $('stageSel'); sel.innerHTML = ''; sel.disabled = false;
    if (!P.stages.length) sel.innerHTML = '<option value="" disabled>' + RB.esc(t('stage.none')) + '</option>';
    P.stages.forEach(function (st) {
      var o = document.createElement('option'); o.value = st.id;
      o.textContent = st.name + '  ' + (lenOf(st) * fac(st) / 1000).toFixed(2) + ' km'; sel.appendChild(o);
    });
    var imp = document.createElement('option'); imp.value = '__import'; imp.textContent = t('stage.import'); sel.appendChild(imp);
    sel.value = S.stageId || '';
  }
  $('stageSel').onchange = function () {
    if (this.value === '__import') { this.value = S.stageId || ''; $('inAny').click(); return; }
    selectStage(this.value, true);
  };
  // one picker for both kinds of file: route files (.gpx) and backup files (.json)
  $('inAny').onchange = function () {
    var list = Array.prototype.slice.call(this.files || []); this.value = '';
    var backups = list.filter(function (f) { return /\.json$/i.test(f.name); }), gpx = list.filter(function (f) { return !/\.json$/i.test(f.name); });
    if (gpx.length) importGpxFiles(gpx);
    if (backups.length) {
      var fr = new FileReader();
      fr.onload = function () { try { openProjectText(fr.result, backups[0].name); } catch (e) { toast(t('err.notProject')); } };
      fr.readAsText(backups[0]);
    }
  };
  function selectStage(id, fit) {
    S.stageId = id; rememberStage(); S.sel = null; S.suggest = [];
    navResetMatch(); renderAll(); if (fit) fitStage();
  }
  document.querySelectorAll('.mode button').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
  function setMode(m) {
    if (S.draw && m !== 'org') {
      if (S.draw.wps.length > 1) { drawCancel(function () { setMode(m); }); return; }
      drawEnd();
    }
    S.mode = m; setAdd(false);
    ['org', 'rec', 'nav'].forEach(function (x) { document.body.classList.toggle('mode-' + x, x === m); });
    document.querySelectorAll('.mode button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === m); });
    if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; }
    gNav.clearLayers(); gpsMarker = accCircle = null;
    if (m === 'nav') navDrawStatic();
    recDrawAll();
    drawTracks(); drawPins(); drawSuggest(); renderNav(); renderRec();
    setTimeout(function () {
      map.invalidateSize();
      var f = m === 'nav' ? N.fix : m === 'rec' ? R.fix : null;
      if (f && N.follow) map.setView([f.lat, f.lon], Math.max(map.getZoom(), 16));
    }, 60);
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      ['rb', 'stage', 'file'].forEach(function (k) { $('tab-' + k).hidden = k !== b.dataset.tab; });
    };
  });

  // ---------- Roadbook list ----------
  function tagHTML(p) {
    if (p.type === 'TULIP') return '';
    if (p.type === 'DANGER') return '<span class="tag DANGER">' + t('type.danger') + ' ' + '!'.repeat(p.danger || 1) + '</span>';
    var txt = RB.isControl(p) ? (p.code || p.type) + (p.time ? '  ' + p.time : '') : typeName(p.type);
    return '<span class="tag ' + p.type + '">' + RB.esc(txt) + '</span>';
  }
  function symsHTML(p, size) {
    var a = (p.sym || []).filter(function (id) { return RBS.BY[id]; });
    return a.length ? '<span class="syms-inline">' + a.map(function (id) { return RBS.svg(id, size); }).join('') + '</span>' : '';
  }
  function instr(p) { var a = LANG === 'th' ? [p.th, p.en] : [p.en, p.th]; return { main: a[0] || a[1] || '', sub: a[0] ? a[1] : '' }; }
  var DUP_M = 20; // boxes closer than this to the previous one are usually a double mark
  function isDup(prev, p, f) { return !!prev && (p.d - prev.d) * f < DUP_M && !(RB.isControl(prev) && RB.isControl(p)); }
  function rowHTML(p, i, prevKm, f, dup) {
    var km = p.d * f / 1000, ins = instr(p);
    return '<div class="rb-row' + (p.type === 'DANGER' ? ' danger' : '') + (RB.isControl(p) ? ' ctrl' : '') + (dup ? ' dup' : '') + (S.sel === p.id ? ' sel' : '') + '" data-id="' + p.id + '">' +
      '<div><span class="rb-no">#' + (i + 1) + '</span><span class="rb-tot">' + fmtKm(km) + '</span><span class="rb-par">' + fmtKm(km - prevKm) + '</span></div>' +
      '<div class="rb-tulip">' + RB.tulipOf(p, { size: 56 }) + '</div>' +
      '<div class="rb-text">' + tagHTML(p) + (dup ? '<span class="dupw">' + t('rb.dup', { m: Math.round((km - prevKm) * 1000) }) + '</span>' : '') + (p.place ? '<span><b>' + RB.esc(p.place) + '</b></span>' : '') + (ins.main ? '<span>' + RB.esc(ins.main) + '</span>' : '') + (ins.sub ? '<span class="en">' + RB.esc(ins.sub) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '') + symsHTML(p, 26) + thumbsHTML(p) + '</div></div>';
  }
  function renderRB() {
    var el = $('tab-rb'), st = stage();
    if (!st) {
      el.innerHTML = '<div class="empty"><b>' + t('rb.emptyTitle') + '</b>' + t('rb.emptyBody') +
        '<label class="btn">' + t('file.importGpx') + '<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" multiple hidden id="inGpx2"></label>' +
        '<button id="eRec">' + t('rb.startRec') + '</button><button id="eDraw">' + t('rb.startDraw') + '</button></div>';
      $('inGpx2').onchange = function () { importGpxFiles(this.files); this.value = ''; };
      $('eRec').onclick = function () { setMode('rec'); };
      $('eDraw').onclick = drawStart;
      return;
    }
    var ps = pts(st), f = fac(st);
    if (!ps.length) { el.innerHTML = '<div class="empty"><b>' + t('rb.noPoints', { name: RB.esc(st.name) }) + '</b>' + t('rb.noPointsBody') + '</div>'; return; }
    var prev = 0, h = '';
    ps.forEach(function (p, i) { h += rowHTML(p, i, prev, f, isDup(ps[i - 1], p, f)); prev = p.d * f / 1000; });
    el.innerHTML = h;
    fillImgs(el);
    el.querySelectorAll('.rb-row').forEach(function (r) {
      r.onclick = function (e) {
        var p = st.points.filter(function (x) { return x.id === r.dataset.id; })[0];
        var im = e.target.closest('img[data-ph]');
        if (im) { openPhoto(im.dataset.ph, photoCaption(st, p)); return; }
        S.sel = p.id; map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17)); renderRB(); drawPins(); openPoint(p, false);
      };
    });
  }

  // ---------- Splitting into legs ----------
  function legName(sg) {
    var lab = function (p) { return p ? (p.code || typeName(p.type)) : ''; };
    if (sg.kind === 'ss') return lab(sg.startP) || 'SS';
    if (sg.kind === 'service') return t('kind.service');
    if (sg.kind === 'pf') return lab(sg.startP) || t('kind.pf');
    return (lab(sg.startP) || 'Start') + ' → ' + (lab(sg.endP) || 'End');
  }
  function replaceStage(st, parts) {
    var idx = P.stages.indexOf(st);
    var made = parts.map(function (pt) {
      pt.points.forEach(function (q) { q.id = uid(); });
      return { id: uid(), name: pt.name, kind: pt.kind, color: KIND_COLOR[pt.kind], track: pt.track, factor: st.factor || 1, tsd: [], points: pt.points, section: st.section, leg: st.leg };
    });
    P.stages.splice.apply(P.stages, [idx, 1].concat(made));
    save(); selectStage(made[0].id, true);
    return made;
  }
  function autoSplit(st) {
    var plan = RB.planSplit(st), f = fac(st);
    if (plan.length < 2) return toast(t('split.none'), 5000);
    var list = plan.map(function (sg, i) { return (i + 1) + '. ' + t('kind.' + sg.kind) + '  ' + legName(sg) + '  ' + fmtKm((sg.b - sg.a) * f / 1000) + ' km'; }).join('\n');
    ask({ title: t('split.confirmTitle', { n: plan.length }), body: list + '\n\n' + t('split.confirmNote'), ok: t('split.go') }).then(function (ok) {
      if (!ok) return;
      var parts = plan.map(function (sg) { var r = RB.sliceStage(st, sg.a, sg.b); return { name: legName(sg), kind: sg.kind, track: r.track, points: r.points }; });
      replaceStage(st, parts); toast(t('split.done', { n: parts.length }), 4000);
    });
  }
  function splitAt(st, d) {
    var L0 = lenOf(st);
    if (d < 5 || d > L0 - 5) return toast(t('split.edge'));
    ask({ title: t('split.hereTitle'), body: t('split.hereBody', { km: fmtKm(d * fac(st) / 1000) }), ok: t('split.go') }).then(function (ok) {
      if (!ok) return;
      var a = RB.sliceStage(st, 0, d), b = RB.sliceStage(st, d, L0), k = kindOf(st);
      if ($('ptDlg').open) $('ptDlg').close();
      replaceStage(st, [{ name: st.name + ' (1)', kind: k, track: a.track, points: a.points }, { name: st.name + ' (2)', kind: k, track: b.track, points: b.points }]);
    });
  }

  // ---------- Stage panel ----------
  function renderStagePanel() {
    var el = $('tab-stage'), st = stage();
    if (!st) { el.innerHTML = '<div class="empty">' + t('stage.needGpx') + '</div>'; return; }
    var f = fac(st), L0 = lenOf(st);
    var tsdRows = (st.tsd || []).map(function (s, i) {
      return '<tr><td><input inputmode="decimal" data-tsd="' + i + '" data-k="fromKm" value="' + s.fromKm + '"></td><td><input inputmode="decimal" data-tsd="' + i + '" data-k="kmh" value="' + s.kmh + '"></td><td><button data-tsddel="' + i + '">' + t('common.delete') + '</button></td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="group"><label class="field">' + t('stage.name') + '<input id="sName" value="' + RB.esc(st.name) + '"></label>' +
      '<span class="set-lbl">' + t('kind.label') + '</span><div class="seg wide kinds">' + KINDS.map(function (k) {
        return '<button type="button" data-kind="' + k + '" aria-pressed="' + (kindOf(st) === k) + '"><i class="kdot" style="background:' + KIND_COLOR[k] + '"></i>' + t('kind.' + k) + '</button>';
      }).join('') + '</div>' +
      '<div class="row2"><label class="field">Section<input id="sSection" value="' + RB.esc(st.section || '') + '"></label><label class="field">Leg<input id="sLeg" value="' + RB.esc(st.leg || '') + '"></label></div>' +
      '<div class="kv"><span>' + t('stage.lenGps') + '</span><b>' + (L0 / 1000).toFixed(3) + ' km</b><span>' + t('stage.lenAdj') + '</span><b>' + (L0 * f / 1000).toFixed(3) + ' km</b><span>' + t('stage.nPoints') + '</span><b>' + st.points.length + '</b></div></div>' +

      '<div class="group"><h3>' + t('stage.calTitle') + '</h3>' +
      '<label class="field">' + t('stage.factor') + '<input id="sFac" inputmode="decimal" value="' + f.toFixed(4) + '"></label>' +
      '<div class="row2"><label class="field">' + t('stage.calGps') + '<input id="cGps" inputmode="decimal" placeholder="' + (L0 / 1000).toFixed(2) + '"></label><label class="field">' + t('stage.calOdo') + '<input id="cOdo" inputmode="decimal"></label></div>' +
      '<button id="cApply">' + t('stage.calApply') + '</button><p class="note">' + t('stage.calNote') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.detTitle') + '</h3>' +
      '<label class="field">' + t('stage.detThr') + '<select id="sThr"><option value="25">25°</option><option value="35" selected>35°</option><option value="50">50°</option></select></label>' +
      '<div class="row2"><button id="sDetect">' + t('stage.detShow') + '</button><button id="sClear">' + t('stage.detHide') + '</button></div>' +
      '<button id="sAddAll">' + t('stage.detAddAll') + '</button><p class="note" id="sDetNote">' + t('stage.detNote') + '</p></div>' +

      '<div class="group"><h3>' + t('split.title') + '</h3><button id="sSplit">' + t('split.auto') + '</button><p class="note">' + t('split.note') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.trimTitle') + '</h3>' +
      '<div class="row2"><label class="field">' + t('stage.trimFrom') + '<input id="tFrom" inputmode="decimal" value="0.00"></label><label class="field">' + t('stage.trimTo') + '<input id="tTo" inputmode="decimal" value="' + (L0 * f / 1000).toFixed(2) + '"></label></div>' +
      '<button id="tApply">' + t('stage.trimApply') + '</button><p class="note">' + t('stage.trimNote') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.tsdTitle') + '</h3>' +
      '<table class="tsd-table"><thead><tr><th>' + t('stage.tsdFrom') + '</th><th>km/h</th><th></th></tr></thead><tbody>' + tsdRows + '</tbody></table>' +
      '<button id="tsdAdd">' + t('stage.tsdAdd') + '</button><p class="note">' + t('stage.tsdNote') + '</p></div>' +

      '<div class="group"><h3>Overview</h3><button id="sOverview">' + t('ov.png') + '</button><p class="note">' + t('ov.note') + '</p></div>' +
      '<div class="group"><button id="sDel" class="danger-btn">' + t('stage.delete') + '</button></div>';

    $('sName').onchange = function () { st.name = this.value.trim() || st.name; save(); renderStageSel(); };
    $('sSection').onchange = function () { st.section = this.value.trim(); save(); };
    $('sOverview').onclick = exportOverviewPng;
    $('sLeg').onchange = function () { st.leg = this.value.trim(); save(); };
    el.querySelectorAll('[data-kind]').forEach(function (b) { b.onclick = function () { st.kind = b.dataset.kind; save(); drawTracks(); renderStagePanel(); }; });
    $('sSplit').onclick = function () { autoSplit(st); };
    $('sFac').onchange = function () {
      var v = parseFloat(this.value); if (!(v > 0.8 && v < 1.2)) { toast(t('err.factorRange')); this.value = f.toFixed(4); return; }
      st.factor = v; save(); renderAll();
    };
    $('cApply').onclick = function () {
      var g = parseFloat($('cGps').value) || L0 / 1000, o = parseFloat($('cOdo').value);
      if (!(o > 0 && g > 0)) return toast(t('err.needOdo'));
      var v = o / g; if (!(v > 0.8 && v < 1.2)) return toast(t('err.calOff'));
      st.factor = +v.toFixed(4); save(); renderAll(); toast(t('toast.factor', { f: st.factor.toFixed(4) }));
    };
    $('sDetect').onclick = function () {
      var have = pts(st);
      S.suggest = RB.detectTurns(st.track, cumOf(st), { threshold: +$('sThr').value }).filter(function (s) { return !have.some(function (p) { return Math.abs(p.d - s.d) < 40; }); });
      drawSuggest(); $('sDetNote').textContent = t('stage.detFound', { n: S.suggest.length });
    };
    $('sClear').onclick = function () { S.suggest = []; drawSuggest(); };
    $('sAddAll').onclick = function () {
      if (!S.suggest.length) return toast(t('err.detFirst'));
      ask({ title: t('confirm.addAll', { n: S.suggest.length }), ok: t('common.add') }).then(function (ok) {
        if (!ok) return;
        S.suggest.forEach(function (s) { st.points.push(newPointAt(st, s.d, s.angle, 'TULIP')); });
        S.suggest = []; save(); renderAll(); toast(t('toast.addedCheck'), 4000);
      });
    };
    $('tApply').onclick = function () {
      var a = parseFloat($('tFrom').value) * 1000 / f, b = parseFloat($('tTo').value) * 1000 / f;
      if (!(isFinite(a) && isFinite(b) && b - a > 20)) return toast(t('err.trimRange'));
      var drop = st.points.filter(function (p) { return p.d < a - 0.5 || p.d > b + 0.5; }).length;
      ask({ title: t('confirm.trimTitle'), body: t('confirm.trim', { a: (a * f / 1000).toFixed(3), b: (b * f / 1000).toFixed(3), n: drop }), ok: t('stage.trimApply'), danger: drop > 0 }).then(function (ok) {
        if (!ok) return;
        var r = RB.trimStage(st, a, b); st.track = r.track; st.points = r.points;
        S.suggest = []; navResetMatch(); save(); renderAll(); fitStage(); toast(t('toast.trimmed'));
      });
    };
    el.querySelectorAll('[data-tsd]').forEach(function (inp) {
      inp.onchange = function () { var v = parseFloat(inp.value); if (isFinite(v)) { st.tsd[+inp.dataset.tsd][inp.dataset.k] = v; save(); } };
    });
    el.querySelectorAll('[data-tsddel]').forEach(function (b) { b.onclick = function () { st.tsd.splice(+b.dataset.tsddel, 1); save(); renderStagePanel(); }; });
    $('tsdAdd').onclick = function () {
      st.tsd = st.tsd || []; var last = st.tsd[st.tsd.length - 1];
      st.tsd.push({ fromKm: last ? +(last.fromKm + 1).toFixed(2) : 0, kmh: last ? last.kmh : 40 }); save(); renderStagePanel();
    };
    $('sDel').onclick = function () {
      ask({ title: t('confirm.delStageTitle', { name: st.name }), body: t('confirm.delStage', { n: st.points.length }), ok: t('common.delete'), danger: true }).then(function (ok) {
        if (!ok) return;
        P.stages = P.stages.filter(function (x) { return x !== st; }); S.stageId = P.stages[0] ? P.stages[0].id : null; save(); renderAll(); fitStage();
      });
    };
  }

  // ---------- Point dialog ----------
  var D = null, Dorig = null, Dnew = false, DautoCode = false;
  function buildDlgLabels() {
    $('ptTypes').innerHTML = TYPES.map(function (k) { return '<button type="button" data-type="' + k + '">' + typeName(k) + '</button>'; }).join('');
    $('ptPresets').innerHTML = RB.PRESETS.map(function (p) { return '<button type="button" data-a="' + p.a + '" title="' + (LANG === 'th' ? p.th : p.en) + '">' + RB.tulipSVG(p.a, [], { size: 40, stroke: 7 }) + '</button>'; }).join('') +
      '<button type="button" data-a="none" title="' + t('pt.noArrow') + '">' + RB.tulipSVG(null, [], { size: 40, stroke: 7 }) + '</button>';
    $('ptBranches').innerHTML = BRANCH_SET.map(function (a) { return '<button type="button" data-b="' + a + '" aria-label="' + a + '°">' + RB.tulipSVG(null, [a], { size: 28, stroke: 7 }) + '</button>'; }).join('');
    var groups = [['ctrl', t('sym.gCtrl')], ['road', t('sym.gRoad')], ['mark', t('sym.gMark')]];
    $('ptSyms').innerHTML = groups.map(function (g) {
      return '<h4>' + g[1] + '</h4><div class="symgrid">' + RBS.LIST.filter(function (x) { return x.g === g[0]; }).map(function (x) {
        return '<button type="button" data-sym="' + x.id + '" aria-pressed="false">' + RBS.svg(x.id, 32) + '<span>' + RB.esc(LANG === 'th' ? x.th : x.en) + '</span></button>';
      }).join('') + '</div>';
    }).join('');
    if (D) syncDlg();
  }
  (function wireDlg() {
    $('ptTypes').onclick = function (e) {
      var b = e.target.closest('[data-type]'); if (!b) return;
      D.type = b.dataset.type;
      if (RB.isControl(D) && (!D.code || DautoCode)) { D.code = RB.suggestCode(stage().points, D); DautoCode = true; }
      if (!RB.isControl(D) && DautoCode) { D.code = ''; }
      syncDlg();
    };
    $('ptDanger').onclick = function (e) { var b = e.target.closest('[data-lv]'); if (b) { D.danger = +b.dataset.lv; syncDlg(); } };
    $('ptPresets').onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b) return;
      var oldPre = RB.nearestPreset(D.angle);
      D.angle = b.dataset.a === 'none' ? null : +b.dataset.a;
      var pre = RB.nearestPreset(D.angle);
      if (pre && (!D.th || (oldPre && D.th === oldPre.th))) D.th = pre.th;
      if (pre && (!D.en || (oldPre && D.en === oldPre.en))) D.en = pre.en;
      syncDlg();
    };
    $('ptAngle').oninput = function () { D.angle = +this.value; syncDlg(true); };
    $('ptRound').onclick = function () { D.round = !D.round; syncDlg(); };
    $('ptCurve').onclick = function (e) {
      var b = e.target.closest('[data-curve]'); if (!b) return;
      D.curve = b.dataset.curve;
      if (D.curve === 'gps') { refreshShape(stage(), D, (D.shape && D.shape.len) || 200); if (D.curve !== 'gps') toast(t('pt.shapeNone')); }
      syncDlg();
    };
    $('ptShapeLen').onclick = function (e) { var b = e.target.closest('[data-slen]'); if (b) { refreshShape(stage(), D, +b.dataset.slen); syncDlg(); } };
    $('ptLead').onclick = function (e) { var b = e.target.closest('[data-lead]'); if (!b) return; if (b.dataset.lead === 'auto') delete D.lead; else D.lead = +b.dataset.lead; syncDlg(); };
    $('ptSplit').onclick = function () { splitAt(stage(), D.d); };
    $('ptRoad').onclick = function (e) { var b = e.target.closest('[data-road]'); if (b) { D.road = b.dataset.road; syncDlg(); } };
    $('ptSyms').onclick = function (e) {
      var b = e.target.closest('[data-sym]'); if (!b) return;
      var a = D.sym = (D.sym || []).slice(), i = a.indexOf(b.dataset.sym);
      if (i >= 0) a.splice(i, 1); else a.push(b.dataset.sym);
      syncDlg();
    };
    $('ptBranches').onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return; var a = +b.dataset.b, i = D.branches.indexOf(a);
      if (i >= 0) D.branches.splice(i, 1); else D.branches.push(a); syncDlg();
    };
    document.querySelectorAll('[data-nudge]').forEach(function (b) {
      b.onclick = function () {
        var st = stage(), f = fac(st), nd = Math.max(0, Math.min(lenOf(st), D.d + (+b.dataset.nudge) / f));
        var p = RB.pointAt(st.track, cumOf(st), nd); D.d = nd; D.lat = p[0]; D.lon = p[1]; refreshShape(st, D); syncDlg(); showDraft();
      };
    });
    var fmap = { ptTh: 'th', ptEn: 'en', ptNote: 'note', ptCode: 'code', ptTime: 'time', ptPlace: 'place' };
    Object.keys(fmap).forEach(function (id) {
      $(id).oninput = function () { D[fmap[id]] = id === 'ptCode' ? this.value.toUpperCase() : this.value; if (id === 'ptCode') DautoCode = false; };
      $(id).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
    });
    $('ptSave').onclick = function () {
      var st = stage();
      D.code = (D.code || '').trim();
      if (!D.photos || !D.photos.length) delete D.photos;
      if (D.curve !== 'gps') delete D.shape;
      if (Dnew) st.points.push(D); else { if (!D.photos) delete Dorig.photos; if (typeof D.lead !== 'number') delete Dorig.lead; if (!D.shape) delete Dorig.shape; Object.assign(Dorig, D); }
      S.sel = D.id; save(); $('ptDlg').close(); renderAll();
    };
    $('ptDel').onclick = function () {
      var st = stage(), id = D.id;
      var go = function () { st.points = st.points.filter(function (p) { return p.id !== id; }); S.sel = null; save(); if ($('ptDlg').open) $('ptDlg').close(); renderAll(); };
      if (Dnew) return go();
      ask({ title: t('confirm.delPoint'), ok: t('common.delete'), danger: true }).then(function (ok) { if (ok) go(); });
    };
    $('ptDlg').addEventListener('close', function () { if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; } D = null; gcPhotos(); });
  })();
  function openPoint(p, isNew) {
    Dorig = p; Dnew = isNew; D = JSON.parse(JSON.stringify(p)); D.branches = D.branches || []; D.code = D.code || ''; D.time = D.time || '';
    DautoCode = isNew && !!D.code;
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || ''; $('ptNote').value = D.note || ''; $('ptPlace').value = D.place || '';
    $('ptDel').textContent = isNew ? t('pt.discard') : t('pt.delete');
    $('ptSplit').hidden = isNew;
    $('ptSymWrap').open = !!(D.sym && D.sym.length);
    D.photos = D.photos || []; renderPtPhotos();
    syncDlg(); showDraft(); $('ptDlg').showModal();
  }
  function showDraft() {
    if (draftMarker) map.removeLayer(draftMarker);
    draftMarker = L.circleMarker([D.lat, D.lon], { radius: 9, color: '#D0021B', weight: 3, fillOpacity: 0 }).addTo(map);
    if (!map.getBounds().pad(-0.1).contains(draftMarker.getLatLng())) map.panTo(draftMarker.getLatLng());
  }
  function syncDlg(fromSlider) {
    var st = stage(); if (!D || !st) return;
    $('ptKm').textContent = fmtKm(D.d * fac(st) / 1000);
    document.querySelectorAll('#ptTypes [data-type]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.type === D.type); });
    $('ptCtrl').hidden = !RB.isControl(D);
    $('ptCode').value = D.code || ''; $('ptTime').value = D.time || '';
    $('ptDanger').hidden = D.type !== 'DANGER';
    document.querySelectorAll('#ptDanger [data-lv]').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.lv === (D.danger || 1)); });
    document.querySelectorAll('#ptPresets [data-a]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.a === 'none' ? D.angle == null : +b.dataset.a === D.angle); });
    document.querySelectorAll('#ptBranches [data-b]').forEach(function (b) { b.setAttribute('aria-pressed', D.branches.indexOf(+b.dataset.b) >= 0); });
    if (!fromSlider) $('ptAngle').value = D.angle == null ? 0 : D.angle;
    $('ptAngleOut').textContent = D.angle == null ? t('pt.none') : (D.angle > 0 ? '+' : '') + D.angle + '°';
    $('ptPreview').innerHTML = RB.tulipOf(D, { size: 110, ink: '#000' });
    $('ptRound').setAttribute('aria-pressed', !!D.round);
    var cv = D.curve || 'sharp';
    document.querySelectorAll('#ptCurve [data-curve]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.curve === cv); });
    $('ptShapeLen').hidden = cv !== 'gps';
    document.querySelectorAll('#ptShapeLen [data-slen]').forEach(function (b) { b.setAttribute('aria-pressed', !!D.shape && +b.dataset.slen === D.shape.len); });
    document.querySelectorAll('#ptLead [data-lead]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.lead === 'auto' ? typeof D.lead !== 'number' : +b.dataset.lead === D.lead); });
    document.querySelectorAll('#ptRoad [data-road]').forEach(function (b) { b.setAttribute('aria-pressed', (D.road || 'tarmac') === b.dataset.road); });
    var sy = D.sym || [];
    document.querySelectorAll('#ptSyms [data-sym]').forEach(function (b) { b.setAttribute('aria-pressed', sy.indexOf(b.dataset.sym) >= 0); });
    $('ptSymCount').textContent = sy.length ? '(' + sy.length + ')' : '';
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || '';
  }

  // ---------- Photos (stored on this phone in IndexedDB; points keep only { id, book }) ----------
  var PH_MAX = 3, phBusy = 0, gcT = null;
  function phList(p) { return (p && p.photos) || []; }
  function livePhotoIds(onlyProject) {
    var a = [], seen = {};
    var add = function (id) { if (id && !seen[id]) { seen[id] = 1; a.push(id); } };
    P.stages.forEach(function (st) { (st.points || []).forEach(function (p) { phList(p).forEach(function (x) { add(x.id); }); }); });
    if (!onlyProject) {
      if (typeof R !== 'undefined' && R) (R.marks || []).forEach(function (m) { (m.photos || []).forEach(add); });
      if (D) phList(D).forEach(function (x) { add(x.id); });
    }
    return a;
  }
  // forget pictures nothing points to any more (deleted points, discarded recce, cancelled edits)
  function gcPhotos() {
    clearTimeout(gcT);
    gcT = setTimeout(function () { if (phBusy) return gcPhotos(); RBP.gc(livePhotoIds()); }, 2000);
  }
  function instrText(p) { var a = LANG === 'th' ? [p.th, p.en] : [p.en, p.th]; return a[0] || a[1] || ''; }
  function photoCaption(st, p) {
    var ps = pts(st), i = ps.map(function (q) { return q.id; }).indexOf(p.id), km = fmtKm(p.d * fac(st) / 1000, CFG.navDec) + ' km', txt = instrText(p);
    if (RB.isControl(p)) return [(p.code || p.type), p.place || txt, p.time, km].filter(Boolean).join('  ·  ');
    return [i >= 0 ? t('ph.box', { n: i + 1 }) : '', km, txt].filter(Boolean).join('  ·  ');
  }
  function thumbsHTML(p) {
    var a = phList(p);
    return a.length ? '<span class="rb-ph">' + a.map(function (x) { return '<img data-ph="' + x.id + '" class="' + (x.book ? '' : 'off') + '" alt="">'; }).join('') + '</span>' : '';
  }
  function fillImgs(root) {
    root.querySelectorAll('img[data-ph]').forEach(function (img) {
      RBP.url(img.dataset.ph).then(function (u) { if (u) img.src = u; else img.alt = '?'; });
    });
  }
  function openPhoto(id, cap) {
    RBP.url(id).then(function (u) {
      if (!u) return toast(t('ph.missing'), 4000);
      $('phImg').src = u; $('phCap').textContent = cap || ''; $('phDlg').showModal();
    });
  }
  $('phImg').onclick = function () { $('phDlg').close(); };
  function renderPtPhotos() {
    if (!D) return;
    var a = D.photos || [];
    $('ptPhCount').textContent = a.length ? '(' + a.length + '/' + PH_MAX + ')' : '';
    $('ptPhList').innerHTML = a.map(function (x, i) {
      return '<div class="ph"><img data-ph="' + x.id + '" alt="">' +
        '<div class="ph-ctl"><button type="button" data-book="' + i + '" aria-pressed="' + !!x.book + '">' + t('ph.book') + '</button>' +
        '<button type="button" class="danger-btn" data-phdel="' + i + '" aria-label="' + t('common.delete') + '">×</button></div></div>';
    }).join('');
    $('ptPhBtns').hidden = a.length >= PH_MAX;
    fillImgs($('ptPhList'));
  }
  $('ptPhList').onclick = function (e) {
    if (!D) return;
    var b = e.target.closest('[data-book]'), x = e.target.closest('[data-phdel]'), im = e.target.closest('img[data-ph]');
    if (b) { var ph = D.photos[+b.dataset.book]; ph.book = !ph.book; renderPtPhotos(); }
    else if (x) { D.photos.splice(+x.dataset.phdel, 1); renderPtPhotos(); }
    else if (im) { var st = stage(); openPhoto(im.dataset.ph, st ? photoCaption(st, D) : ''); }
  };
  function addPtFiles(files) {
    if (!D || !files.length) return;
    var room = PH_MAX - D.photos.length, list = files.slice(0, Math.max(0, room)), target = D;
    if (files.length > room) toast(t('ph.max', { n: PH_MAX }), 3500);
    if (!list.length) return;
    phBusy++; toast(t('ph.saving'), 20000);
    list.reduce(function (pr, f) {
      return pr.then(function () {
        return RBP.add(f).then(function (rec) {
          if (D !== target) return; // dialog was closed meanwhile; the picture is cleaned up later
          D.photos.push({ id: rec.id, book: RB.isControl(D) }); renderPtPhotos();
        });
      });
    }, Promise.resolve()).then(function () { toast(t('ph.added'), 1500); })
      .catch(function () { toast(t('ph.fail'), 5000); })
      .then(function () { phBusy--; });
  }
  $('inPhCam').onchange = function () { addPtFiles([].slice.call(this.files)); this.value = ''; };
  $('inPhGal').onchange = function () { addPtFiles([].slice.call(this.files)); this.value = ''; };

  // pictures from the gallery that carry a GPS position go to the nearest roadbook point
  $('inPhGps').onchange = function () { var f = [].slice.call(this.files); this.value = ''; importGeoPhotos(f); };
  function importGeoPhotos(files) {
    if (!files.length) return;
    if (!P.stages.length) return toast(t('err.noStage'));
    var res = { att: 0, made: 0, noGps: 0, far: 0, fail: 0 }, loose = [], i = 0;
    phBusy++; toast(t('ph.importing', { n: files.length }), 60000);
    function next() {
      if (i >= files.length) return Promise.resolve();
      var f = files[i++];
      return RBP.add(f).then(function (rec) {
        if (rec.lat == null) { res.noGps++; return RBP.del(rec.id); }
        var best = null;
        P.stages.forEach(function (st) {
          if (!st.track || st.track.length < 2) return;
          var r = RB.project(st.track, cumOf(st), rec.lat, rec.lon);
          if (r && (!best || r.off < best.r.off)) best = { st: st, r: r };
        });
        if (!best || best.r.off > 300) { res.far++; return RBP.del(rec.id); }
        var near = null;
        best.st.points.forEach(function (p) { var dd = Math.abs(p.d - best.r.d); if (dd <= 50 && phList(p).length < PH_MAX && (!near || dd < near.dd)) near = { p: p, dd: dd }; });
        if (near) { near.p.photos = phList(near.p).concat([{ id: rec.id, book: RB.isControl(near.p) }]); res.att++; return; }
        loose.push({ st: best.st, d: best.r.d, id: rec.id });
      }).catch(function () { res.fail++; }).then(next);
    }
    next().then(function () {
      if (!loose.length) return;
      return ask({ title: t('ph.looseTitle', { n: loose.length }), body: t('ph.looseBody'), ok: t('ph.looseOk') }).then(function (ok) {
        if (!ok) return;
        var made = [];
        loose.forEach(function (x) {
          var p = made.filter(function (q) { return q.st === x.st && Math.abs(q.p.d - x.d) <= 50 && q.p.photos.length < PH_MAX; })[0];
          if (p) { p.p.photos.push({ id: x.id, book: false }); return; }
          var np = newPointAt(x.st, x.d, null, 'INFO'); np.th = ''; np.en = ''; np.angle = null; np.photos = [{ id: x.id, book: false }];
          x.st.points.push(np); made.push({ st: x.st, p: np }); res.made++;
        });
        res.att += loose.length;
      });
    }).then(function () {
      phBusy--; save(); renderAll();
      toast(t('ph.importDone', { a: res.att, b: res.made, c: res.noGps, d: res.far }), 7000);
    });
  }

  // ---------- Draw route ----------
  function drawStart() {
    if (S.mode !== 'org') setMode('org');
    setAdd(false); S.suggest = []; drawSuggest();
    S.draw = { wps: [], segs: [], snap: CFG.drawSnap !== false, warned: false };
    $('drawBar').hidden = false; $('fDraw').hidden = true; $('fAdd').hidden = true; $('fFilter').hidden = true;
    gPins.clearLayers(); map.getContainer().style.cursor = 'crosshair';
    drawRender();
  }
  function drawEnd() {
    S.draw = null; gDraw.clearLayers();
    $('drawBar').hidden = true; $('fDraw').hidden = false; $('fAdd').hidden = false; $('fFilter').hidden = false;
    map.getContainer().style.cursor = ''; drawPins();
  }
  function drawCancel(then) {
    var fin = function () { drawEnd(); if (typeof then === 'function') then(); };
    if (!S.draw || S.draw.wps.length < 2) return fin();
    ask({ title: t('confirm.drawCancel'), ok: t('confirm.drawDiscard'), cancel: t('confirm.drawKeep'), danger: true }).then(function (ok) { if (ok) fin(); });
  }
  $('fDraw').onclick = drawStart;
  $('dCancel').onclick = function () { drawCancel(); };
  $('dSnap').onclick = function () { if (S.draw) { S.draw.snap = true; drawRender(); } };
  $('dLine').onclick = function () { if (S.draw) { S.draw.snap = false; drawRender(); } };
  $('dUndo').onclick = function () { var d = S.draw; if (!d || !d.wps.length) return; d.wps.pop(); d.segs.pop(); drawRender(); };
  $('dDone').onclick = function () {
    var d = S.draw; if (!d) return;
    if (d.segs.some(function (s) { return s.busy; })) return toast(t('draw.wait'));
    var track = drawTrack();
    if (track.length < 2) return toast(t('err.drawShort'));
    var len = 0; for (var k = 1; k < track.length; k++) len += RB.hav(track[k - 1], track[k]);
    ask({ title: t('draw.saveTitle'), body: t('draw.saveBody', { km: (len / 1000).toFixed(3), n: d.wps.length }), input: nextStageName(), label: t('prompt.stageName'), ok: t('fin.create') }).then(function (name) {
      if (name == null || !S.draw) return;
      var st = addStage(name.trim() || nextStageName(), RB.cleanTrack(track, 1));
      drawEnd(); selectStage(st.id, true); toast(t('toast.stageCreated', { name: st.name, km: (lenOf(st) / 1000).toFixed(3) }), 3500);
    });
  };
  function drawTrack() {
    var d = S.draw, out = [];
    if (!d || !d.wps.length) return out;
    out.push([d.wps[0].lat, d.wps[0].lon]);
    d.segs.forEach(function (s) { (s.pts || []).slice(1).forEach(function (p) { out.push(p); }); });
    return out;
  }
  function straight(a, b) { return [[a.lat, a.lon], [b.lat, b.lon]]; }
  function routeSeg(i) {
    var d = S.draw, a = d.wps[i], b = d.wps[i + 1], seg = d.segs[i];
    if (!a || !b || !seg) return;
    seg.pts = straight(a, b);
    if (!b.snap) { seg.busy = false; drawRender(); return; }
    seg.busy = true; var token = seg.token = uid();
    var ctrl = window.AbortController ? new AbortController() : null;
    var to = setTimeout(function () { if (ctrl) ctrl.abort(); }, 9000);
    fetch(OSRM + a.lon + ',' + a.lat + ';' + b.lon + ',' + b.lat + '?overview=full&geometries=geojson', ctrl ? { signal: ctrl.signal } : {})
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (j) {
        if (!S.draw || seg.token !== token) return;
        var g = j.routes && j.routes[0] && j.routes[0].geometry;
        if (!g || g.coordinates.length < 2) throw new Error('noroute');
        var p = g.coordinates.map(function (c) { return [c[1], c[0]]; });
        p[0] = [a.lat, a.lon]; p[p.length - 1] = [b.lat, b.lon];
        // snapped route that wanders far beyond a straight hop usually means "no road here"
        var direct = RB.hav([a.lat, a.lon], [b.lat, b.lon]), routed = j.routes[0].distance;
        if (direct > 50 && routed > direct * 4 + 1500) { seg.far = true; }
        seg.pts = p;
      })
      .catch(function () {
        if (!S.draw || seg.token !== token) return;
        seg.failed = true;
        if (!S.draw.warned) { S.draw.warned = true; toast(t('draw.snapFail'), 4500); }
      })
      .then(function () { clearTimeout(to); if (S.draw && seg.token === token) { seg.busy = false; drawRender(); } });
  }
  function drawAdd(lat, lon) {
    var d = S.draw; d.wps.push({ lat: lat, lon: lon, snap: d.snap });
    if (d.wps.length > 1) { d.segs.push({ pts: null }); routeSeg(d.wps.length - 2); }
    drawRender();
  }
  function drawRender() {
    var d = S.draw; if (!d) return;
    $('dSnap').setAttribute('aria-pressed', d.snap); $('dLine').setAttribute('aria-pressed', !d.snap);
    gDraw.clearLayers();
    d.segs.forEach(function (s, i) {
      if (!s.pts) return;
      var b = d.wps[i + 1];
      L.polyline(s.pts, { color: '#fff', weight: 8, opacity: .9, interactive: false }).addTo(gDraw);
      L.polyline(s.pts, { color: s.failed || s.far ? '#D0021B' : '#0050B3', weight: 4, dashArray: b.snap && !s.failed ? null : '8 6', opacity: s.busy ? .5 : 1, interactive: false }).addTo(gDraw);
    });
    d.wps.forEach(function (w, i) {
      var m = L.marker([w.lat, w.lon], { draggable: true, icon: L.divIcon({ className: '', html: '<div class="wp' + (i === 0 ? ' first' : '') + '">' + (i === 0 ? 'S' : i) + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }) }).addTo(gDraw);
      m.on('dragend', function () {
        var ll = m.getLatLng(); w.lat = ll.lat; w.lon = ll.lng;
        if (i > 0) routeSeg(i - 1); if (i < d.segs.length) routeSeg(i);
        drawRender();
      });
    });
    var tr = drawTrack(), len = 0;
    for (var k = 1; k < tr.length; k++) len += RB.hav(tr[k - 1], tr[k]);
    $('drawKm').textContent = (len / 1000).toFixed(2) + ' km';
    var bad = d.segs.some(function (s) { return s.failed || s.far; });
    $('drawMsg').textContent = d.segs.some(function (s) { return s.busy; }) ? t('draw.routing') : bad ? t('draw.checkRed') : d.wps.length ? t('draw.hintMore') : t('draw.hint');
  }

  // ---------- Files ----------
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]+/g, '_').trim() || 'roadbook'; }
  function guessType(name) {
    var n = (name || '').toUpperCase();
    if (/FINISH|\bFIN\b|STOP/.test(n)) return 'FINISH';
    if (/START/.test(n)) return 'START';
    if (/\bTC/.test(n)) return 'TC'; if (/\bPC/.test(n)) return 'PC'; if (/\bCP/.test(n)) return 'CP';
    if (/DANGER|!/.test(n)) return 'DANGER';
    return 'INFO';
  }
  function importGpxText(text, fname) {
    var g = RB.parseGPX(text), added = 0, wadd = 0, firstId = null;
    g.tracks.forEach(function (tk, i) {
      var tr = RB.cleanTrack(tk.pts, 2); if (tr.length < 2) return;
      var st = addStage(tk.name || (fname.replace(/\.gpx$/i, '') + (g.tracks.length > 1 ? ' ' + (i + 1) : '')), tr);
      var cum = cumOf(st);
      g.waypoints.forEach(function (w) {
        var r = RB.project(tr, cum, w.lat, w.lon);
        if (r.off > 40) return;
        var ty = guessType(w.name), an = RB.angleAt(tr, cum, r.d, 30);
        an = ty === 'START' ? null : Math.abs(an) < 12 ? 0 : Math.round(an / 5) * 5;
        var m = /\b(TC|PC|CP)\s*\d+[A-Z]?/i.exec(w.name || '');
        st.points.push({ id: uid(), d: r.d, lat: r.lat, lon: r.lon, type: ty, danger: 1, angle: an, branches: [], th: w.name || '', en: '', note: '', code: m ? m[0].replace(/\s+/g, '').toUpperCase() : (ty === 'START' || ty === 'FINISH' ? ty : ''), time: '' });
        wadd++;
      });
      added++; if (!firstId) firstId = st.id;
    });
    return { added: added, wadd: wadd, firstId: firstId };
  }
  function importGpxFiles(files) {
    var list = Array.prototype.slice.call(files || []), tot = 0, wt = 0, first = null, done = 0;
    if (!list.length) return;
    list.forEach(function (f) {
      var fr = new FileReader();
      fr.onload = function () {
        try { var r = importGpxText(fr.result, f.name); tot += r.added; wt += r.wadd; first = first || r.firstId; }
        catch (e) { toast(t('err.readFile', { f: f.name })); }
        if (++done === list.length) {
          if (!tot) return toast(t('err.noTrack'), 4000);
          save(); selectStage(first, true);
          toast(t('toast.imported', { n: tot }) + (wt ? t('toast.importedWpt', { n: wt }) : ''), 3500);
        }
      };
      fr.readAsText(f);
    });
  }
  $('inGpx').onchange = function () { importGpxFiles(this.files); this.value = ''; };
  $('inJson').onchange = function () {
    var f = this.files[0]; this.value = ''; if (!f) return;
    var fr = new FileReader();
    fr.onload = function () {
      try {
        openProjectText(fr.result, f.name);
      } catch (e) { toast(t('err.notProject')); }
    };
    fr.readAsText(f);
  };
  function backupJson(withPh) {
    var d = new Date(), day = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    var done = function () { META.dirtySince = null; META.backupAt = Date.now(); saveMeta(); };
    if (withPh !== true) { download(safeName(P.name) + '_' + day + '.json', JSON.stringify(P), 'application/json'); done(); return Promise.resolve(); }
    var ids = livePhotoIds(true);
    if (!ids.length) { toast(t('ph.noneToPack')); return backupJson(false); }
    toast(t('ph.packing', { n: ids.length }), 60000);
    return Promise.all(ids.map(function (id) { return RBP.b64(id).then(function (x) { return x ? [id, { b64: x.b64, w: x.w, h: x.h }] : null; }).catch(function () { return null; }); }))
      .then(function (list) {
        var o = Object.assign({}, P, { photoData: {} }), n = 0;
        list.forEach(function (e) { if (e) { o.photoData[e[0]] = e[1]; n++; } });
        download(safeName(P.name) + '_' + day + '_photos.json', JSON.stringify(o), 'application/json'); done();
        toast(t('ph.packed', { n: n }), 4000);
      }).catch(function () { toast(t('ph.fail'), 5000); });
  }
  $('bSaveJson').onclick = function () { backupJson(false); };
  $('bSaveJsonPh').onclick = function () { backupJson(true); };
  function openProjectText(text, fname) {
    var o = JSON.parse(text); if (!o || !Array.isArray(o.stages)) throw 0;
    var pd = o.photoData || null; delete o.photoData;
    var apply = function () {
      if (!pd) return apply2();
      var ids = Object.keys(pd); phBusy++;
      toast(t('ph.unpacking', { n: ids.length }), 60000);
      Promise.all(ids.map(function (id) { return RBP.fromB64(id, pd[id].b64, { w: pd[id].w, h: pd[id].h, t: Date.now() }).catch(function () {}); }))
        .then(function () { phBusy--; apply2(); });
    };
    var apply2 = function () { P = o; S.stageId = P.stages[0] ? P.stages[0].id : null; save(); META.dirtySince = null; saveMeta(); renderAll(); fitStage(); toast(t('toast.opened', { name: P.name || fname })); };
    if (!P.stages.length) return apply();
    ask({ title: t('confirm.replaceTitle'), body: t('confirm.replace', { name: o.name || fname, cur: P.name, n: P.stages.length }), ok: t('confirm.replaceOk'), danger: true }).then(function (ok) { if (ok) apply(); });
  }
  $('bCsv').onclick = function () {
    if (!P.stages.length) return toast(t('err.noStage'));
    var body = P.stages.map(function (st, i) { var c = RB.stageCSV(st); return i ? c.split('\r\n').slice(1).join('\r\n') : c; }).join('\r\n');
    download(safeName(P.name) + '_roadbook.csv', '﻿' + body, 'text/csv;charset=utf-8');
  };
  // ---------- Event info & logos (per project; logos also kept in a library on this device) ----------
  var LOGO_KEY = 'rb.logos.v1', MAX_LOGOS = 5;
  function ev() { P.event = P.event || { title: '', date: '', place: '', logos: [] }; P.event.logos = P.event.logos || []; return P.event; }
  function logoLib() { try { return JSON.parse(store.getItem(LOGO_KEY) || '[]'); } catch (e) { return []; } }
  function saveLogoLib(a) { try { store.setItem(LOGO_KEY, JSON.stringify(a.slice(0, 20))); return true; } catch (e) { toast(t('err.storageFull'), 5000); return false; } }
  function shrinkImage(file) { // keep logos small: longest side 400 px, PNG keeps transparency
    return new Promise(function (ok, bad) {
      var fr = new FileReader();
      fr.onload = function () {
        var im = new Image();
        im.onload = function () {
          var k = Math.min(1, 400 / Math.max(im.width || 400, im.height || 400)), w = Math.max(1, Math.round((im.width || 400) * k)), h = Math.max(1, Math.round((im.height || 400) * k));
          var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
          ok(c.toDataURL('image/png'));
        };
        im.onerror = bad; im.src = fr.result;
      };
      fr.onerror = bad; fr.readAsDataURL(file);
    });
  }
  function renderEvent() {
    var e = ev();
    $('evTitle').value = e.title || ''; $('evDate').value = e.date || ''; $('evPlace').value = e.place || '';
    $('evLogos').innerHTML = e.logos.length ? e.logos.map(function (src, i) {
      return '<div class="logo"><img src="' + src + '" alt=""><div class="lbtns">' +
        '<button type="button" data-lmove="' + i + '" data-dir="-1" aria-label="←"' + (i ? '' : ' disabled') + '>←</button>' +
        '<button type="button" data-lmove="' + i + '" data-dir="1" aria-label="→"' + (i < e.logos.length - 1 ? '' : ' disabled') + '>→</button>' +
        '<button type="button" data-ldel="' + i + '" aria-label="' + t('common.delete') + '">✕</button></div></div>';
    }).join('') : '<span class="empty-note">' + t('ev.noLogos') + '</span>';
    var lib = logoLib();
    $('logoLib').innerHTML = lib.length ? lib.map(function (src, i) {
      return '<div class="logo" data-lpick="' + i + '"><img src="' + src + '" alt=""><div class="lbtns"><button type="button" data-lrm="' + i + '">' + t('ev.libRemove') + '</button></div></div>';
    }).join('') : '<span class="empty-note">' + t('ev.libEmpty') + '</span>';
  }
  ['evTitle', 'evDate', 'evPlace'].forEach(function (id) {
    $(id).onchange = function () { ev()[{ evTitle: 'title', evDate: 'date', evPlace: 'place' }[id]] = this.value.trim(); save(); };
  });
  $('inLogo').onchange = function () {
    var files = Array.prototype.slice.call(this.files || []); this.value = '';
    var e = ev(), room = MAX_LOGOS - e.logos.length;
    if (room <= 0) return toast(t('ev.max', { n: MAX_LOGOS }));
    Promise.all(files.slice(0, room).map(shrinkImage)).then(function (list) {
      var lib = logoLib();
      list.forEach(function (d) { e.logos.push(d); if (lib.indexOf(d) < 0) lib.unshift(d); });
      saveLogoLib(lib); save(); renderEvent();
    }).catch(function () { toast(t('ev.badImage')); });
  };
  $('evLogos').onclick = function (x) {
    var e = ev(), b = x.target.closest('button'); if (!b) return;
    if (b.dataset.ldel != null) { e.logos.splice(+b.dataset.ldel, 1); }
    else if (b.dataset.lmove != null) { var i = +b.dataset.lmove, j = i + (+b.dataset.dir), tmp = e.logos[i]; e.logos[i] = e.logos[j]; e.logos[j] = tmp; }
    save(); renderEvent();
  };
  $('bLogoLib').onclick = function () { var open = $('logoLib').hidden; $('logoLib').hidden = !open; this.setAttribute('aria-expanded', open); renderEvent(); };
  $('logoLib').onclick = function (x) {
    var lib = logoLib(), rm = x.target.closest('[data-lrm]');
    if (rm) { x.stopPropagation(); lib.splice(+rm.dataset.lrm, 1); saveLogoLib(lib); return renderEvent(); }
    var pk = x.target.closest('[data-lpick]'); if (!pk) return;
    var e = ev(), d = lib[+pk.dataset.lpick];
    if (e.logos.indexOf(d) >= 0) return toast(t('ev.already'));
    if (e.logos.length >= MAX_LOGOS) return toast(t('ev.max', { n: MAX_LOGOS }));
    e.logos.push(d); save(); renderEvent();
  };

  // ---------- Stage overview picture ----------
  function overviewLabels(st) {
    var f = fac(st);
    return pts(st).filter(RB.isControl).map(function (p) {
      return { lat: p.lat, lon: p.lon, title: p.code || p.type, sub: fmtKm(p.d * f / 1000, CFG.navDec) + ' km', kind: p.type };
    });
  }
  function renderOverview(st, w, h) {
    var i = P.stages.indexOf(st), extra = [P.stages[i - 1], P.stages[i + 1]].filter(function (x) { return x && kindOf(x) === 'liaison'; })
      .map(function (x) { return { track: x.track, color: stageColor(x) }; });
    var opts = { track: st.track, labels: overviewLabels(st), color: stageColor(st), layer: S.sat ? 'sat' : 'osm', w: w, h: h, extra: extra };
    var fontReady = document.fonts && document.fonts.load ? document.fonts.load('bold 26px "Barlow Condensed"').catch(function () {}) : Promise.resolve();
    return fontReady.then(function () { return RBO.render(opts); }).then(function (cv) {
      try { cv.toDataURL('image/png'); return cv; } // a tile without CORS would block reading the picture
      catch (e) { opts.noTiles = true; return RBO.render(opts).then(function (c2) { c2.missingTiles = -1; return c2; }); }
    });
  }
  function canvasB64(cv) { return cv.toDataURL('image/png').split(',')[1]; }
  function imgSize(src) { return new Promise(function (ok) { var im = new Image(); im.onload = function () { ok({ w: im.width, h: im.height }); }; im.onerror = function () { ok({ w: 100, h: 100 }); }; im.src = src; }); }
  function exportOverviewPng() {
    var st = stage(); if (!st) return toast(t('err.noStage'));
    toast(t('ov.building'), 8000);
    var e = ev(), W = 1200, head = 170;
    renderOverview(st, W, 1400).then(function (map) {
      return Promise.all(e.logos.map(function (src) { return new Promise(function (ok) { var im = new Image(); im.onload = function () { ok(im); }; im.onerror = function () { ok(null); }; im.src = src; }); }))
        .then(function (logos) {
          var cv = document.createElement('canvas'); cv.width = W; cv.height = map.height + head; var g = cv.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
          var ls = logos.filter(Boolean), x = 20;
          ls.forEach(function (im) { var hh = 80, ww = im.width * hh / im.height; g.drawImage(im, x, 14, ww, hh); x += ww + 16; });
          var tx = ls.length ? x + 10 : 24, font = '"Barlow Condensed", Tahoma, sans-serif';
          g.fillStyle = '#000'; g.textBaseline = 'top'; g.textAlign = 'left';
          g.font = 'bold 40px ' + font; g.fillText('Overview ' + st.name, 24, 104);
          g.font = '600 26px ' + font; g.fillText(fmtKm(lenOf(st) * fac(st) / 1000, CFG.navDec) + ' km' + (e.title ? '   ' + e.title : '') + (e.date ? '   ' + e.date : ''), tx, 22);
          if (e.place) g.fillText(e.place, tx, 56);
          g.drawImage(map, 0, head);
          var d = new Date(), day = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
          cv.toBlob(function (blob) {
            var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = safeName(st.name) + '_overview_' + day + '.png';
            document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
            toast(map.missingTiles ? t('ov.partial') : t('ov.done'), map.missingTiles ? 6000 : 3000);
          }, 'image/png');
        });
    }).catch(function () { toast(t('ov.fail'), 5000); });
  }

  // ---------- Excel export (event SS Form layout) ----------
  var scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) scriptCache[src] = new Promise(function (ok, bad) {
      var el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = function () { delete scriptCache[src]; bad(new Error(src)); };
      document.head.appendChild(el);
    });
    return scriptCache[src];
  }
  function tulipPng(p) {
    return new Promise(function (resolve) {
      var size = 300, svg = RB.tulipOf(p, { size: size, ink: '#000', stroke: 6 });
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'); c.width = c.height = size;
        var g = c.getContext('2d'); g.drawImage(img, 0, 0, size, size); // transparent, so the SS tint shows through
        resolve(c.toDataURL('image/png').split(',')[1]);
      };
      img.onerror = function () { resolve('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  }
  // whole Excel direction box: tulip in the middle, box number in a small square bottom-left (WRC); transparent so the SS tint shows
  function boxPng(p, no, w, h) {
    return new Promise(function (resolve) {
      var k = 2, cv = document.createElement('canvas'); cv.width = w * k; cv.height = h * k;
      var g = cv.getContext('2d'), sz = Math.min(w - 8, h - 12, 190), img = new Image();
      var fin = function () {
        var bs = 30, x = 6, y = h - bs - 6;
        g.fillStyle = '#fff'; g.fillRect(x * k, y * k, bs * k, bs * k);
        g.strokeStyle = '#000'; g.lineWidth = 2 * k; g.strokeRect(x * k, y * k, bs * k, bs * k);
        g.fillStyle = '#000'; g.font = 'bold ' + (String(no).length > 2 ? 15 : 19) * k + 'px Tahoma, Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(no), (x + bs / 2) * k, (y + bs / 2 + 1) * k);
        resolve({ b64: cv.toDataURL('image/png').split(',')[1], w: w, h: h });
      };
      img.onload = function () { g.drawImage(img, (w - sz) / 2 * k, (h - sz) / 2 * k - 6 * k, sz * k, sz * k); fin(); };
      img.onerror = fin;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(RB.tulipOf(p, { size: 300, ink: '#000', stroke: 6 }));
    });
  }
  // small lines of bold text as a transparent picture (Excel "Next" note under Partial)
  function textPng(lines, w) {
    var k = 2, lh = 18, h = lines.length * lh + 4, cv = document.createElement('canvas'); cv.width = w * k; cv.height = h * k;
    var g = cv.getContext('2d'); g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'top';
    lines.forEach(function (l, i) {
      var fs = i ? 12 : 14; g.font = 'bold ' + fs * k + 'px Tahoma, Arial, sans-serif';
      while (fs > 7 && g.measureText(l).width > (w - 4) * k) { fs--; g.font = 'bold ' + fs * k + 'px Tahoma, Arial, sans-serif'; }
      g.fillText(l, w / 2 * k, (2 + i * lh) * k);
    });
    return Promise.resolve({ b64: cv.toDataURL('image/png').split(',')[1], w: w, h: h });
  }
  function symbolsPng(p) {
    var ids = (p.sym || []).filter(function (id) { return RBS.BY[id]; });
    if (!ids.length) return Promise.resolve(null);
    var S1 = 120, gap = 12, cv = document.createElement('canvas'); cv.width = ids.length * S1 + (ids.length - 1) * gap; cv.height = S1;
    var g = cv.getContext('2d');
    return Promise.all(ids.map(function (id, i) {
      return new Promise(function (ok) {
        var im = new Image();
        im.onload = function () { g.drawImage(im, i * (S1 + gap), 0, S1, S1); ok(); };
        im.onerror = ok;
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(RBS.svg(id, S1));
      });
    })).then(function () { return { b64: cv.toDataURL('image/png').split(',')[1], w: cv.width, h: cv.height }; });
  }
  function findDups() {
    var out = [];
    P.stages.forEach(function (st) {
      var ps = pts(st), f = fac(st);
      ps.forEach(function (p, i) { if (isDup(ps[i - 1], p, f)) out.push({ st: st, p: p, no: i + 1, m: Math.round((p.d - ps[i - 1].d) * f) }); });
    });
    return out;
  }
  function exportXlsx(force) {
    if (!P.stages.length) return toast(t('err.noStage'));
    var dups = force === true ? [] : findDups();
    if (dups.length) {
      var list = dups.slice(0, 8).map(function (x) { return x.st.name + '  #' + x.no + '  (' + x.m + ' m)'; }).join('\n') + (dups.length > 8 ? '\n…' : '');
      return ask({ title: t('xl.dupTitle', { n: dups.length }), body: t('xl.dupBody', { list: list, m: DUP_M }), ok: t('xl.dupGo'), cancel: t('xl.dupFix') }).then(function (ok) {
        if (ok) return exportXlsx(true);
        var x = dups[0]; selectStage(x.st.id, false); S.sel = x.p.id;
        document.querySelector('.tabs [data-tab=rb]').click();
        map.setView([x.p.lat, x.p.lon], Math.max(map.getZoom(), 17)); renderRB(); drawPins();
        var row = document.querySelector('.rb-row.sel'); if (row) row.scrollIntoView({ block: 'center' });
      });
    }
    var btn = $('bXlsx'); btn.disabled = true; toast(t('xl.building'), 8000);
    loadScript('vendor/exceljs/exceljs.min.js').then(function () {
      var stages = P.stages.map(function (st) { return Object.assign({}, st, { _len: lenOf(st) }); });
      var e = ev(), missing = 0;
      return Promise.all(e.logos.map(function (src) { return imgSize(src).then(function (sz) { return { b64: src.split(',')[1], w: sz.w, h: sz.h }; }); }))
        .then(function (logos) {
          return RBX.build(window.ExcelJS, {
            project: P, stages: stages, cfg: CFG, t: t, lang: LANG, tulipPng: tulipPng, boxPng: boxPng, textPng: textPng, isControl: RB.isControl, symbolsPng: symbolsPng,
            photo: CFG.xlPhotos === false ? null : function (id) { return RBP.b64(id).catch(function () { return null; }); },
            instr: function (p) { return instrText(p); },
            event: { title: e.title, date: e.date, place: e.place, logos: logos },
            overview: function (st) {
              var real = P.stages.filter(function (x) { return x.id === st.id; })[0];
              return renderOverview(real, 1080, 1300).then(function (cv) { if (cv.missingTiles) missing++; return { b64: canvasB64(cv), w: cv.width, h: cv.height }; })
                .catch(function () { return null; });
            }
          });
        }).then(function (buf) { if (missing) setTimeout(function () { toast(t('ov.partial'), 6000); }, 3600); return buf; });
    }).then(function (buf) {
      var d = new Date(), day = d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = safeName(P.name) + '_roadbook_' + day + '.xlsx'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      toast(t('xl.done', { n: P.stages.length }), 3500);
    }).catch(function (e) { toast(t('xl.fail') + (e && e.message ? ' (' + e.message + ')' : ''), 6000); })
      .then(function () { btn.disabled = false; });
  }
  $('bXlsx').onclick = function () { exportXlsx(); };
  $('bGpxOut').onclick = function () { if (!P.stages.length) return toast(t('err.noStage')); download(safeName(P.name) + '.gpx', RB.stageGPX(P.stages), 'application/gpx+xml'); };
  $('bLogOut').onclick = exportLog;
  $('projName').onchange = function () { P.name = this.value.trim() || P.name; save(); };
  $('bNewProj').onclick = function () {
    ask({ title: t('file.newProj'), body: t('confirm.newProj', { name: P.name, n: P.stages.length }), ok: t('confirm.newProjOk'), danger: true }).then(function (ok) {
      if (!ok) return;
      P = newProject(); S.stageId = null; save(); renderAll();
    });
  };
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('bInstall').hidden = false; });
  $('bInstall').onclick = function () { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('bInstall').hidden = true; } };

  // ---------- Shared GPS helpers ----------
  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || !(N.on || R.on)) return;
    navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
  }
  function releaseAwake() { if (!N.on && !R.on && wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && (N.on || R.on)) keepAwake(); });
  function gpsAllowed() {
    if (!navigator.geolocation) { toast(t('err.noGps')); return false; }
    if (location.protocol === 'http:' && location.hostname !== 'localhost') { toast(t('err.https'), 4000); return false; }
    return true;
  }
  var audio = null;
  function beep(freq, n, force) {
    if (!CFG.sound && !force) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (var i = 0; i < n; i++) {
        var o = audio.createOscillator(), g = audio.createGain(), tt = audio.currentTime + i * 0.22;
        o.frequency.value = freq; o.type = 'square'; g.gain.setValueAtTime(0.25, tt); g.gain.setValueAtTime(0, tt + 0.14);
        o.connect(g); g.connect(audio.destination); o.start(tt); o.stop(tt + 0.16);
      }
    } catch (e) {}
  }
  function unlockAudio() { try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {} }
  var gpsMarker = null, accCircle = null;
  function showFix(ll, acc) {
    if (!gpsMarker) {
      accCircle = L.circle(ll, { radius: acc, color: '#0050B3', weight: 1, fillOpacity: .08, interactive: false }).addTo(gNav);
      gpsMarker = L.marker(ll, { icon: dot(), interactive: false }).addTo(gNav);
    } else { gpsMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(acc); }
    if (N.follow && (S.mode === 'rec' || CFG.map)) map.setView(ll, Math.max(map.getZoom(), 16), { animate: false });
  }
  map.on('dragstart', function () { if (S.mode !== 'org') { N.follow = false; $('fFollow').setAttribute('aria-pressed', 'false'); } });
  $('fFollow').onclick = function () {
    N.follow = true; this.setAttribute('aria-pressed', 'true');
    var f = S.mode === 'rec' ? R.fix : N.fix; if (f) map.setView([f.lat, f.lon], Math.max(map.getZoom(), 16));
  };

  // ---------- Recce recorder ----------
  var R = loadRec();
  function loadRec() {
    var d = { pts: [], marks: [], startT: null, elapsed: 0, segT: null, dist: 0 };
    try { var s = JSON.parse(store.getItem(RKEY) || 'null'); if (s) Object.assign(d, s); } catch (e) {}
    d.on = false; d.watch = null; d.fix = null;
    if (d.segT) { d.elapsed += 0; d.segT = null; } // app was closed while recording: treat as paused
    return d;
  }
  var recSaveT;
  function saveRec(now) {
    clearTimeout(recSaveT);
    var w = function () { try { store.setItem(RKEY, JSON.stringify({ pts: R.pts, marks: R.marks, startT: R.startT, elapsed: R.elapsed + (R.segT ? Date.now() - R.segT : 0), dist: R.dist })); } catch (e) {} };
    if (now) w(); else recSaveT = setTimeout(w, 1500);
  }
  function recElapsed() { return (R.elapsed + (R.segT ? Date.now() - R.segT : 0)) / 1000; }
  var recLine = null;
  function recDrawAll() {
    gRec.clearLayers(); recLine = null;
    if (S.mode !== 'rec') return;
    recLine = L.polyline(R.pts.map(function (p) { return [p[0], p[1]]; }), { color: '#D0021B', weight: 5, interactive: false }).addTo(gRec);
    R.marks.forEach(recDrawMark);
  }
  function recDrawMark(m) {
    var cls = m.k === 'danger' ? 'DANGER' : m.k === 'ctrl' ? 'TC' : 'TULIP';
    L.marker([m.lat, m.lon], { interactive: false, icon: L.divIcon({ className: '', html: '<div class="pin ' + cls + '">' + (m.k === 'danger' ? '!' : m.k === 'ctrl' ? 'C' : 'T') + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(gRec);
  }
  $('rStart').onclick = function () {
    if (R.on) { recPause(); return; }
    if (!gpsAllowed()) return;
    if (N.on) stopGps();
    unlockAudio();
    if (!R.startT) { R.startT = Date.now(); R.elapsed = 0; R.dist = 0; R.pts = []; R.marks = []; }
    R.on = true; R.segT = Date.now(); R.lastAcc = null;
    R.watch = navigator.geolocation.watchPosition(recFix, function (e) {
      if (e.code === 1) { recPause(); toast(t('err.perm'), 5000); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    keepAwake(); N.follow = true; $('fFollow').setAttribute('aria-pressed', 'true'); saveRec(true); renderRec();
  };
  function recPause() {
    if (R.watch != null) navigator.geolocation.clearWatch(R.watch);
    R.watch = null; R.on = false; if (R.segT) { R.elapsed += Date.now() - R.segT; R.segT = null; }
    saveRec(true); releaseAwake(); renderRec();
  }
  function recFix(pos) {
    var c = pos.coords, ts = pos.timestamp || Date.now(), prev = R.fix;
    var spd = c.speed != null && c.speed >= 0 ? c.speed : (prev ? RB.hav([prev.lat, prev.lon], [c.latitude, c.longitude]) / Math.max(0.5, (ts - prev.t) / 1000) : 0);
    R.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, spd: spd, t: ts };
    if (c.accuracy <= CFG.recAcc) {
      var last = R.pts[R.pts.length - 1], ll = [c.latitude, c.longitude];
      var step = last ? RB.hav([last[0], last[1]], ll) : 0;
      // skip jitter while stopped, and single implausible jumps (> 70 m/s);
      // after 3 jumps in a row the earlier point was the bad one, so accept the new position
      var jump = last && step / Math.max(0.5, (ts - last[2]) / 1000) >= 70;
      if (jump && (R.rej = (R.rej || 0) + 1) < 3) { /* wait for more fixes */ }
      else if (!last || jump || step >= Math.max(3, c.accuracy * 0.5)) {
        R.rej = 0;
        R.pts.push([+c.latitude.toFixed(7), +c.longitude.toFixed(7), ts]); R.dist += jump ? 0 : step;
        if (recLine) recLine.addLatLng(ll); saveRec();
      }
    }
    if (S.mode === 'rec') showFix([c.latitude, c.longitude], c.accuracy);
    renderRec();
  }
  document.querySelectorAll('.mark').forEach(function (b) {
    b.onclick = function () {
      if (!R.on) return toast(t('rec.needStart'));
      var f = R.fix; if (!f) return toast(t('rec.waitGps'));
      var m = { lat: f.lat, lon: f.lon, t: Date.now(), k: b.dataset.k, km: R.dist / 1000 };
      R.marks.push(m); if (S.mode === 'rec') recDrawMark(m);
      if (CFG.markFx) { if (navigator.vibrate) navigator.vibrate(80); beep(1200, 1, true); }
      saveRec(true); renderRec(); toast(t('rec.marked', { k: t('mark.' + m.k), km: fmtKm(m.km, 2) }), 1500);
      offerRecPhoto(m);
    };
  });
  // Finish screen: recording keeps running until "Create stage" is pressed, so "Keep recording" loses nothing
  $('rFinish').onclick = function () {
    if (R.pts.length < 2) return toast(t('rec.tooShort'));
    var c = { turn: 0, danger: 0, ctrl: 0 }; R.marks.forEach(function (m) { c[m.k]++; });
    $('finDist').textContent = fmtKm(R.dist / 1000);
    $('finTime').textContent = fmtClock(recElapsed());
    $('finMarks').textContent = t('fin.marks', { a: c.turn, b: c.danger, c: c.ctrl });
    $('finName').value = nextStageName();
    $('finDlg').showModal();
  };
  $('finBack').onclick = function () { $('finDlg').close(); };
  $('finName').onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); $('finOk').click(); } };
  $('finOk').onclick = function () {
    if (R.on) recPause();
    $('rPhoto').hidden = true;
    var name = $('finName').value.trim() || nextStageName();
    var tr = RB.cleanTrack(R.pts.map(function (p) { return [p[0], p[1]]; }), 2);
    if (tr.length < 2) { $('finDlg').close(); return toast(t('rec.tooShort')); }
    $('finDlg').close();
    var st = addStage(name, tr), cum = cumOf(st);
    R.marks.forEach(function (m) {
      var r = RB.project(tr, cum, m.lat, m.lon), d = r.d;
      var type = m.k === 'danger' ? 'DANGER' : m.k === 'ctrl' ? 'TC' : 'TULIP';
      if (type === 'TULIP') {
        // the button is usually pressed a moment after the junction: snap to the sharpest bend from 60 m before to 20 m after
        var best = null;
        for (var x = Math.max(0, d - 60); x <= Math.min(lenOf(st), d + 20); x += 5) {
          var a = RB.angleAt(tr, cum, x, 25); if (!best || Math.abs(a) > Math.abs(best.a)) best = { d: x, a: a };
        }
        if (best && Math.abs(best.a) >= 25) d = best.d;
      }
      var p = newPointAt(st, d, null, type);
      if (type !== 'TULIP') { p.th = ''; p.en = ''; p.angle = type === 'DANGER' ? 0 : null; }
      if (m.photos && m.photos.length) p.photos = m.photos.slice(0, PH_MAX).map(function (id) { return { id: id, book: RB.isControl(p) }; });
      st.points.push(p);
    });
    var n = R.marks.length;
    R = loadRec(); R.pts = []; R.marks = []; R.startT = null; R.elapsed = 0; R.dist = 0;
    try { store.removeItem(RKEY); } catch (e) {}
    save(); setMode('org'); selectStage(st.id, true);
    toast(t('toast.recDone', { name: st.name, km: (lenOf(st) / 1000).toFixed(3), n: n }), 4500);
  };
  // after a mark, offer a photo of that spot for a few seconds
  var recPhT = null, recPhMark = null;
  function offerRecPhoto(m) {
    recPhMark = m;
    $('rPhotoTxt').textContent = t('ph.recShoot', { k: t('mark.' + m.k), km: fmtKm(m.km, 2) }) + ((m.photos || []).length ? '  (' + m.photos.length + ')' : '');
    $('rPhoto').hidden = (m.photos || []).length >= PH_MAX;
    clearTimeout(recPhT); recPhT = setTimeout(function () { $('rPhoto').hidden = true; }, 10000);
  }
  $('inRecPh').onchange = function () {
    var f = this.files[0], m = recPhMark; this.value = '';
    if (!f || !m) return;
    clearTimeout(recPhT); $('rPhoto').hidden = true;
    phBusy++; toast(t('ph.saving'), 20000);
    RBP.add(f, { lat: m.lat, lon: m.lon }).then(function (rec) {
      m.photos = (m.photos || []).concat([rec.id]); saveRec(true);
      toast(t('ph.added'), 1500);
      if (R.marks.indexOf(m) >= 0) offerRecPhoto(m);
    }).catch(function () { toast(t('ph.fail'), 5000); }).then(function () { phBusy--; });
  };
  $('rDiscard').onclick = function () {
    if (!R.pts.length && !R.marks.length) return;
    ask({ title: t('confirm.recDiscardTitle'), body: t('confirm.recDiscard', { km: fmtKm(R.dist / 1000), n: R.marks.length }), ok: t('rec.discard'), danger: true }).then(function (ok) {
      if (!ok) return;
      if (R.on) recPause();
      R.pts = []; R.marks = []; R.startT = null; R.elapsed = 0; R.dist = 0;
      try { store.removeItem(RKEY); } catch (e) {}
      $('rPhoto').hidden = true; gcPhotos();
      recDrawAll(); renderRec();
    });
  };
  function renderRec() {
    $('rStart').textContent = R.on ? t('rec.pause') : R.startT ? t('rec.resume') : t('rec.start');
    $('rStart').classList.toggle('primary', !R.on);
    if (S.mode !== 'rec') return;
    $('rDist').textContent = fmtKm(R.dist / 1000, CFG.navDec);
    $('rTime').textContent = fmtClock(recElapsed());
    var g = $('rGps');
    if (!R.on) { g.textContent = t('gps.off'); g.className = ''; }
    else if (!R.fix) { g.textContent = t('gps.wait'); g.className = 'warn'; }
    else { g.textContent = 'GPS ±' + Math.round(R.fix.acc) + ' m'; g.className = R.fix.acc > CFG.recAcc ? 'warn' : ''; }
    $('rSpeed').textContent = R.fix && R.on ? Math.round(R.fix.spd * 3.6) + ' km/h' : '-- km/h';
    $('rState').textContent = R.on ? t('rec.recording') : R.startT ? t('rec.paused') : '';
    $('rState').className = R.on ? 'rec-on' : '';
    var c = { turn: 0, danger: 0, ctrl: 0 }; R.marks.forEach(function (m) { c[m.k]++; });
    $('cTurn').textContent = c.turn; $('cDanger').textContent = c.danger; $('cCtrl').textContent = c.ctrl;
    $('rFinish').disabled = R.pts.length < 2; $('rDiscard').disabled = !R.pts.length && !R.marks.length;
    document.querySelectorAll('.mark').forEach(function (b) { b.disabled = !R.on; });
  }

  // ---------- Navigator ----------
  var N = loadNav();
  function loadNav() {
    var d = { offset: {}, tsdStart: {}, log: [] };
    try { var s = JSON.parse(store.getItem(NKEY) || 'null'); if (s) Object.assign(d, s); } catch (e) {}
    d.on = false; d.matcher = null; d.d = null; d.fix = null; d.follow = true; d.alerted = {}; d.manualBase = null;
    return d;
  }
  var navSaveT;
  function saveNav() {
    clearTimeout(navSaveT);
    navSaveT = setTimeout(function () {
      try { store.setItem(NKEY, JSON.stringify({ offset: N.offset, tsdStart: N.tsdStart, log: N.log.slice(-20000) })); } catch (e) {}
    }, 1000);
  }
  function navResetMatch() { N.matcher = null; N.d = null; N.alerted = {}; N.manualBase = null; }
  function matcher() { var st = stage(); if (!st) return null; if (!N.matcher) N.matcher = new RB.Matcher(st.track, cumOf(st), { maxOff: CFG.offRoute, maxAcc: CFG.navAcc }); return N.matcher; }
  function offOf() { return N.offset[S.stageId] || 0; }
  function rawPos() { return N.d == null ? null : N.d + offOf(); }
  var trail = null;
  function navDrawStatic() {
    trail = L.polyline(N.log.slice(-3000).map(function (p) { return [p[0], p[1]]; }), { color: '#000', weight: 2, dashArray: '4 4', interactive: false }).addTo(gNav);
  }

  $('bGps').onclick = function () {
    if (N.on) return stopGps();
    if (!stage()) return toast(t('err.needStage'));
    if (!gpsAllowed()) return;
    if (R.on) return toast(t('err.recBusy'), 3500);
    unlockAudio();
    N.on = true; N.watch = navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    keepAwake(); renderNav();
  };
  function stopGps() {
    if (N.watch != null) navigator.geolocation.clearWatch(N.watch);
    N.on = false; N.watch = null; releaseAwake(); renderNav();
  }
  function onGpsErr(e) {
    if (e.code === 1) { stopGps(); toast(t('err.perm'), 5000); }
    else { $('dGps').textContent = e.code === 3 ? t('gps.wait') : t('gps.err'); $('dGps').className = 'warn'; }
  }
  function onFix(pos) {
    var c = pos.coords, ts = pos.timestamp || Date.now(), prev = N.fix;
    var spd = c.speed != null && c.speed >= 0 ? c.speed : (prev ? RB.hav([prev.lat, prev.lon], [c.latitude, c.longitude]) / Math.max(0.5, (ts - prev.t) / 1000) : 0);
    N.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, spd: spd, t: ts };
    if (CFG.rec && c.accuracy <= CFG.navAcc) {
      var last = N.log[N.log.length - 1];
      if (!last || RB.hav([last[0], last[1]], [c.latitude, c.longitude]) >= 3) { N.log.push([+c.latitude.toFixed(7), +c.longitude.toFixed(7), ts]); if (trail && S.mode === 'nav') trail.addLatLng([c.latitude, c.longitude]); saveNav(); }
    }
    var m = matcher(), r = m ? m.update(c.latitude, c.longitude, c.accuracy, spd) : null;
    if (r) { N.d = r.d; N.match = r; }
    if (S.mode === 'nav') showFix([c.latitude, c.longitude], c.accuracy);
    checkAlerts(); renderNav();
  }
  function navState() {
    var st = stage(); if (!st) return null;
    var f = fac(st), ps = pts(st), x = rawPos(), next = null, then = null, prev = null;
    if (x != null) {
      for (var i = 0; i < ps.length; i++) { if (ps[i].d > x + 5) { next = ps[i]; then = ps[i + 1] || null; prev = ps[i - 1] || null; break; } }
      if (!next && ps.length) prev = ps[ps.length - 1];
    } else { next = ps[0] || null; then = ps[1] || null; }
    return { st: st, f: f, ps: ps, x: x, next: next, then: then, prev: prev, km: x == null ? null : x * f / 1000 };
  }
  function checkAlerts() {
    var s = navState(); if (!s || !s.next || s.x == null || (N.match && N.match.offRoute)) return;
    var dist = (s.next.d - s.x) * s.f, A = alerts();
    for (var i = A.length - 1; i >= 0; i--) {
      var th = A[i], k = s.next.id + ':' + th;
      if (dist <= th && !N.alerted[k]) {
        A.forEach(function (t2) { if (t2 >= th) N.alerted[s.next.id + ':' + t2] = true; });
        // nearest threshold = loudest; the box flashes on the last one
        var lvl = Math.min(3, A.length - i), close = i === A.length - 1;
        beep([800, 1100, 1400][lvl - 1], lvl);
        if (CFG.vib && navigator.vibrate) navigator.vibrate(lvl === 3 ? [200, 80, 200, 80, 200] : lvl === 2 ? [150, 80, 150] : [150]);
        var box = $('dNext'); box.classList.remove('flash'); void box.offsetWidth; if (close) box.classList.add('flash');
        break;
      }
    }
  }
  function boxFill(p, s, kmId, tulipId, textId, inId) {
    if (!p) { $(tulipId).innerHTML = ''; $(textId).innerHTML = inId ? t('nav.noNext') : ''; $(kmId).textContent = ''; if (inId) $(inId).textContent = '--'; return; }
    var idx = s.ps.indexOf(p) + 1, ink = isNight() && !inId ? '#fff' : '#000', ins = instr(p);
    $(kmId).textContent = '#' + idx + '  ' + fmtKm(p.d * s.f / 1000);
    $(tulipId).innerHTML = RB.tulipOf(p, { size: inId ? 84 : 52, ink: ink });
    $(textId).innerHTML = tagHTML(p) + (ins.main ? '<span>' + RB.esc(ins.main) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '') + symsHTML(p, inId ? 34 : 24);
    if (inId) {
      var dist = s.x == null ? null : (p.d - s.x) * s.f;
      $(inId).textContent = dist == null ? '--' : dist >= 1000 ? (dist / 1000).toFixed(2) + 'k' : Math.max(0, Math.round(dist / 10) * 10) + ' m';
    }
  }
  function renderNav() {
    applyNight();
    document.body.classList.toggle('nomap', !CFG.map);
    $('bGps').textContent = N.on ? t('nav.gpsStop') : t('nav.gpsStart'); $('bGps').classList.toggle('primary', !N.on);
    if (S.mode !== 'nav') return;
    var s = navState();
    $('dTotal').textContent = fmtKm(s ? s.km : null, CFG.navDec);
    var base = 0;
    if (s && s.x != null) {
      // partial distance restarts at every roadbook point, or only at control points
      s.ps.forEach(function (p) { if (p.d <= s.x + 5 && (CFG.partial !== 'ctrl' || RB.isControl(p))) base = p.d * s.f / 1000; });
    }
    if (N.manualBase != null && N.manualBase > base) base = N.manualBase;
    $('dPartial').textContent = fmtKm(s && s.km != null ? Math.max(0, s.km - base) : null, CFG.navDec);
    var g = $('dGps');
    if (!N.on) { g.textContent = t('gps.off'); g.className = ''; }
    else if (!N.fix) { g.textContent = t('gps.wait'); g.className = 'warn'; }
    else { g.textContent = 'GPS ±' + Math.round(N.fix.acc) + ' m'; g.className = N.fix.acc > 20 ? 'warn' : ''; }
    $('dSpeed').textContent = N.fix ? Math.round(N.fix.spd * 3.6) + ' km/h' : '-- km/h';
    $('dRec').textContent = CFG.rec && N.on ? t('nav.logged', { n: N.log.length }) : '';
    var off = N.on && N.match && N.match.offRoute && N.fix;
    $('dOff').hidden = !off; if (off) $('dOffM').textContent = Math.round(N.match.off) + ' m';
    renderClock(s);
    if (!s) { boxFill(null, null, 'dNextKm', 'dNextTulip', 'dNextText', 'dNextIn'); boxFill(null, null, 'dThenKm', 'dThenTulip', 'dThenText'); $('dTsd').hidden = true; $('bTsd').hidden = true; return; }
    boxFill(s.next, s, 'dNextKm', 'dNextTulip', 'dNextText', 'dNextIn');
    boxFill(s.then, s, 'dThenKm', 'dThenTulip', 'dThenText');
    var tsd = s.st.tsd && s.st.tsd.length, t0 = N.tsdStart[s.st.id];
    $('dTsd').hidden = !tsd; $('bTsd').hidden = !tsd;
    if (tsd) {
      $('bTsd').textContent = t0 ? t('nav.tsdRunning') : t('nav.tsdStart');
      var sp = s.km != null ? RB.tsdSpeedAt(s.st.tsd, s.km) : null;
      $('dTsdSpeed').textContent = t('nav.target') + ' ' + (sp ? sp + ' km/h' : '--');
      var el = $('dTsdDelta');
      if (t0 && s.km != null) {
        var elapsed = (Date.now() - t0) / 1000, dlt = elapsed - RB.tsdIdeal(s.st.tsd, s.km);
        el.textContent = (dlt >= 0 ? '+' : '−') + (CFG.tsdFmt === 'cmin' ? (Math.abs(dlt) / 60).toFixed(2) + ' min' : Math.abs(dlt).toFixed(1) + ' s');
        el.className = 'tsd-d ' + (dlt > 0.5 ? 'late' : dlt < -0.5 ? 'early' : '');
        $('dTsdElapsed').textContent = (dlt > 0.5 ? t('nav.late') : dlt < -0.5 ? t('nav.early') : t('nav.onTime')) + '  ' + fmtClock(elapsed);
      } else { el.textContent = '--'; el.className = 'tsd-d'; $('dTsdElapsed').textContent = t('nav.tsdHint'); }
    }
  }
  // Rally clock (phone time + offset set to the official clock) and countdown to the next timed control
  function renderClock(s) {
    $('dClock').textContent = fmtTod(rallyNow());
    var due = $('dDue'), nx = null;
    if (s) s.ps.forEach(function (p) { if (!nx && RB.isControl(p) && /^\d{1,2}:\d{2}/.test(p.time || '') && (s.x == null || p.d > s.x + 5)) nx = p; });
    if (!nx) { due.textContent = ''; due.className = 'due'; return; }
    var hm = nx.time.split(':'), now = new Date(rallyNow()), d = new Date(now);
    d.setHours(+hm[0], +hm[1], +(hm[2] || 0), 0);
    var left = Math.round((d - now) / 1000);
    if (left < -43200) left += 86400; else if (left > 43200) left -= 86400;
    due.textContent = (nx.code || nx.type) + ' ' + nx.time + '  ' + (left >= 0 ? t('clock.in') + ' ' + fmtClock(left) : t('clock.over') + ' ' + fmtClock(-left));
    due.className = 'due' + (left < 0 ? ' late' : left <= 60 ? ' soon' : '');
  }
  setInterval(function () {
    if (S.mode === 'nav') { if (N.tsdStart[S.stageId]) renderNav(); else renderClock(navState()); }
    if (S.mode !== 'org' && CFG.night === 'auto') applyNight();
    if ($('setDlg').open && $('sClock')) $('sClock').textContent = fmtTod(rallyNow());
    if (S.mode === 'rec' && R.on) $('rTime').textContent = fmtClock(recElapsed());
  }, 500);

  act($('partialCell'), function () { var s = navState(); if (s && s.km != null) { N.manualBase = s.km; renderNav(); toast(t('toast.partialZero')); } }, true);
  act($('bSync'), function () {
    var s = navState(); if (!s || N.d == null) return toast(t('err.noPos'));
    var best = null; s.ps.forEach(function (p) { var dd = Math.abs(p.d - s.x); if (!best || dd < best.dd) best = { p: p, dd: dd }; });
    if (!best || best.dd * s.f > 400) return toast(t('err.noNearPoint'));
    N.offset[S.stageId] = best.p.d - N.d; N.alerted = {}; N.manualBase = null; saveNav(); renderNav();
    toast(t('toast.synced', { n: s.ps.indexOf(best.p) + 1, km: fmtKm(best.p.d * s.f / 1000) }));
  }, true);
  function nudge(m) { var st = stage(); if (!st) return; N.offset[S.stageId] = offOf() + m / fac(st); saveNav(); renderNav(); }
  act($('bMinus'), function () { nudge(-10); }, true);
  act($('bPlus'), function () { nudge(10); }, true);
  act($('bTsd'), function () {
    var id = S.stageId; if (!id) return;
    if (N.tsdStart[id]) { toast(t('toast.tsdAlready')); return; }
    N.tsdStart[id] = Date.now(); saveNav(); renderNav(); beep(1000, 1); toast(t('toast.tsdStarted'));
  }, true);
  $('bMore').onclick = function () { $('moreDlg').showModal(); };
  $('oSet').onclick = function () { $('moreDlg').close(); openSettings(); };
  act($('oTsdReset'), function () { delete N.tsdStart[S.stageId]; saveNav(); renderNav(); toast(t('toast.tsdReset')); }, true);
  act($('oOffReset'), function () { delete N.offset[S.stageId]; saveNav(); renderNav(); toast(t('toast.offReset')); }, true);
  $('oLog').onclick = exportLog;
  $('oLogClear').onclick = function () {
    ask({ title: t('confirm.logClear'), body: t('confirm.logClearBody', { n: N.log.length }), ok: t('more.logClear'), danger: true }).then(function (ok) {
      if (ok) { N.log = []; saveNav(); gNav.clearLayers(); gpsMarker = accCircle = null; navDrawStatic(); renderNav(); }
    });
  };
  function exportLog() {
    if (!N.log.length) return toast(t('err.noLog'));
    var st = stage(), nm = (st ? st.name : 'run') + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    download(safeName(nm) + '.gpx', RB.logGPX(nm, N.log), 'application/gpx+xml');
  }

  // ---------- Settings screen ----------
  var swReg = null, offerUpdate = function () {};
  function segH(key, opts) {
    return '<div class="seg wide" data-seg="' + key + '">' + opts.map(function (o) {
      return '<button type="button" data-v="' + o[0] + '" aria-pressed="' + (String(CFG[key]) === String(o[0])) + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }
  function chkH(key, label) { return '<label class="check"><input type="checkbox" data-chk="' + key + '"' + (CFG[key] ? ' checked' : '') + '> <span>' + label + '</span></label>'; }
  function numH(key, label, unit, min, max) { return '<label class="field num">' + label + '<span><input inputmode="numeric" data-num="' + key + '" data-min="' + min + '" data-max="' + max + '" value="' + CFG[key] + '"> ' + unit + '</span></label>'; }
  function rowH(label, ctl) { return '<div class="set-row"><span class="set-lbl">' + label + '</span>' + ctl + '</div>'; }
  function grpH(title, body, note) { return '<section class="group"><h3>' + title + '</h3>' + body + (note ? '<p class="note">' + note + '</p>' : '') + '</section>'; }
  function renderSettings() {
    var A = CFG.alerts || DEF.alerts;
    var langs = Object.keys(I18N).map(function (k) { return [k, I18N[k]._name]; });
    var off = CFG.clockOffset || 0, offS = (off >= 0 ? '+' : '−') + (Math.abs(off) / 1000).toFixed(0) + ' s';
    $('setBody').innerHTML =
      grpH(t('set.general'),
        rowH(t('file.lang'), '<div class="seg wide" id="sLang">' + langs.map(function (l) { return '<button type="button" data-lang="' + l[0] + '" aria-pressed="' + (l[0] === LANG) + '">' + l[1] + '</button>'; }).join('') + '</div>') +
        rowH(t('set.night'), segH('night', [['off', t('set.off')], ['on', t('set.on')], ['auto', t('set.nightAuto')]])) +
        rowH(t('set.navDec'), segH('navDec', [[2, '0.00'], [3, '0.000']])),
        t('set.decNote')) +

      grpH(t('set.clock'),
        '<div class="clock-set"><b id="sClock">' + fmtTod(rallyNow()) + '</b><span>' + t('set.offset') + ' ' + offS + '</span></div>' +
        '<div class="row2"><label class="field">' + t('set.clockIn') + '<input id="sClockIn" type="time" step="1"></label><button type="button" id="sClockSet" class="primary">' + t('set.clockSet') + '</button></div>' +
        '<div class="row3"><button type="button" data-off="-1000">−1 s</button><button type="button" data-off="1000">+1 s</button><button type="button" data-off="0">' + t('set.clockClear') + '</button></div>' +
        rowH(t('set.tsdFmt'), segH('tsdFmt', [['s', t('set.sec')], ['cmin', t('set.cmin')]])),
        t('set.clockNote')) +

      grpH(t('set.nav'),
        '<div class="alerts"><span class="set-lbl">' + t('set.alerts') + '</span><div class="row3">' + [0, 1, 2].map(function (i) { return '<input inputmode="numeric" data-alert="' + i + '" value="' + (A[i] || '') + '" aria-label="' + t('set.alerts') + ' ' + (i + 1) + '">'; }).join('') + '</div></div>' +
        chkH('sound', t('more.sound')) + chkH('vib', t('more.vib')) + chkH('map', t('more.map')) + chkH('rec', t('more.rec')) +
        rowH(t('set.partial'), segH('partial', [['point', t('set.partialPoint')], ['ctrl', t('set.partialCtrl')]])) +
        chkH('hold', t('set.hold')) +
        numH('offRoute', t('set.offRoute'), 'm', 15, 200) + numH('navAcc', t('set.navAcc'), 'm', 10, 200),
        t('set.navNote')) +

      grpH(t('set.rec'), chkH('markFx', t('set.markFx')) + numH('recAcc', t('set.recAcc'), 'm', 5, 100), t('set.recNote')) +

      grpH(t('set.map'),
        rowH(t('set.layer'), segH('layer', [['osm', t('fab.map')], ['sat', t('fab.sat')]])) +
        rowH(t('set.drawMode'), segH('drawSnap', [[true, t('draw.snap')], [false, t('draw.line')]])) +
        '<div class="set-row"><span class="set-lbl" id="sTiles">' + t('set.tilesCounting') + '</span><button type="button" id="sTilesClear">' + t('set.tilesClear') + '</button></div>') +

      grpH(t('set.docs'),
        rowH(t('set.paper'), segH('paper', [['A5', 'A5'], ['A4', 'A4']])) +
        rowH(t('set.coordFmt'), segH('coordFmt', [['ddm', "N 15° 30.123'"], ['dec', '15.502050']])) +
        rowH(t('set.curve'), segH('curve', [['sharp', t('curve.sharp')], ['soft', t('curve.soft')], ['wide', t('curve.wide')], ['gps', t('curve.gps')]])) +
        chkH('refMark', t('set.refMark')) + chkH('xlPhotos', t('set.xlPhotos')),
        t('set.docsNote')) +

      grpH(t('set.data'),
        chkH('backup', t('set.backupRemind')) +
        '<p class="note" id="sBackupInfo">' + (META.backupAt ? t('set.lastBackup', { d: new Date(META.backupAt).toLocaleString(LANG === 'th' ? 'th-TH' : 'en-GB') }) : t('set.neverBackup')) + '</p>' +
        '<div class="row2"><button type="button" id="sBackup">' + t('file.saveJson') + '</button><button type="button" id="sBackupPh">' + t('file.saveJsonPh') + '</button></div>' +
        '<p class="note" id="sStore"></p>') +

      grpH(t('set.about'),
        '<div class="kv"><span>' + t('set.version') + '</span><b>' + APP_VER + '</b></div>' +
        '<button type="button" id="sUpdate">' + t('set.checkUpdate') + '</button><p class="note" id="sUpdMsg" role="status"></p>');

    var body = $('setBody');
    body.querySelectorAll('[data-seg]').forEach(function (g) {
      g.onclick = function (e) {
        var b = e.target.closest('[data-v]'); if (!b) return;
        var k = g.dataset.seg, v = b.dataset.v;
        CFG[k] = v === 'true' ? true : v === 'false' ? false : /^\d+$/.test(v) ? +v : v;
        cfgChanged(k); renderSettings();
      };
    });
    $('sLang').onclick = function (e) { var b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); };
    body.querySelectorAll('[data-chk]').forEach(function (c) { c.onchange = function () { CFG[c.dataset.chk] = c.checked; cfgChanged(c.dataset.chk); }; });
    body.querySelectorAll('[data-num]').forEach(function (inp) {
      inp.onchange = function () {
        var v = parseFloat(inp.value), lo = +inp.dataset.min, hi = +inp.dataset.max;
        if (!(v >= lo && v <= hi)) { toast(t('set.range', { a: lo, b: hi })); inp.value = CFG[inp.dataset.num]; return; }
        CFG[inp.dataset.num] = Math.round(v); cfgChanged(inp.dataset.num);
      };
    });
    body.querySelectorAll('[data-alert]').forEach(function (inp) {
      inp.onchange = function () {
        var a = (CFG.alerts || DEF.alerts).slice(), v = parseFloat(inp.value);
        a[+inp.dataset.alert] = v > 0 && v <= 2000 ? Math.round(v) : 0;
        if (!a.some(function (x) { return x > 0; })) { toast(t('set.alertNeed')); inp.value = (CFG.alerts || [])[+inp.dataset.alert] || ''; return; }
        CFG.alerts = a; cfgChanged('alerts');
      };
    });
    $('sClockSet').onclick = function () {
      var v = $('sClockIn').value; if (!v) return toast(t('set.clockNeed'));
      var hm = v.split(':'), now = new Date(), d = new Date(now);
      d.setHours(+hm[0], +hm[1], +(hm[2] || 0), 0);
      var o = d - now; if (o > 43200000) o -= 86400000; else if (o < -43200000) o += 86400000;
      CFG.clockOffset = o; cfgChanged('clockOffset'); renderSettings(); toast(t('set.clockDone', { t: fmtTod(rallyNow()) }));
    };
    body.querySelectorAll('[data-off]').forEach(function (b) {
      b.onclick = function () { var d = +b.dataset.off; CFG.clockOffset = d ? (CFG.clockOffset || 0) + d : 0; cfgChanged('clockOffset'); renderSettings(); };
    });
    $('sBackup').onclick = function () { backupJson(false); renderSettings(); };
    $('sBackupPh').onclick = function () { backupJson(true).then(renderSettings); };
    $('sTilesClear').onclick = function () {
      if (!window.caches) return;
      ask({ title: t('set.tilesClearTitle'), body: t('set.tilesConfirm'), ok: t('set.tilesClear'), danger: true }).then(function (ok) {
        if (ok) caches.delete('rb-tiles').then(function () { renderSettings(); toast(t('set.tilesCleared')); });
      });
    };
    $('sUpdate').onclick = checkForUpdate;
    if (window.caches) caches.open('rb-tiles').then(function (c) { return c.keys(); }).then(function (k) { if ($('sTiles')) $('sTiles').textContent = t('set.tiles', { n: k.length }); }).catch(function () {});
    else $('sTiles').textContent = '';
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (e) {
      if ($('sStore')) $('sStore').textContent = t('set.storage', { mb: ((e.usage || 0) / 1048576).toFixed(1) });
    }).catch(function () {});
  }
  function cfgChanged(k) {
    saveCfg();
    RB.setRef(CFG.refMark !== false);
    if (k === 'layer') setLayer(CFG.layer === 'sat');
    if ((k === 'offRoute' || k === 'navAcc') && N.matcher) { N.matcher.maxOff = CFG.offRoute; N.matcher.maxAcc = CFG.navAcc; }
    if (k === 'map') setTimeout(function () { map.invalidateSize(); }, 60);
    if (k === 'alerts') N.alerted = {};
    applyNight(); renderAll();
  }
  function openSettings() { renderSettings(); $('setDlg').showModal(); }
  $('bSet').onclick = openSettings;
  $('setReset').onclick = function () {
    ask({ title: t('set.reset'), body: t('set.resetConfirm'), ok: t('set.reset') }).then(function (ok) {
      if (!ok) return;
      var keep = { lang: CFG.lang, clockOffset: CFG.clockOffset };
      CFG = Object.assign({}, DEF, keep); saveCfg();
      setLayer(false); if (N.matcher) { N.matcher.maxOff = CFG.offRoute; N.matcher.maxAcc = CFG.navAcc; }
      applyNight(); renderAll(); renderSettings(); toast(t('set.resetDone'));
    });
  };
  function updMsg(msg) { var el = $('sUpdMsg'); if (el) el.textContent = msg; }
  function checkForUpdate() {
    if (!swReg) return updMsg(t('set.noUpdate'));
    updMsg(t('set.checking'));
    swReg.update().then(function () {
      setTimeout(function () {
        if (swReg.waiting || swReg.installing) {
          updMsg(t('set.updateReady'));
          if (swReg.waiting) offerUpdate(swReg.waiting);
        } else updMsg(t('set.upToDate', { v: APP_VER }));
      }, 1500);
    }).catch(function () { updMsg(t('set.updateFail')); });
  }

  // ---------- Render all ----------
  function renderAll() {
    $('projName').value = P.name || '';
    $('storeNote').textContent = store.mem ? t('file.storeMem') : t('file.storeOk');
    renderStageSel(); drawTracks(); drawPins(); drawSuggest(); renderRB(); renderStagePanel(); renderNav(); renderRec(); renderEvent();
  }
  setLayer(CFG.layer === 'sat');
  RB.setRef(CFG.refMark !== false);
  // road shapes are redrawn with the current rules each time the app opens
  P.stages.forEach(function (st) { (st.points || []).forEach(function (p) { if (p.curve === 'gps') refreshShape(st, p); }); });
  applyI18n(); renderAll(); fitStage();
  if (R.startT) toast(t('rec.restored'), 4000);
  else if (CFG.backup && P.stages.length && META.dirtySince && Date.now() - META.dirtySince > 86400000) {
    toast(t('backup.remind'), 15000); $('toast').onclick = function () { $('toast').hidden = true; backupJson(false); };
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    offerUpdate = function (w) {
      if (!w || !navigator.serviceWorker.controller) return;
      toast(t('toast.update'), 600000);
      $('toast').onclick = function () { w.postMessage('skip'); };
    };
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      swReg = reg;
      // a version downloaded while the app was closed waits here; offer it on every open
      if (reg.waiting) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        nw && nw.addEventListener('statechange', function () { if (nw.state === 'installed') offerUpdate(nw); });
      });
      var check = function () { reg.update().catch(function () {}); };
      check();
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') check(); });
    }).catch(function () {});
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!reloaded) { reloaded = true; location.reload(); } });
  }
})();
