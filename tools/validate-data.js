/* Validation qualité des fichiers de données avant déploiement GitHub Pages.
   Vérifie schéma, types, plages plausibles et absence de données personnelles.
   Usage : node tools/validate-data.js [data.json|data-daily.json]
   Sans argument : valide data.json + data-daily.json (s'il existe).
   Exit 1 en cas d'échec — le workflow Pages doit échouer plutôt que déployer. */
"use strict";
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var errors = [];

function isNum(x, min, max) {
  return typeof x === "number" && isFinite(x) && x >= min && x <= max;
}

function reqNum(d, k, min, max, file) {
  if (!isNum(d[k], min, max)) errors.push(file + " : champ " + k + " manquant ou hors plage plausible [" + min + " ; " + max + "] (" + JSON.stringify(d[k]) + ")");
}

function optNum(d, k, min, max, file) {
  if (d[k] === undefined || d[k] === null) return;
  if (!isNum(d[k], min, max)) errors.push(file + " : champ optionnel " + k + " hors plage plausible [" + min + " ; " + max + "] (" + JSON.stringify(d[k]) + ")");
}

function optStr(d, k, file) {
  if (d[k] === undefined) return;
  if (typeof d[k] !== "string") errors.push(file + " : champ " + k + " doit être une chaîne");
}

function checkCommon(raw, file) {
  if (!raw || typeof raw !== "object") { errors.push(file + " : JSON non lisible"); return; }
  if (typeof raw.dateData !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.dateData)) {
    errors.push(file + " : dateData manquant ou mal formé (YYYY-MM-DD attendu)");
  }
  if (!raw.data || typeof raw.data !== "object") {
    errors.push(file + " : objet data manquant");
    return;
  }
  var d = raw.data;
  if ("reserve" in d) errors.push(file + " : « reserve » ne doit JAMAIS être poussé (donnée personnelle)");
  if ("paliersDone" in d) errors.push(file + " : « paliersDone » ne doit JAMAIS être poussé (donnée personnelle)");
  if (d.dateData) errors.push(file + " : dateData doit être à la racine, pas dans data");
  return d;
}

function checkWeekly(raw) {
  var d = checkCommon(raw, "data.json") || {};
  reqNum(d, "msci", 20, 1000, "data.json");
  reqNum(d, "msciHigh52", 20, 1000, "data.json");
  reqNum(d, "cape", 5, 60, "data.json");
  reqNum(d, "vix", 3, 100, "data.json");
  reqNum(d, "inflZE", -2, 15, "data.json");
  reqNum(d, "inflUS", -2, 15, "data.json");
  reqNum(d, "bceDepot", -1, 10, "data.json");
  reqNum(d, "bund10", -1, 15, "data.json");
  reqNum(d, "oat10", -1, 15, "data.json");
  reqNum(d, "pmiZE", 20, 80, "data.json");
  reqNum(d, "orEUR", 300, 20000, "data.json");
  reqNum(d, "orHigh52", 300, 20000, "data.json");
  reqNum(d, "btcEUR", 500, 1000000, "data.json");
  optNum(d, "msciLow52", 20, 1000, "data.json");
  optNum(d, "orLow52", 300, 20000, "data.json");
  optNum(d, "btcHigh52", 500, 1000000, "data.json");
  optNum(d, "vix5", 3, 100, "data.json");
  optStr(d, "msciHigh52Date", "data.json");
  optStr(d, "dateMacro", "data.json"); // fraîcheur macro affichée séparément (cadence mensuelle)
  if (["hausse", "stable", "baisse"].indexOf(d.bceDir) === -1) {
    errors.push("data.json : bceDir doit valoir hausse | stable | baisse");
  }
  if (isNum(d.msci, 20, 1000) && isNum(d.msciHigh52, 20, 1000) && d.msciHigh52 < d.msci) {
    errors.push("data.json : msciHigh52 (" + d.msciHigh52 + ") < msci (" + d.msci + ") — le sommet 52 sem. doit être ≥ au cours");
  }
  if (!Array.isArray(raw.sources) || raw.sources.length < 5) {
    errors.push("data.json : sources manquantes (≥ 5 entrées attendues)");
  }
}

function checkDaily(raw) {
  var d = checkCommon(raw, "data-daily.json") || {};
  var has = ["msci", "msciHigh52", "msciLow52", "vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE"].filter(function (k) { return d[k] !== undefined; });
  if (!has.length) errors.push("data-daily.json : aucun champ de marché reconnu (msci, vix, vix5…)");
  optNum(d, "msci", 20, 1000, "data-daily.json");
  optNum(d, "msciHigh52", 20, 1000, "data-daily.json");
  optNum(d, "msciLow52", 20, 1000, "data-daily.json");
  optNum(d, "vix", 3, 100, "data-daily.json");
  optNum(d, "vix5", 3, 100, "data-daily.json");
  optNum(d, "bceDepot", -1, 10, "data-daily.json");
  optNum(d, "inflZE", -2, 15, "data-daily.json");
  optStr(d, "msciHigh52Date", "data-daily.json");
  optNum(d, "bund10", -1, 15, "data-daily.json");
  optNum(d, "oat10", -1, 15, "data-daily.json");
}

var files = process.argv.slice(2);
if (!files.length) {
  files = ["data.json"];
  if (fs.existsSync(path.join(ROOT, "data-daily.json"))) files.push("data-daily.json");
}
files.forEach(function (f) {
  var p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { errors.push(f + " : fichier introuvable"); return; }
  var raw = null;
  try { raw = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { errors.push(f + " : JSON invalide — " + e.message); return; }
  if (f === "data.json") checkWeekly(raw);
  else checkDaily(raw);
});

if (errors.length) {
  errors.forEach(function (e) { console.error("❌ " + e); });
  console.error("\nValidation ÉCHOUÉE (" + errors.length + " erreur(s)).");
  process.exit(1);
}
console.log("✅ Validation OK — " + files.join(", "));
