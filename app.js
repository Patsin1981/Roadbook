/* Rally Roadbook — app logic */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'rb.project.v1', NKEY = 'rb.nav.v1';
  var COLORS = ['#0050B3', '#D0021B', '#007A3D', '#7A3EB1', '#E07000', '#00838F'];
  var TYPES = [
    { k: 'START', l: 'START' }, { k: 'TULIP', l: 'Tulip' }, { k: 'CP', l: 'CP' }, { k: 'PC', l: 'PC' },
    { k: 'TC', l: 'TC' }, { k: 'DANGER', l: 'อันตราย' }, { k: 'INFO', l: 'Info' }, { k: 'FINISH', l: 'FINISH' }
  ];
  var BRANCH_SET = [-135, -90, -45, 0, 45, 90, 135];
  var ALERTS = [300, 100, 50];

  function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
  function fmtKm(km) { return km == null || !isFinite(km) ? '--.--' : km.toFixed(2); }
  function toast(msg, ms) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  // ---------- Storage (localStorage on device; falls back to memory if blocked) ----------
  var store = (function () {
    try { localStorage.setItem('rb.t', '1'); localStorage.removeItem('rb.t'); return localStorage; }
    catch (e) { var m = {}; return { getItem: function (k) { return k in m ? m[k] : null; }, setItem: function (k, v) { m[k] = v; }, removeItem: function (k) { delete m[k]; }, mem: true }; }
  })();
  function newProject() { return { v: 1, name: 'Rally ใหม่', stages: [] }; }
  function load() { try { var s = store.getItem(KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  var saveT;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(function () {
      try { store.setItem(KEY, JSON.stringify(P)); } catch (e) { toast('บันทึกในเครื่องไม่สำเร็จ: พื้นที่เต็ม ให้ส่งออกเป็น .json ไว้ก่อน', 5000); }
    }, 300);
  }

  var P = load() || newProject();
  var S = { mode: 'org', stageId: P.stages[0] ? P.stages[0].id : null, sel: null, addMode: false, suggest: [], sat: false };
  var cumCache = new WeakMap();
  function stage() { return P.stages.filter(function (s) { return s.id === S.stageId; })[0] || null; }
  function cumOf(st) { var c = cumCache.get(st.track); if (!c) { c = RB.buildCum(st.track); cumCache.set(st.track, c); } return c; }
  function lenOf(st) { var c = cumOf(st); return c.length ? c[c.length - 1] : 0; }
  function fac(st) { return st && st.factor > 0 ? st.factor : 1; }
  function pts(st) { return RB.sortedPoints(st); }

  // ---------- Map ----------
  var map = L.map('map', { zoomControl: false, attributionControl: true, preferCanvas: true }).setView([13.75, 100.5], 6);
  var osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: 'anonymous', attribution: '&copy; OpenStreetMap' }).addTo(map);
  var sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 20, maxNativeZoom: 18, crossOrigin: 'anonymous', attribution: 'Imagery &copy; Esri' });
  var gTracks = L.layerGroup().addTo(map), gPins = L.layerGroup().addTo(map), gSug = L.layerGroup().addTo(map), gNav = L.layerGroup().addTo(map);
  var draftMarker = null;

  $('fLayer').onclick = function () {
    S.sat = !S.sat;
    if (S.sat) { map.removeLayer(osm); sat.addTo(map); this.textContent = 'แผนที่'; }
    else { map.removeLayer(sat); osm.addTo(map); this.textContent = 'ดาวเทียม'; }
  };
  $('fFit').onclick = fitStage;
  function fitStage() { var st = stage(); if (st && st.track.length) map.fitBounds(L.latLngBounds(st.track), { padding: [24, 24] }); }
  $('fAdd').onclick = function () { setAdd(!S.addMode); };
  function setAdd(on) {
    S.addMode = on; $('fAdd').setAttribute('aria-pressed', on); $('addHint').hidden = !on;
    map.getContainer().style.cursor = on ? 'crosshair' : '';
  }
  $('fLocate').onclick = function () {
    if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับ GPS');
    navigator.geolocation.getCurrentPosition(function (p) {
      var ll = [p.coords.latitude, p.coords.longitude];
      gNav.clearLayers(); L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gpsdot"></div>', iconSize: [20, 20] }) }).addTo(gNav);
      map.setView(ll, Math.max(map.getZoom(), 16));
    }, function (e) { toast('หาตำแหน่งไม่ได้: ' + e.message); }, { enableHighAccuracy: true, timeout: 15000 });
  };

  map.on('click', function (e) {
    if (S.mode !== 'org' || !S.addMode) return;
    var st = stage(); if (!st) return toast('นำเข้า GPX ก่อนวางจุด');
    var r = RB.project(st.track, cumOf(st), e.latlng.lat, e.latlng.lng);
    if (r.off > 60) return toast('จุดห่างเส้นทาง ' + Math.round(r.off) + ' m ให้แตะใกล้เส้นมากกว่านี้');
    openPoint(newPointAt(st, r.d), true);
  });

  function newPointAt(st, d, angle) {
    var p = RB.pointAt(st.track, cumOf(st), d);
    var a = angle != null ? angle : RB.angleAt(st.track, cumOf(st), d, 30);
    var ps = pts(st), type = !ps.length ? 'START' : 'TULIP';
    var ang = type === 'START' ? null : (Math.abs(a) < 12 ? 0 : Math.round(a / 5) * 5);
    var pre = RB.nearestPreset(ang);
    return { id: uid(), d: d, lat: p[0], lon: p[1], type: type, danger: 1, angle: ang, branches: [], th: pre && type !== 'START' ? pre.th : '', en: pre && type !== 'START' ? pre.en : '', note: '' };
  }

  function drawTracks() {
    gTracks.clearLayers();
    P.stages.forEach(function (st) {
      var active = st.id === S.stageId;
      if (!active) L.polyline(st.track, { color: '#666', weight: 3, opacity: .6, interactive: false }).addTo(gTracks);
    });
    var st = stage();
    if (st) {
      L.polyline(st.track, { color: '#fff', weight: 9, opacity: .9, interactive: false }).addTo(gTracks);
      L.polyline(st.track, { color: st.color || COLORS[0], weight: 5, interactive: false }).addTo(gTracks);
    }
  }
  function drawPins() {
    gPins.clearLayers();
    var st = stage(); if (!st) return;
    pts(st).forEach(function (p, i) {
      var m = L.marker([p.lat, p.lon], {
        draggable: S.mode === 'org', autoPan: true,
        icon: L.divIcon({ className: '', html: '<div class="pin ' + p.type + (S.sel === p.id ? ' sel' : '') + '">' + (i + 1) + '</div>', iconSize: [28, 28], iconAnchor: [14, 14] })
      }).addTo(gPins);
      m.on('click', function () { if (S.mode === 'org') { S.sel = p.id; renderRB(); drawPins(); openPoint(p, false); } });
      m.on('dragend', function () {
        var ll = m.getLatLng(), r = RB.project(st.track, cumOf(st), ll.lat, ll.lng);
        p.d = r.d; p.lat = r.lat; p.lon = r.lon; save(); drawPins(); renderRB();
        toast('ย้ายจุดไปที่ ' + fmtKm(p.d * fac(st) / 1000) + ' km');
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
    if (!P.stages.length) { sel.innerHTML = '<option>ยังไม่มี stage</option>'; sel.disabled = true; return; }
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
    navResetMatch();
    renderAll(); if (fit) fitStage();
  }
  document.querySelectorAll('.mode button').forEach(function (b) {
    b.onclick = function () { setMode(b.dataset.mode); };
  });
  function setMode(m) {
    S.mode = m; setAdd(false);
    document.body.classList.toggle('mode-org', m === 'org'); document.body.classList.toggle('mode-nav', m === 'nav');
    document.querySelectorAll('.mode button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === m); });
    if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; }
    gNav.clearLayers(); if (m === 'nav') navDrawStatic();
    drawPins(); drawSuggest(); renderNav();
    setTimeout(function () { map.invalidateSize(); if (m === 'nav' && N.fix && N.follow) map.setView([N.fix.lat, N.fix.lon], Math.max(map.getZoom(), 16)); }, 60);
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tabs button').forEach(function (x) { x.setAttribute('aria-selected', x === b); });
      ['rb', 'stage', 'file'].forEach(function (t) { $('tab-' + t).hidden = t !== b.dataset.tab; });
    };
  });

  // ---------- Roadbook list ----------
  function rowHTML(p, i, prevKm, f) {
    var km = p.d * f / 1000, dangerMarks = p.type === 'DANGER' ? ' ' + '!'.repeat(p.danger || 1) : '';
    var tag = p.type === 'TULIP' ? '' : '<span class="tag ' + p.type + '">' + (p.type === 'DANGER' ? 'อันตราย' + dangerMarks : p.type) + '</span>';
    return '<div class="rb-row' + (p.type === 'DANGER' ? ' danger' : '') + (S.sel === p.id ? ' sel' : '') + '" data-id="' + p.id + '">' +
      '<div><span class="rb-no">#' + (i + 1) + '</span><span class="rb-tot">' + fmtKm(km) + '</span><span class="rb-par">' + fmtKm(km - prevKm) + '</span></div>' +
      '<div class="rb-tulip">' + (p.type === 'START' && p.angle == null ? RB.tulipSVG(null, [], { size: 56 }) : RB.tulipSVG(p.angle, p.branches, { size: 56 })) + '</div>' +
      '<div class="rb-text">' + tag + (p.th ? '<span>' + RB.esc(p.th) + '</span>' : '') + (p.en ? '<span class="en">' + RB.esc(p.en) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '') + '</div></div>';
  }
  function renderRB() {
    var el = $('tab-rb'), st = stage();
    if (!st) {
      el.innerHTML = '<div class="empty"><b>ยังไม่มีเส้นทาง</b>นำเข้าไฟล์ GPX จากการ recce เพื่อเริ่มวางจุด roadbook<label class="btn">นำเข้า GPX<input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" multiple hidden id="inGpx2"></label></div>';
      $('inGpx2').onchange = function () { importGpxFiles(this.files); this.value = ''; };
      return;
    }
    var ps = pts(st), f = fac(st);
    if (!ps.length) { el.innerHTML = '<div class="empty"><b>ยังไม่มีจุดใน ' + RB.esc(st.name) + '</b>กดปุ่ม “+ จุด” แล้วแตะบนเส้นทาง หรือไปที่แท็บ Stage เพื่อให้ระบบหาจุดเลี้ยวให้</div>'; return; }
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
    if (!st) { el.innerHTML = '<div class="empty">นำเข้า GPX ก่อน จึงจะตั้งค่า stage ได้</div>'; return; }
    var f = fac(st), L0 = lenOf(st);
    var tsdRows = (st.tsd || []).map(function (s, i) {
      return '<tr><td><input inputmode="decimal" data-tsd="' + i + '" data-k="fromKm" value="' + s.fromKm + '"></td><td><input inputmode="decimal" data-tsd="' + i + '" data-k="kmh" value="' + s.kmh + '"></td><td><button data-tsddel="' + i + '">ลบ</button></td></tr>';
    }).join('');
    el.innerHTML =
      '<div class="group"><label class="field">ชื่อ stage<input id="sName" value="' + RB.esc(st.name) + '"></label>' +
      '<div class="colors">' + COLORS.map(function (c) { return '<button style="background:' + c + '" data-color="' + c + '" aria-pressed="' + (st.color === c) + '" aria-label="สี ' + c + '"></button>'; }).join('') + '</div>' +
      '<div class="kv"><span>ระยะจาก GPS</span><b>' + (L0 / 1000).toFixed(3) + ' km</b><span>ระยะหลังปรับ</span><b>' + (L0 * f / 1000).toFixed(3) + ' km</b><span>จำนวนจุด</span><b>' + st.points.length + '</b></div></div>' +

      '<div class="group"><h3>ปรับระยะให้ตรง odometer</h3>' +
      '<label class="field">ตัวคูณระยะ (correction factor)<input id="sFac" inputmode="decimal" value="' + f.toFixed(4) + '"></label>' +
      '<div class="row2"><label class="field">ระยะในแอป (km, GPS)<input id="cGps" inputmode="decimal" placeholder="' + (L0 / 1000).toFixed(2) + '"></label><label class="field">ระยะ odometer จริง (km)<input id="cOdo" inputmode="decimal"></label></div>' +
      '<button id="cApply">คำนวณตัวคูณ</button>' +
      '<p class="note">วิ่งช่วงทดสอบ (calibration zone) แล้วกรอกระยะที่แอปวัดได้เทียบกับ odometer ระบบจะคำนวณตัวคูณให้ ระยะทุกจุดใน roadbook และ CSV จะปรับตาม</p></div>' +

      '<div class="group"><h3>หาจุดเลี้ยวอัตโนมัติ</h3>' +
      '<label class="field">มุมเลี้ยวขั้นต่ำ<select id="sThr"><option value="25">25° (จับละเอียด)</option><option value="35" selected>35°</option><option value="50">50° (เฉพาะเลี้ยวชัด)</option></select></label>' +
      '<div class="row2"><button id="sDetect">แสดงจุดที่เจอบนแผนที่</button><button id="sClear">ซ่อนจุดแนะนำ</button></div>' +
      '<button id="sAddAll">เพิ่มจุดแนะนำทั้งหมดเป็น tulip</button>' +
      '<p class="note" id="sDetNote">จุดที่ระบบหาเจอเป็นวงกลมประสีเหลือง แตะเพื่อเพิ่มทีละจุด ควรตรวจกับภาพดาวเทียมทุกจุด</p></div>' +

      '<div class="group"><h3>TSD ความเร็วเฉลี่ย</h3>' +
      '<table class="tsd-table"><thead><tr><th>เริ่มที่ km</th><th>km/h</th><th></th></tr></thead><tbody>' + tsdRows + '</tbody></table>' +
      '<button id="tsdAdd">เพิ่มช่วงความเร็ว</button>' +
      '<p class="note">ความเร็วแต่ละช่วงใช้ตั้งแต่ km ที่กำหนดไปจนถึงช่วงถัดไป ใช้ระยะตาม roadbook (หลังปรับตัวคูณ)</p></div>' +

      '<div class="group"><button id="sDel" class="danger-btn">ลบ stage นี้</button></div>';

    $('sName').onchange = function () { st.name = this.value.trim() || st.name; save(); renderStageSel(); };
    el.querySelectorAll('[data-color]').forEach(function (b) { b.onclick = function () { st.color = b.dataset.color; save(); drawTracks(); renderStagePanel(); }; });
    $('sFac').onchange = function () {
      var v = parseFloat(this.value); if (!(v > 0.8 && v < 1.2)) { toast('ตัวคูณควรอยู่ระหว่าง 0.8–1.2'); this.value = f.toFixed(4); return; }
      st.factor = v; save(); renderAll();
    };
    $('cApply').onclick = function () {
      var g = parseFloat($('cGps').value) || L0 / 1000, o = parseFloat($('cOdo').value);
      if (!(o > 0 && g > 0)) return toast('กรอกระยะ odometer ก่อน');
      var v = o / g; if (!(v > 0.8 && v < 1.2)) return toast('ผลต่างเกิน 20% ตรวจตัวเลขอีกครั้ง');
      st.factor = +v.toFixed(4); save(); renderAll(); toast('ตั้งตัวคูณเป็น ' + st.factor.toFixed(4));
    };
    $('sDetect').onclick = function () {
      S.suggest = RB.detectTurns(st.track, cumOf(st), { threshold: +$('sThr').value });
      var have = pts(st);
      S.suggest = S.suggest.filter(function (s) { return !have.some(function (p) { return Math.abs(p.d - s.d) < 40; }); });
      drawSuggest(); $('sDetNote').textContent = 'เจอ ' + S.suggest.length + ' จุด (ไม่นับจุดที่มีอยู่แล้วในระยะ 40 m) แตะวงกลมบนแผนที่เพื่อเพิ่มทีละจุด';
    };
    $('sClear').onclick = function () { S.suggest = []; drawSuggest(); };
    $('sAddAll').onclick = function () {
      if (!S.suggest.length) return toast('กด “แสดงจุดที่เจอบนแผนที่” ก่อน');
      if (!confirm('เพิ่ม ' + S.suggest.length + ' จุดเป็น tulip?')) return;
      S.suggest.forEach(function (s) { st.points.push(newPointAt(st, s.d, s.angle)); });
      S.suggest = []; save(); renderAll(); toast('เพิ่มจุดแล้ว ตรวจคำสั่งและทางแยกอื่นในแต่ละจุดอีกครั้ง', 4000);
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
      if (!confirm('ลบ ' + st.name + ' และจุดทั้งหมดใน stage นี้?')) return;
      P.stages = P.stages.filter(function (x) { return x !== st; }); S.stageId = P.stages[0] ? P.stages[0].id : null; save(); renderAll(); fitStage();
    };
  }

  // ---------- Point dialog ----------
  var D = null, Dorig = null, Dnew = false;
  (function buildDlg() {
    $('ptTypes').innerHTML = TYPES.map(function (t) { return '<button type="button" data-type="' + t.k + '">' + t.l + '</button>'; }).join('');
    $('ptPresets').innerHTML = RB.PRESETS.map(function (p) { return '<button type="button" data-a="' + p.a + '" title="' + p.th + '">' + RB.tulipSVG(p.a, [], { size: 40, stroke: 7 }) + '</button>'; }).join('') +
      '<button type="button" data-a="none" title="ไม่มีลูกศร">' + RB.tulipSVG(null, [], { size: 40, stroke: 7 }) + '</button>';
    $('ptBranches').innerHTML = BRANCH_SET.map(function (a) { return '<button type="button" data-b="' + a + '" aria-label="ถนนแยก ' + a + '°">' + RB.tulipSVG(null, [a], { size: 28, stroke: 7 }) + '</button>'; }).join('');
    $('ptTypes').onclick = function (e) { var b = e.target.closest('[data-type]'); if (b) { D.type = b.dataset.type; syncDlg(); } };
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
    ['ptTh', 'ptEn', 'ptNote'].forEach(function (id) { $(id).onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); this.blur(); } }; });
    ['ptTh', 'ptEn', 'ptNote'].forEach(function (id) { $(id).oninput = function () { D[{ ptTh: 'th', ptEn: 'en', ptNote: 'note' }[id]] = this.value; }; });
    $('ptSave').onclick = function () {
      var st = stage();
      if (Dnew) st.points.push(D); else Object.assign(Dorig, D);
      S.sel = D.id; save(); $('ptDlg').close(); renderAll();
    };
    $('ptDel').onclick = function () {
      var st = stage(); if (!Dnew && !confirm('ลบจุดนี้?')) return;
      st.points = st.points.filter(function (p) { return p.id !== D.id; }); S.sel = null; save(); $('ptDlg').close(); renderAll();
    };
    $('ptDlg').addEventListener('close', function () { if (draftMarker) { map.removeLayer(draftMarker); draftMarker = null; } });
  })();
  function openPoint(p, isNew) {
    Dorig = p; Dnew = isNew; D = JSON.parse(JSON.stringify(p)); D.branches = D.branches || [];
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || ''; $('ptNote').value = D.note || '';
    $('ptDel').textContent = isNew ? 'ไม่เพิ่ม' : 'ลบจุด';
    syncDlg(); showDraft(); $('ptDlg').showModal();
  }
  function showDraft() {
    if (draftMarker) map.removeLayer(draftMarker);
    draftMarker = L.circleMarker([D.lat, D.lon], { radius: 9, color: '#D0021B', weight: 3, fillOpacity: 0 }).addTo(map);
    if (!map.getBounds().pad(-0.1).contains(draftMarker.getLatLng())) map.panTo(draftMarker.getLatLng());
  }
  function syncDlg(fromSlider) {
    var st = stage();
    $('ptKm').textContent = fmtKm(D.d * fac(st) / 1000);
    document.querySelectorAll('#ptTypes [data-type]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.type === D.type); });
    $('ptDanger').hidden = D.type !== 'DANGER';
    document.querySelectorAll('#ptDanger [data-lv]').forEach(function (b) { b.setAttribute('aria-pressed', +b.dataset.lv === (D.danger || 1)); });
    document.querySelectorAll('#ptPresets [data-a]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.a === 'none' ? D.angle == null : +b.dataset.a === D.angle); });
    document.querySelectorAll('#ptBranches [data-b]').forEach(function (b) { b.setAttribute('aria-pressed', D.branches.indexOf(+b.dataset.b) >= 0); });
    if (!fromSlider) $('ptAngle').value = D.angle == null ? 0 : D.angle;
    $('ptAngleOut').textContent = D.angle == null ? 'ไม่มี' : (D.angle > 0 ? '+' : '') + D.angle + '°';
    $('ptPreview').innerHTML = RB.tulipSVG(D.angle, D.branches, { size: 110, ink: '#000' });
    $('ptTh').value = D.th || ''; $('ptEn').value = D.en || '';
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
    g.tracks.forEach(function (t, i) {
      var tr = RB.cleanTrack(t.pts, 2); if (tr.length < 2) return;
      var st = { id: uid(), name: t.name || (fname.replace(/\.gpx$/i, '') + (g.tracks.length > 1 ? ' ' + (i + 1) : '')), color: COLORS[P.stages.length % COLORS.length], track: tr, factor: 1, tsd: [], points: [] };
      var cum = cumOf(st);
      g.waypoints.forEach(function (w) {
        var r = RB.project(tr, cum, w.lat, w.lon);
        if (r.off <= 40) {
          var ty = guessType(w.name), an = RB.angleAt(tr, cum, r.d, 30); an = ty === 'START' ? null : Math.abs(an) < 12 ? 0 : Math.round(an / 5) * 5;
          st.points.push({ id: uid(), d: r.d, lat: r.lat, lon: r.lon, type: ty, danger: 1, angle: an, branches: [], th: w.name || '', en: '', note: '' }); wadd++; }
      });
      P.stages.push(st); added++; if (!firstId) firstId = st.id;
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
        catch (e) { toast('อ่าน ' + f.name + ' ไม่ได้'); }
        if (++done === list.length) {
          if (!tot) return toast('ไม่พบ track ในไฟล์ GPX (ต้องมี <trk> หรือ <rte>)', 4000);
          save(); selectStage(first, true);
          toast('เพิ่ม ' + tot + ' stage' + (wt ? ' และ ' + wt + ' จุดจาก waypoint' : ''), 3500);
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
        if (P.stages.length && !confirm('แทนที่โปรเจกต์ปัจจุบันด้วย ' + (o.name || f.name) + '?')) return;
        P = o; S.stageId = P.stages[0] ? P.stages[0].id : null; save(); renderAll(); fitStage(); toast('เปิด ' + (P.name || f.name) + ' แล้ว');
      } catch (e) { toast('ไฟล์นี้ไม่ใช่โปรเจกต์ Roadbook'); }
    };
    fr.readAsText(f);
  };
  $('bSaveJson').onclick = function () { download(safeName(P.name) + '.json', JSON.stringify(P), 'application/json'); };
  $('bCsv').onclick = function () {
    if (!P.stages.length) return toast('ยังไม่มี stage');
    var body = P.stages.map(function (st, i) { var c = RB.stageCSV(st); return i ? c.split('\r\n').slice(1).join('\r\n') : c; }).join('\r\n');
    download(safeName(P.name) + '_roadbook.csv', '\uFEFF' + body, 'text/csv;charset=utf-8');
  };
  $('bGpxOut').onclick = function () { if (!P.stages.length) return toast('ยังไม่มี stage'); download(safeName(P.name) + '.gpx', RB.stageGPX(P.stages), 'application/gpx+xml'); };
  $('bLogOut').onclick = exportLog;
  $('projName').onchange = function () { P.name = this.value.trim() || P.name; save(); };
  $('bNewProj').onclick = function () {
    if (!confirm('เริ่มโปรเจกต์ใหม่? ข้อมูลปัจจุบันจะถูกลบจากเครื่อง (บันทึก .json ไว้ก่อนถ้าต้องการ)')) return;
    P = newProject(); S.stageId = null; save(); renderAll();
  };
  var deferredInstall = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferredInstall = e; $('bInstall').hidden = false; });
  $('bInstall').onclick = function () { if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; $('bInstall').hidden = true; } };

  // ---------- Navigator ----------
  var N = loadNav();
  function loadNav() {
    var d = { offset: {}, tsdStart: {}, log: [], sound: true, vib: true, night: false, map: true, rec: true };
    try { var s = JSON.parse(store.getItem(NKEY) || 'null'); if (s) Object.assign(d, s); } catch (e) {}
    d.on = false; d.matcher = null; d.d = null; d.fix = null; d.follow = true; d.alerted = {}; d.manualBase = null; d.lastFixT = 0;
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

  var gpsMarker = null, accCircle = null, trail = null;
  function navDrawStatic() {
    gNav.clearLayers(); gpsMarker = accCircle = null;
    trail = L.polyline(N.log.slice(-3000).map(function (p) { return [p[0], p[1]]; }), { color: '#000', weight: 2, dashArray: '4 4', interactive: false }).addTo(gNav);
  }

  var audio = null;
  function beep(freq, n) {
    if (!N.sound) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      for (var i = 0; i < n; i++) {
        var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + i * 0.22;
        o.frequency.value = freq; o.type = 'square'; g.gain.setValueAtTime(0.25, t); g.gain.setValueAtTime(0, t + 0.14);
        o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + 0.16);
      }
    } catch (e) {}
  }
  var wakeLock = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || !N.on) return;
    navigator.wakeLock.request('screen').then(function (w) { wakeLock = w; }).catch(function () {});
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && N.on) keepAwake(); });

  $('bGps').onclick = function () {
    if (N.on) return stopGps();
    if (!stage()) return toast('เลือก stage ก่อน');
    if (!navigator.geolocation) return toast('อุปกรณ์นี้ไม่รองรับ GPS');
    if (location.protocol === 'http:' && location.hostname !== 'localhost') return toast('GPS ใช้ได้เฉพาะเว็บที่เป็น https://', 4000);
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {}
    N.on = true; N.watch = navigator.geolocation.watchPosition(onFix, onGpsErr, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    keepAwake(); renderNav();
  };
  function stopGps() {
    if (N.watch != null) navigator.geolocation.clearWatch(N.watch);
    N.on = false; N.watch = null; if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } renderNav();
  }
  function onGpsErr(e) {
    if (e.code === 1) { stopGps(); toast('ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เปิดสิทธิ์ Location ให้เว็บนี้ใน Chrome', 5000); }
    else { $('dGps').textContent = 'GPS: ' + (e.code === 3 ? 'รอสัญญาณ' : 'ขัดข้อง'); $('dGps').className = 'warn'; }
  }
  function onFix(pos) {
    var c = pos.coords, t = pos.timestamp || Date.now(), prev = N.fix;
    var spd = c.speed != null && c.speed >= 0 ? c.speed : (prev ? RB.hav([prev.lat, prev.lon], [c.latitude, c.longitude]) / Math.max(0.5, (t - prev.t) / 1000) : 0);
    N.fix = { lat: c.latitude, lon: c.longitude, acc: c.accuracy, spd: spd, t: t };
    if (N.rec && c.accuracy <= 50) {
      var last = N.log[N.log.length - 1];
      if (!last || RB.hav([last[0], last[1]], [c.latitude, c.longitude]) >= 3) { N.log.push([+c.latitude.toFixed(7), +c.longitude.toFixed(7), t]); if (trail) trail.addLatLng([c.latitude, c.longitude]); saveNav(); }
    }
    var m = matcher(), r = m ? m.update(c.latitude, c.longitude, c.accuracy, spd) : null;
    if (r) { N.d = r.d; N.match = r; }
    var ll = [c.latitude, c.longitude];
    if (S.mode === 'nav') {
      if (!gpsMarker) {
        accCircle = L.circle(ll, { radius: c.accuracy, color: '#0050B3', weight: 1, fillOpacity: .08, interactive: false }).addTo(gNav);
        gpsMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="gpsdot"></div>', iconSize: [20, 20] }), interactive: false }).addTo(gNav);
      } else { gpsMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(c.accuracy); }
      if (N.follow && N.map) map.setView(ll, Math.max(map.getZoom(), 16), { animate: false });
    }
    checkAlerts(); renderNav();
  }
  map.on('dragstart', function () { if (S.mode === 'nav') { N.follow = false; $('fFollow').setAttribute('aria-pressed', 'false'); } });
  $('fFollow').onclick = function () { N.follow = true; this.setAttribute('aria-pressed', 'true'); if (N.fix) map.setView([N.fix.lat, N.fix.lon], Math.max(map.getZoom(), 16)); };

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
    if (!p) { $(tulipId).innerHTML = ''; $(textId).innerHTML = inId ? 'ไม่มีจุดถัดไป' : ''; $(kmId).textContent = ''; if (inId) $(inId).textContent = '--'; return; }
    var idx = s.ps.indexOf(p) + 1, ink = N.night && !inId ? '#fff' : '#000';
    $(kmId).textContent = '#' + idx + '  ' + fmtKm(p.d * s.f / 1000);
    $(tulipId).innerHTML = RB.tulipSVG(p.angle, p.branches, { size: inId ? 84 : 52, ink: ink });
    var tag = p.type === 'TULIP' ? '' : '<span class="tag ' + p.type + '">' + (p.type === 'DANGER' ? 'อันตราย ' + '!'.repeat(p.danger || 1) : p.type) + '</span>';
    $(textId).innerHTML = tag + (p.th ? '<span>' + RB.esc(p.th) + '</span>' : '') + (p.note ? '<span class="en">' + RB.esc(p.note) + '</span>' : '');
    if (inId) {
      var dist = s.x == null ? null : (p.d - s.x) * s.f;
      $(inId).textContent = dist == null ? '--' : dist >= 1000 ? (dist / 1000).toFixed(2) + 'k' : Math.max(0, Math.round(dist / 10) * 10) + ' m';
    }
  }
  function renderNav() {
    document.body.classList.toggle('night', S.mode === 'nav' && N.night);
    document.body.classList.toggle('nomap', !N.map);
    $('bGps').textContent = N.on ? 'หยุด GPS' : 'เริ่ม GPS'; $('bGps').classList.toggle('primary', !N.on);
    if (S.mode !== 'nav') return;
    var s = navState();
    $('dTotal').textContent = s && s.km != null ? fmtKm(s.km) : '--.--';
    var base = 0;
    if (s && s.prev) base = s.prev.d * s.f / 1000;
    if (N.manualBase != null && N.manualBase > base) base = N.manualBase;
    $('dPartial').textContent = s && s.km != null ? fmtKm(Math.max(0, s.km - base)) : '-.--';
    var g = $('dGps');
    if (!N.on) { g.textContent = 'GPS ปิด'; g.className = ''; }
    else if (!N.fix) { g.textContent = 'รอสัญญาณ GPS'; g.className = 'warn'; }
    else { g.textContent = 'GPS ±' + Math.round(N.fix.acc) + ' m'; g.className = N.fix.acc > 20 ? 'warn' : ''; }
    $('dSpeed').textContent = N.fix ? Math.round(N.fix.spd * 3.6) + ' km/h' : '-- km/h';
    $('dRec').textContent = N.rec && N.on ? 'บันทึก ' + N.log.length : '';
    var off = N.on && N.match && N.match.offRoute && N.fix;
    $('dOff').hidden = !off; if (off) $('dOffM').textContent = Math.round(N.match.off) + ' m';
    if (!s) { boxFill(null, null, 'dNextKm', 'dNextTulip', 'dNextText', 'dNextIn'); boxFill(null, null, 'dThenKm', 'dThenTulip', 'dThenText'); return; }
    boxFill(s.next, s, 'dNextKm', 'dNextTulip', 'dNextText', 'dNextIn');
    boxFill(s.then, s, 'dThenKm', 'dThenTulip', 'dThenText');
    var tsd = s.st.tsd && s.st.tsd.length, t0 = N.tsdStart[s.st.id];
    $('dTsd').hidden = !tsd; $('bTsd').hidden = !tsd;
    if (tsd) {
      $('bTsd').textContent = t0 ? 'TSD กำลังจับ' : 'เริ่ม TSD';
      var sp = s.km != null ? RB.tsdSpeedAt(s.st.tsd, s.km) : null;
      $('dTsdSpeed').textContent = sp ? 'เป้า ' + sp + ' km/h' : 'เป้า --';
      var el = $('dTsdDelta');
      if (t0 && s.km != null) {
        var elapsed = (Date.now() - t0) / 1000, ideal = RB.tsdIdeal(s.st.tsd, s.km), dlt = elapsed - ideal;
        el.textContent = (dlt >= 0 ? '+' : '−') + Math.abs(dlt).toFixed(1) + ' s';
        el.className = 'tsd-d ' + (dlt > 0.5 ? 'late' : dlt < -0.5 ? 'early' : '');
        $('dTsdElapsed').textContent = (dlt > 0.5 ? 'ช้ากว่าเป้า' : dlt < -0.5 ? 'เร็วกว่าเป้า' : 'ตรงเป้า') + '  ' + fmtClock(elapsed);
      } else { el.textContent = '--'; el.className = 'tsd-d'; $('dTsdElapsed').textContent = 'กดเริ่มตอนออกตัว'; }
    }
  }
  function fmtClock(s) { s = Math.floor(s); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' : '') + (m < 10 && h ? '0' : '') + m + ':' + (x < 10 ? '0' : '') + x; }
  setInterval(function () { if (S.mode === 'nav' && N.tsdStart[S.stageId]) renderNav(); }, 500);

  $('partialCell').onclick = function () { var s = navState(); if (s && s.km != null) { N.manualBase = s.km; renderNav(); toast('ตั้งศูนย์ระยะช่วงแล้ว'); } };
  $('bSync').onclick = function () {
    var s = navState(); if (!s || N.d == null) return toast('ยังไม่มีตำแหน่งบนเส้นทาง');
    var best = null; s.ps.forEach(function (p) { var dd = Math.abs(p.d - s.x); if (!best || dd < best.dd) best = { p: p, dd: dd }; });
    if (!best || best.dd * s.f > 400) return toast('ไม่มีจุดใน roadbook ในระยะ 400 m');
    N.offset[S.stageId] = best.p.d - N.d; N.alerted = {}; N.manualBase = null; saveNav(); renderNav();
    toast('Sync ที่ #' + (s.ps.indexOf(best.p) + 1) + '  ' + fmtKm(best.p.d * s.f / 1000) + ' km');
  };
  function nudge(m) { var st = stage(); if (!st) return; N.offset[S.stageId] = offOf() + m / fac(st); saveNav(); renderNav(); }
  $('bMinus').onclick = function () { nudge(-10); };
  $('bPlus').onclick = function () { nudge(10); };
  $('bTsd').onclick = function () {
    var id = S.stageId; if (!id) return;
    if (N.tsdStart[id]) { toast('TSD เริ่มไปแล้ว รีเซ็ตได้ในเมนู เพิ่มเติม'); return; }
    N.tsdStart[id] = Date.now(); saveNav(); renderNav(); beep(1000, 1); toast('เริ่มจับเวลา TSD');
  };
  $('bMore').onclick = function () {
    $('oMap').checked = N.map; $('oSound').checked = N.sound; $('oVib').checked = N.vib; $('oNight').checked = N.night; $('oRec').checked = N.rec;
    $('moreDlg').showModal();
  };
  [['oMap', 'map'], ['oSound', 'sound'], ['oVib', 'vib'], ['oNight', 'night'], ['oRec', 'rec']].forEach(function (x) {
    $(x[0]).onchange = function () { N[x[1]] = this.checked; saveNav(); renderNav(); if (x[1] === 'map') setTimeout(function () { map.invalidateSize(); }, 60); };
  });
  $('oTsdReset').onclick = function () { delete N.tsdStart[S.stageId]; saveNav(); renderNav(); toast('รีเซ็ต TSD แล้ว'); };
  $('oOffReset').onclick = function () { delete N.offset[S.stageId]; saveNav(); renderNav(); toast('ล้างค่า Sync แล้ว'); };
  $('oLog').onclick = exportLog;
  $('oLogClear').onclick = function () { if (confirm('ล้างเส้นที่วิ่งทั้งหมด?')) { N.log = []; saveNav(); navDrawStatic(); renderNav(); } };
  function exportLog() {
    if (!N.log.length) return toast('ยังไม่มีเส้นที่วิ่ง');
    var st = stage(), nm = (st ? st.name : 'run') + '_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '');
    download(safeName(nm) + '.gpx', RB.logGPX(nm, N.log), 'application/gpx+xml');
  }

  // ---------- Render all ----------
  function renderAll() {
    $('projName').value = P.name || '';
    renderStageSel(); drawTracks(); drawPins(); drawSuggest(); renderRB(); renderStagePanel(); renderNav();
  }
  renderAll(); fitStage();
  if (store.mem) $('storeNote').textContent = 'เบราว์เซอร์นี้ไม่อนุญาตให้เก็บข้อมูลในเครื่อง ข้อมูลจะหายเมื่อปิดหน้า ให้บันทึกเป็น .json';
  else $('storeNote').textContent = 'ข้อมูลเก็บในเครื่องนี้อัตโนมัติ ควรบันทึก .json สำรองไว้ก่อนวันแข่ง';
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var nw = reg.installing;
        nw && nw.addEventListener('statechange', function () {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            toast('มีเวอร์ชันใหม่ แตะที่นี่เพื่อโหลด', 10000);
            $('toast').onclick = function () { nw.postMessage('skip'); };
          }
        });
      });
    }).catch(function () {});
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (!reloaded) { reloaded = true; location.reload(); } });
  }
})();
