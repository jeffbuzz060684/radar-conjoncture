#!/usr/bin/env node
"use strict";
// ops.js — v4.0.8 : mémoire opérationnelle du pipeline + alertes de panne + dead man's switch.
// Problème (revue du 09/11) : ntfy ne servait que pour les signaux d'initiés ; si une source
// tombait (swaoo, SEC, Yahoo+TV), PERSONNE n'était prévenu — le bandeau de l'app suppose
// qu'on l'ouvre. ops.json (committé par les workflows) garde l'état entre deux runs :
//   frOk / usOk      : sources initiés FR (AMF) et US (SEC) saines au dernier relevé
//   quotesOk         : dernier relevé de cotations réussi
//   quotesFailStreak : échecs de cotes consécutifs (alerte à 2)
// Alertes ntfy sur les TRANSITIONS (ok→panne et panne→ok) — pas de spam à chaque run.
// Dead man's switch : ping HEALTHCHECKS_URL (type healthchecks.io) après chaque run qui va
// au bout ; si les workflows s'arrêtent eux-mêmes ( Actions down, cron désactivé, dépôt
// cassé), le ping cesse et le service prévient — c'est le seul moyen de surveiller le surveillant.
// Le ping n'est volontaireirement PAS envoyé quand le run échoue : c'est le role de la garde.

var fs = require("fs");
var path = require("path");
var OPS_PATH = path.join(__dirname, "..", "ops.json");

function loadOps() {
  try { return JSON.parse(fs.readFileSync(OPS_PATH, "utf8")); }
  catch (e) { return { frOk: true, usOk: true, quotesOk: true, quotesFailStreak: 0 }; }
}

function saveOps(ops) {
  fs.writeFileSync(OPS_PATH, JSON.stringify({ frOk: !!ops.frOk, usOk: !!ops.usOk, quotesOk: !!ops.quotesOk, quotesFailStreak: ops.quotesFailStreak || 0 }, null, 1) + "\n");
}

// messages ntfy sur les transitions d'état (les alertes ne partent qu'au CHANGEMENT)
function flipAlerts(prev, next) {
  var msgs = [];
  if (prev.frOk === true && next.frOk === false) msgs.push("🔴 Source FR (AMF/DGCC via swaoo) en PANNE — données précédentes conservées, l'app affiche l'ancienneté. Voir GitHub Actions.");
  if (prev.frOk === false && next.frOk === true) msgs.push("🟢 Source FR (initiés) rétablie.");
  if (prev.usOk === true && next.usOk === false) msgs.push("🔴 Source US (SEC EDGAR) en PANNE — données précédentes conservées. Voir GitHub Actions.");
  if (prev.usOk === false && next.usOk === true) msgs.push("🟢 Source US (initiés) rétablie.");
  if (prev.quotesOk === true && next.quotesOk === false) msgs.push("🔴 Cotations SBF 120 en ÉCHEC — quotes.json précédent conservé.");
  if (prev.quotesOk === false && next.quotesOk === true) msgs.push("🟢 Cotations SBF 120 rétablies.");
  return msgs;
}

// relevé initiés : transitions frOk/usOk (le run finit toujours, panne ≠ crash)
function nextInsiders(prev, frOk, usOk) {
  var next = { frOk: frOk === true, usOk: usOk === true, quotesOk: !!prev.quotesOk, quotesFailStreak: prev.quotesFailStreak || 0 };
  return { ops: next, alerts: flipAlerts(prev, next) };
}

// relevé cotes : ok remet le compteur à zéro ; échec l'incrémente (alerte à 2 de suite)
function nextQuotes(prev, ok) {
  var next = {
    frOk: !!prev.frOk, usOk: !!prev.usOk,
    quotesOk: ok === true,
    quotesFailStreak: ok === true ? 0 : (prev.quotesFailStreak || 0) + 1
  };
  var alerts = flipAlerts(prev, next);
  if (ok !== true && next.quotesFailStreak === 2) {
    alerts.push("🔴 Cotations en échec 2 runs de suite — Yahoo ET TradingView ? Voir GitHub Actions, onglet Cotations SBF 120.");
  }
  return { ops: next, alerts: alerts };
}

// dead man's switch : GET sur l'URL healthchecks (jamais throw, jamais fait échouer le run)
var FETCH_IMPL = (typeof fetch === "function") ? fetch : null;
function setFetchForTests(f) { FETCH_IMPL = f; }
function pingHealth(url) {
  if (!url || !FETCH_IMPL) return Promise.resolve(false);
  return FETCH_IMPL(url, { method: "GET", signal: AbortSignal.timeout(10000) })
    .then(function (r) {
      if (r && typeof r.status === "number") return r.status >= 200 && r.status < 300;
      return true; // réponse sans statut (mocks) : on considère l'envoi parti
    })
    .catch(function () { return false; });
}

module.exports = {
  OPS_PATH: OPS_PATH,
  loadOps: loadOps, saveOps: saveOps, flipAlerts: flipAlerts,
  nextInsiders: nextInsiders, nextQuotes: nextQuotes,
  pingHealth: pingHealth, setFetchForTests: setFetchForTests
};
