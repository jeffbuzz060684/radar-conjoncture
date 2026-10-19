var CACHE = "radar-v27";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./logic.js", "./auto.js", "./vehicles.js"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return c.addAll(SHELL).then(function () { return self.skipWaiting(); });
  }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  var url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return; // jamais de cache pour les API externes (CoinGecko, ntfy, Telegram)
  // data.json & data-daily.json : toujours le réseau d'abord (maj), cache en secours hors ligne
  if (url.pathname.indexOf("data.json") !== -1 || url.pathname.indexOf("data-daily.json") !== -1) {
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () {
      return caches.match(e.request);
    }));
    return;
  }
  if (e.request.mode === "navigate") {
    // réseau d'abord pour toujours avoir la dernière version, cache en secours (hors ligne)
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return r;
    }).catch(function () {
      return caches.match(e.request).then(function (m) { return m || caches.match("./index.html"); });
    }));
    return;
  }
  // Fichiers du shell : réseau d'abord, cache en secours — évite tout skew de versions
  // entre le HTML servi frais et les JS servis périmés (rapport revue v5.6, point 4).
  e.respondWith(fetch(e.request).then(function (r) {
    if (r && r.ok) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    }
    return r;
  }).catch(function () {
    return caches.match(e.request);
  }));
});
