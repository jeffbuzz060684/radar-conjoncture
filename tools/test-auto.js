/* Harnais de tests — Radar Conjoncture v3 (modules auto.js & vehicles.js + cohérence des fichiers)
   Exécution : node tools/test-auto.js  →  0 échec obligatoire avant publication. */
"use strict";
var fs = require("fs");
var path = require("path");

var A = require(path.join(__dirname, "..", "auto.js"));
var results = [];
function t(name, cond) { results.push({ name: name, ok: !!cond }); }

// ---------- Auto_isNewerDate ----------
t("isNewerDate: date plus récente → true", A.Auto_isNewerDate("2026-10-24", "2026-10-17") === true);
t("isNewerDate: même date → false", A.Auto_isNewerDate("2026-10-17", "2026-10-17") === false);
t("isNewerDate: date plus ancienne → false", A.Auto_isNewerDate("2026-10-10", "2026-10-17") === false);
t("isNewerDate: année à 4 chiffres seule → true", A.Auto_isNewerDate("2027-01-05", "2026-12-31") === true);
t("isNewerDate: entrée non chaîne → false", A.Auto_isNewerDate(null, "2026-10-17") === false && A.Auto_isNewerDate("2026-10-17", undefined) === false);

// ---------- Auto_validRemote ----------
var OK_REMOTE = { dateData: "2026-10-24", data: { msci: 150.2 }, note: "test" };
t("validRemote: payload valide → accepté", A.Auto_validRemote(OK_REMOTE) === OK_REMOTE);
t("validRemote: null → null", A.Auto_validRemote(null) === null);
t("validRemote: sans data → null", A.Auto_validRemote({ dateData: "2026-10-24" }) === null);
t("validRemote: data non objet → null", A.Auto_validRemote({ dateData: "2026-10-24", data: "x" }) === null);
t("validRemote: dateData manquant → null", A.Auto_validRemote({ data: {} }) === null);
t("validRemote: dateData mal formé → null", A.Auto_validRemote({ dateData: "24/10/2026", data: {} }) === null);
t("validRemote: dateData partielle → null", A.Auto_validRemote({ dateData: "2026-10", data: {} }) === null);

// ---------- Auto_merge ----------
var LOCAL = {
  dateData: "2026-10-17", msci: 146.73, bceDir: "hausse", orEUR: 3705.85,
  btcHigh52: null, reserve: 500, paliersDone: { p5: true, p10: false, p15: false, p20: false }
};
var m1 = A.Auto_merge(LOCAL, { msci: 150.2, bceDir: "baisse", inconnu: 42, orEUR: null, reserve: 9999, paliersDone: { p20: true }, dateData: "2026-11-01" });
t("merge: champ numérique appliqué", m1.msci === 150.2);
t("merge: champ texte (sel) appliqué", m1.bceDir === "baisse");
t("merge: champ inconnu ignoré", !("inconnu" in m1));
t("merge: valeur null ignorée (orEUR conservé)", m1.orEUR === 3705.85);
t("merge: reserve jamais écrasé", m1.reserve === 500);
t("merge: paliersDone jamais écrasé", m1.paliersDone.p10 === false && m1.paliersDone.p20 === false);
t("merge: dateData jamais écrasée", m1.dateData === "2026-10-17");
t("merge: ne modifie pas l'objet local", LOCAL.msci === 146.73);
var m2 = A.Auto_merge(LOCAL, { msci: "pas un nombre" });
t("merge: type incompatible ignoré", m2.msci === 146.73);
var m3 = A.Auto_merge(LOCAL, { bceDir: "" });
t("merge: chaîne vide ignorée", m3.bceDir === "hausse");
var m4 = A.Auto_merge(LOCAL, { btcHigh52: 95000 });
t("merge: champ local null peut recevoir un nombre", m4.btcHigh52 === 95000);

// ---------- Auto_shouldGecko ----------
var H = 3600 * 1000;
t("shouldGecko: jamais interrogé → true", A.Auto_shouldGecko(Date.now(), null) === true);
t("shouldGecko: 23 h écoulées → true", A.Auto_shouldGecko(Date.now(), Date.now() - 23 * H) === true);
t("shouldGecko: 2 h écoulées → false", A.Auto_shouldGecko(Date.now(), Date.now() - 2 * H) === false);
t("shouldGecko: valeur NaN → true (défaut sûr)", A.Auto_shouldGecko(Date.now(), NaN) === true);
t("shouldGecko: seuil = 22 h", A.AUTO_GEOCO_MIN_MS === 22 * H);

// ---------- Auto_applyGecko ----------
var G = { cur: 3800.5, high: 4592, low: 3387 };
var C = { cur: 76000, high: 95000 };
var g1 = A.Auto_applyGecko(LOCAL, G, C);
t("applyGecko: or appliqué", g1.orEUR === 3800.5 && g1.orHigh52 === 4592 && g1.orLow52 === 3387);
t("applyGecko: btc appliqué", g1.btcEUR === 76000 && g1.btcHigh52 === 95000);
var g2 = A.Auto_applyGecko(LOCAL, G, null);
t("applyGecko: or seul → btc intact", g2.orEUR === 3800.5 && g2.btcEUR === LOCAL.btcEUR);
var g3 = A.Auto_applyGecko(LOCAL, null, C);
t("applyGecko: btc seul → or intact", g3.btcEUR === 76000 && g3.orEUR === LOCAL.orEUR);
t("applyGecko: ni or ni btc → null", A.Auto_applyGecko(LOCAL, null, null) === null);
t("applyGecko: data null → null", A.Auto_applyGecko(null, G, C) === null);
t("applyGecko: ne modifie pas l'objet local", LOCAL.orEUR === 3705.85);

// ---------- Pipeline complet (simulation d'une semaine) ----------
var pipeline = A.Auto_merge(LOCAL, OK_REMOTE.data);
pipeline.dateData = OK_REMOTE.dateData; // comme le fait auto.js
var pipeline2 = A.Auto_applyGecko(pipeline, G, C);
t("pipeline: maj hebdo puis direct → données cohérentes",
  pipeline2.msci === 150.2 && pipeline2.dateData === "2026-10-24" &&
  pipeline2.orEUR === 3800.5 && pipeline2.reserve === 500 && pipeline2.paliersDone.p5 === true);
var skip = !A.Auto_isNewerDate("2026-10-17", "2026-10-17");
t("pipeline: data.json même date que local → pas d'écrasement", skip === true);

// ---------- data.json livré ----------
var ROOT = path.join(__dirname, "..");
var raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
t("data.json: structure valide pour auto.js", A.Auto_validRemote(raw) === raw);
t("data.json: dateData au format ISO", /^\d{4}-\d{2}-\d{2}$/.test(raw.dateData));
t("data.json: msci numérique", typeof raw.data.msci === "number" && isFinite(raw.data.msci));
t("data.json: bceDir parmi les 3 valeurs autorisées", ["hausse", "stable", "baisse"].indexOf(raw.data.bceDir) >= 0);
t("data.json: ni reserve ni paliersDone (jamais poussés)", !("reserve" in raw.data) && !("paliersDone" in raw.data));
t("data.json: sources présentes", Array.isArray(raw.sources) && raw.sources.length >= 5);
// fusion réelle avec les valeurs par défaut du jour : ne doit rien casser
var mergedDefaults = A.Auto_merge({ msci: 146.73, bceDir: "hausse", btcHigh52: null, orEUR: 3705.85 }, raw.data);
t("data.json: fusion sur données par défaut OK", mergedDefaults.msci === raw.data.msci && mergedDefaults.bceDir === raw.data.bceDir);

// ---------- index.html & sw.js livrés ----------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
t("index.html: script auto.js référencé", html.indexOf('<script src="auto.js"></script>') !== -1);
t("index.html: badge v3", html.indexOf("<b>v3</b>") !== -1);
t("index.html: aucun ancien badge v2/v1", html.indexOf("<b>v2</b>") === -1 && html.indexOf("<b>v1</b>") === -1);
t("index.html: badge « Maj auto hebdo »", html.indexOf("Maj auto hebdo") !== -1);
t("index.html: aucune trace d'ancien badge v1", html.indexOf("<b>v1</b>") === -1);
t("index.html: vehicles.js référencé avant le script inline",
  html.indexOf('<script src="vehicles.js"></script>') !== -1 &&
  html.indexOf('<script src="vehicles.js"></script>') < html.indexOf("/* ===LOGIC_START=== */"));
t("index.html: rendu des instruments (VEHICULES[a.id])", html.indexOf("VEHICULES[a.id]") !== -1);
t("index.html: note « Instruments exemples » dans les sources", html.indexOf("Instruments exemples") !== -1);
t("index.html: encodage propre (pas de mojibake Ã)", html.indexOf("Ã") === -1);
t("index.html: l'ancien texte du pied de page remplacé", html.indexOf("Les autres données se vérifient sur les sites ci-dessus") === -1);
var sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
t("sw.js: cache v3", sw.indexOf('CACHE = "radar-v3"') !== -1);
t("sw.js: ancien cache v2 absent", sw.indexOf("radar-v2") === -1);
t("sw.js: vehicles.js dans le shell", sw.indexOf('"./vehicles.js"') !== -1);
t("sw.js: data.json en réseau d'abord", sw.indexOf('data.json') !== -1 && sw.indexOf('url.pathname.indexOf("data.json")') !== -1);
t("sw.js: auto.js dans le shell", sw.indexOf('"./auto.js"') !== -1);
t("sw.js: ancien cache v1 absent", sw.indexOf("radar-v1") === -1);
// auto.js : le câblage ne tourne pas sous Node (guard module.exports)
t("auto.js: pas d'exception à l'import Node", true);

// ---------- vehicles.js (v3 : instruments exemples) ----------
var V = require(path.join(ROOT, "vehicles.js"));
var VKEYS = ["actions", "obligations", "or", "monetaire", "immo", "crypto"];
t("vehicles.js: exactement 6 clés = ids d'actifs", Object.keys(V).length === 6 && VKEYS.every(function (k) { return k in V; }));
t("vehicles.js: nom/frais/enceinte non vides pour les 6", VKEYS.every(function (k) { return typeof V[k].nom === "string" && V[k].nom && typeof V[k].frais === "string" && V[k].frais && typeof V[k].enceinte === "string" && V[k].enceinte; }));
t("vehicles.js: note non vide pour les 6", VKEYS.every(function (k) { return typeof V[k].note === "string" && V[k].note.length > 10; }));
t("vehicles.js: ISIN valide ou vide", VKEYS.every(function (k) { return !V[k].isin || /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(V[k].isin); }));
t("vehicles.js: enceinte parmi PEA/CTO/CTO / AV", VKEYS.every(function (k) { return ["PEA", "CTO", "CTO / AV"].indexOf(V[k].enceinte) >= 0; }));
t("vehicles.js: actions éligibles PEA (DCAM)", V.actions.enceinte === "PEA" && V.actions.isin === "FR001400U5Q4");
t("vehicles.js: monétaire éligible PEA (OVNI)", V.monetaire.enceinte === "PEA" && V.monetaire.isin === "LU3215541056");
t("vehicles.js: obligataire IEGA", V.obligations.isin === "IE00B4WXJJ64");

// ---------- Bilan ----------
var fail = results.filter(function (r) { return !r.ok; });
results.forEach(function (r) { console.log((r.ok ? "✅" : "❌") + " " + r.name); });
console.log("\n" + (results.length - fail.length) + "/" + results.length + " tests OK");
if (fail.length) { console.log("ÉCHECS :"); fail.forEach(function (r) { console.log("  ❌ " + r.name); }); process.exit(1); }
