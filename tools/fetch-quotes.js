#!/usr/bin/env node
"use strict";
// Radar Conjoncture — cotations + métriques de valorisation du SBF 120 (aucune dépendance, Node 18+)
// v9.1 : pipeline MIGRÉ de sentinelle--perso (dépôt supprimé) — il alimente l'onglet 🇫🇷 CAC 40
//   Source : Yahoo Finance public. Le flux non officiel exige un cookie (fc.yahoo.com) + un crumb
//   (/v1/test/getcrumb) ; ensuite l'API batch /v7/finance/quote renvoie pour chaque titre .PA :
//   cours, variation, PER (trailing + forward), rendement du dividende, P/B, capitalisation.
//   L'indice lui-même : ^SBF120 (Yahoo). Données Euronext en différé (~15 min) — pas de licence temps réel.
//   120 valeurs en 3 batchs de 40 + 1 pour l'indice = 4 requêtes par run.
// Écrit quotes.json. Garde : moins de 90 % des valeurs qui répondent -> exit 1, quotes.json conservé.

var fs = require("fs");
var path = require("path");
var OPS = require("./ops.js");
var NTFY_Q = require("./ntfy-quotes.js"); // v9.1 : notifyNtfy local (l'ancienne dépendance fetch-insiders.js n'existe pas ici)

var UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
var FETCH_IMPL = (typeof fetch === "function") ? fetch : null;
function setFetchForTests(f) { FETCH_IMPL = f; }
function log() { console.log.apply(console, arguments); }
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

// ---------- garde-fous temps (v4.0.4) ----------
// Timeout par requête : une requête qui ne répond jamais ne doit pas immobiliser un workflow
// (voire retarder un déploiement Pages). Budget global : délai maximal pour UNE collecte
// complète, borné dans main() — les boucles de tentatives s'arrêtent proprement une fois épuisé.
var REQ_TIMEOUT_MS = 12000;
var DEADLINE = null;
function setDeadline(ms) { DEADLINE = ms ? Date.now() + ms : null; }
function outOfTime() { return DEADLINE !== null && Date.now() >= DEADLINE; }

async function rawFetch(url, opts) {
  if (!FETCH_IMPL) throw new Error("fetch indisponible");
  opts = opts || {};
  if (!opts.signal && typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    opts.signal = AbortSignal.timeout(opts.timeoutMs || REQ_TIMEOUT_MS);
  }
  return FETCH_IMPL(url, opts);
}

// ---------- cookie + crumb Yahoo ----------

async function yahooSession(maxAttempts) {
  var attempts = maxAttempts || 8;
  var cookie = "", crumb = "";
  var lastErr = null;
  for (var a = 1; a <= attempts; a++) {
    if (outOfTime()) throw new Error("budget temps dépassé : session Yahoo abandonnée");
    try {
      // 1) cookie : fc.yahoo.com pose A1/A3 même en renvoyant 404
      var r1 = await rawFetch("https://fc.yahoo.com", { headers: { "User-Agent": UA, "Accept": "*/*" } });
      var setCookies = [];
      if (r1.headers && typeof r1.headers.getSetCookie === "function") setCookies = r1.headers.getSetCookie();
      else if (r1.headers && r1.headers.get("set-cookie")) setCookies = String(r1.headers.get("set-cookie")).split(/,(?=[^;]+=)/);
      cookie = setCookies.map(function (c) { return c.split(";")[0]; }).filter(Boolean).join("; ");
      // 2) crumb — un 429 renvoie un CORPS texte (« Too Many Requests ») qui se glisserait en crumb :
      //    on exige un statut 200, sinon on retente. Les 429 de Yahoo vont par rafales : on alterne
      //    query1/query2 et on patiente (backoff ~2,5 s × n° de tentative, jusqu'à ~70 s au total —
      //    le cron a 10 min, mieux vaut patienter que publier un relevé vide).
      var host = (a % 2 === 0) ? "query2" : "query1";
      var r2 = await rawFetch("https://" + host + ".finance.yahoo.com/v1/test/getcrumb", {        headers: { "User-Agent": UA, "Accept": "*/*", "Cookie": cookie }
      });
      if (r2.status !== 200) throw new Error("getcrumb HTTP " + r2.status);
      crumb = (await r2.text()).trim();
      if (crumb && cookie && crumb.length < 32 && /^[\w-]+$/.test(crumb)) return { cookie: cookie, crumb: crumb };
      lastErr = new Error("crumb/cookie inattendus (crumb=" + JSON.stringify(crumb.slice(0, 40)) + ")");
    } catch (e) { lastErr = e; }
    await sleep(2500 * a);
  }
  throw new Error("session Yahoo impossible : " + (lastErr ? lastErr.message : "?"));
}

// ---------- cotations ----------

async function quotesBatch(symbols, sess, maxAttempts) {
  var attempts = maxAttempts || 6;
  var lastErr = null;
  for (var a = 1; a <= attempts; a++) {
    if (outOfTime()) throw new Error("budget temps dépassé : batch v7/quote abandonné (" + symbols.length + " symboles)");
    try {
      var host = (a % 2 === 0) ? "query2" : "query1"; // alternance : les 429 de Yahoo vont par rafales
      var url = "https://" + host + ".finance.yahoo.com/v7/finance/quote?symbols=" + encodeURIComponent(symbols.join(",")) +
        "&crumb=" + encodeURIComponent(sess.crumb);
      var r = await rawFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": sess.cookie } });
      if (r.status === 429 || r.status >= 500) { await sleep(2000 * a); continue; }
      if (r.status !== 200) throw new Error("HTTP " + r.status + " sur v7/quote");
      var body = JSON.parse(await r.text());
      var res = (body.quoteResponse && body.quoteResponse.result) || null;
      if (!res) throw new Error("réponse v7/quote inattendue");
      return res;
    } catch (e) { lastErr = e; await sleep(1500 * a); }
  }
  throw new Error("batch v7/quote en échec (" + symbols.length + " symboles) : " + (lastErr ? lastErr.message : "?"));
}

// ---------- objectifs de cours (consensus analystes) + éléments éco/financiers (v4.0.6) ----------
// Yahoo v10/finance/quoteSummary?modules=financialData, 1 requête PAR valeur (pas de batch pour
// ce module). Fournit l'objectif de cours moyen/haut/bas, le nombre d'analystes, la recommandation
// ET les éléments économiques et financiers qui fondent les modèles des analystes : croissance du
// CA et du résultat, marge opérationnelle, ROE, dette/capitaux propres. Les objectifs bougent
// lentement : garde --max-age-targets-min (12 h côté workflows), et abandon immédiat au premier
// 429 — l'étape n'est JAMAIS bloquante, le relevé des cotes reste valide sans objectifs.

function finDataRow(fd) {
  function num(v) { return (v && typeof v.raw === "number" && isFinite(v.raw)) ? v.raw : null; }
  return {
    tp: num(fd.targetMeanPrice), tpLo: num(fd.targetLowPrice), tpHi: num(fd.targetHighPrice),
    tpN: num(fd.numberOfAnalystOpinions),
    rec: (typeof fd.recommendationKey === "string" && fd.recommendationKey) || null,
    gRev: num(fd.revenueGrowth), gEps: num(fd.earningsGrowth),
    mOp: num(fd.operatingMargins), roe: num(fd.returnOnEquity), de: num(fd.debtToEquity)
  };
}

// v4.1.0 : module calendarEvents (même requête v10 que les objectifs — zéro requête en plus) :
//   nextRes — prochaine date de publication de résultats (earningsDate[0].raw, en ISO YYYY-MM-DD)
//   surp    — surprise EPS MOYENNE des trimestres publiés disponibles (surprisePercent, en %)
// Une surprise positive = l'entreprise bat le consensus ; c'est le fil « résultats financiers »
// du classement d'achat. Champs absents → null, jamais de faux zéro.
function calRow(cal) {
  var nr = null;
  try {
    var ed = cal && cal.earnings && cal.earnings.earningsDate;
    if (ed && ed[0] && typeof ed[0].raw === "number" && isFinite(ed[0].raw)) {
      var d = new Date(ed[0].raw * 1000);
      var p = function (n) { return (n < 10 ? "0" : "") + n; };
      nr = d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
    }
  } catch (e) { nr = null; }
  var surp = null;
  try {
    var hist = cal && cal.earningsHistory && cal.earningsHistory.history;
    if (hist && hist.length) {
      var s = 0, n = 0;
      for (var i = 0; i < hist.length; i++) {
        var sp = hist[i] && hist[i].surprisePercent;
        if (sp && typeof sp.raw === "number" && isFinite(sp.raw)) { s += sp.raw; n++; }
      }
      if (n > 0) surp = Math.round((s / n) * 100) / 100;
    }
  } catch (e2) { surp = null; }
  return { nextRes: nr, surp: surp };
}

// Requête v10 pour un symbole (null si la réponse est vide/mal formée). v4.1.0 : le module
// calendarEvents est demandé DANS la même requête que financialData — les résultats financiers
// et le consensus voyagent ensemble, sans augmenter le nombre de requêtes.
async function finDataFor(sym, sess) {
  var host = (Math.random() < 0.5) ? "query1" : "query2";
  var url = "https://" + host + ".finance.yahoo.com/v10/finance/quoteSummary/" + encodeURIComponent(sym) +
    "?modules=financialData,calendarEvents&crumb=" + encodeURIComponent(sess.crumb);
  var r = await rawFetch(url, { headers: { "User-Agent": UA, "Accept": "application/json", "Cookie": sess.cookie } });
  if (r.status !== 200) { var e = new Error("v10 HTTP " + r.status); e.status = r.status; throw e; }
  var body = JSON.parse(await r.text());
  var res = body && body.quoteSummary && body.quoteSummary.result && body.quoteSummary.result[0];
  if (!res) return null;
  var row = (res.financialData) ? finDataRow(res.financialData) : { tp: null, tpLo: null, tpHi: null, tpN: null, rec: null, gRev: null, gEps: null, mOp: null, roe: null, de: null };
  var cal = calRow(res.calendarEvents);
  row.nextRes = cal.nextRes;
  row.surp = cal.surp;
  return row;
}

// Collecte des objectifs pour tous les tickers. Retour { rows: {ticker: champs}, got, errors }.
// Au premier 429 : on ARRÊTE (les 429 de Yahoo vont par rafales — inutile de marteler 119 fois).
async function fetchTargets(symbols, sess, opts) {
  opts = opts || {};
  var rows = {}, got = 0, errors = 0, aborted = false;
  for (var i = 0; i < symbols.length; i++) {
    if (outOfTime()) { log("[targets] budget temps dépassé après " + i + "/" + symbols.length + " — objectifs partiels conservés"); aborted = true; break; }
    var sym = symbols[i];
    try {
      var row = await finDataFor(sym, sess);
      // v4.1.0 : une ligne SANS objectif mais avec résultats (nextRes/surp) est conservée —
      // le fil « résultats financiers » ne doit pas disparaître quand les objectifs manquent ;
      // le compteur `got` (couverture tpUpdated) ne compte toujours QUE les objectifs.
      if (row && (row.tp != null || row.nextRes != null || row.surp != null)) {
        rows[sym] = row;
        if (row.tp != null) got++;
      }
    } catch (e) {
      if (e && e.status === 429) { log("[targets] 429 Yahoo au symbole " + (i + 1) + "/" + symbols.length + " — étape interrompue, le relevé des cotes reste valide"); aborted = true; break; }
      errors++;
    }
    if (i % 20 === 19) log("[targets] " + (i + 1) + "/" + symbols.length + " traités (" + got + " objectifs)");
    await sleep(opts.paceMs != null ? opts.paceMs : 150);
  }
  if (!aborted && errors) log("[targets] " + errors + " réponses en erreur (ignorées)");
  return { rows: rows, got: got, errors: errors };
}

// Session + collecte, budget temps dédié (jamais de budget résiduel entre les étapes).
async function fetchTargetsAuto(symbols, opts) {
  opts = opts || {};
  setDeadline(opts.budgetTargetsMs || 100000);
  try {
    var sess = await yahooSession(opts.sessionAttempts || 4);
    log("[targets] session Yahoo OK — collecte des objectifs (" + symbols.length + " valeurs)");
    return await fetchTargets(symbols, sess, opts);
  } finally {
    setDeadline(null);
  }
}

// Fusion des objectifs dans un relevé : par ticker, champs courts sur chaque ligne.
// tpUpdated n'est posé QUE si la couverture est décente (≥ 60 % des lignes) — sinon null :
// le run suivant réessaiera au lieu de servir des objectifs périmés en silence.
function mergeTargets(q, targets) {
  if (!targets || !targets.rows) return q;
  q.list.forEach(function (e) {
    var t = targets.rows[e.y];
    if (!t) return;
    for (var k in t) if (Object.prototype.hasOwnProperty.call(t, k)) e[k] = t[k];
  });
  q.tpN = targets.got;
  q.tpUpdated = (targets.got >= Math.ceil(q.list.length * 0.6)) ? new Date().toISOString().replace(/\.\d+Z$/, "Z") : null;
  return q;
}

// Normalise une réponse v7/quote en ligne compacte (noms de champs courts — quotes.json est servi au
// navigateur : taille maîtrisée). null -> champ absent.
function quoteRow(q) {
  function num(v) { return (typeof v === "number" && isFinite(v)) ? v : null; }
  return {
    y: q.symbol,
    n: q.shortname || q.longname || q.symbol,
    px: num(q.regularMarketPrice),
    chg: num(q.regularMarketChangePercent),
    per: num(q.trailingPE),
    fper: num(q.forwardPE),
    dY: num(q.dividendYield),
    pb: num(q.priceToBook),
    cap: num(q.marketCap),
    t: num(q.regularMarketTime),
    st: q.marketState || null,
    w52lo: num(q.fiftyTwoWeekLow),
    w52hi: num(q.fiftyTwoWeekHigh)
  };
}

async function fetchQuotes(sb, opts) {
  opts = opts || {};
  if (!sb || !Array.isArray(sb.list) || sb.list.length < 100) throw new Error("sbf120.json invalide (" + (sb && sb.list ? sb.list.length : 0) + " valeurs)");
  var sess = await yahooSession(opts.sessionAttempts);
  log("[quotes] session Yahoo OK (crumb " + sess.crumb.slice(0, 4) + "…)");

  var bySym = {};
  var batch = 40;
  var symbols = sb.list.map(function (e) { return e.y; });
  for (var i = 0; i < symbols.length; i += batch) {
    if (outOfTime()) throw new Error("budget temps dépassé : relevé Yahoo interrompu après " + i + " valeurs");
    var part = symbols.slice(i, i + batch);
    var res = await quotesBatch(part, sess);
    res.forEach(function (q) { bySym[q.symbol] = quoteRow(q); });
    log("[quotes] batch " + (Math.floor(i / batch) + 1) + "/" + Math.ceil(symbols.length / batch) + " : " + res.length + "/" + part.length + " réponses");
    if (i + batch < symbols.length) await sleep(350);
  }
  // les indices : SBF 120 (onglet SBF) + CAC 40 (onglet 🇫🇷, v4.1.0) — MÊME batch, pas de requête en plus
  var idxRes = await quotesBatch(["^SBF120", "^FCHI"], sess);
  var sbIdx = null, cacIdx = null;
  (idxRes || []).forEach(function (q) {
    if (q.symbol === "^SBF120") sbIdx = quoteRow(q);
    else if (q.symbol === "^FCHI") cacIdx = quoteRow(q);
  });
  var idx = (sbIdx && sbIdx.px != null) ? sbIdx : null;

  var list = [], missing = [];
  sb.list.forEach(function (e) {
    var q = bySym[e.y];
    if (!q || q.px == null) { missing.push(e.y); return; }
    list.push({
      y: e.y, n: q.n, mn: e.mn, g: e.g, isin: e.isin || "", approx: e.approx === true ? true : undefined,
      px: q.px, chg: q.chg, per: q.per, fper: q.fper, dY: q.dY, pb: q.pb, cap: q.cap, t: q.t
    });
  });

  var ratio = list.length / sb.list.length;
  if (ratio < (opts.minRatio || 0.9)) {
    throw new Error("trop peu de réponses Yahoo : " + list.length + "/" + sb.list.length + " — quotes.json précédent conservé");
  }

  return {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "Yahoo Finance (Euronext en différé ~15 min)",
    ok: true,
    n: list.length,
    missing: missing,
    sbUpdated: sb.updated || null,
    idx: idx && idx.px != null ? { px: idx.px, chg: idx.chg, t: idx.t } : null,
    // v4.1.0 : indice CAC 40 dédié (onglet 🇫🇷) — ^FCHI côté Yahoo
    cacIdx: cacIdx && cacIdx.px != null ? { px: cacIdx.px, chg: cacIdx.chg, t: cacIdx.t, name: "CAC 40" } : null,
    list: list
  };
}

// ---------- repli TradingView (quand Yahoo sature en 429 — rafales constatées le 09/11/2026) ----------
// Le scanner public scanner.tradingview.com ne demande ni clé ni cookie et couvre Euronext Paris,
// en différé ~15 min comme Yahoo. Colonnes vérifiées le 09/11/2026 : close, change,
// price_earnings_ttm, dividends_yield_current, price_book_ratio, market_cap_basic répondent ;
// price_earnings_forecast_fy0 reste null sur EURONEXT (→ fper null, l'UI affiche « — »).
// Limites honnêtes : ~8/120 tickers absents du scanner (MT, SOLB, TF1…) → missing[] ;
// le SBF 120 n'y existe pas → indice de repli = CAC 40 (EURONEXT:PX1), nommé dans idx.name
// (affiché tel quel par l'UI — jamais d'indice CAC 40 déguisé en SBF 120).

var TV_SCAN_URL = "https://scanner.tradingview.com/france/scan";
var TV_COLUMNS = ["name", "close", "change", "price_earnings_ttm", "price_earnings_forecast_fy0",
  "dividends_yield_current", "price_book_ratio", "market_cap_basic", "sector",
  "price_52_week_low", "price_52_week_high",
  // v4.0.9 : fondamentaux qualité depuis le MÊME scan (plus de dépendance à Yahoo pour le score 💎) —
  // vérifié le 09/11/2026 sur les 112 réponses : return_on_equity 106, operating_margin 109, debt_to_equity 109.
  // Les colonnes revenue_* (croissance) restent null sur EURONEXT → gRev null en repli TV, la règle
  // « ≥ 3/4 métriques » d'oppScores fait alors le score sur ROE/marge/dette.
  "return_on_equity", "operating_margin", "debt_to_equity"];

function tvTicker(y) { return "EURONEXT:" + String(y).replace(/\.PA$/i, "").toUpperCase(); } // le scanner TV exige des MAJUSCULES
function tvNum(v) { return (typeof v === "number" && isFinite(v)) ? v : null; }
// v4.0.9 : TV parle en % (ROE 16,3) et en ratio (dette/CP 0,54) ; Yahoo — le format canonique de
// quotes.json (finDataRow) — parle en décimaux (0,163) et en % (53,8). On convertit pour que
// logique, UI et validateur ne voient QU'UN format ; mergeTargets écrasera avec les valeurs
// Yahoo dès que Yahoo revient (même définition : ROE = résultat/fonds propres, dette/CP = dette totale/fonds propres).
function tvPct(v) { var n = tvNum(v); return n != null ? n / 100 : null; }  // TV 16,3 % → décimal 0,163
function tvDe(v) { var n = tvNum(v); return n != null ? n * 100 : null; }    // TV ratio 0,538 → % 53,8

async function tvScan(tickers, maxAttempts) {
  var attempts = maxAttempts || 3;
  var lastErr = null;
  for (var a = 1; a <= attempts; a++) {
    try {
      var r = await rawFetch(TV_SCAN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": "https://fr.tradingview.com/", "User-Agent": UA },
        body: JSON.stringify({ symbols: { tickers: tickers, query: { types: [] } }, columns: TV_COLUMNS })
      });
      if (r.status !== 200) throw new Error("scanner HTTP " + r.status);
      var body = JSON.parse(await r.text());
      if (!body || !Array.isArray(body.data)) throw new Error("réponse scanner inattendue");
      return body.data;
    } catch (e) { lastErr = e; await sleep(1500 * a); }
  }
  throw new Error("scanner TV en échec (" + tickers.length + " tickers) : " + (lastErr ? lastErr.message : "?"));
}

async function fetchQuotesTv(sb, opts) {
  opts = opts || {};
  if (!sb || !Array.isArray(sb.list) || sb.list.length < 100) throw new Error("sbf120.json invalide (" + (sb && sb.list ? sb.list.length : 0) + " valeurs)");
  var tickers = sb.list.map(function (e) { return tvTicker(e.y); });
  var rows = {};
  for (var i = 0; i < tickers.length; i += 60) {
    if (outOfTime()) throw new Error("budget temps dépassé : relevé TradingView interrompu");
    var part = tickers.slice(i, i + 60);
    var data = await tvScan(part);
    data.forEach(function (row) { rows[String(row.s).split(":")[1].toUpperCase()] = row.d; });
    log("[quotes/TV] batch " + (Math.floor(i / 60) + 1) + "/" + Math.ceil(tickers.length / 60) + " : " + data.length + "/" + part.length + " réponses");
  }
  var list = [], missing = [];
  sb.list.forEach(function (e) {
    var key = String(e.y).replace(/\.PA$/i, "").toUpperCase();
    var d = rows[key];
    if (!d || tvNum(d[1]) == null) { missing.push(e.y); return; }
    list.push({
      y: e.y, n: e.n, mn: e.mn, g: e.g, isin: e.isin || "", approx: e.approx === true ? true : undefined,
      px: d[1], chg: tvNum(d[2]), per: tvNum(d[3]), fper: tvNum(d[4]),
      dY: tvNum(d[5]), pb: tvNum(d[6]), cap: tvNum(d[7]), t: null,
      sec: (typeof d[8] === "string" && d[8]) ? d[8] : null,
      w52lo: tvNum(d[9]), w52hi: tvNum(d[10]),
      roe: tvPct(d[11]), mOp: tvPct(d[12]), de: tvDe(d[13])
    });
  });
  if (list.length / sb.list.length < (opts.minRatio || 0.9)) {
    throw new Error("trop peu de réponses TradingView : " + list.length + "/" + sb.list.length + " — quotes.json précédent conservé");
  }
  // v4.0.8 : contrôle de schéma — les bornes 52 s. sont en FIN de tableau (d[9]/d[10], d[0] = name) ;
  // si le scanner renvoyait moins de 11 colonnes, w52 serait silencieusement null partout : on prévient.
  var withW52 = list.filter(function (r) { return r.w52lo != null; }).length;
  // (sous le harnais de tests : silence — les fixtures sans bornes déclencheraient ce warning à chaque run CI)
  if (!process.env.SP_HARNESS && list.length >= 20 && withW52 < list.length * 0.5) {
    log("::warning::[quotes/TV] schéma suspect : bornes 52 s. présentes sur " + withW52 + "/" + list.length + " lignes seulement — colonnes décalées ?");
  }
  // indice : SBF 120 absent du scanner → repli CAC 40, explicitement nommé (idx.name affiché par l'UI).
  // Règle v4.0.4 : un relevé de repli SANS indice est REJETÉ (avant écriture) — le validateur
  // exige idx.px, on ne publie jamais un quotes.json destiné à être invalidé. 2 tentatives,
  // puis échec explicite : le relevé précédent est conservé, le cycle suivant réessaiera.
  var idx = null;
  for (var k = 0; k < 2 && !idx; k++) {
    try {
      var idxData = await tvScan(["EURONEXT:PX1"]);
      if (idxData[0] && tvNum(idxData[0].d[1]) != null) {
        idx = { px: idxData[0].d[1], chg: tvNum(idxData[0].d[2]), t: null,
          name: "CAC 40 (repli — SBF 120 absent de TradingView)" };
      }
    } catch (eIdx) { log("[quotes/TV] indice : tentative " + (k + 1) + "/2 en échec — " + eIdx.message); }
  }
  if (!idx) throw new Error("indice de repli (CAC 40) indisponible — relevé rejeté (règle v4.0.4 : jamais de quotes.json sans indice)");
  return {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "TradingView (repli — Yahoo indisponible), Euronext en différé ~15 min",
    ok: true,
    n: list.length,
    missing: missing,
    sbUpdated: sb.updated || null,
    idx: idx,
    // v4.1.0 : en repli TradingView, l'indice déjà relevé EST le CAC 40 (EURONEXT:PX1) —
    // l'onglet 🇫🇷 l'affiche directement, zéro requête en plus.
    cacIdx: { px: idx.px, chg: idx.chg, t: null, name: "CAC 40 (Euronext via TradingView)" },
    list: list
  };
}

// Bascule v4.0.3 : Yahoo d'abord, repli TradingView si Yahoo sature (429 par rafales).
// v4.0.4 : budget temps PAR ÉTAPE — l'étape Yahoo ne doit jamais consommer celui du repli
// (constaté en réel : 8 tentatives getcrumb ≈ 90 s, il ne restait plus rien pour TradingView).
async function fetchQuotesAuto(sb, opts) {
  opts = opts || {};
  var eYahoo = null;
  try {
    try {
      setDeadline(opts.budgetYahooMs || 75000);
      return await fetchQuotes(sb, opts);
    } catch (e) { eYahoo = e; }
    setDeadline(opts.budgetTvMs || 60000);
    log("[quotes] Yahoo en échec (" + eYahoo.message + ") — repli TradingView");
    var out = await fetchQuotesTv(sb, opts);
    log("[quotes] relevé TradingView OK : " + out.n + " valeurs");
    return out;
  } finally {
    setDeadline(null); // jamais de budget résiduel entre deux collectes
  }
}

// Âge d'un relevé en minutes (null si absent/invalide) — pour la garde anti-doublon.
function ageMinutesOf(updatedIso) {
  if (!updatedIso) return null;
  var t = Date.parse(updatedIso);
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

// ---------- v4.1.0 : macro (bandeau 🌍 de l'onglet CAC 40) ----------
// Source : les relevés PUBLICS du Radar Conjoncture de Jade (GitHub Pages) — data.json (relevé
// hebdomadaire vérifié par la tâche planifiée du lundi) et data-daily.json (relevé quotidien
// automatique). Réutiliser ces sources garantit la COHÉRENCE entre les deux apps (jamais deux
// chiffres contradictoires pour la même donnée). Chaque champ vient du relevé LE PLUS FRAIS ;
// les deux fichiers sont complémentaires (l'hebdo porte OAT/Bund/BCE/inflation/PMI, le quotidien
// porte les spots marché VIX). Échec = silencieux : la macro précédente est conservée, les cotes
// restent valides (même convention que les objectifs).
var RADAR_BASE = "https://jeffbuzz060684.github.io/radar-conjoncture/";

async function radarJson(file) {
  var r = await rawFetch(RADAR_BASE + file, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (r.status !== 200) throw new Error(file + " HTTP " + r.status);
  return JSON.parse(await r.text());
}

async function fetchMacro() {
  var weekly = null, daily = null;
  try { weekly = await radarJson("data.json"); }
  catch (e) { log("[macro] data.json Radar indisponible : " + e.message); }
  if (weekly) {
    try { daily = await radarJson("data-daily.json"); }
    catch (e2) { log("[macro] data-daily.json Radar indisponible : " + e2.message); }
  }
  if (!weekly && !daily) throw new Error("Radar Conjoncture injoignable");
  var wd = (weekly && weekly.data) || {}, dd = (daily && daily.data) || {};
  var wDate = String((weekly && weekly.dateData) || ""), dDate = String((daily && daily.dateData) || "");
  var dailyNewer = dDate > wDate; // dates ISO : comparaison lexicographique valide
  function pick(k) {
    if (dailyNewer && dd[k] != null && isFinite(dd[k])) return dd[k];
    if (wd[k] != null && isFinite(wd[k])) return wd[k];
    if (dd[k] != null && isFinite(dd[k])) return dd[k];
    return null;
  }
  var m = {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "Radar Conjoncture — relevés publics data.json (hebdo vérifié) + data-daily.json",
    dateData: (dailyNewer ? dDate : wDate) || null,
    dateMacro: (wd.dateMacro != null) ? wd.dateMacro : null
  };
  ["vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE", "pmiZE", "cape"].forEach(function (k) { m[k] = pick(k); });
  m.bceDir = ((typeof wd.bceDir === "string" && wd.bceDir) || (typeof dd.bceDir === "string" && dd.bceDir) || null);
  return m;
}

// applique la macro à un relevé : la macro précédente est reportée si fraîche (< maxAgeMacroMin,
// défaut 60 min — 2 petites requêtes), sinon re-fetch ; échec → macro précédente conservée.
// Toujours non bloquant : un relevé de cotes ne doit JAMAIS échouer à cause de la macro.
async function applyMacro(q, prev, opts) {
  opts = opts || {};
  var maxAge = (opts.maxAgeMacroMin != null) ? opts.maxAgeMacroMin : 60;
  if (prev && prev.macro && ageMinutesOf(prev.macro.updated) != null && ageMinutesOf(prev.macro.updated) < maxAge) {
    q.macro = prev.macro;
    return q;
  }
  try {
    q.macro = await fetchMacro();
    log("[macro] Radar Conjoncture intégré (données du " + q.macro.dateData + ")");
  } catch (e) {
    if (prev && prev.macro) { q.macro = prev.macro; log("[macro] échec — macro précédente conservée : " + e.message); }
    else log("[macro] échec — bandeau macro absent : " + e.message);
  }
  return q;
}

// v4.0.8 : alertes de panne ntfy pour les cotes (topic en secret, jamais en dur dans un dépôt public)
async function alertOps(alerts) {
  var topic = String(process.env.NTFY_TOPIC || "").trim();
  if (!topic) { log("[ops] NTFY_TOPIC non défini — " + alerts.length + " alerte(s) de panne NON envoyée(s)"); return; }
  var n = await NTFY_Q.notifyNtfy(topic, alerts);
  log("[ops] " + n + "/" + alerts.length + " alerte(s) de panne envoyée(s)");
}

// v4.0.8 : mémoire ops + alertes de transition + dead man's switch. Jamais bloquant : une
// erreur ici ne doit jamais empêcher un relevé de cotes d'être commité.
async function opsSuccess() {
  try {
    var prev = OPS.loadOps();
    var r = OPS.nextQuotes(prev, true);
    OPS.saveOps(r.ops);
    if (r.alerts.length) await alertOps(r.alerts);
    var okPing = await OPS.pingHealth(String(process.env.HEALTHCHECKS_URL || "").trim());
    log("[ops] cotes OK ; dead man : " + (okPing ? "ping envoyé (run allé au bout)" : "pas de ping (HEALTHCHECKS_URL absent ou en échec)"));
  } catch (eOps) { log("[ops] étape non bloquante en échec : " + eOps.message); }
}

async function main() {
  var dest = path.join(__dirname, "..", "quotes.json");
  // v4.0.4 anti-double collecte : --max-age-min=N (utilisé par le secours de pages.yml) —
  // si le quotes.json existant a moins de N minutes, on ne re-collecte PAS (le cron quotes.yml
  // couvre déjà la cadence). Sans l'option, on collecte toujours (workflow cotes dédié).
  // v4.0.6 : --max-age-targets-min=N — les objectifs d'analystes bougent lentement : si le
  // tpUpdated du fichier existant a moins de N minutes, l'étape objectifs est sautée (le module
  // v10 est PAR valeur : 120 requêtes à ne refaire que 1x/12 h).
  // v4.1.0 : --max-age-macro-min=N — la macro du Radar Conjoncture est re-téléchargée si la
  // précédente a plus de N minutes (défaut 60 : 2 petites requêtes vers GitHub Pages).
  var maxAge = null, maxAgeTargets = null, maxAgeMacro = null;
  process.argv.forEach(function (a) {
    var m = /^--max-age-min=(\d+)$/.exec(a);
    if (m) maxAge = parseInt(m[1], 10);
    var t = /^--max-age-targets-min=(\d+)$/.exec(a);
    if (t) maxAgeTargets = parseInt(t[1], 10);
    var g = /^--max-age-macro-min=(\d+)$/.exec(a);
    if (g) maxAgeMacro = parseInt(g[1], 10);
  });
  try {
    var sb = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "sbf120.json"), "utf8"));
    var prev = null;
    try { prev = JSON.parse(fs.readFileSync(dest, "utf8")); } catch (eRead) { /* pas de quotes.json précédent */ }
    var targetsFresh = function () {
      var ageT = prev ? ageMinutesOf(prev.tpUpdated) : null;
      return ageT !== null && (maxAgeTargets === null || ageT < maxAgeTargets);
    };
    if (maxAge !== null && prev) {
      var age = ageMinutesOf(prev.updated);
      if (age !== null && age < maxAge) {
        log("[quotes] relevé précédent frais (" + age + " min < " + maxAge + ") — pas de nouvelle collecte (anti-doublon)");
        // les cotes sont fraîches mais les objectifs/macro peuvent être périmés : étapes ciblées,
        // on ne touche à RIEN d'autre du fichier (cotes, indice, composition d'origine).
        var dirty = false;
        if (!targetsFresh() && prev.list && prev.list.length) {
          try {
            var t0 = await fetchTargetsAuto(prev.list.map(function (e) { return e.y; }), {});
            if (t0.got > 0) {
              mergeTargets(prev, t0);
              dirty = true;
              log("[targets] écrit : " + t0.got + " objectifs (relevé des cotes inchangé)");
            } else log("[targets] aucun objectif récupéré");
          } catch (eT) { log("[targets] étape en échec (non bloquant) : " + eT.message); }
        } else if (targetsFresh()) { log("[targets] objectifs précédents frais — rien à faire"); }
        // v4.1.0 : la macro est rafraîchie MÊME quand cotes et objectifs sont frais (elle vit
        // dans un autre fichier côté Radar et suit son propre rythme — hebdo vérifié + quotidien)
        var mBefore = (prev.macro && prev.macro.updated) || null;
        await applyMacro(prev, prev, { maxAgeMacroMin: maxAgeMacro });
        if (prev.macro && prev.macro.updated !== mBefore) {
          dirty = true;
          log("[macro] relevé macro écrit (cotes inchangées)");
        }
        if (dirty) fs.writeFileSync(dest, JSON.stringify(prev));
        await opsSuccess();
        return;
      }
    }
    setDeadline(null); // fetchQuotesAuto pose son budget par étape (Yahoo puis repli)
    var out = await fetchQuotesAuto(sb, {});
    // étape objectifs (v4.0.6) : non bloquante. Si les objectifs du fichier précédent sont
    // frais, on les REPORTe sur le nouveau relevé (l'objectif ne dépend pas du relevé en cours) ;
    // sinon on collecte (Yahoo v10 — le repli TradingView n'a pas d'objectifs, la colonne est null).
    if (prev && targetsFresh() && prev.list) {
      var carried = { rows: {}, got: 0 };
      prev.list.forEach(function (e) {
        if (e.tp != null) {
          // v4.1.0 : les résultats financiers (nextRes/surp) voyagent avec les objectifs
          carried.rows[e.y] = { tp: e.tp, tpLo: e.tpLo, tpHi: e.tpHi, tpN: e.tpN, rec: e.rec, gRev: e.gRev, gEps: e.gEps, mOp: e.mOp, roe: e.roe, de: e.de, nextRes: e.nextRes != null ? e.nextRes : null, surp: e.surp != null ? e.surp : null };
          carried.got++;
        }
      });
      if (carried.got >= Math.ceil(out.list.length * 0.6)) {
        mergeTargets(out, carried); out.tpUpdated = prev.tpUpdated;
        log("[targets] objectifs précédents reportés sur le nouveau relevé (" + carried.got + ")");
      }
    }
    if (out.tpUpdated == null) {
      try {
        var t1 = await fetchTargetsAuto(out.list.map(function (e) { return e.y; }), {});
        mergeTargets(out, t1);
        log("[targets] " + t1.got + "/" + out.list.length + " objectifs intégrés" + (out.tpUpdated ? "" : " (couverture insuffisante — tpUpdated non posé)"));
      } catch (eT) { log("[targets] étape en échec (non bloquant) : " + eT.message); }
    }
    // v4.1.0 : macro du Radar Conjoncture (bandeau 🌍 de l'onglet CAC 40) — non bloquante
    await applyMacro(out, prev, { maxAgeMacroMin: maxAgeMacro });
    fs.writeFileSync(dest, JSON.stringify(out));
    log("[quotes] écrit : " + out.n + " valeurs" + (out.missing.length ? " (manquantes : " + out.missing.join(", ") + ")" : "") + " -> " + dest);
    await opsSuccess();
  } catch (e) {
    console.error("[quotes] ÉCHEC — quotes.json précédent conservé : " + e.message);
    // v4.0.8 : panne de cotes → mémoire ops + alerte (flip ok→panne, et 2 échecs de suite)
    try {
      var prevOps = OPS.loadOps();
      var rOps = OPS.nextQuotes(prevOps, false);
      OPS.saveOps(rOps.ops);
      await alertOps(rOps.alerts);
    } catch (eOps) { console.error("[ops] étape en échec : " + eOps.message); }
    process.exit(1);
  }
}
if (require.main === module) main();
module.exports = { yahooSession: yahooSession, quotesBatch: quotesBatch, quoteRow: quoteRow, fetchQuotes: fetchQuotes, setFetchForTests: setFetchForTests, fetchQuotesTv: fetchQuotesTv, tvScan: tvScan, tvTicker: tvTicker, fetchQuotesAuto: fetchQuotesAuto, ageMinutesOf: ageMinutesOf, setDeadline: setDeadline, finDataRow: finDataRow, finDataFor: finDataFor, fetchTargets: fetchTargets, fetchTargetsAuto: fetchTargetsAuto, mergeTargets: mergeTargets, calRow: calRow, radarJson: radarJson, fetchMacro: fetchMacro, applyMacro: applyMacro };
