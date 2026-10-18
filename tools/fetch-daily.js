/* Relevé quotidien automatique v4.2 — exécuté par GitHub Actions (cron jours ouvrés).
   Récupère le cours IWDA en EUROS (IWDA.AS, Euronext Amsterdam) et ses références
   52 sem. (fenêtre 1 an, même source que le cours), le VIX (courant + moyenne 5 séances),
   le taux de dépôt BCE et sa direction (API officielle ECB Data Portal) et l'inflation
   zone euro (API officielle Eurostat, uniquement si la période est récente).
   Cohérence vs le dernier relevé quotidien accepté (fallback : relevé hebdo vérifié),
   puis écrit data-daily.json à la racine du site, daté de la clôture du cours.
   Usage : node tools/fetch-daily.js [--dry-run] */
"use strict";
var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var UA = { headers: { "User-Agent": "Mozilla/5.0 (radar-conjoncture daily fetch)" } };

function round2(x) { return Math.round(x * 100) / 100; }

function fetchChart(symbol, range) {
  var url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(symbol) +
    "?range=" + range + "&interval=1d";
  return fetch(url, UA).then(function (r) {
    if (!r.ok) throw new Error(symbol + " HTTP " + r.status);
    return r.json();
  }).then(function (j) {
    var res = j && j.chart && j.chart.result && j.chart.result[0];
    if (!res || !res.indicators || !res.indicators.quote || !res.indicators.quote[0]) {
      throw new Error(symbol + " : format inattendu");
    }
    return res;
  });
}

// Clôtures valides uniquement : [{date: "YYYY-MM-DD", close: nombre}]
function closes(res) {
  var q = res.indicators.quote[0];
  var out = [];
  res.timestamp.forEach(function (t, i) {
    var c = q.close[i];
    if (typeof c === "number" && isFinite(c)) {
      out.push({ date: new Date(t * 1000).toISOString().slice(0, 10), close: c });
    }
  });
  if (!out.length) throw new Error("aucune clôture exploitable");
  return out;
}

function check(name, val, old, min, max, maxDrift, data, applied, skipped) {
  if (val === null || !isFinite(val) || val < min || val > max) { skipped.push(name); return; }
  if (typeof old === "number" && isFinite(old) && old > 0 && Math.abs(val / old - 1) > maxDrift) { skipped.push(name); return; }
  data[name] = val;
  applied.push(name);
}

function fetchJSON(url) {
  return fetch(url, UA).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  });
}

// BCE : taux de dépôt (FM/B.U2.EUR.4F.KR.DFR.LEV) + direction dérivée des 2 dernières décisions.
function fetchEcbDeposit() {
  return fetchJSON("https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=jsondata&lastNObservations=2")
    .then(function (j) {
      var dims = j && j.structure && j.structure.dimensions && j.structure.dimensions.observation;
      var series = j && j.dataSets && j.dataSets[0] && j.dataSets[0].series;
      if (!dims || !series) throw new Error("BCE : format inattendu");
      var times = dims[0].values.map(function (v) { return v.id; });
      var obs = Object.values(series)[0].observations;
      var vals = times.map(function (_, i) { return (obs && obs[i]) ? obs[i][0] : null; });
      if (vals.length < 2 || vals.some(function (v) { return typeof v !== "number" || !isFinite(v); })) {
        throw new Error("BCE : observations inattendues");
      }
      var last = vals[vals.length - 1], prev = vals[vals.length - 2];
      return {
        depot: last,
        dir: last > prev ? "hausse" : last < prev ? "baisse" : "stable",
        date: times[times.length - 1]
      };
    });
}

// Eurostat : inflation zone euro (HICP taux annuel, prc_hicp_manr CP00 EA).
// Uniquement si la période est récente (≤ 3 mois) : une série en retard ne doit pas
// écraser le relevé hebdo vérifié.
function eurostatAgeMonths(period, now) {
  var m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return 999;
  return (now.getUTCFullYear() - +m[1]) * 12 + (now.getUTCMonth() + 1 - +m[2]);
}

function fetchEurostatInflation(now) {
  return fetchJSON("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_manr?format=JSON&lang=EN&geo=EA&coicop=CP00&lastTimePeriod=2")
    .then(function (j) {
      var idx = j && j.dimension && j.dimension.time && j.dimension.time.category && j.dimension.time.category.index;
      if (!idx) throw new Error("Eurostat : format inattendu");
      var keys = Object.keys(idx);
      if (!keys.length) throw new Error("Eurostat : aucune période");
      var latest = keys[keys.length - 1];
      var v = j.value && j.value[idx[latest]];
      if (typeof v !== "number" || !isFinite(v)) throw new Error("Eurostat : valeur manquante");
      var age = eurostatAgeMonths(latest, now);
      if (age > 3) throw new Error("période " + latest + " trop ancienne (" + age + " mois)");
      return { infl: v, period: latest };
    });
}

async function main() {
  var weekly = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
  var previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(ROOT, "data-daily.json"), "utf8")); } catch (e) {}

  // Référence de cohérence : le DERNIER RELEVÉ QUOTIDIEN ACCEPTÉ (un écart > 10 % sur le
  // cours en une seule séance est aberrant). Sans relevé quotidien précédent → relevé hebdo
  // vérifié. Un krach cumulé sur plusieurs séances reste ainsi accepté : chaque relevé
  // accepté devient la nouvelle référence.
  var refDaily = (previous && previous.data && typeof previous.data === "object") ? previous.data : null;
  var ref = refDaily || weekly.data;

  // Marchés : IWDA en EUR (Euronext Amsterdam) — fenêtre 1 an pour cours + références 52 sem.
  var iwda = closes(await fetchChart("IWDA.AS", "1y"));
  var vixC = closes(await fetchChart("^VIX", "10d"));   // 10 j pour garantir 5 séances
  var last = iwda[iwda.length - 1];
  var msci = round2(last.close);
  var hi = -Infinity, hiDate = "", lo = Infinity;
  iwda.forEach(function (c) {
    if (c.close > hi) { hi = c.close; hiDate = c.date; }
    if (c.close < lo) lo = c.close;
  });
  var msciHigh52 = round2(hi), msciLow52 = round2(lo);
  var vixLast = round2(vixC[vixC.length - 1].close);
  var last5 = vixC.slice(-5);
  var vix5 = round2(last5.reduce(function (s, c) { return s + c.close; }, 0) / last5.length);

  // Macro officiel : échec silencieux → champs simplement absents du relevé du jour.
  var now = new Date();
  var ecb = null, euro = null, macroNotes = [];
  try { ecb = await fetchEcbDeposit(); } catch (e) { macroNotes.push("bceDepot indisponible (" + e.message + ")"); }
  try { euro = await fetchEurostatInflation(now); } catch (e) { macroNotes.push("inflZE écartée (" + e.message + ")"); }

  // Garde-fous : plages plausibles + écart max en UNE séance vs la dernière valeur acceptée.
  var data = {}, applied = [], skipped = [];
  check("msci", msci, ref.msci, 15, 1000, 0.10, data, applied, skipped);
  check("msciHigh52", msciHigh52, ref.msciHigh52, 15, 1000, 0.25, data, applied, skipped);
  check("msciLow52", msciLow52, ref.msciLow52, 15, 1000, 0.25, data, applied, skipped);
  check("vix", vixLast, ref.vix, 3, 100, 0.60, data, applied, skipped);
  check("vix5", vix5, ref.vix5 !== undefined ? ref.vix5 : ref.vix, 3, 100, 0.60, data, applied, skipped);
  if (ecb) {
    check("bceDepot", round2(ecb.depot), ref.bceDepot, -1, 10, 0.30, data, applied, skipped);
    if (applied.indexOf("bceDepot") !== -1) { data.bceDir = ecb.dir; applied.push("bceDir"); }
  }
  if (euro) check("inflZE", round2(euro.infl), ref.inflZE, -2, 15, 0.30, data, applied, skipped);
  if (!applied.length) {
    console.error("Aucune valeur cohérente (" + skipped.join(", ") + ") — data-daily.json inchangé.");
    process.exit(1);
  }

  // dateData = date de CLÔTURE du cours (pas la date d'exécution : un run week-end reste
  // daté de la dernière séance). No-op si le fichier existant est déjà à jour ou plus récent.
  var dateData = last.date;
  if (previous && previous.dateData >= dateData) {
    console.log("data-daily.json déjà à jour (dernier relevé " + previous.dateData + " ≥ clôture " + dateData + ") — rien à faire.");
    return;
  }

  var sources = [
    ["MSCI World (IWDA) : " + msci + " € — clôture du " + last.date + " (IWDA.AS, Euronext Amsterdam, EUR)", "Yahoo Finance"],
    ["Références 52 sem. : plus haut " + msciHigh52 + " € (le " + hiDate + "), plus bas " + msciLow52 + " € — fenêtre 1 an, même source que le cours", "Yahoo Finance"],
    ["VIX : " + vixLast + " ; moyenne 5 séances : " + vix5, "Yahoo Finance (^VIX)"]
  ];
  if (ecb) sources.push(["Taux de dépôt BCE : " + ecb.depot.toFixed(2).replace(".", ",") + " % — direction : " + ecb.dir + " (dernière décision le " + ecb.date + ")", "ECB Data Portal (FM/B.U2.EUR.4F.KR.DFR.LEV)"]);
  if (euro) sources.push(["Inflation zone euro : " + euro.infl.toFixed(1).replace(".", ",") + " % (taux annuel, période " + euro.period + ")", "Eurostat (prc_hicp_manr, CP00, EA)"]);

  var out = {
    version: 1,
    dateData: dateData,
    note: "relevé quotidien automatique (marchés EUR + macro officiel)",
    data: data,
    sources: sources.concat([[
      "Garde-fous : plausibilité + écart max une séance vs " +
      (refDaily ? "le dernier relevé quotidien accepté" : "le relevé vérifié du " + weekly.dateData) +
      " — champs écartés : " + (skipped.length ? skipped.join(", ") : "aucun") +
      (macroNotes.length ? " ; " + macroNotes.join(" ; ") : ""),
      "tools/fetch-daily.js"
    ]])
  };
  if (process.argv.indexOf("--dry-run") !== -1) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  fs.writeFileSync(path.join(ROOT, "data-daily.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("data-daily.json écrit (clôture du " + dateData + ") — champs : " + applied.join(", ") + ".");
}

main().catch(function (e) {
  console.error("Échec du relevé quotidien : " + e.message);
  process.exit(1);
});
