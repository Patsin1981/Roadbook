/* Rally Roadbook — app logic v1.1 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'rb.project.v1', NKEY = 'rb.nav.v1', RKEY = 'rb.rec.v1', LKEY = 'rb.lang';
  var COLORS = ['#0050B3', '#D0021B', '#007A3D', '#7A3EB1', '#E07000', '#00838F'];
  var TYPES = ['START', 'TULIP', 'TC', 'PC', 'CP', 'DANGER', 'INFO', 'FINISH'];
  var BRANCH_SET = [-135, -90, -45, 0, 45, 90, 135];
  var ALERTS = [300, 100, 50];
  var OSRM = 'https://router.project-osrm.org/route/v1/driving/';

  // ---------- Storage ----------
  var store = (function () {
    try { localStorage.setItem('rb.t', '1'); localStorage.removeItem('rb.t'); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = v; }, removeItem: function (k) { delete m[k]; }, mem: true }; }
  })();

  // ---------- i18n ----------
  var LANG = store.getItem(LKEY) || ((navigator.language || 'th').slice(0, 2) === 'th' ? 'th' : 'en');
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
    $('langSeg').innerHTML = Object.keys(I18N).map(function (k) { return '<button data-lang="' + k + '" aria-pressed="' + (k === LANG) + '">' + I18N[k]._name + '</button>'; }).join('');
    $('fLayer').textContent = S.sat ? t('fab.map') : t('fab.sat');
    buildDlgLabels();
  }
  function setLang(l) { LANG = l; try { store.setItem(LKEY, l); } catch (e) {} applyI18n(); renderAll(); }

  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function fmtKm(km) { return km == null || !isFinite(km) ? '--.--' : km.toFixed(2); }
  function toast(msg, ms) {
    var el = $('toast'); el.textContent = msg; el.hidden = false; el.onclick = null;
    clearTimeout(toast._t); toast._t = setTimeout(function () { el.hidden = true; }, ms || 2600);
  }
  function typeName(type) { return type === 'TULIP' ? 'Tulip' : type === 'DANGER' ? t('type.danger') : type === 'INFO' ? 'Info' : type; }
  function fmtClock(s) { s = Math.max(0, Math.floor(s)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + (m < 10 && h ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }

  // ---------- Project ----------
  function newProject() { return { v: 1, name: t('proj.new'), stages: [] }; }
  function load() { try { var s = store.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  var saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () { try { store.setItem(KEY, JSON.stringify(P)); } catch (e) { toast(t('err.storageFull'), 5000); } }, 300);
  }
  var S = { mode: 'org', stageId: null, sel: null, addMode: false, suggest: [], sat: false, ctrlOnly: false, draw: null };
  var P = load() || newProject();
  S.stageId = P.stages[0] ? P.stages[0].id : null;
  var cumCache = new WeakMap();
  function stage() { return P.stages.filter(function (s) { return s.id === S.stageId; })[0] || null; }
  function cumOf(st) { var c = cumCache.get(st.track); if (!c) { c = RB.buildCum(st.track); cumCache.set(st.track, c); } return c; }
  function lenOf(st) { var c = cumOf(st); return c.length ? c[c.length - 1] : 0; }
  function fac(st) { return st && st.factor > 0 ? st.factor : 1; }
  function pts(st) { return RB.sortedPoints(st); }
  function addStage(name, track, points) {
    var st = { id: uid(), name: name, color: COLORS[P.stages.length % COLORS.length], track: track, factor: 1, tsd: [], points: points || [] };
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

  $('fLayer').onclick = function () {
    S.sat = !S.sat;
    if (S.sat) { map.removeLayer(osm); sat.addTo(map); } else { map.removeLayer(sat); osm.addTo(map); }
    this.textContent = S.sat ? t('fab.map') : t('fab.sat');
  };
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
    return pt;
  }

  function drawTracks() {
    gTracks.clearLayers();
    P.stages.forEach(function (st) { if (st.id !== S.stageId) L.polyline(st.track, { color: '#666', weight: 3, opacity: .6, interactive: false }).addTo(gTracks); });
    var st = stage();
    if (st) {
      L.polyline(st.track, { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(gTracks);
      L.polyline(st.track, { color: st.color || COLORS[0], weight: 5, interactive: false }).addTo(gTracks);
    }
  }
  function ctrlLabel(p, st) {
    var km = fmtKm(p.d * fac(st) / 1000);
    return '<div class="ctl-tag ' + p.type + (S.sel === p.id ? ' sel' : '') + '"><b>' + RB.esc(p.code || p.type) + '</b><span>' + km + ' km</span>' + (p.time ? '<span>' + RB.esc(p.time) + '</span>' : '') + '</div>';
  }
  function drawPins() {
    gPins.clearLayers();
    var st = stage(); if (!st || S.draw) return;
    pts(st).forEach(function (p, i) {
      var ctrl = RB.isControl(p);
      if (S.ctrlOnly && !ctrl && S.mode === 'org') return;
      var icon = ctrl
        ? L.divIcon({ className: 'ctl-icon', html: ctrlLabel(p, st), iconSize: null, iconAnchor: [0, 0] })
        : L.divIcon({ className: '', html: '<div class="pin ' + p.type + (S.sel === p.id ? ' sel' : '') + '">' + (i + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] });
      var m = L.marker([p.lat, p.lon], { draggable: S.mode === 'org', autoPan: true, icon: icon, zIndexOffset: ctrl ? 500 : 0 }).addTo(gPins);
      m.on('click', function () { if (S.mode === 'org' && !S.draw) { S.sel = p.id; renderRB(); drawPins(); openPoint(p, false); } });
      m.on('dragend', function () {
        var ll = m.getLatLng(), r = RB.project(st.track, cumOf(st), ll.lat, ll.lng);
        p.d = r.d; p.lat = r.lat; p.lon = r.lon; save(); drawPins(); renderRB();
        toast(t('toast.moved', { km: fmtKm(p.d * fac(st) / 1000) }));
      });
    });
  }
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
    var sel = $('stageSel'); sel.innerHTML = '';
    if (!P.stages.length) { sel.innerHTML = '<option>' + RB.esc(t('stage.none')) + '</option>'; sel.disabled = true; return; }
    sel.disabled = false;
    P.stages.forEach(function (st) {
      var o = document.createElement('option'); o.value = st.id;
      o.textContent = st.name + '  ' + (lenOf(st) * fac(st) / 1000).toFixed(2) + ' km'; sel.appendChild(o);
    });
    sel.value = S.stageId;
  }
  $('stageSel').onchange = function () { selectStage(this.value, true); };
  function selectStage(id, fit) {
    S.stageId = id; S.sel = null; S.suggest = [];
    navResetMatch(); renderAll(); if (fit) fitStage();
  }
  document.querySelectorAll('.mode button').forEach(function (b) { b.onclick = function () { setMode(b.dataset.mode); }; });
  function setMode(m) {
    if (S.draw && m !== 'org') drawCancel();
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
  function instr(p) { var a = LANG === 'th' ? [p.th, p.en] : [p.en, p.th]; return { main: a[0] || a[1] || '', sub: a[0] ? a[1] : '' }; }
  function rowHTML(p, i, prevKm, f) {
    var km = p.d * f / 1000, ins = instr(p);
    return '<div class="rb-row' + (p.type === 'DANGER' ? ' danger' : '') + (RB.isControl(p) ? ' ctrl' : '') + (S.sel === p.id ? ' sel' : '') + '" data-id="' + p.id + '">' +
      '<div><span class="rb-no">#' + (i + 1) + '</span><span class="rb-tot">' + fmtKm(km) + '</span><span class="rb-par">' + fmtKm(km - prevKm) + '</span></div>' +
      '<div class="rb-tulip">' + RB.tulipSVG(p.angle, p.branches, { size: 56 }) + '</div>' +
      '<div class="rb-text">' + tagHTML(p) + (ins.main ? '<span>' + RB.esc(ins.main) + '</span>' : '') + (ins.sub ? '<span class="en">' + RB.esc(ins.sub) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '') + '</div></div>';
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
    ps.forEach(function (p, i) { h += rowHTML(p, i, prev, f); prev = p.d * f / 1000; });
    el.innerHTML = h;
    el.querySelectorAll('.rb-row').forEach(function (r) {
      r.onclick = function () {
        var p = st.points.filter(function (x) { return x.id === r.dataset.id; })[0];
        S.sel = p.id; map.setView([p.lat, p.lon], Math.max(map.getZoom(), 17)); renderRB(); drawPins(); openPoint(p, false);
      };
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
      '<div class="colors">' + COLORS.map(function (c) { return '<button style="background:' + c + '" data-color="' + c + '" aria-pressed="' + (st.color === c) + '" aria-label="' + c + '"></button>'; }).join('') + '</div>' +
      '<div class="kv"><span>' + t('stage.lenGps') + '</span><b>' + (L0 / 1000).toFixed(3) + ' km</b><span>' + t('stage.lenAdj') + '</span><b>' + (L0 * f / 1000).toFixed(3) + ' km</b><span>' + t('stage.nPoints') + '</span><b>' + st.points.length + '</b></div></div>' +

      '<div class="group"><h3>' + t('stage.calTitle') + '</h3>' +
      '<label class="field">' + t('stage.factor') + '<input id="sFac" inputmode="decimal" value="' + f.toFixed(4) + '"></label>' +
      '<div class="row2"><label class="field">' + t('stage.calGps') + '<input id="cGps" inputmode="decimal" placeholder="' + (L0 / 1000).toFixed(2) + '"></label><label class="field">' + t('stage.calOdo') + '<input id="cOdo" inputmode="decimal"></label></div>' +
      '<button id="cApply">' + t('stage.calApply') + '</button><p class="note">' + t('stage.calNote') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.detTitle') + '</h3>' +
      '<label class="field">' + t('stage.detThr') + '<select id="sThr"><option value="25">25°</option><option value="35" selected>35°</option><option value="50">50°</option></select></label>' +
      '<div class="row2"><button id="sDetect">' + t('stage.detShow') + '</button><button id="sClear">' + t('stage.detHide') + '</button></div>' +
      '<button id="sAddAll">' + t('stage.detAddAll') + '</button><p class="note" id="sDetNote">' + t('stage.detNote') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.trimTitle') + '</h3>' +
      '<div class="row2"><label class="field">' + t('stage.trimFrom') + '<input id="tFrom" inputmode="decimal" value="0.00"></label><label class="field">' + t('stage.trimTo') + '<input id="tTo" inputmode="decimal" value="' + (L0 * f / 1000).toFixed(2) + '"></label></div>' +
      '<button id="tApply">' + t('stage.trimApply') + '</button><p class="note">' + t('stage.trimNote') + '</p></div>' +

      '<div class="group"><h3>' + t('stage.tsdTitle') + '</h3>' +
      '<table class="tsd-table"><thead><tr><th>' + t('stage.tsdFrom') + '</th><th>km/h</th><th></th></tr></thead><tbody>' + tsdRows + '</tbody></table>' +
      '<button id="tsdAdd">' + t('stage.tsdAdd') + '</button><p class="note">' + t('stage.tsdNote') + '</p></div>' +

      '<div class="group"><button id="sDel" class="danger-btn">' + t('stage.delete') + '</button></div>';

    $('sName').onchange = function () { st.name = this.value.trim() || st.name; save(); renderStageSel(); };
    el.querySelectorAll('[data-color]').forEach(function (b) { b.onclick = function () { st.color = b.dataset.color; save(); drawTracks(); renderStagePanel(); }; });
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
      if (!confirm(t('confirm.addAll', { n: S.suggest.length }))) return;
      S.suggest.forEach(function (s) { st.points.push(newPointAt(st, s.d, s.angle, 'TULIP')); });
      S.suggest = []; save(); renderAll(); toast(t('toast.addedCheck'), 4000);
    };
    $('tApply').onclick = function () {
      var a = parseFloat($('tFrom').value) * 1000 / f, b = parseFloat($('tTo').value) * 1000 / f;
      if (!(isFinite(a) && isFinite(b) && b - a > 20)) return toast(t('err.trimRange'));
      var drop = st.points.filter(function (p) { return p.d < a - 0.5 || p.d > b + 0.5; }).length;
      if (!confirm(t('confirm.trim', { a: (a * f / 1000).toFixed(2), b: (b * f / 1000).toFixed(2), n: drop }))) return;
      var r = RB.trimStage(st, a, b); st.track = r.track; st.points = r.points;
      S.suggest = []; navResetMatch(); save(); renderAll(); fitStage(); toast(t('toast.trimmed'));
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
      if (!confirm(t('confirm.delStage', { name: st.name }))) return;
      P.stages = P.stages.filter(function (x) { return x !== st; }); S.stageId = P.stages[0] ? P.stages[0].id : null; save(); renderAll(); fitStage();
    };
  }

  // ---------- Point dialog ----------
  var D = null, Dorig = null, Dnew = false, DautoCode = false;
  function buildDlgLabels() {
    $('ptTypes').innerHTML = TYPES.map(function (k) { return '<button type="button" data-type="' + k + '">' + typeName(k) + '</button>'; }).join('');
    $('ptPresets').innerHTML = RB.PRESETS.map(function (p) { return '<button type="button" data-a="' + p.a + '" title="' + (LANG === 'th' ? p.th : p.en) + '">' + RB.tulipSVG(p.a, [], { size: 40, stroke: 7 }) + '</button>'; }).join('') +
      '<button type="button" data-a="none" title="' + t('pt.noArrow') + '">' + RB.tulipSVG(null, [], { size: 40, stroke: 7 }) + '</button>';
    $('ptBranches').innerHTML = BRANCH_SET.map(function (a) { return '<button type="button" data-b="' + a + '" aria-label="' + a + '°">' + RB.tulipSVG(null, [a], { size: 28, stroke: 7 }) + '</button>'; }).join('');
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
    $('ptBranches').onclick = function (e) {
      var b = e.target.closest('[data-b]'); if (!b) return; var a = +b.dataset.b, i = D.branches.indexOf(a);
      if (i >= 0) D.branches.splice(i, 1); else D.branches.push(a); syncDlg();
    };
    document.querySelectorAll('[data-nudge]').forEach(function (b) {
      b.onclick = function () {
        var st = stage(), f = fac(st), nd = Math.max(0, Math.min(lenOf(st), D.d + (+b.dataset.nudge) / f));
        var p = RB.pointAt(st.track, cumOf(st), nd); D.d = nd; D.lat = p[0]; D.lon = p[1]; syncDlg(); showDraft();
      };
    });
    var fmap = { ptTh: 'th', ptEn: 'en', ptNote: 'note', ptCode: 'code', ptTime: 'time' };
    Object.keys(fmap).forEach(function (id) {
      $(id).oninput = function () { D[fmap[id]] = id === 'ptCode' ? this.value.toUpperCase() : this.value; if (id === 'ptCode') DautoCode = false; };
      $(id).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } };
    });
    $('ptSave').onclick = function () {
      var st = stage();
      D.code = (D.code || '').trim();
      if (Dnew) st.points.push(D); else Object.assign(Dorig, D);
      S.sel = D.id; save(); $('ptDlg').close(); renderAll();
    };
    $('ptDel').onclick = function () {
      var st = stage(); if (!Dnew && !confirm(t('confirm.delPoint'))) return;
      st.points = st.points.filter(function (p) { return p.id !== D.id; }); S.sel = null; save(); $('ptDlg').close(); renderAll();
    };
    $('ptDlg').addEventListener('close', function () { if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; } D = null; });
  })();
  function openPoint(p, isNew) {
    Dorig = p; Dnew = isNew; D = JSON.parse(JSON.stringify(p)); D.branches = D.branches || []; D.code = D.code || ''; D.time = D.time || '';
    DautoCode = isNew && !!D.code;
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || ''; $('ptNote').value = D.note || '';
    $('ptDel').textContent = isNew ? t('pt.discard') : t('pt.delete');
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
    $('ptPreview').innerHTML = RB.tulipSVG(D.angle, D.branches, { size: 110, ink: '#000' });
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || '';
  }

  // ---------- Draw route ----------
  function drawStart() {
    if (S.mode !== 'org') setMode('org');
    setAdd(false); S.suggest = []; drawSuggest();
    S.draw = { wps: [], segs: [], snap: true, warned: false };
    $('drawBar').hidden = false; $('fDraw').hidden = true; $('fAdd').hidden = true; $('fFilter').hidden = true;
    gPins.clearLayers(); map.getContainer().style.cursor = 'crosshair';
    drawRender();
  }
  function drawEnd() {
    S.draw = null; gDraw.clearLayers();
    $('drawBar').hidden = true; $('fDraw').hidden = false; $('fAdd').hidden = false; $('fFilter').hidden = false;
    map.getContainer().style.cursor = ''; drawPins();
  }
  function drawCancel() {
    if (S.draw && S.draw.wps.length > 1 && !confirm(t('confirm.drawCancel'))) return false;
    drawEnd(); return true;
  }
  $('fDraw').onclick = drawStart;
  $('dCancel').onclick = drawCancel;
  $('dSnap').onclick = function () { if (S.draw) { S.draw.snap = true; drawRender(); } };
  $('dLine').onclick = function () { if (S.draw) { S.draw.snap = false; drawRender(); } };
  $('dUndo').onclick = function () { var d = S.draw; if (!d || !d.wps.length) return; d.wps.pop(); d.segs.pop(); drawRender(); };
  $('dDone').onclick = function () {
    var d = S.draw; if (!d) return;
    if (d.segs.some(function (s) { return s.busy; })) return toast(t('draw.wait'));
    var track = drawTrack();
    if (track.length < 2) return toast(t('err.drawShort'));
    var name = prompt(t('prompt.stageName'), nextStageName()); if (name === null) return;
    var st = addStage(name.trim() || nextStageName(), RB.cleanTrack(track, 1));
    drawEnd(); selectStage(st.id, true); toast(t('toast.stageCreated', { name: st.name, km: (lenOf(st) / 1000).toFixed(2) }), 3500);
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
        var o = JSON.parse(fr.result); if (!o || !Array.isArray(o.stages)) throw 0;
        if (P.stages.length && !confirm(t('confirm.replace', { name: o.name || f.name }))) return;
        P = o; S.stageId = P.stages[0] ? P.stages[0].id : null; save(); renderAll(); fitStage(); toast(t('toast.opened', { name: P.name || f.name }));
      } catch (e) { toast(t('err.notProject')); }
    };
    fr.readAsText(f);
  };
  $('bSaveJson').onclick = function () { download(safeName(P.name) + '.json', JSON.stringify(P), 'application/json'); };
  $('bCsv').onclick = function () {
    if (!P.stages.length) return toast(t('err.noStage'));
    var body = P.stages.map(function (st, i) { var c = RB.stageCSV(st); return i ? c.split('\r\n').slice(1).join('\r\n') : c; }).join('\r\n');
    download(safeName(P.name) + '_roadbook.csv', '﻿' + body, 'text/csv;charset=utf-8');
  };
  $('bGpxOut').onclick = function () { if (!P.stages.length) return toast(t('err.noStage')); download(safeName(P.name) + '.gpx', RB.stageGPX(P.stages), 'application/gpx+xml'); };
  $('bLogOut').onclick = exportLog;
  $('projName').onchange = function () { P.name = this.value.trim() || P.name; save(); };
  $('bNewProj').onclick = function () {
    if (!confirm(t('confirm.newProj'))) return;
    P = newProject(); S.stageId = null; save(); renderAll();
  };
  $('langSeg').onclick = function (e) { var b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); };
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
    if (!N.sound && !force) return;
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
    if (N.follow && (S.mode === 'rec' || N.map)) map.setView(ll, Math.max(map.getZoom(), 16), { animate: false });
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
    if (c.accuracy <= 30) {
      var last = R.pts[R.pts.length - 1], ll = [c.latitude, c.longitude];
      var step = last ? RB.hav([last[0], last[1]], ll) : 0;
      // skip jitter while stopped, and implausible jumps (> 70 m/s)
      if (!last || (step >= Math.max(3, c.accuracy * 0.5) && step / Math.max(0.5, (ts - last[2]) / 1000) < 70)) {
        R.pts.push([+c.latitude.toFixed(7), +c.longitude.toFixed(7), ts]); R.dist += step;
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
      if (navigator.vibrate) navigator.vibrate(80); beep(1200, 1, true);
      saveRec(true); renderRec(); toast(t('rec.marked', { k: t('mark.' + m.k), km: fmtKm(m.km) }), 1500);
    };
  });
  $('rFinish').onclick = function () {
    if (R.pts.length < 2) return toast(t('rec.tooShort'));
    if (R.on) recPause();
    var name = prompt(t('prompt.stageName'), nextStageName()); if (name === null) return;
    var tr = RB.cleanTrack(R.pts.map(function (p) { return [p[0], p[1]]; }), 2);
    if (tr.length < 2) return toast(t('rec.tooShort'));
    var st = addStage(name.trim() || nextStageName(), tr), cum = cumOf(st);
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
      st.points.push(p);
    });
    var n = R.marks.length;
    R = loadRec(); R.pts = []; R.marks = []; R.startT = null; R.elapsed = 0; R.dist = 0;
    try { store.removeItem(RKEY); } catch (e) {}
    save(); setMode('org'); selectStage(st.id, true);
    toast(t('toast.recDone', { name: st.name, km: (lenOf(st) / 1000).toFixed(2), n: n }), 4500);
  };
  $('rDiscard').onclick = function () {
    if (!R.pts.length && !R.marks.length) return;
    if (!confirm(t('confirm.recDiscard'))) return;
    if (R.on) recPause();
    R.pts = []; R.marks = []; R.startT = null; R.elapsed = 0; R.dist = 0;
    try { store.removeItem(RKEY); } catch (e) {}
    recDrawAll(); renderRec();
  };
  function renderRec() {
    $('rStart').textContent = R.on ? t('rec.pause') : R.startT ? t('rec.resume') : t('rec.start');
    $('rStart').classList.toggle('primary', !R.on);
    if (S.mode !== 'rec') return;
    $('rDist').textContent = fmtKm(R.dist / 1000);
    $('rTime').textContent = fmtClock(recElapsed());
    var g = $('rGps');
    if (!R.on) { g.textContent = t('gps.off'); g.className = ''; }
    else if (!R.fix) { g.textContent = t('gps.wait'); g.className = 'warn'; }
    else { g.textContent = 'GPS ±' + Math.round(R.fix.acc) + ' m'; g.className = R.fix.acc > 30 ? 'warn' : ''; }
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
    var d = { offset: {}, tsdStart: {}, log: [], sound: true, vib: true, night: false, map: true, rec: true };
    try { var s = JSON.parse(store.getItem(NKEY) || 'null'); if (s) Object.assign(d, s); } catch (e) {}
    d.on = false; d.matcher = null; d.d = null; d.fix = null; d.follow = true; d.alerted = {}; d.manualBase = null;
    return d;
  }
  var navSaveT;
  function saveNav() {
    clearTimeout(navSaveT);
    navSaveT = setTimeout(function () {
      try { store.setItem(NKEY, JSON.stringify({ offset: N.offset, tsdStart: N.tsdStart, log: N.log.slice(-20000), sound: N.sound, vib: N.vib, night: N.night, map: N.map, rec: N.rec })); } catch (e) {}
    }, 1000);
  }
  function navResetMatch() { N.matcher = null; N.d = null; N.alerted = {}; N.manualBase = null; }
  function matcher() { var st = stage(); if (!st) return null; if (!N.matcher) N.matcher = new RB.Matcher(st.track, cumOf(st), { maxOff: 40, maxAcc: 50 }); return N.matcher; }
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
    if (N.rec && c.accuracy <= 50) {
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
    var dist = (s.next.d - s.x) * s.f;
    for (var i = ALERTS.length - 1; i >= 0; i--) {
      var th = ALERTS[i], k = s.next.id + ':' + th;
      if (dist <= th && !N.alerted[k]) {
        ALERTS.forEach(function (t2) { if (t2 >= th) N.alerted[s.next.id + ':' + t2] = true; });
        var close = th === 50;
        beep(close ? 1400 : th === 100 ? 1100 : 800, close ? 3 : th === 100 ? 2 : 1);
        if (N.vib && navigator.vibrate) navigator.vibrate(close ? [200, 80, 200, 80, 200] : th === 100 ? [150, 80, 150] : [150]);
        var box = $('dNext'); box.classList.remove('flash'); void box.offsetWidth; if (close) box.classList.add('flash');
        break;
      }
    }
  }
  function boxFill(p, s, kmId, tulipId, textId, inId) {
    if (!p) { $(tulipId).innerHTML = ''; $(textId).innerHTML = inId ? t('nav.noNext') : ''; $(kmId).textContent = ''; if (inId) $(inId).textContent = '--'; return; }
    var idx = s.ps.indexOf(p) + 1, ink = N.night && !inId ? '#fff' : '#000', ins = instr(p);
    $(kmId).textContent = '#' + idx + '  ' + fmtKm(p.d * s.f / 1000);
    $(tulipId).innerHTML = RB.tulipSVG(p.angle, p.branches, { size: inId ? 84 : 52, ink: ink });
    $(textId).innerHTML = tagHTML(p) + (ins.main ? '<span>' + RB.esc(ins.main) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '');
    if (inId) {
      var dist = s.x == null ? null : (p.d - s.x) * s.f;
      $(inId).textContent = dist == null ? '--' : dist >= 1000 ? (dist / 1000).toFixed(2) + 'k' : Math.max(0, Math.round(dist / 10) * 10) + ' m';
    }
  }
  function renderNav() {
    document.body.classList.toggle('night', S.mode === 'nav' && N.night);
    document.body.classList.toggle('nomap', !N.map);
    $('bGps').textContent = N.on ? t('nav.gpsStop') : t('nav.gpsStart'); $('bGps').classList.toggle('primary', !N.on);
    if (S.mode !== 'nav') return;
    var s = navState();
    $('dTotal').textContent = s && s.km != null ? fmtKm(s.km) : '--.--';
    var base = s && s.prev ? s.prev.d * s.f / 1000 : 0;
    if (N.manualBase != null && N.manualBase > base) base = N.manualBase;
    $('dPartial').textContent = s && s.km != null ? fmtKm(Math.max(0, s.km - base)) : '-.--';
    var g = $('dGps');
    if (!N.on) { g.textContent = t('gps.off'); g.className = ''; }
    else if (!N.fix) { g.textContent = t('gps.wait'); g.className = 'warn'; }
    else { g.textContent = 'GPS ±' + Math.round(N.fix.acc) + ' m'; g.className = N.fix.acc > 20 ? 'warn' : ''; }
    $('dSpeed').textContent = N.fix ? Math.round(N.fix.spd * 3.6) + ' km/h' : '-- km/h';
    $('dRec').textContent = N.rec && N.on ? t('nav.logged', { n: N.log.length }) : '';
    var off = N.on && N.match && N.match.offRoute && N.fix;
    $('dOff').hidden = !off; if (off) $('dOffM').textContent = Math.round(N.match.off) + ' m';
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
        el.textContent = (dlt >= 0 ? '+' : '−') + Math.abs(dlt).toFixed(1) + ' s';
        el.className = 'tsd-d ' + (dlt > 0.5 ? 'late' : dlt < -0.5 ? 'early' : '');
        $('dTsdElapsed').textContent = (dlt > 0.5 ? t('nav.late') : dlt < -0.5 ? t('nav.early') : t('nav.onTime')) + '  ' + fmtClock(elapsed);
      } else { el.textContent = '--'; el.className = 'tsd-d'; $('dTsdElapsed').textContent = t('nav.tsdHint'); }
    }
  }
  setInterval(function () {
    if (S.mode === 'nav' && N.tsdStart[S.stageId]) renderNav();
    if (S.mode === 'rec' && R.on) $('rTime').textContent = fmtClock(recElapsed());
  }, 500);

  $('partialCell').onclick = function () { var s = navState(); if (s && s.km != null) { N.manualBase = s.km; renderNav(); toast(t('toast.partialZero')); } };
  $('bSync').onclick = function () {
    var s = navState(); if (!s || N.d == null) return toast(t('err.noPos'));
    var best = null; s.ps.forEach(function (p) { var dd = Math.abs(p.d - s.x); if (!best || dd < best.dd) best = { p: p, dd: dd }; });
    if (!best || best.dd * s.f > 400) return toast(t('err.noNearPoint'));
    N.offset[S.stageId] = best.p.d - N.d; N.alerted = {}; N.manualBase = null; saveNav(); renderNav();
    toast(t('toast.synced', { n: s.ps.indexOf(best.p) + 1, km: fmtKm(best.p.d * s.f / 1000) }));
  };
  function nudge(m) { var st = stage(); if (!st) return; N.offset[S.stageId] = offOf() + m / fac(st); saveNav(); renderNav(); }
  $('bMinus').onclick = function () { nudge(-10); };
  $('bPlus').onclick = function () { nudge(10); };
  $('bTsd').onclick = function () {
    var id = S.stageId; if (!id) return;
    if (N.tsdStart[id]) { toast(t('toast.tsdAlready')); return; }
    N.tsdStart[id] = Date.now(); saveNav(); renderNav(); beep(1000, 1); toast(t('toast.tsdStarted'));
  };
  $('bMore').onclick = function () {
    $('oMap').checked = N.map; $('oSound').checked = N.sound; $('oVib').checked = N.vib; $('oNight').checked = N.night; $('oRec').checked = N.rec;
    $('moreDlg').showModal();
  };
  [['oMap', 'map'], ['oSound', 'sound'], ['oVib', 'vib'], ['oNight', 'night'], ['oRec', 'rec']].forEach(function (x) {
    $(x[0]).onchange = function () { N[x[1]] = this.checked; saveNav(); renderNav(); if (x[1] === 'map') setTimeout(function () { map.invalidateSize(); }, 60); };
  });
  $('oTsdReset').onclick = function () { delete N.tsdStart[S.stageId]; saveNav(); renderNav(); toast(t('toast.tsdReset')); };
  $('oOffReset').onclick = function () { delete N.offset[S.stageId]; saveNav(); renderNav(); toast(t('toast.offReset')); };
  $('oLog').onclick = exportLog;
  $('oLogClear').onclick = function () { if (confirm(t('confirm.logClear'))) { N.log = []; saveNav(); gNav.clearLayers(); gpsMarker = accCircle = null; navDrawStatic(); renderNav(); } };
  function exportLog() {
    if (!N.log.length) return toast(t('err.noLog'));
    var st = stage(), nm = (st ? st.name : 'run') + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    download(safeName(nm) + '.gpx', RB.logGPX(nm, N.log), 'application/gpx+xml');
  }

  // ---------- Render all ----------
  function renderAll() {
    $('projName').value = P.name || '';
    $('storeNote').textContent = store.mem ? t('file.storeMem') : t('file.storeOk');
    renderStageSel(); drawTracks(); drawPins(); drawSuggest(); renderRB(); renderStagePanel(); renderNav(); renderRec();
  }
  applyI18n(); renderAll(); fitStage();
  if (R.startT) toast(t('rec.restored'), 4000);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    var offerUpdate = function (w) {
      if (!w || !navigator.serviceWorker.controller) return;
      toast(t('toast.update'), 600000);
      $('toast').onclick = function () { w.postMessage('skip'); };
    };
    navigator.serviceWorker.register('sw.js').then(function (reg) {
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
