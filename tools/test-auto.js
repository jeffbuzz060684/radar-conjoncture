/* Harnais de tests — Radar Conjoncture v5 (modules auto.js, logic.js & vehicles.js, fichiers
   livrés, pipeline quotidien/épisode/référence, scoring, validateurs, workflows et régressions).
   Exécution : node tools/test-auto.js  →  0 échec obligatoire avant publication. */
"use strict";
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var A = require(path.join(__dirname, "..", "auto.js"));
var L = require(path.join(__dirname, "..", "logic.js"));
var results = [];
function t(name, cond) { results.push({ name: name, ok: !!cond }); }

// ---------- Auto_isNewerDate / Auto_isSameOrNewerDate / Auto_isValidDate ----------
t("isNewerDate: date plus récente → true", A.Auto_isNewerDate("2026-10-24", "2026-10-17") === true);
t("isNewerDate: même date → false", A.Auto_isNewerDate("2026-10-17", "2026-10-17") === false);
t("isNewerDate: date plus ancienne → false", A.Auto_isNewerDate("2026-10-10", "2026-10-17") === false);
t("isNewerDate: année à 4 chiffres seule → true", A.Auto_isNewerDate("2027-01-05", "2026-12-31") === true);
t("isNewerDate: entrée non chaîne → false", A.Auto_isNewerDate(null, "2026-10-17") === false && A.Auto_isNewerDate("2026-10-17", undefined) === false);
t("isSameOrNewerDate: même date → true (révision du quotidien, même clôture)", A.Auto_isSameOrNewerDate("2026-10-16", "2026-10-16") === true);
t("isSameOrNewerDate: plus récent → true", A.Auto_isSameOrNewerDate("2026-10-17", "2026-10-16") === true);
t("isSameOrNewerDate: plus ancien → false", A.Auto_isSameOrNewerDate("2026-10-15", "2026-10-16") === false);
t("isValidDate: date réelle → true", A.Auto_isValidDate("2026-10-17") === true);
t("isValidDate: 29 février bissextile → true", A.Auto_isValidDate("2028-02-29") === true);
t("isValidDate: 31 février → false", A.Auto_isValidDate("2026-02-31") === false);
t("isValidDate: 29 février non bissextile → false", A.Auto_isValidDate("2026-02-29") === false);
t("isValidDate: 13e mois → false", A.Auto_isValidDate("2026-13-01") === false);

// ---------- Auto_validRemote ----------
var OK_REMOTE = { dateData: "2026-10-24", data: { msci: 150.2 }, note: "test" };
t("validRemote: payload valide → accepté", A.Auto_validRemote(OK_REMOTE) === OK_REMOTE);
t("validRemote: null → null", A.Auto_validRemote(null) === null);
t("validRemote: sans data → null", A.Auto_validRemote({ dateData: "2026-10-24" }) === null);
t("validRemote: data non objet → null", A.Auto_validRemote({ dateData: "2026-10-24", data: "x" }) === null);
t("validRemote: dateData manquant → null", A.Auto_validRemote({ data: {} }) === null);
t("validRemote: dateData mal formé → null", A.Auto_validRemote({ dateData: "24/10/2026", data: {} }) === null);
t("validRemote: dateData partielle → null", A.Auto_validRemote({ dateData: "2026-10", data: {} }) === null);
t("validRemote: dateData inexistant au calendrier (31/02) → null", A.Auto_validRemote({ dateData: "2026-02-31", data: {} }) === null);
t("validRemote: dateData mois 13 → null", A.Auto_validRemote({ dateData: "2026-13-01", data: {} }) === null);

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
t("dailyRanges: plages plausibles par champ", A.AUTO_DAILY_RANGES.msci[0] === 20 && A.AUTO_DAILY_RANGES.msci[1] === 1000 &&
  A.AUTO_DAILY_RANGES.vix[0] === 3 && A.AUTO_DAILY_RANGES.vix[1] === 100 && A.AUTO_DAILY_RANGES.bund10[1] === 20 && A.AUTO_DAILY_RANGES.oat10[1] === 20);
t("dailyMaxJump: 50 % (garde anti-corruption msci uniquement)", A.AUTO_DAILY_MAX_JUMP === 0.50);
var DAILY_OK = { msci: 147.3, vix: 20.5, vix5: 17.1, bund10: 3.45, oat10: 4.8 };
var od1 = A.Auto_overlayDaily(LOCAL, DAILY_OK);
t("overlayDaily: champs du jour appliqués", od1 && od1.msci === 147.3 && od1.vix === 20.5 && od1.vix5 === 17.1);
t("overlayDaily: ne touche ni reserve ni paliersDone ni référence 52 sem.",
  od1.reserve === 500 && od1.paliersDone.p5 === true && od1.msciHigh52 === 149.81 && od1.msciHigh52Date === "");
t("overlayDaily: ne modifie pas l'objet local", LOCAL.msci === 146.81);
var od2 = A.Auto_overlayDaily(LOCAL, { msci: 180, vix: 21 }); // +22 % vs local : krach/haussé légitime → accepté
t("overlayDaily: mouvement > 15 % (±22 %) accepté — un krach cumulé ne doit pas être bloqué", od2.msci === 180 && od2.vix === 21);
var od2b = A.Auto_overlayDaily(LOCAL, { msci: 250 }); // +70 % vs local : impossible en une séance → corruption
t("overlayDaily: saut > 50 % (msci) écarté (anti-corruption)", od2b === null);
var od2c = A.Auto_overlayDaily(LOCAL, { msci: 5000 }); // hors plage plausible
t("overlayDaily: valeur hors plage plausible écartée", od2c === null);
t("overlayDaily: spike VIX légitime (+100 %) accepté (plage seule, pas de dérive)",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix = 20; var r = A.Auto_overlayDaily(l, { vix: 40 }); return r !== null && r.vix === 40; })());
t("overlayDaily: VIX hors plage (vix 3) écarté",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix = 20; var r = A.Auto_overlayDaily(l, { vix: 2 }); return r === null; })());
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

// ---------- Auto_refUpdate (v5 : référence 52 sem. recalée sur la fenêtre 1 an) ----------
var RLOCAL = { dateData: "2026-10-16", msci: 130.55, msciHigh52: 131, msciHigh52Date: "", msciLow52: 110, paliersDone: { p5: true, p10: false, p15: false, p20: false } };
var ru1 = A.Auto_refUpdate(RLOCAL, { msciHigh52: 132.26, msciLow52: 107.51, msciHigh52Date: "2026-10-12" }, "2026-10-16");
t("refUpdate: sommet 1 an plus haut → référence recalée à la hausse (132,26 €, datée)",
  !!ru1 && ru1.data.msciHigh52 === 132.26 && ru1.data.msciHigh52Date === "2026-10-12");
t("refUpdate: bas 52 sem. mis à jour (107,51 €)", ru1.data.msciLow52 === 107.51);
t("refUpdate: nouvel épisode + paliers réinitialisés",
  ru1.episode.oldHigh52 === 131 && ru1.episode.newHigh52 === 132.26 && ru1.episode.deployed === 1 && ru1.data.paliersDone.p5 === false);
t("refUpdate: mouvement < 2 % → pas d'alerte instable", ru1.unstable === false);
t("refUpdate: référence jamais abaissée → null", A.Auto_refUpdate(RLOCAL, { msciHigh52: 130 }, "2026-10-16") === null);
var RLOCAL2 = JSON.parse(JSON.stringify(RLOCAL)); RLOCAL2.msciHigh52 = 122;
var ru3 = A.Auto_refUpdate(RLOCAL2, { msciHigh52: 132.26 }, "2026-10-16");
t("refUpdate: saut > 2 % → alerte instable signalée", !!ru3 && ru3.unstable === true);
t("refUpdate: saut > 10 % → aberrant → null", A.Auto_refUpdate(RLOCAL, { msciHigh52: 150 }, "2026-10-16") === null);
t("refUpdate: refs invalides → null",
  A.Auto_refUpdate(RLOCAL, { msciHigh52: "132" }, "2026-10-16") === null && A.Auto_refUpdate(RLOCAL, null, "2026-10-16") === null);
t("refUpdate: date invalide → null", A.Auto_refUpdate(RLOCAL, { msciHigh52: 132.26 }, "2026-02-31") === null);

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
t("data.json: dateMacro du dernier point macro (ISO valide)", typeof raw.data.dateMacro === "string" && A.Auto_isValidDate(raw.data.dateMacro));
var mergedDefaults = A.Auto_merge({ msci: 146.81, msciHigh52Date: "", bceDir: "hausse", btcHigh52: null, orEUR: 3729.84, vix5: null }, raw.data);
t("data.json: fusion sur données par défaut OK", mergedDefaults.msci === raw.data.msci && mergedDefaults.bceDir === raw.data.bceDir && mergedDefaults.vix5 === raw.data.vix5);

// ---------- data-daily.json livré ----------
var daily = JSON.parse(fs.readFileSync(path.join(ROOT, "data-daily.json"), "utf8"));
t("data-daily.json: structure valide pour auto.js", A.Auto_validRemote(daily) === daily);
t("data-daily.json: au moins un champ de marché", ["msci", "vix", "vix5", "bund10", "oat10"].some(function (k) { return typeof daily.data[k] === "number"; }));
t("data-daily.json: ni reserve ni paliersDone", !("reserve" in daily.data) && !("paliersDone" in daily.data));
t("data-daily.json: aucun champ hors liste autorisée", Object.keys(daily.data).every(function (k) { return A.AUTO_DAILY_FIELDS.indexOf(k) !== -1; }));
t("data-daily.json: sources présentes", Array.isArray(daily.sources) && daily.sources.length >= 2);
t("data-daily.json: refs 52 sem. présentes et plausibles (même source que le cours)",
  !!daily.refs && typeof daily.refs.msciHigh52 === "number" && daily.refs.msciHigh52 >= daily.data.msci &&
  typeof daily.refs.msciLow52 === "number" && daily.refs.msciLow52 < daily.refs.msciHigh52 &&
  A.Auto_isValidDate(daily.refs.msciHigh52Date));
t("data-daily.json: aucune donnée perso dans refs", !("reserve" in daily.refs) && !("paliersDone" in daily.refs));
t("data-daily.json: même devise que le relevé hebdo (EUR)", daily.data.msci === raw.data.msci);
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
t("fetch-daily: garde-fous une séance (10 % msci / 60 % VIX) présents", fd.indexOf("0.10") !== -1 && fd.indexOf("0.60") !== -1);
t("fetch-daily: référence de dérive = dernier relevé quotidien accepté", fd.indexOf("refDaily") !== -1 && fd.indexOf("previous.data") !== -1);
t("fetch-daily: dateData = date de clôture (last.date), pas la date d'exécution", fd.indexOf("dateData = last.date") !== -1 && fd.indexOf("dateData = today") === -1);
t("fetch-daily: no-op si relevé existant ≥ clôture (jamais d'écrasement par une date plus ancienne)", fd.indexOf("previous.dateData >= dateData") !== -1);
t("fetch-daily: source IWDA.AS (Euronext Amsterdam, EUR) et ^VIX", fd.indexOf("IWDA.AS") !== -1 && fd.indexOf("IWDA.L") === -1 && fd.indexOf("^VIX") !== -1);
t("fetch-daily: références 52 sem. via range=1y (même source que le cours)", fd.indexOf('\"1y\"') !== -1 && fd.indexOf("out.refs") !== -1);
t("fetch-daily: --force pour régénérer après changement de source", fd.indexOf("--force") !== -1);
t("fetch-daily: ne touche ni reserve ni paliersDone", fd.indexOf("reserve") === -1 && fd.indexOf("paliersDone") === -1);

// ---------- index.html & sw.js & logic.js livrés ----------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
t("index.html: script auto.js référencé", html.indexOf('<script src="auto.js"></script>') !== -1);
t("index.html: badge v5", html.indexOf("<b>v5</b>") !== -1);
t("index.html: aucun ancien badge v4.1/v4/v3/v2/v1",
  ["<b>v4.1</b>", "<b>v4</b>", "<b>v3</b>", "<b>v2</b>", "<b>v1</b>"].every(function (b) { return html.indexOf(b) === -1; }));
t("index.html: badge « Maj auto quotidienne »", html.indexOf("Maj auto quotidienne") !== -1);
t("index.html: badge « Maj auto hebdo » absent", html.indexOf("Maj auto hebdo") === -1);
t("index.html: vehicles.js puis logic.js chargés dans cet ordre",
  html.indexOf('<script src="vehicles.js"></script>') !== -1 &&
  html.indexOf('<script src="vehicles.js"></script>') < html.indexOf('<script src="logic.js"></script>'));
t("index.html: plus aucun montant en dollars (paliers 100 % euros)", !/ \$[^(]/.test(html));
t("index.html: chip fraîcheur macro séparée (macroChip)", html.indexOf('id="macroChip"') !== -1);
t("index.html: échappement HTML des valeurs issues d'un import JSON",
  html.indexOf("esc(String(h.topScore))") !== -1 && html.indexOf("esc(String(h.scores.actions))") !== -1 &&
  html.indexOf("esc(String(e.oldHigh52))") !== -1 && html.indexOf("esc(String(state.refAlert.from))") !== -1);
t("index.html: rendu des instruments (VEHICULES[a.id])", html.indexOf("VEHICULES[a.id]") !== -1);
t("index.html: note « Instruments exemples » dans les sources", html.indexOf("Instruments exemples") !== -1);
t("index.html: encodage propre (pas de mojibake Ã)", html.indexOf("Ã") === -1);
t("index.html: alerte référence 52 sem. (id refAlert)", html.indexOf('id="refAlert"') !== -1 && html.indexOf("btnRefOk") !== -1);
t("index.html: carte Évolution des scores par actif", html.indexOf("Évolution des scores par actif") !== -1 && html.indexOf('id="scoresWrap"') !== -1);
t("index.html: carte Épisodes de paliers", html.indexOf("Épisodes de paliers") !== -1 && html.indexOf('id="episodesTable"') !== -1);
t("index.html: épisodes persistés (state.episodes)", html.indexOf("state.episodes") !== -1);
t("index.html: alerte référence persistée (state.refAlert)", html.indexOf("state.refAlert") !== -1);
t("index.html: légende des 6 actifs du graphique (SCORE_META)", html.indexOf("SCORE_META") !== -1);
// logic.js (v5 : logique extraite d'index.html)
var logicSrc = fs.readFileSync(path.join(ROOT, "logic.js"), "utf8");
t("logic.js: présent, sans mojibake", logicSrc.length > 15000 && logicSrc.indexOf("Ã") === -1);
t("logic.js: DEFAULT_DATA en euros (IWDA.AS — 130,55 € / sommet 132,26 € du 12/10)",
  L.DEFAULT_DATA.msci === 130.55 && L.DEFAULT_DATA.msciHigh52 === 132.26 && L.DEFAULT_DATA.msciHigh52Date === "2026-10-12" && L.DEFAULT_DATA.msciLow52 === 107.51);
t("logic.js: dateMacro du dernier point macro", L.DEFAULT_DATA.dateMacro === "2026-10-16");
t("logic.js: FIELDS avec dateMacro et MSCI libellés en €",
  L.FIELDS.some(function (f) { return f.k === "dateMacro"; }) &&
  L.FIELDS.some(function (f) { return f.k === "msci" && f.l.indexOf("€") !== -1 && f.l.indexOf("$") === -1; }));
t("logic.js: sources EUR même source que le quotidien (IWDA.AS)", L.SOURCES[0][0].indexOf("130,55 €") !== -1 && L.SOURCES[0][1].indexOf("IWDA.AS") !== -1);
t("logic.js: VIX lissé utilisé dans le scoring (vixEff)", logicSrc.indexOf("vixEff") !== -1 && logicSrc.indexOf("der.vixEff") !== -1);
var sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
t("sw.js: cache v6", sw.indexOf('CACHE = "radar-v6"') !== -1);
t("sw.js: anciens caches v5/v4/v3 absents", ["radar-v5", "radar-v4", "radar-v3"].every(function (c) { return sw.indexOf(c) === -1; }));
t("sw.js: vehicles.js et logic.js dans le shell", sw.indexOf('"./vehicles.js"') !== -1 && sw.indexOf('"./logic.js"') !== -1);
t("sw.js: data.json ET data-daily.json en réseau d'abord",
  sw.indexOf('url.pathname.indexOf("data.json")') !== -1 && sw.indexOf('url.pathname.indexOf("data-daily.json")') !== -1);
t("sw.js: clé de cache sans ?v= (cleanUrl) — le secours hors ligne retrouve la copie",
  sw.indexOf("cleanUrl") !== -1 && sw.indexOf("c.put(cleanUrl, copy)") !== -1);
t("sw.js: auto.js dans le shell", sw.indexOf('"./auto.js"') !== -1);
// auto.js : le câblage ne tourne pas sous Node (guard module.exports)
t("auto.js: pas d'exception à l'import Node", true);
var autosrc = fs.readFileSync(path.join(ROOT, "auto.js"), "utf8");
t("auto.js: récupère data-daily.json à l'ouverture", autosrc.indexOf('"data-daily.json"') !== -1);
t("auto.js: câble l'épisode et l'alerte référence", autosrc.indexOf("Auto_episodeUpdate(") !== -1 && autosrc.indexOf("Auto_refUnstable(") !== -1);
t("auto.js: en-tête v5", autosrc.indexOf("module de mise à jour automatique (v5)") !== -1);
t("auto.js: garde anti-corruption 50 % msci uniquement (plus de dérive 15 %)",
  autosrc.indexOf("AUTO_DAILY_MAX_JUMP") !== -1 && autosrc.indexOf("AUTO_DAILY_MAX_DRIFT") === -1);
t("auto.js: quotidien même-date accepté (révision du soir, même clôture)",
  autosrc.indexOf("Auto_isSameOrNewerDate(daily.dateData, cur.dateData)") !== -1);
t("auto.js: recale la référence 52 sem. depuis daily.refs (Auto_refUpdate)",
  autosrc.indexOf("Auto_refUpdate(cur, daily.refs") !== -1);
t("auto.js: montant en euros dans les messages (plus aucun $)",
  autosrc.indexOf(" €)") !== -1 && !/ \$[^(]/.test(autosrc));

// ---------- workflows GitHub livrés ----------
var pages = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
t("pages.yml: validation data avant déploiement", pages.indexOf("validate-data.js") !== -1);
t("pages.yml: validation AVANT upload-pages-artifact",
  pages.indexOf("validate-data.js") !== -1 && pages.indexOf("validate-data.js") < pages.indexOf("upload-pages-artifact"));
var dailyWf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "daily-data.yml"), "utf8");
t("daily-data.yml: cron jours ouvrés (1-5)", dailyWf.indexOf('"45 21 * * 1-5"') !== -1);
t("daily-data.yml: lance tools/fetch-daily.js", dailyWf.indexOf("tools/fetch-daily.js") !== -1);
t("daily-data.yml: permission contents write", dailyWf.indexOf("contents: write") !== -1);
t("daily-data.yml: permission actions write (le GITHUB_TOKEN ne déclenche aucun workflow)", dailyWf.indexOf("actions: write") !== -1);
t("daily-data.yml: commit seulement si changé", dailyWf.indexOf("--cached --quiet") !== -1);
t("daily-data.yml: sortie changed (GITHUB_OUTPUT)", dailyWf.indexOf("steps.commit.outputs.changed") !== -1);
t("daily-data.yml: redéploie Pages après commit (gh workflow run pages.yml)", dailyWf.indexOf("gh workflow run pages.yml") !== -1);

// ---------- Scoring & stratégie (logique extraite dans logic.js, testée en CI) ----------
// Bug 1 : avec les données du jour (DD −1,3 %), le prochain palier (−5 %) affiche la baisse restante.
var dFix = L.normalizeData({ dateData: "2026-10-17", msci: 130.55, msciHigh52: 132.26, reserve: 1000, paliersDone: { p5: false, p10: false, p15: false, p20: false } });
var derFix = L.computeDerived(dFix);
t("scoring: drawdown MSCI −1,29 % sur les données du jour", derFix.ddMsci !== null && Math.abs(derFix.ddMsci + 1.2928) < 0.002);
var palFix = L.paliersOf(dFix, derFix);
t("paliers: seuils 125,65 / 119,03 / 112,42 / 105,81 € (base 132,26 €)",
  palFix.length === 4 && palFix[0].seuil === 125.65 && palFix[1].seuil === 119.03 && palFix[2].seuil === 112.42 && palFix[3].seuil === 105.81);
var stratFix = L.strategyOf(dFix, derFix, palFix, null).lines.join(" | ");
t("régression bug 1 : prochain palier = « encore 3.8 % de baisse » (plus jamais « déjà franchi »)",
  stratFix.indexOf("Prochain palier : −5 % à 125.65 €, soit encore 3.8 % de baisse") !== -1 && stratFix.indexOf("déjà franchi") === -1);
var dF2 = L.normalizeData({ dateData: "2026-10-17", msci: 124, msciHigh52: 132.26, reserve: 1000, paliersDone: { p5: false, p10: false, p15: false, p20: false } });
var derF2 = L.computeDerived(dF2);
var stratF2 = L.strategyOf(dF2, derF2, L.paliersOf(dF2, derF2), null).lines.join(" | ");
t("stratégie: palier −5 % franchi → déployer 25 % de la réserve (≈ 250 €)",
  stratF2.indexOf("Palier −5 % FRANCHI") !== -1 && stratF2.indexOf("≈ 250 €") !== -1);
// Bug 4 : un champ vidé reste manquant ; seul un champ absent retombe sur la valeur du jour.
var ndClear = L.normalizeData({ dateData: "2026-10-17", vix5: null, cape: 41 });
t("régression bug 4 : champ vidé (null) reste manquant, pas la valeur du 17/10", ndClear.vix5 === null);
var ndAbsent = L.normalizeData({ dateData: "2026-10-17" });
t("régression bug 4 : champ absent → valeur du jour", ndAbsent.vix5 === L.DEFAULT_DATA.vix5 && ndAbsent.vix5 === 16.76);
t("régression bug 4 : scoring et régime sans panne sur données manquantes",
  typeof L.computeDerived(ndClear) === "object" && typeof L.regimeOf(ndClear).label === "string");
// Radar complet sur les données du jour (structure du scoring en CI).
var dDef = L.normalizeData(L.DEFAULT_DATA);
var radarDef = L.radarAll(dDef);
t("radar: 6 actifs triés par score décroissant, scores entiers bornés 0-100",
  radarDef.list.length === 6 &&
  radarDef.list.every(function (a, i) { return (i === 0 || radarDef.list[i - 1].score >= a.score) && a.score >= 0 && a.score <= 100 && Math.round(a.score) === a.score; }));
t("radar: badge qualitatif sur chaque actif", radarDef.list.every(function (a) { return ["good", "mid", "bad"].indexOf(a.badge.cls) !== -1; }));
var derDef = L.computeDerived(dDef);
t("dérivés: VIX lissé prioritaire (vixEff 16,76)", derDef.vixEff === 16.76);
t("dérivés: taux réel ZE −1,3 % · Bund réel −0,38 % · spread OAT 137 pb · marge immo 0,21",
  Math.abs(derDef.tauxReelZE + 1.3) < 0.001 && Math.abs(derDef.bundReal + 0.38) < 0.001 && Math.round(derDef.spreadOat) === 137 && Math.abs(derDef.imoMarge - 0.21) < 0.001);
t("dérivés: position or dans la fourchette 52 sem. (~28 %)", derDef.posOr !== null && derDef.posOr > 25 && derDef.posOr < 32);
t("stepScore: CAPE 40,38 → −24 pts ; valeur manquante → 0 pts",
  L.stepScore(40.38, [[20, 20], [25, 10], [30, 0], [35, -10], [40, -18], [Infinity, -24]]) === -24 && L.stepScore(null, [[20, 20]]) === 0);
t("pctDD: cas limites (high manquant, high ≤ 0)", L.pctDD(100, null) === null && L.pctDD(50, 0) === null);
t("clampScore: borné 0-100", L.clampScore(-5) === 0 && L.clampScore(104.6) === 100);
t("staleDays: 3 jours ; date invalide → null", L.staleDays("2026-10-17", Date.parse("2026-10-20T12:00:00Z")) === 3 && L.staleDays("nawak", 0) === null);
var geo = L.parseGecko({ prices: [[0, 5], [1, 7], [2, 6]] });
t("parseGecko: cur/high/low extraits", !!geo && geo.cur === 6 && geo.high === 7 && geo.low === 5);
t("régime: Expansion · inflation élevée · BCE en relèvement de taux",
  (function () { var r = L.regimeOf(dDef); return r.label.indexOf("Expansion") !== -1 && r.label.indexOf("élevée") !== -1 && r.label.indexOf("relèvement") !== -1; })());
var snapDef = L.snapshotOf(dDef, radarDef);
t("snapshot: forme complète (top, score, scores des 6 actifs, ddMsci)",
  snapDef.top === radarDef.list[0].name && snapDef.topScore === radarDef.list[0].score && snapDef.ddMsci === derDef.ddMsci && Object.keys(snapDef.scores).length === 6);
// Bug 5 : l'export doit être symétrique avec l'import (refAlert + episodes inclus).
t("régression bug 5 : export inclut refAlert et episodes",
  html.indexOf("history: state.history, refAlert: state.refAlert, episodes: state.episodes }, null, 2") !== -1);

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
