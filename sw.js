var CACHE = "radar-v6";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg", "./icon-192.png", "./icon-512.png", "./auto.js", "./logic.js", "./vehicles.js"];

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
  if (url.origin !== self.location.origin) return; // jamais de cache pour les API externes (CoinGecko)
  // data.json & data-daily.json : toujours le réseau d'abord (maj), cache en secours hors ligne.
  // La clé de cache est l'URL SANS le ?v=<timestamp> : sinon chaque requête étant unique,
  // la copie mise en cache n'était JAMAIS retrouvée au secours hors ligne.
  if (url.pathname.indexOf("data.json") !== -1 || url.pathname.indexOf("data-daily.json") !== -1) {
    var cleanUrl = url.origin + url.pathname; // clé de cache stable, sans query
    e.respondWith(fetch(e.request).then(function (r) {
      var copy = r.clone();
      caches.open(CACHE).then(function (c) { c.put(cleanUrl, copy); });
      return r;
    }).catch(function () {
      return caches.match(cleanUrl);
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
  e.respondWith(caches.match(e.request).then(function (m) { return m || fetch(e.request); }));
});
