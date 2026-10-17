/* Relevé quotidien automatique — exécuté par GitHub Actions (cron jours ouvrés).
   Récupère le cours IWDA (USD, cotation LSE) et le VIX (courant + moyenne 5 séances)
   via l'API publique Yahoo Finance, vérifie la cohérence vs le dernier relevé
   vérifié (data.json), puis écrit data-daily.json à la racine du site.
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

async function main() {
  var weekly = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
  var ref = weekly.data; // dernier relevé vérifié : référence de cohérence
  var previous = null;
  try { previous = JSON.parse(fs.readFileSync(path.join(ROOT, "data-daily.json"), "utf8")); } catch (e) {}

  var iwdaC = closes(await fetchChart("IWDA.L", "5d")); // LSE, coté en USD
  var vixC = closes(await fetchChart("^VIX", "10d"));   // 10 j pour garantir 5 séances
  var last = iwdaC[iwdaC.length - 1];
  var msci = round2(last.close);
  var vixLast = round2(vixC[vixC.length - 1].close);
  var last5 = vixC.slice(-5);
  var vix5 = round2(last5.reduce(function (s, c) { return s + c.close; }, 0) / last5.length);

  // Garde-fous : plages plausibles + écart maximum vs le relevé vérifié.
  var data = {}, applied = [], skipped = [];
  check("msci", msci, ref.msci, 20, 1000, 0.12, data, applied, skipped);
  check("vix", vixLast, ref.vix, 3, 100, 0.60, data, applied, skipped);
  check("vix5", vix5, ref.vix, 3, 100, 0.60, data, applied, skipped);
  if (!applied.length) {
    console.error("Aucune valeur cohérente (" + skipped.join(", ") + ") — data-daily.json inchangé.");
    process.exit(1);
  }

  var today = new Date().toISOString().slice(0, 10);
  if (previous && previous.dateData === today &&
      JSON.stringify(previous.data) === JSON.stringify(data)) {
    console.log("data-daily.json déjà à jour pour " + today + " — rien à faire.");
    return;
  }

  var out = {
    version: 1,
    dateData: today,
    note: "relevé quotidien automatique (marchés)",
    data: data,
    sources: [
      ["MSCI World (IWDA) : " + msci + " $ — clôture du " + last.date + " (IWDA.L, LSE, cotation USD)", "Yahoo Finance"],
      ["VIX : " + vixLast + " ; moyenne 5 séances : " + vix5, "Yahoo Finance (^VIX)"],
      ["Garde-fous appliqués vs relevé vérifié du " + weekly.dateData + " — champs écartés : " +
       (skipped.length ? skipped.join(", ") : "aucun"), "tools/fetch-daily.js"]
    ]
  };
  if (process.argv.indexOf("--dry-run") !== -1) {
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  fs.writeFileSync(path.join(ROOT, "data-daily.json"), JSON.stringify(out, null, 2) + "\n");
  console.log("data-daily.json écrit (" + today + ") — champs : " + applied.join(", ") + ".");
}

main().catch(function (e) {
  console.error("Échec du relevé quotidien : " + e.message);
  process.exit(1);
});
