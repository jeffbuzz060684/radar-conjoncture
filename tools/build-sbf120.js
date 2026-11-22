#!/usr/bin/env node
"use strict";
// Radar Conjoncture — construction de la composition du SBF 120 (aucune dépendance, Node 18+)
//   SBF 120 = CAC 40 + CAC Next 20 + CAC Mid 60 (groupes disjoints, révisions trimestrielles Euronext).
//   Noms : Wikipédia FR (navbox « Entreprises du CAC … », projet indices boursiers, à jour de la révision
//   du 22/12/2025). La page EN "CAC Next 20" est OBSOLÈTE (Accor/Eiffage/Euronhead y figurent encore, tous
//   passés au CAC 40) — on ne l'utilise pas.
//   Tickers : mnémoniques de la table Wikipédia CAC 40 (colonne « Mnémo ») ; pour les 80 autres, le modèle
//   {{Euronext|Mnémo|ISIN|Place}} de l'infobox de chaque article, récupéré en 2 REQUÊTES BATCH (50 titres
//   par requête — jamais 80 requêtes individuelles, les quotas API ne le pardonneraient pas).
//   Fallback : API search Yahoo (résolution nom → symbole .PA) si l'infobox n'a pas le modèle.
// Écrit sbf120.json. Contrôles bloquants : 40/20/60 exactement, groupes disjoints, 120 symboles uniques,
//   tout résolu ; si un contrôle échoue -> exit 1 et sbf120.json précédent conservé.

var fs = require("fs");
var path = require("path");
// v9.1 : pipeline MIGRÉ de sentinelle--perso (dépôt supprimé) — les 3 helpers de parsing
// (decodeEntities/stripTags/normName) sont INLINÉS ici : plus de dépendance à logic.js externe.
function decodeEntities(s) {
  return String(s == null ? "" : s)
    .replace(/&nbsp;/gi, " ").replace(/&euro;/gi, "€")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
}
function stripTags(s) {
  return decodeEntities(String(s == null ? "" : s).replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function normName(s) {
  return String(s == null ? "" : s).toUpperCase()
    .replace(/[\u00c0\u00c1\u00c2\u00c3\u00c4\u00c5]/g, "A").replace(/[\u00c8\u00c9\u00ca\u00cb]/g, "E")
    .replace(/[\u00cc\u00cd\u00ce\u00cf]/g, "I").replace(/[\u00d2\u00d3\u00d4\u00d5\u00d6]/g, "O")
    .replace(/[\u00d9\u00da\u00db\u00dc]/g, "U").replace(/\u00c7/g, "C")
    .replace(/[^A-Z0-9]+/g, " ").trim();
}
var RI = { decodeEntities: decodeEntities, stripTags: stripTags, normName: normName };

var UA = "RadarConjoncture/9.1 (https://github.com/jeffbuzz060684/radar-conjoncture)";
var FETCH_IMPL = (typeof fetch === "function") ? fetch : null;
function setFetchForTests(f) { FETCH_IMPL = f; }
function log() { console.log.apply(console, arguments); }

function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }

// GET avec retries 429/5xx honorant Retry-After (Wikipédia/Yahoo limitent les rafales).
async function fetchRetry(url, accept, maxAttempts, label) {
  var text = null, finalStatus = 0;
  for (var attempt = 1; attempt <= (maxAttempts || 6); attempt++) {
    var status = 0, ra = 0;
    try {
      var ac = new AbortController();
      var timer = setTimeout(function () { ac.abort(); }, 20000);
      var r = await FETCH_IMPL(url, { headers: { "User-Agent": UA, "Accept": accept || "*/*" }, signal: ac.signal });
      clearTimeout(timer);
      status = r.status;
      ra = parseInt(String(r.headers && r.headers.get ? r.headers.get("retry-after") : "") || "", 10) || 0;
      text = await r.text();
    } catch (e) { await sleep(1000 * attempt); continue; }
    if (status === 200) { finalStatus = 200; break; }
    finalStatus = status;
    if (status === 429 || status >= 500) { text = null; await sleep(ra ? Math.min(ra * 1000, 30000) : 2000 * attempt); continue; }
    throw new Error("HTTP " + status + " sur " + (label || url));
  }
  if (finalStatus !== 200 || text == null) throw new Error((label || url) + " : indisponible (statut " + finalStatus + ")");
  return text;
}
async function fetchJsonRetry(url, maxAttempts, label) {
  return JSON.parse(await fetchRetry(url, "application/json", maxAttempts, label));
}

// ---------- parsing Wikipédia ----------

// liens <a> d'une table navbox « Entreprises du CAC X » — exclut les liens internes du bandeau (v, m, ·,
// drapeau, les autres indices CAC). Retourne [{ label, page }] : libellé affiché + titre de l'article
// (href /wiki/… décodé) dans l'ordre, uniques par page.
function navboxCompanies(html) {
  var tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  var picked = null;
  for (var i = 0; i < tables.length; i++) {
    if (tables[i].indexOf("Entreprises du") >= 0) { picked = tables[i]; break; }
  }
  if (!picked) return null;
  var seen = {}, out = [];
  var re = /<a\b([^>]*)href="[^"]*\/wiki\/([^"#]+)"([^>]*)>([^<]*)<\/a>/g, m;
  while ((m = re.exec(picked)) !== null) {
    var attrs = m[1] + m[3], label = RI.decodeEntities(m[4]).trim();
    var page = decodeURIComponent(m[2].replace(/_/g, " "));
    if (label.length < 3) continue;                       // v · m, drapeau (image), etc.
    if (attrs.indexOf("class=\"new\"") >= 0) continue;     // article inexistant
    if (/title="[^"]*Mod\u00e8le:/i.test(attrs)) continue; // liens internes du bandeau
    if (/title="[^"]*(Drapeau|Fichier|Cat\u00e9gorie|Portail|Discussion)/i.test(attrs)) continue;
    if (/^CAC\b/.test(label)) continue;                   // liens vers les autres indices du bandeau
    if (label.indexOf("indices") >= 0) continue;
    if (!seen[page]) { seen[page] = 1; out.push({ label: label, page: page }); }
  }
  return out.length ? out : null;
}

// table « Composition » du CAC 40 (Wikipédia FR) : colonnes Société | Mnémo | Secteur | …
// Retourne [{ nom, mnemo, secteur }] — 40 lignes attendues.
function cac40Table(html) {
  var tables = html.match(/<table[\s\S]*?<\/table>/g) || [];
  for (var i = 0; i < tables.length; i++) {
    var rows = tables[i].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    if (rows.length !== 41) continue;
    var out = [], headOk = false;
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r].match(/<t[hd][^>]*>[\s\S]*?<\/t[hd]>/g) || [];
      var txt = cells.map(function (c) { return RI.stripTags(c); });
      if (r === 0) { headOk = /Soci\u00e9t\u00e9/i.test(txt[0] || "") && /Mn\u00e9mo/i.test(txt[1] || ""); if (!headOk) break; continue; }
      if (txt.length >= 2 && txt[0] && txt[1]) out.push({ nom: txt[0], mnemo: txt[1].replace(/\s+/g, ""), secteur: txt[2] || "" });
    }
    if (headOk && out.length === 40) return out;
  }
  return null;
}

// ---------- tickers ----------

// mnémonique Euronext + ISIN depuis le modèle {{Euronext|Mnémo|ISIN|Place}} du wikitext d'une infobox.
// Accepte les variantes rencontrées : {{euronext|ADP}} (minuscules), {{Euronext |BIM}} (espace).
function euronextFromWikitext(wt) {
  var m = String(wt || "").match(/\{\{\s*euronext\s*\|([^}|]+)(?:\|([^}|]+))?(?:\|([^}|]+))?/i);
  if (!m) return null;
  var mn = m[1].trim();
  if (!/^[A-Z0-9]{1,6}$/.test(mn)) return null;
  var isin = (m[2] || "").trim();
  return { mn: mn, isin: /^[A-Z]{2}/.test(isin) ? isin : "" };
}

// BATCH : section 0 (infobox) de 50 articles en UNE requête API.
// Retourne { titrePage -> wikitext }.
async function wikiInfoboxBatch(titles) {
  var url = "https://fr.wikipedia.org/w/api.php?action=query&format=json&prop=revisions&rvprop=content&rvsection=0&titles=" +
    encodeURIComponent(titles.join("|"));
  var body = await fetchJsonRetry(url, 6, "API Wikipédia (batch infobox)");
  var out = {};
  var pages = (body && body.query && body.query.pages) || {};
  Object.keys(pages).forEach(function (id) {
    var p = pages[id];
    var rev = p.revisions && p.revisions[0];
    if (rev) out[p.title] = rev["*"] || "";
  });
  return out;
}

// dernier recours : résolution nom -> symbole .PA via l'API search Yahoo.
async function resolveYahoo(name) {
  var url = "https://query1.finance.yahoo.com/v1/finance/search?q=" + encodeURIComponent(name) + "&quotesCount=6&newsCount=0";
  var body = await fetchJsonRetry(url, 5, "search Yahoo « " + name + " »");
  var quotes = (body && body.quotes) || [];
  var norm = RI.normName(name);
  var fallback = null;
  for (var i = 0; i < quotes.length; i++) {
    var q = quotes[i];
    var sym = String(q.symbol || "");
    if (!/^[A-Z0-9]{1,6}\.PA$/.test(sym)) continue;
    var qn = RI.normName(q.shortname || q.longname || "");
    if (!fallback) fallback = sym;
    if (qn && (qn.indexOf(norm) >= 0 || norm.indexOf(qn) >= 0)) return { y: sym, approx: false };
  }
  return fallback ? { y: fallback, approx: true } : null;
}

// ---------- assemblage ----------

async function buildSbf120() {
  var WIKI_CAC40 = "https://fr.wikipedia.org/wiki/CAC_40";
  var WIKI_NEXT20 = "https://fr.wikipedia.org/wiki/CAC_Next_20";
  var WIKI_MID60 = "https://fr.wikipedia.org/wiki/CAC_Mid_60";

  log("[sbf120] téléchargement des 3 pages Wikipédia FR…");
  var h40 = await fetchRetry(WIKI_CAC40, "text/html", 6, "page CAC 40");
  var h20 = await fetchRetry(WIKI_NEXT20, "text/html", 6, "page CAC Next 20");
  var h60 = await fetchRetry(WIKI_MID60, "text/html", 6, "page CAC Mid 60");

  var t40 = cac40Table(h40);
  if (!t40) throw new Error("table CAC 40 (41 lignes Société/Mnémo) introuvable — page Wikipédia changée ?");
  var g40 = navboxCompanies(h40);
  var g20 = navboxCompanies(h20);
  var g60 = navboxCompanies(h60);
  if (!g40 || g40.length !== 40) throw new Error("navbox CAC 40 : " + (g40 ? g40.length : 0) + " entreprises (40 attendues)");
  if (!g20 || g20.length !== 20) throw new Error("navbox CAC Next 20 : " + (g20 ? g20.length : 0) + " entreprises (20 attendues)");
  if (!g60 || g60.length !== 60) throw new Error("navbox CAC Mid 60 : " + (g60 ? g60.length : 0) + " entreprises (60 attendues)");

  // mnémoniques du CAC 40 : la table officielle de la page (colonne Mnémo)
  var mnByNorm = {};
  t40.forEach(function (r) { mnByNorm[RI.normName(r.nom)] = r.mnemo; });

  // les 80 autres : infobox en 2 batchs de 50
  var rest = g20.concat(g60);
  log("[sbf120] mnémoniques : 2 requêtes batch vers l'API Wikipédia…");
  var wikitexts = {};
  for (var b = 0; b < rest.length; b += 50) {
    var part = await wikiInfoboxBatch(rest.slice(b, b + 50).map(function (x) { return x.page; }));
    Object.keys(part).forEach(function (k) { wikitexts[k] = part[k]; });
  }

  var entries = [], errors = [];
  async function addGroup(items, group) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var mn = mnByNorm[RI.normName(it.label)], isin = "", approx = false;
      if (!mn) {
        var eur = euronextFromWikitext(wikitexts[it.page]);
        if (eur) { mn = eur.mn; isin = eur.isin; }
        else {
          var r = await resolveYahoo(it.label);
          if (!r) { errors.push("« " + it.label + " » : aucun ticker trouvé (ni infobox Wikipédia, ni Yahoo)"); continue; }
          mn = r.y.replace(/\.PA$/, "");
          approx = r.approx === true;
          log("[sbf120] ⚠ « " + it.label + " » résolu via Yahoo search : " + r.y + (approx ? " (correspondance approximative)" : "") + " — à vérifier");
          await sleep(400);
        }
      }
      entries.push({ n: it.label, mn: mn, y: mn + ".PA", g: group, disp: it.label, isin: isin, approx: approx });
    }
  }
  await addGroup(g40, "cac40");
  await addGroup(g20, "next20");
  await addGroup(g60, "mid60");

  if (errors.length) throw new Error("résolution impossible pour : " + errors.join(" ; "));

  // contrôles : 40/20/60, disjoint, symboles uniques
  var c = { cac40: 0, next20: 0, mid60: 0 };
  entries.forEach(function (e) { c[e.g]++; });
  if (c.cac40 !== 40 || c.next20 !== 20 || c.mid60 !== 60) throw new Error("comptes de groupes faux : " + JSON.stringify(c));
  var byNorm = {}, seenY = {};
  entries.forEach(function (e) {
    var k = RI.normName(e.n);
    if (byNorm[k]) throw new Error("doublon de société entre groupes : " + e.n);
    byNorm[k] = 1;
    if (seenY[e.y]) throw new Error("symbole Yahoo en double : " + e.y);
    seenY[e.y] = 1;
  });

  // garde anti-régression : si un sbf120.json précédent existe, pas plus de 12 changements
  var prevPath = path.join(__dirname, "..", "sbf120.json");
  var added = 0, removed = 0;
  if (fs.existsSync(prevPath)) {
    var prev = JSON.parse(fs.readFileSync(prevPath, "utf8"));
    var prevKeys = {}; (prev.list || []).forEach(function (e) { prevKeys[RI.normName(e.n)] = 1; });
    var newKeys = {}; entries.forEach(function (e) { newKeys[RI.normName(e.n)] = 1; });
    entries.forEach(function (e) { if (!prevKeys[RI.normName(e.n)]) added++; });
    Object.keys(prevKeys).forEach(function (k) { if (!newKeys[k]) removed++; });
    if (added + removed > 12) throw new Error("trop de changements vs sbf120.json précédent (+" + added + "/-" + removed + ") — vérifier la source avant d'écraser");
    if (added || removed) log("[sbf120] diff vs précédent : +" + added + " entrées, -" + removed + " sorties");
  }

  return {
    updated: new Date().toISOString().replace(/\.\d+Z$/, "Z"),
    source: "Wikipédia FR (navbox CAC 40/Next 20/Mid 60, révision indices 22/12/2025 ; mnémoniques table CAC 40 + infobox {{Euronext}})",
    counts: c,
    list: entries.map(function (e) { return { n: e.n, y: e.y, mn: e.mn, g: e.g, disp: e.disp, isin: e.isin || "", approx: e.approx === true ? true : undefined }; })
  };
}

async function main() {
  try {
    var out = await buildSbf120();
    var dest = path.join(__dirname, "..", "sbf120.json");
    fs.writeFileSync(dest, JSON.stringify(out));
    log("[sbf120] composition écrite : " + out.counts.cac40 + "/" + out.counts.next20 + "/" + out.counts.mid60 + " = " + out.list.length + " valeurs -> " + dest);
  } catch (e) {
    console.error("[sbf120] ÉCHEC — sbf120.json précédent conservé : " + e.message);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { navboxCompanies: navboxCompanies, cac40Table: cac40Table, euronextFromWikitext: euronextFromWikitext, resolveYahoo: resolveYahoo, buildSbf120: buildSbf120, setFetchForTests: setFetchForTests };
