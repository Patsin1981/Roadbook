/* Rally Roadbook service worker */
var VER = 'rb-v1.3.0';
var SHELL = ['./', 'index.html', 'app.css', 'app.js', 'core.js', 'i18n.js', 'manifest.webmanifest',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'fonts/barlow-condensed-latin-500-normal.woff2', 'fonts/barlow-condensed-latin-700-normal.woff2', 'fonts/barlow-condensed-latin-800-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png'];
var TILES = 'rb-tiles', TILE_MAX = 6000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) { return c.addAll(SHELL); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VER && k !== TILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('message', function (e) { if (e.data === 'skip') self.skipWaiting(); });

function isTile(url) { return /tile\.openstreetmap\.org|server\.arcgisonline\.com/.test(url.hostname); }
var trimming = false;
function trimTiles() {
  if (trimming) return; trimming = true;
  caches.open(TILES).then(function (c) {
    return c.keys().then(function (ks) {
      var extra = ks.length - TILE_MAX;
      return Promise.all(ks.slice(0, Math.max(0, extra)).map(function (k) { return c.delete(k); }));
    });
  }).then(function () { trimming = false; }, function () { trimming = false; });
}

self.addEventListener('fetch', function (e) {
  var req = e.request; if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (isTile(url)) {
    // Map tiles: use cached copy first (works offline in areas viewed before), refresh from network otherwise
    e.respondWith(caches.open(TILES).then(function (c) {
      return c.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok && res.type !== 'opaque') { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); }
          return res;
        });
      });
    }));
    return;
  }
  if (url.origin === location.origin) {
    // App files: cache first, then network
    e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) { var copy = res.clone(); caches.open(VER).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () { return req.mode === 'navigate' ? caches.match('index.html') : Response.error(); });
    }));
  }
});
