/* Photos for roadbook points. Pictures are shrunk on the phone (longest side 1600 px, JPEG) and kept in
   IndexedDB, apart from the project text, so the project stays small and quick to save.
   A point only holds references: p.photos = [{ id, book }]  (book = print it in the Excel roadbook). */
(function (root) {
  'use strict';
  var DB = 'rb-photos', STORE = 'p', MAX_SIDE = 1600, QUALITY = 0.82;
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (ok, bad) {
      if (!root.indexedDB) return bad(new Error('no IndexedDB'));
      var rq = indexedDB.open(DB, 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { dbp = null; bad(rq.error); };
    });
    return dbp;
  }
  function tx(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (ok, bad) {
        var x = d.transaction(STORE, mode), s = x.objectStore(STORE), out = fn(s);
        x.oncomplete = function () { ok(out && 'result' in out ? out.result : out); };
        x.onerror = x.onabort = function () { bad(x.error || new Error('tx')); };
      });
    });
  }
  function put(rec) { return tx('readwrite', function (s) { s.put(rec); }).then(function () { return rec; }); }
  function get(id) { return tx('readonly', function (s) { return s.get(id); }); }
  function del(id) { drop(id); return tx('readwrite', function (s) { s.delete(id); }); }
  function keys() { return tx('readonly', function (s) { return s.getAllKeys(); }); }

  // object URLs for showing pictures; kept per id so thumbnails don't flicker on every redraw
  var urls = {};
  function url(id) {
    if (urls[id]) return Promise.resolve(urls[id]);
    return get(id).then(function (r) { if (!r) return null; urls[id] = urls[id] || URL.createObjectURL(r.blob); return urls[id]; }).catch(function () { return null; });
  }
  function drop(id) { if (urls[id]) { URL.revokeObjectURL(urls[id]); delete urls[id]; } }

  function uid() { return 'ph' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5); }

  // ---- EXIF: GPS position and time the picture was taken (JPEG only) ----
  function exif(buf) {
    try {
      var v = new DataView(buf);
      if (v.getUint16(0) !== 0xFFD8) return null;
      var o = 2;
      while (o + 4 < v.byteLength) {
        var mk = v.getUint16(o), len = v.getUint16(o + 2);
        if (mk === 0xFFE1 && v.getUint32(o + 4) === 0x45786966) return tiff(v, o + 10);
        if ((mk & 0xFF00) !== 0xFF00 || mk === 0xFFDA) break;
        o += 2 + len;
      }
    } catch (e) {}
    return null;
  }
  function tiff(v, b) {
    var le = v.getUint16(b) === 0x4949;
    var u16 = function (o) { return v.getUint16(b + o, le); }, u32 = function (o) { return v.getUint32(b + o, le); };
    function ifd(off) {
      var n = u16(off), out = {};
      for (var i = 0; i < n; i++) {
        var e = off + 2 + i * 12, tag = u16(e), type = u16(e + 2), cnt = u32(e + 4), vo = cnt * ([0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] || 1) > 4 ? u32(e + 8) : e + 8;
        out[tag] = { type: type, cnt: cnt, off: vo };
      }
      return out;
    }
    function rat(off, k) { var a = []; for (var i = 0; i < k; i++) a.push(u32(off + i * 8) / (u32(off + i * 8 + 4) || 1)); return a; }
    function str(e) { var s = ''; for (var i = 0; i < e.cnt - 1; i++) s += String.fromCharCode(v.getUint8(b + e.off + i)); return s; }
    var res = {}, i0 = ifd(u32(4));
    if (i0[0x8769]) { var ex = ifd(u32(i0[0x8769].off)); if (ex[0x9003]) res.time = str(ex[0x9003]); }
    if (!res.time && i0[0x0132]) res.time = str(i0[0x0132]);
    if (i0[0x8825]) {
      var g = ifd(u32(i0[0x8825].off));
      if (g[2] && g[4]) {
        var la = rat(g[2].off, 3), lo = rat(g[4].off, 3);
        var lat = la[0] + la[1] / 60 + la[2] / 3600, lon = lo[0] + lo[1] / 60 + lo[2] / 3600;
        var ref = function (t) { return g[t] ? String.fromCharCode(v.getUint8(b + g[t].off)) : ''; };
        if (ref(1) === 'S') lat = -lat;
        if (ref(3) === 'W') lon = -lon;
        if (isFinite(lat) && isFinite(lon) && (lat || lon)) { res.lat = lat; res.lon = lon; }
      }
    }
    return res;
  }

  // ---- shrink: longest side 1600 px; the browser turns the picture upright from its EXIF orientation ----
  function shrink(file) {
    return new Promise(function (ok, bad) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var k = Math.min(1, MAX_SIDE / Math.max(im.naturalWidth, im.naturalHeight)), w = Math.round(im.naturalWidth * k), h = Math.round(im.naturalHeight * k);
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h); URL.revokeObjectURL(u);
        c.toBlob(function (bl) { if (bl) ok({ blob: bl, w: w, h: h }); else bad(new Error('encode')); }, 'image/jpeg', QUALITY);
      };
      im.onerror = function () { URL.revokeObjectURL(u); bad(new Error('image')); };
      im.src = u;
    });
  }
  // file → stored record { id, blob, w, h, t, lat?, lon?, exifGps }
  function add(file, extra) {
    return (file.arrayBuffer ? file.slice(0, 256 * 1024).arrayBuffer() : Promise.resolve(null)).then(function (buf) {
      var ex = buf ? exif(buf) || {} : {};
      return shrink(file).then(function (s) {
        var rec = { id: uid(), blob: s.blob, w: s.w, h: s.h, t: Date.now(), name: file.name || '' };
        if (ex.lat != null) { rec.lat = ex.lat; rec.lon = ex.lon; rec.exifGps = true; }
        if (ex.time) rec.taken = ex.time;
        Object.keys(extra || {}).forEach(function (k) { if (extra[k] != null && rec[k] == null) rec[k] = extra[k]; });
        return put(rec);
      });
    }).then(function (rec) {
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
      return rec;
    });
  }
  // for backups and Excel
  function blobB64(blob) {
    return new Promise(function (ok, bad) { var fr = new FileReader(); fr.onload = function () { ok(String(fr.result).split(',')[1]); }; fr.onerror = bad; fr.readAsDataURL(blob); });
  }
  function b64(id) { return get(id).then(function (r) { return r ? blobB64(r.blob).then(function (d) { return { b64: d, w: r.w, h: r.h, rec: r }; }) : null; }); }
  function fromB64(id, data, meta) {
    var bin = atob(data), a = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return put(Object.assign({}, meta || {}, { id: id, blob: new Blob([a], { type: 'image/jpeg' }) }));
  }
  // remove stored pictures nothing refers to any more
  function gc(liveIds) {
    var live = {}; liveIds.forEach(function (id) { live[id] = 1; });
    return keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return !live[k]; }).map(del)); }).catch(function () {});
  }

  root.RBP = { add: add, get: get, put: put, del: del, keys: keys, url: url, b64: b64, fromB64: fromB64, gc: gc, exif: exif, uid: uid };
})(this);
