#!/usr/bin/env node
"use strict";
// Validation de sbf120.json (composition) et quotes.json (cotations) avant tout déploiement.
// Tolérant : un fichier absent = note, pas d'échec (l'UI gère l'état vide).
// En revanche, un fichier PRÉSENT mais invalide = exit 1 (ne jamais servir de la bouillie).
var fs = require("fs");

function fail(msg) { console.error("VALIDATION ÉCHOUÉE : " + msg); process.exit(1); }
function load(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) {
    if (e.code === "ENOENT") return null;
    fail(p + " illisible : " + e.message);
  }
}

// ---------- sbf120.json : 120 valeurs, tickers uniques, 40/20/60 ----------
var sbf = load("sbf120.json");
if (sbf) {
  if (!sbf || typeof sbf !== "object" || !Array.isArray(sbf.list)) fail("sbf120.json : pas d'objet avec list[]");
  if (sbf.list.length !== 120) fail("sbf120.json : " + sbf.list.length + " valeurs au lieu de 120");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(sbf.updated || "")) fail("sbf120.json : updated absent ou non ISO");
  var seenY = {}, seenMn = {}, groups = {};
  sbf.list.forEach(function (r, i) {
    var w = "sbf120.list[" + i + "] : ";
    if (!r.n || !r.y || !r.mn) fail(w + "champ n/y/mn manquant");
    if (seenY[r.y]) fail(w + "doublon ticker " + r.y);
    seenY[r.y] = true;
    if (seenMn[r.mn]) fail(w + "doublon mnémonique " + r.mn);
    seenMn[r.mn] = true;
    if (["cac40", "next20", "mid60"].indexOf(r.g) < 0) fail(w + "groupe inconnu : " + r.g);
    groups[r.g] = (groups[r.g] || 0) + 1;
  });
  if (groups.cac40 !== 40 || groups.next20 !== 20 || groups.mid60 !== 60) {
    fail("sbf120.json : composition " + JSON.stringify(groups) + " au lieu de 40/20/60");
  }
  console.log("sbf120.json OK : 120 valeurs (40 CAC 40 + 20 Next 20 + 60 Mid 60), build " + sbf.updated);
} else {
  console.log("  note : sbf120.json absent — l'onglet SBF restera vide jusqu'au premier build");
}

// ---------- quotes.json : { updated, source, ok, n, missing, idx, cacIdx?, macro?, list } ----------
// v4.1.0 : cacIdx (indice CAC 40 dédié, Yahoo ^FCHI) et macro (relevés Radar Conjoncture) sont
// OPTIONNELS — le repli TradingView n'en produit pas (idx tient lieu de CAC 40, bandeau absent).
var q = load("quotes.json");
if (q) {
  if (!q || typeof q !== "object") fail("quotes.json : pas un objet");
  if (!/^\d{4}-\d{2}-\d{2}T/.test(q.updated || "")) fail("quotes.json : updated absent ou non ISO");
  if (q.sbUpdated !== undefined && q.sbUpdated !== null && !/^\d{4}-\d{2}-\d{2}T/.test(q.sbUpdated)) fail("quotes.json : sbUpdated non ISO");
  if (typeof q.ok !== "boolean") fail("quotes.json : ok absent (bool attendu)");
  if (!Array.isArray(q.list)) fail("quotes.json : list pas un tableau");
  if (!Array.isArray(q.missing)) fail("quotes.json : missing pas un tableau");
  if (!q.idx || !isFinite(q.idx.px)) fail("quotes.json : indice SBF 120 absent (idx.px)");
  if (q.list.length + q.missing.length < 100) fail("quotes.json : " + q.list.length + " + " + q.missing.length + " missing < 100 — le relevé ne couvre pas l'indice");
  var seenQ = {};
  q.list.forEach(function (r, i) {
    var w = "quotes.list[" + i + "] : ";
    if (!r.y) fail(w + "ticker y manquant");
    if (seenQ[r.y]) fail(w + "doublon ticker " + r.y);
    seenQ[r.y] = true;
    if (!isFinite(r.px) || r.px <= 0) fail(w + "px invalide : " + r.px);
    ["chg", "per", "fper", "dY", "pb", "cap", "tp", "tpLo", "tpHi", "tpN", "gRev", "gEps", "mOp", "roe", "de", "w52lo", "w52hi"].forEach(function (k) {
      if (r[k] !== null && r[k] !== undefined && !isFinite(r[k])) fail(w + k + " invalide : " + r[k]);
    });
    if (r.w52lo != null && r.w52lo <= 0) fail(w + "plus bas 52 s. non positif : " + r.w52lo);
    if (r.w52lo != null && r.w52hi != null && !(r.w52hi > r.w52lo)) fail(w + "fourchette 52 s. incohérente (lo " + r.w52lo + " >= hi " + r.w52hi + ")");
    if (r.tp != null && r.tpLo != null && r.tpHi != null && !(r.tpLo <= r.tp && r.tp <= r.tpHi)) fail(w + "objectif hors bornes (tp " + r.tp + ", " + r.tpLo + "-" + r.tpHi + ")");
    if (r.tp != null && r.tp <= 0) fail(w + "objectif non positif : " + r.tp);
    // v4.1.0 : résultats financiers — prochaine publication (date ISO stricte) + surprise EPS (finie)
    if (r.nextRes !== null && r.nextRes !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(r.nextRes))) fail(w + "nextRes non YYYY-MM-DD : " + r.nextRes);
    if (r.surp !== null && r.surp !== undefined && !isFinite(r.surp)) fail(w + "surp invalide : " + r.surp);
    if (!r.n || !r.mn || !r.g) fail(w + "champ n/mn/g manquant");
  });
  // v4.1.0 : indice CAC 40 dédié — toléré absent (repli TV : idx EST le CAC 40), sinon px positif
  if (q.cacIdx !== undefined && q.cacIdx !== null) {
    if (typeof q.cacIdx !== "object" || !isFinite(q.cacIdx.px) || q.cacIdx.px <= 0) fail("quotes.json : cacIdx invalide (px) : " + JSON.stringify(q.cacIdx));
  }
  // v4.1.0 : bandeau macro (relevés publics du Radar Conjoncture) — toléré absent, sinon champs finis
  if (q.macro !== undefined && q.macro !== null) {
    var mg = q.macro, mw = "quotes.macro : ";
    if (typeof mg !== "object") fail(mw + "pas un objet");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(mg.dateData || ""))) fail(mw + "dateData absent ou non YYYY-MM-DD : " + mg.dateData);
    ["vix", "vix5", "oat10", "bund10", "spread", "bceDepot", "inflZE", "pmiZE", "cape"].forEach(function (k) {
      if (mg[k] !== null && mg[k] !== undefined && !isFinite(mg[k])) fail(mw + k + " invalide : " + mg[k]);
    });
    if (mg.bceDir !== null && mg.bceDir !== undefined && ["hausse", "baisse", "stable"].indexOf(mg.bceDir) < 0) fail(mw + "bceDir inconnu : " + mg.bceDir);
    if (mg.src !== null && mg.src !== undefined && typeof mg.src !== "string") fail(mw + "src non chaîne");
  }
  // si le relevé s'est bien passé, il doit couvrir l'essentiel de l'indice (garde 90 % côté fetch,
  // on re-vérifie ici : ok=true avec la moitié des valeurs manquantes = incohérence)
  if (q.ok && q.list.length < 108) fail("quotes.json : ok=true mais seulement " + q.list.length + "/120 cotes");
  console.log("quotes.json OK : " + q.list.length + "/120 cotes, indice " + q.idx.px +
    (q.ok ? "" : " [relevé en échec — relevé précédent conservé]") + ", " + q.updated);
} else {
  console.log("  note : quotes.json absent — l'UI affichera l'état vide, pas d'échec");
}
