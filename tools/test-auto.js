/* Harnais de tests — Radar Conjoncture v4 (modules auto.js & vehicles.js, fichiers livrés,
   pipeline quotidien/épisode/référence, validateurs et workflows).
   Exécution : node tools/test-auto.js  →  0 échec obligatoire avant publication. */
"use strict";
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

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

// ---------- Auto_merge (hebdo) ----------
var LOCAL = {
  dateData: "2026-10-17", msci: 146.81, msciHigh52: 149.81, msciHigh52Date: "", bceDir: "hausse",
  orEUR: 3729.84, btcHigh52: null, reserve: 500, paliersDone: { p5: true, p10: false, p15: false, p20: false }
};
var m1 = A.Auto_merge(LOCAL, { msci: 150.2, bceDir: "baisse", inconnu: 42, orEUR: null, reserve: 9999, paliersDone: { p20: true }, dateData: "2026-11-01" });
t("merge: champ numérique appliqué", m1.msci === 150.2);
t("merge: champ texte (sel) appliqué", m1.bceDir === "baisse");
t("merge: champ inconnu ignoré", !("inconnu" in m1));
t("merge: valeur null ignorée (orEUR conservé)", m1.orEUR === 3729.84);
t("merge: reserve jamais écrasé", m1.reserve === 500);
t("merge: paliersDone jamais écrasé", m1.paliersDone.p10 === false && m1.paliersDone.p20 === false);
t("merge: dateData jamais écrasée", m1.dateData === "2026-10-17");
t("merge: ne modifie pas l'objet local", LOCAL.msci === 146.81);
var m2 = A.Auto_merge(LOCAL, { msci: "pas un nombre" });
t("merge: type incompatible ignoré", m2.msci === 146.81);
var m3 = A.Auto_merge(LOCAL, { bceDir: "" });
t("merge: chaîne vide ignorée", m3.bceDir === "hausse");
var m4 = A.Auto_merge(LOCAL, { btcHigh52: 95000 });
t("merge: champ local null peut recevoir un nombre", m4.btcHigh52 === 95000);
var m4b = A.Auto_merge(LOCAL, { msciHigh52Date: "2026-08-12" });
t("merge: date du sommet 52 sem. (string) appliquée", m4b.msciHigh52Date === "2026-08-12");

// ---------- Auto_overlayDaily (v4 : relevé quotidien) ----------
t("dailyFields: liste exacte autorisée", JSON.stringify(A.AUTO_DAILY_FIELDS) === JSON.stringify(["msci", "vix", "vix5", "bund10", "oat10"]));
t("dailyMaxDrift: 15 %", A.AUTO_DAILY_MAX_DRIFT === 0.15);
var DAILY_OK = { msci: 147.3, vix: 20.5, vix5: 17.1, bund10: 3.45, oat10: 4.8 };
var od1 = A.Auto_overlayDaily(LOCAL, DAILY_OK);
t("overlayDaily: champs du jour appliqués", od1 && od1.msci === 147.3 && od1.vix === 20.5 && od1.vix5 === 17.1);
t("overlayDaily: ne touche ni reserve ni paliersDone ni référence 52 sem.",
  od1.reserve === 500 && od1.paliersDone.p5 === true && od1.msciHigh52 === 149.81 && od1.msciHigh52Date === "");
t("overlayDaily: ne modifie pas l'objet local", LOCAL.msci === 146.81);
var od2 = A.Auto_overlayDaily(LOCAL, { msci: 180, vix: 21 }); // +22 % vs local → aberrant
t("overlayDaily: cours aberrant (> 15 %) écarté", od2.msci === 146.81 && od2.vix === 21);
t("overlayDaily: champ non autorisé ignoré → rien d'appliqué", A.Auto_overlayDaily(LOCAL, { cape: 20 }) === null);
var od3 = A.Auto_overlayDaily(LOCAL, { cape: 20 });
t("overlayDaily: cape (hors liste) jamais appliquée", od3 === null || od3.cape === undefined || od3.cape === LOCAL.cape);
t("overlayDaily: vix5 accepté même si absent localement (null)",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix5 = null; var r = A.Auto_overlayDaily(l, { vix5: 16.8 }); return r !== null && r.vix5 === 16.8; })());
t("overlayDaily: rien de valable → null", A.Auto_overlayDaily(LOCAL, {}) === null);
t("overlayDaily: entrée null → null", A.Auto_overlayDaily(LOCAL, null) === null && A.Auto_overlayDaily(null, DAILY_OK) === null);

// ---------- Auto_episodeUpdate (v4 : nouvel épisode) ----------
t("episodeMaxJump: 10 %", A.AUTO_EPISODE_MAX_JUMP === 0.10);
var WITH_DONE = JSON.parse(JSON.stringify(LOCAL));
WITH_DONE.msci = 150.5; // clôture au-dessus du sommet 52 sem. (149,81 $) → nouveau plus haut
WITH_DONE.paliersDone = { p5: true, p10: true, p15: false, p20: false };
var ep1 = A.Auto_episodeUpdate(WITH_DONE, "2026-10-24");
t("épisode: nouveau plus haut → référence montée au cours",
  ep1 && ep1.data.msciHigh52 === 150.5);
t("épisode: date du sommet consignée", ep1 && ep1.data.msciHigh52Date === "2026-10-24");
t("épisode: paliers réinitialisés", ep1 && ep1.data.paliersDone.p5 === false && ep1.data.paliersDone.p10 === false);
t("épisode: bilan de l'épisode clos (2 déployés)", ep1 && ep1.episode.deployed === 2 && ep1.episode.oldHigh52 === 149.81 && ep1.episode.newHigh52 === 150.5 && ep1.episode.date === "2026-10-24");
var HIGHER = JSON.parse(JSON.stringify(WITH_DONE)); HIGHER.msci = 152.0;
var ep2 = A.Auto_episodeUpdate(HIGHER, "2026-10-24");
t("épisode: cours sous le sommet → aucun épisode (null)", A.Auto_episodeUpdate(LOCAL, "2026-10-24") === null);
t("épisode: saut aberrant (> 10 % au-dessus) ignoré",
  (function () { var h = JSON.parse(JSON.stringify(LOCAL)); h.msci = 165; return A.Auto_episodeUpdate(h, "2026-10-24") === null; })());
t("épisode: date mal formée → null", A.Auto_episodeUpdate(HIGHER, "24/10/2026") === null);
t("épisode: données manquantes → null", A.Auto_episodeUpdate({ msci: 150 }, "2026-10-24") === null);
t("épisode: ne modifie pas l'objet local", WITH_DONE.msci === 150.5 && WITH_DONE.paliersDone.p5 === true && WITH_DONE.msciHigh52 === 149.81);
t("épisode: égalité stricte (cours = sommet) → pas d'épisode",
  (function () { var h = JSON.parse(JSON.stringify(LOCAL)); h.msci = 149.81; return A.Auto_episodeUpdate(h, "2026-10-24") === null; })());

// ---------- Auto_refUnstable (v4 : référence instable) ----------
t("refUnstable: écart de 7 % → true", A.Auto_refUnstable(161.35, 149.81) === true);
t("refUnstable: écart de 1 % → false", A.Auto_refUnstable(149.81, 151.3) === false);
t("refUnstable: écart exactement 2 % → false", A.Auto_refUnstable(100, 102) === false);
t("refUnstable: valeur locale manquante → false", A.Auto_refUnstable(null, 149.81) === false);
t("refUnstable: valeur distante manquante → false", A.Auto_refUnstable(149.81, null) === false);
t("refUnstable: référence plus haute (nouveau sommet +8 %) → true",
  A.Auto_refUnstable(149.81, 161.35) === true);

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
t("applyGecko: ne modifie pas l'objet local", LOCAL.orEUR === 3729.84);

// ---------- Pipeline complet hebdo + quotidien + épisode ----------
var p0 = JSON.parse(JSON.stringify(LOCAL)); p0.dateData = "2026-10-17"; p0.vix5 = 14.5; p0.vix = 16.46;
var weeklyNew = { msci: 151.0, vix: 18.0, vix5: 15.8, note: "test" };
var p1 = A.Auto_merge(p0, weeklyNew); p1.dateData = "2026-10-20";
var p2 = A.Auto_overlayDaily(p1, { msci: 152.0, vix: 19.5, vix5: 16.2 }); p2.dateData = "2026-10-21";
t("pipeline: hebdo puis quotidien → valeurs du jour",
  p2.msci === 152.0 && p2.vix5 === 16.2 && p2.dateData === "2026-10-21");
var epP = A.Auto_episodeUpdate(p2, p2.dateData);
t("pipeline: cours 152 > sommet 149,81 → nouvel épisode déclenché",
  !!epP && epP.data.msciHigh52 === 152 && epP.data.paliersDone.p5 === false && epP.episode.oldHigh52 === 149.81);
t("pipeline: référence instable détectée (ancien 161,35 → relevé 149,81)",
  A.Auto_refUnstable(161.35, 149.81) === true);
t("pipeline: référence quasi identique (−1,9 %) → pas d'alerte",
  A.Auto_refUnstable(149.81, 147.0) === false);
t("pipeline: data.json même date que local → pas d'écrasement",
  !A.Auto_isNewerDate("2026-10-17", "2026-10-17") === true);

// ---------- data.json livré ----------
var ROOT = path.join(__dirname, "..");
var raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
t("data.json: structure valide pour auto.js", A.Auto_validRemote(raw) === raw);
t("data.json: dateData au format ISO", /^\d{4}-\d{2}-\d{2}$/.test(raw.dateData));
t("data.json: msci numérique", typeof raw.data.msci === "number" && isFinite(raw.data.msci));
t("data.json: bceDir parmi les 3 valeurs autorisées", ["hausse", "stable", "baisse"].indexOf(raw.data.bceDir) >= 0);
t("data.json: ni reserve ni paliersDone (jamais poussés)", !("reserve" in raw.data) && !("paliersDone" in raw.data));
t("data.json: sources présentes", Array.isArray(raw.sources) && raw.sources.length >= 5);
t("data.json: sommet 52 sem. ≥ cours", raw.data.msciHigh52 >= raw.data.msci);
t("data.json: vix5 présent et numérique", typeof raw.data.vix5 === "number" && isFinite(raw.data.vix5));
t("data.json: date du sommet absente ou chaîne", raw.data.msciHigh52Date === undefined || typeof raw.data.msciHigh52Date === "string");
var mergedDefaults = A.Auto_merge({ msci: 146.81, msciHigh52Date: "", bceDir: "hausse", btcHigh52: null, orEUR: 3729.84, vix5: null }, raw.data);
t("data.json: fusion sur données par défaut OK", mergedDefaults.msci === raw.data.msci && mergedDefaults.bceDir === raw.data.bceDir && mergedDefaults.vix5 === raw.data.vix5);

// ---------- data-daily.json livré ----------
var daily = JSON.parse(fs.readFileSync(path.join(ROOT, "data-daily.json"), "utf8"));
t("data-daily.json: structure valide pour auto.js", A.Auto_validRemote(daily) === daily);
t("data-daily.json: au moins un champ de marché", ["msci", "vix", "vix5", "bund10", "oat10"].some(function (k) { return typeof daily.data[k] === "number"; }));
t("data-daily.json: ni reserve ni paliersDone", !("reserve" in daily.data) && !("paliersDone" in daily.data));
t("data-daily.json: aucun champ hors liste autorisée", Object.keys(daily.data).every(function (k) { return A.AUTO_DAILY_FIELDS.indexOf(k) !== -1; }));
t("data-daily.json: sources présentes", Array.isArray(daily.sources) && daily.sources.length >= 2);
t("data-daily.json: overlay applicable sur le data.json du jour",
  A.Auto_overlayDaily(JSON.parse(JSON.stringify(raw.data)), daily.data) !== null);

// ---------- validate-data.js (fonctionnel sur les fichiers livrés) ----------
try {
  child_process.execSync("node " + JSON.stringify(path.join(ROOT, "tools", "validate-data.js")), { cwd: ROOT, stdio: "pipe" });
  t("validate-data: passe sur les fichiers livrés", true);
} catch (e) { t("validate-data: passe sur les fichiers livrés", false); }
try {
  child_process.execSync("node " + JSON.stringify(path.join(ROOT, "tools", "validate-data.js")) + " " + JSON.stringify("inexistant.json"), { cwd: ROOT, stdio: "pipe" });
  t("validate-data: échoue sur fichier introuvable", false);
} catch (e) { t("validate-data: échoue sur fichier introuvable", true); }
try {
  fs.writeFileSync(path.join(ROOT, "tmp-bad.json"), JSON.stringify({ dateData: "2026-10-17", data: { msci: 999999, reserve: 100, vix: 5 } }));
  child_process.execSync("node " + JSON.stringify(path.join(ROOT, "tools", "validate-data.js")) + " " + JSON.stringify("tmp-bad.json"), { cwd: ROOT, stdio: "pipe" });
  t("validate-data: rejette msci aberrant + reserve poussé", false);
} catch (e) { t("validate-data: rejette msci aberrant + reserve poussé", true); }
fs.unlinkSync(path.join(ROOT, "tmp-bad.json"));

// ---------- fetch-daily.js (livré, hors réseau ici) ----------
var fd = fs.readFileSync(path.join(ROOT, "tools", "fetch-daily.js"), "utf8");
t("fetch-daily: fichier présent", fd.length > 1000);
t("fetch-daily: garde-fous de plage et de dérive présents", fd.indexOf("0.12") !== -1 && fd.indexOf("0.60") !== -1);
t("fetch-daily: sources IWDA.L (USD) et ^VIX", fd.indexOf("IWDA.L") !== -1 && fd.indexOf("^VIX") !== -1);
t("fetch-daily: ne touche ni reserve ni paliersDone", fd.indexOf("reserve") === -1 && fd.indexOf("paliersDone") === -1);

// ---------- index.html & sw.js livrés ----------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
t("index.html: script auto.js référencé", html.indexOf('<script src="auto.js"></script>') !== -1);
t("index.html: badge v4", html.indexOf("<b>v4</b>") !== -1);
t("index.html: aucun ancien badge v3/v2/v1", html.indexOf("<b>v3</b>") === -1 && html.indexOf("<b>v2</b>") === -1 && html.indexOf("<b>v1</b>") === -1);
t("index.html: badge « Maj auto quotidienne »", html.indexOf("Maj auto quotidienne") !== -1);
t("index.html: badge « Maj auto hebdo » absent", html.indexOf("Maj auto hebdo") === -1);
t("index.html: vehicles.js référencé avant le script inline",
  html.indexOf('<script src="vehicles.js"></script>') !== -1 &&
  html.indexOf('<script src="vehicles.js"></script>') < html.indexOf("/* ===LOGIC_START=== */"));
t("index.html: rendu des instruments (VEHICULES[a.id])", html.indexOf("VEHICULES[a.id]") !== -1);
t("index.html: note « Instruments exemples » dans les sources", html.indexOf("Instruments exemples") !== -1);
t("index.html: encodage propre (pas de mojibake Ã)", html.indexOf("Ã") === -1);
t("index.html: champ msciHigh52Date dans le formulaire", html.indexOf('"msciHigh52Date"') !== -1);
t("index.html: champ vix5 dans le formulaire", html.indexOf('"vix5"') !== -1);
t("index.html: VIX lissé utilisé dans le scoring (vixEff)", html.indexOf("vixEff") !== -1 && html.indexOf("der.vixEff") !== -1);
t("index.html: alerte référence 52 sem. (id refAlert)", html.indexOf('id="refAlert"') !== -1 && html.indexOf("btnRefOk") !== -1);
t("index.html: carte Évolution des scores par actif", html.indexOf("Évolution des scores par actif") !== -1 && html.indexOf('id="scoresWrap"') !== -1);
t("index.html: carte Épisodes de paliers", html.indexOf("Épisodes de paliers") !== -1 && html.indexOf('id="episodesTable"') !== -1);
t("index.html: épisodes persistés (state.episodes)", html.indexOf("state.episodes") !== -1);
t("index.html: alerte référence persistée (state.refAlert)", html.indexOf("state.refAlert") !== -1);
t("index.html: légende des 6 actifs du graphique (SCORE_META)", html.indexOf("SCORE_META") !== -1);
var sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
t("sw.js: cache v4", sw.indexOf('CACHE = "radar-v4"') !== -1);
t("sw.js: ancien cache v3 absent", sw.indexOf("radar-v3") === -1);
t("sw.js: vehicles.js dans le shell", sw.indexOf('"./vehicles.js"') !== -1);
t("sw.js: data.json ET data-daily.json en réseau d'abord",
  sw.indexOf('url.pathname.indexOf("data.json")') !== -1 && sw.indexOf('url.pathname.indexOf("data-daily.json")') !== -1);
t("sw.js: auto.js dans le shell", sw.indexOf('"./auto.js"') !== -1);
// auto.js : le câblage ne tourne pas sous Node (guard module.exports)
t("auto.js: pas d'exception à l'import Node", true);
var autosrc = fs.readFileSync(path.join(ROOT, "auto.js"), "utf8");
t("auto.js: récupère data-daily.json à l'ouverture", autosrc.indexOf('"data-daily.json"') !== -1);
t("auto.js: câble l'épisode et l'alerte référence", autosrc.indexOf("Auto_episodeUpdate(") !== -1 && autosrc.indexOf("Auto_refUnstable(") !== -1);
t("auto.js: en-tête v3", autosrc.indexOf("module de mise à jour automatique (v3)") !== -1);

// ---------- workflows GitHub livrés ----------
var pages = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
t("pages.yml: validation data avant déploiement", pages.indexOf("validate-data.js") !== -1);
t("pages.yml: validation AVANT upload-pages-artifact",
  pages.indexOf("validate-data.js") !== -1 && pages.indexOf("validate-data.js") < pages.indexOf("upload-pages-artifact"));
var dailyWf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "daily-data.yml"), "utf8");
t("daily-data.yml: cron jours ouvrés (1-5)", dailyWf.indexOf('"45 21 * * 1-5"') !== -1);
t("daily-data.yml: lance tools/fetch-daily.js", dailyWf.indexOf("tools/fetch-daily.js") !== -1);
t("daily-data.yml: permission contents write", dailyWf.indexOf("contents: write") !== -1);
t("daily-data.yml: commit seulement si changé", dailyWf.indexOf("--cached --quiet") !== -1);

// ---------- vehicles.js (inchangé) ----------
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
