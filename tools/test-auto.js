/* Harnais de tests — Radar Conjoncture v5.4 (logic.js, auto.js, vehicles.js, fichiers livrés,
   pipeline quotidien/épisode/référence, validateurs, workflows, notifications ntfy/Telegram,
   sanitisation des imports, régressions v4.1/v5, compilation navigateur des scripts servis et conseil d'allocation v5.4).
   Exécution : node tools/test-auto.js  →  0 échec obligatoire avant publication. */
"use strict";
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var A = require(path.join(__dirname, "..", "auto.js"));
var L = require(path.join(__dirname, "..", "logic.js"));
var results = [];
function t(name, cond) { results.push({ name: name, ok: !!cond }); }

// ---------- Auto_isNewerDate ----------
t("isNewerDate: date plus récente → true", A.Auto_isNewerDate("2026-10-24", "2026-10-17") === true);
t("isNewerDate: même date → false", A.Auto_isNewerDate("2026-10-17", "2026-10-17") === false);
t("isNewerDate: date plus ancienne → false", A.Auto_isNewerDate("2026-10-10", "2026-10-17") === false);
t("isNewerDate: année à 4 chiffres seule → true", A.Auto_isNewerDate("2027-01-05", "2026-12-31") === true);
t("isNewerDate: entrée non chaîne → false", A.Auto_isNewerDate(null, "2026-10-17") === false && A.Auto_isNewerDate("2026-10-17", undefined) === false);

// ---------- Auto_validRemote (v5 : la date doit EXISTER dans le calendrier) ----------
var NOW = Date.UTC(2026, 9, 18); // 2026-10-18, horloge figée pour des tests déterministes
var OK_REMOTE = { dateData: "2026-10-19", data: { msci: 150.2 }, note: "test" };
t("validRemote: payload valide → accepté", A.Auto_validRemote(OK_REMOTE, NOW) === OK_REMOTE);
t("validRemote: horloge par défaut (Date.now) → accepté", A.Auto_validRemote(OK_REMOTE) === OK_REMOTE);
t("validRemote: null → null", A.Auto_validRemote(null, NOW) === null);
t("validRemote: sans data → null", A.Auto_validRemote({ dateData: "2026-10-19" }, NOW) === null);
t("validRemote: data non objet → null", A.Auto_validRemote({ dateData: "2026-10-19", data: "x" }, NOW) === null);
t("validRemote: dateData manquant → null", A.Auto_validRemote({ data: {} }, NOW) === null);
t("validRemote: dateData mal formé → null", A.Auto_validRemote({ dateData: "24/10/2026", data: {} }, NOW) === null);
t("validRemote: dateData partielle → null", A.Auto_validRemote({ dateData: "2026-10", data: {} }, NOW) === null);
t("validRemote: 30 février → null (jour inexistant)", A.Auto_validRemote({ dateData: "2026-02-30", data: {} }, NOW) === null);
t("validRemote: 31 avril → null (jour inexistant)", A.Auto_validRemote({ dateData: "2026-04-31", data: {} }, NOW) === null);
t("validRemote: mois 13 → null", A.Auto_validRemote({ dateData: "2026-13-01", data: {} }, NOW) === null);
t("validRemote: 29 février non bissextile → null", A.Auto_validRemote({ dateData: "2025-02-29", data: {} }, NOW) === null);
t("validRemote: 29 février bissextile → accepté", A.Auto_validRemote({ dateData: "2028-02-29", data: {} }, Date.UTC(2028, 2, 5)) !== null);
t("validRemote: futur > 2 jours → null", A.Auto_validRemote({ dateData: "2026-10-30", data: {} }, NOW) === null);
t("validRemote: futur ≤ 2 jours → accepté", A.Auto_validRemote({ dateData: "2026-10-20", data: {} }, NOW) !== null);
t("validRemote: avant 2000 → null", A.Auto_validRemote({ dateData: "1999-12-31", data: {} }, NOW) === null);

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
var m5 = A.Auto_merge(LOCAL, { dateMacro: "2026-10-16" });
t("merge: dateMacro absent du local (non-string) → ignoré sans erreur", m5 !== null);

// ---------- Auto_overlayDaily (v5.1 : champs spot + macro officiels, références via Auto_refUpdate) ----------
t("dailyFields: liste exacte autorisée (spot + macro ; les références 52 sem. passent par Auto_refUpdate)",
  JSON.stringify(A.AUTO_DAILY_FIELDS) === JSON.stringify(["msci", "vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE"]));
t("dailyRanges: plages plausibles EUR + macro", A.AUTO_DAILY_RANGES.msci[0] === 15 && A.AUTO_DAILY_RANGES.msci[1] === 1000 &&
  A.AUTO_DAILY_RANGES.msciHigh52[1] === 1000 && A.AUTO_DAILY_RANGES.vix[0] === 3 && A.AUTO_DAILY_RANGES.vix[1] === 100 &&
  A.AUTO_DAILY_RANGES.bceDepot[0] === -1 && A.AUTO_DAILY_RANGES.inflZE[1] === 15);
t("dailyMaxJump: 50 % (garde anti-corruption msci uniquement)", A.AUTO_DAILY_MAX_JUMP === 0.50);
var DAILY_OK = { msci: 147.3, vix: 20.5, vix5: 17.1, bund10: 3.45, oat10: 4.8 };
var od1 = A.Auto_overlayDaily(LOCAL, DAILY_OK);
t("overlayDaily: champs du jour appliqués", od1 && od1.msci === 147.3 && od1.vix === 20.5 && od1.vix5 === 17.1);
t("overlayDaily: ne touche ni reserve ni paliersDone (non portés par le relevé)",
  od1 && od1.reserve === 500 && od1.paliersDone.p10 === false && od1.msciHigh52 === 149.81);
t("overlayDaily: ne modifie pas l'objet local", LOCAL.msci === 146.81);
var od2 = A.Auto_overlayDaily(LOCAL, { msci: 180, vix: 21 }); // +22 % vs local : mouvement légitime → accepté
t("overlayDaily: mouvement > 15 % (±22 %) accepté — un krach cumulé ne doit pas être bloqué", od2.msci === 180 && od2.vix === 21);
var od2b = A.Auto_overlayDaily(LOCAL, { msci: 250 }); // +70 % vs local : impossible en une séance → corruption
t("overlayDaily: saut > 50 % (msci) écarté (anti-corruption)", od2b === null);
var od2c = A.Auto_overlayDaily(LOCAL, { msci: 5000 }); // hors plage plausible
t("overlayDaily: valeur hors plage plausible écartée", od2c === null);
t("overlayDaily: spike VIX légitime (+100 %) accepté (plage seule, pas de dérive)",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix = 20; var r = A.Auto_overlayDaily(l, { vix: 40 }); return r !== null && r.vix === 40; })());
t("overlayDaily: VIX hors plage (vix 2) écarté",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix = 20; var r = A.Auto_overlayDaily(l, { vix: 2 }); return r === null; })());
t("overlayDaily: champ non autorisé ignoré → rien d'appliqué", A.Auto_overlayDaily(LOCAL, { cape: 20 }) === null);
var od3 = A.Auto_overlayDaily(LOCAL, { cape: 20 });
t("overlayDaily: cape (hors liste) jamais appliquée", od3 === null || od3.cape === undefined || od3.cape === LOCAL.cape);
t("overlayDaily: vix5 accepté même si absent localement (null)",
  (function () { var l = JSON.parse(JSON.stringify(LOCAL)); l.vix5 = null; var r = A.Auto_overlayDaily(l, { vix5: 16.8 }); return r !== null && r.vix5 === 16.8; })());
t("overlayDaily: rien de valable → null", A.Auto_overlayDaily(LOCAL, {}) === null);
t("overlayDaily: entrée null → null", A.Auto_overlayDaily(LOCAL, null) === null && A.Auto_overlayDaily(null, DAILY_OK) === null);
var ovE = A.Auto_overlayDaily(LOCAL, { bceDepot: 2.75, inflZE: 3.9, bceDir: "hausse" });
t("overlayDaily: macro officiels appliqués", ovE && ovE.bceDepot === 2.75 && ovE.inflZE === 3.9);
t("overlayDaily: bceDir validé par liste fermée", ovE && ovE.bceDir === "hausse" && A.Auto_overlayDaily(LOCAL, { bceDir: "nimporte" }) === null);
t("overlayDaily: références 52 sem. JAMAIS appliquées à plat (via Auto_refUpdate uniquement)",
  A.Auto_overlayDaily(LOCAL, { msciHigh52: 152.3, msciLow52: 120.4, msciHigh52Date: "2026-08-01" }) === null &&
  A.Auto_overlayDaily(LOCAL, { msciHigh52Date: "2026-08-01" }) === null);

// ---------- Auto_isValidDate / Auto_isSameOrNewerDate ----------
t("isValidDate: 2026-10-16 → true", A.Auto_isValidDate("2026-10-16") === true);
t("isValidDate: 2026-02-28 → true, 2026-02-29 → false (année non bissextile)",
  A.Auto_isValidDate("2026-02-28") === true && A.Auto_isValidDate("2026-02-29") === false);
t("isValidDate: 2026-02-31 / 2026-13-01 → false", A.Auto_isValidDate("2026-02-31") === false && A.Auto_isValidDate("2026-13-01") === false);
t("isValidDate: formats invalides → false",
  A.Auto_isValidDate("16/10/2026") === false && A.Auto_isValidDate("") === false && A.Auto_isValidDate(null) === false && A.Auto_isValidDate(20261016) === false);
t("isSameOrNewerDate: même date → true, ancien → false, récent → true",
  A.Auto_isSameOrNewerDate("2026-10-16", "2026-10-16") === true &&
  A.Auto_isSameOrNewerDate("2026-10-15", "2026-10-16") === false &&
  A.Auto_isSameOrNewerDate("2026-10-17", "2026-10-16") === true);

// ---------- Auto_refUpdate (recale la référence 52 sem., fenêtre 1 an, à la hausse uniquement) ----------
var RU_BASE = { msci: 146.81, msciHigh52: 149.81, msciHigh52Date: "", msciLow52: 123.2, paliersDone: { p5: true, p10: false, p15: false, p20: false } };
var ru1 = A.Auto_refUpdate(RU_BASE, { msciHigh52: 152.3, msciLow52: 120.4, msciHigh52Date: "2026-08-01" }, "2026-10-20");
t("refUpdate: sommet 1 an plus haut → référence recalée", ru1 && ru1.data.msciHigh52 === 152.3);
t("refUpdate: date du sommet consignée (fournie)", ru1 && ru1.data.msciHigh52Date === "2026-08-01");
t("refUpdate: bas 52 sem. suivi (même fenêtre)", ru1 && ru1.data.msciLow52 === 120.4);
t("refUpdate: nouvel épisode + paliers réinitialisés",
  ru1 && ru1.episode.oldHigh52 === 149.81 && ru1.episode.newHigh52 === 152.3 && ru1.episode.deployed === 1 && ru1.data.paliersDone.p5 === false);
t("refUpdate: écart de 1,7 % → pas d'alerte instable", ru1 && ru1.unstable === false);
t("refUpdate: date du sommet absente/invalide → date du relevé",
  A.Auto_refUpdate(RU_BASE, { msciHigh52: 152.3, msciHigh52Date: "12/08/2026" }, "2026-10-20").data.msciHigh52Date === "2026-10-20");
t("refUpdate: référence JAMAIS abaissée (fenêtre qui défile) → null", A.Auto_refUpdate(RU_BASE, { msciHigh52: 148.0 }, "2026-10-20") === null);
t("refUpdate: égalité (même sommet) → null (no-op)", A.Auto_refUpdate(RU_BASE, { msciHigh52: 149.81 }, "2026-10-20") === null);
t("refUpdate: saut aberrant > +10 % → null", A.Auto_refUpdate(RU_BASE, { msciHigh52: 165.0 }, "2026-10-20") === null);
t("refUpdate: sommet hors plage plausible → null", A.Auto_refUpdate(RU_BASE, { msciHigh52: 5000 }, "2026-10-20") === null);
t("refUpdate: bas hors plage ignoré, sommet appliqué",
  (function () { var r = A.Auto_refUpdate(RU_BASE, { msciHigh52: 152.3, msciLow52: 5000 }, "2026-10-20"); return r && r.data.msciHigh52 === 152.3 && r.data.msciLow52 === 123.2; })());
t("refUpdate: date du relevé invalide → null", A.Auto_refUpdate(RU_BASE, { msciHigh52: 152.3 }, "24/10/2026") === null);
t("refUpdate: gros mouvement légitime (+7,7 %) → alerte instable",
  A.Auto_refUpdate(RU_BASE, { msciHigh52: 161.35 }, "2026-10-20").unstable === true);
t("refUpdate: entrées invalides → null",
  A.Auto_refUpdate(null, { msciHigh52: 152.3 }, "2026-10-20") === null &&
  A.Auto_refUpdate(RU_BASE, null, "2026-10-20") === null &&
  A.Auto_refUpdate(RU_BASE, { msciHigh52: "abc" }, "2026-10-20") === null);
t("refUpdate: ne modifie pas l'objet local", RU_BASE.msciHigh52 === 149.81 && RU_BASE.paliersDone.p5 === true);

// ---------- Auto_episodeUpdate ----------
t("episodeMaxJump: 10 %", A.AUTO_EPISODE_MAX_JUMP === 0.10);
var WITH_DONE = JSON.parse(JSON.stringify(LOCAL));
WITH_DONE.msci = 150.5; WITH_DONE.paliersDone = { p5: true, p10: true, p15: false, p20: false };
var ep1 = A.Auto_episodeUpdate(WITH_DONE, "2026-10-24");
t("épisode: nouveau plus haut → référence montée au cours",
  ep1 && ep1.data.msciHigh52 === 150.5 && ep1.data.msciHigh52 !== 149.81);
t("épisode: date du sommet consignée", ep1 && ep1.data.msciHigh52Date === "2026-10-24");
t("épisode: paliers réinitialisés", ep1 && ep1.data.paliersDone.p5 === false && ep1.data.paliersDone.p10 === false);
t("épisode: bilan de l'épisode clos (2 déployés)", ep1 && ep1.episode.deployed === 2 && ep1.episode.oldHigh52 === 149.81 && ep1.episode.newHigh52 === 150.5 && ep1.episode.date === "2026-10-24");
var HIGHER = JSON.parse(JSON.stringify(WITH_DONE)); HIGHER.msci = 152.0;
var ep2 = A.Auto_episodeUpdate(HIGHER, "2026-10-24");
t("épisode: cours sous le sommet → aucun épisode (null)", A.Auto_episodeUpdate(LOCAL, "2026-10-24") === null);
t("épisode: saut aberrant (> 10 % au-dessus) ignoré",
  A.Auto_episodeUpdate({ msci: 170, msciHigh52: 149.81, paliersDone: { p5: false } }, "2026-10-24") === null);
t("épisode: date mal formée → null", A.Auto_episodeUpdate(HIGHER, "24/10/2026") === null);
t("épisode: données manquantes → null", A.Auto_episodeUpdate({ msci: 150 }, "2026-10-24") === null);
t("épisode: ne modifie pas l'objet local", WITH_DONE.msci === 150.5 && WITH_DONE.paliersDone.p5 === true && WITH_DONE.msciHigh52 === 149.81);
t("épisode: égalité stricte (cours = sommet) → pas d'épisode",
  A.Auto_episodeUpdate({ msci: 149.81, msciHigh52: 149.81, paliersDone: {} }, "2026-10-24") === null);

// ---------- Auto_refUnstable ----------
t("refUnstable: écart de 7 % → true", A.Auto_refUnstable(161.35, 149.81) === true);
t("refUnstable: écart de 1 % → false", A.Auto_refUnstable(149.81, 151.3) === false);
t("refUnstable: écart exactement 2 % → false", A.Auto_refUnstable(100, 102) === false);
t("refUnstable: valeur locale manquante → false", A.Auto_refUnstable(null, 149.81) === false);
t("refUnstable: valeur distante manquante → false", A.Auto_refUnstable(149.81, null) === false);
t("refUnstable: référence plus haute (nouveau sommet +8 %) → true",
  A.Auto_refUnstable(149.81, 161.35) === true);
t("refUnstable: référence abaissée par le défilement de la fenêtre 52 sem. → true",
  A.Auto_refUnstable(132.26, 125.6) === true);

// ---------- Auto_palierToDeploy (v5 : notifications) ----------
t("palierToDeploy: −5 % franchi non déployé → 5", A.Auto_palierToDeploy({ msci: 125, msciHigh52: 132.26, paliersDone: { p5: false } }) === 5);
t("palierToDeploy: −5 déployé → passe au −10", A.Auto_palierToDeploy({ msci: 119, msciHigh52: 132.26, paliersDone: { p5: true, p10: false } }) === 10);
t("palierToDeploy: tous déployés → null", A.Auto_palierToDeploy({ msci: 100, msciHigh52: 132.26, paliersDone: { p5: true, p10: true, p15: true, p20: true } }) === null);
t("palierToDeploy: aucun palier franchi → null", A.Auto_palierToDeploy({ msci: 130, msciHigh52: 132.26, paliersDone: { p5: false } }) === null);
t("palierToDeploy: données manquantes → null", A.Auto_palierToDeploy({}) === null && A.Auto_palierToDeploy(null) === null);

// ---------- Auto_tgValid (v5 : Telegram) ----------
t("tgValid: token + chat id valides → true", A.Auto_tgValid("123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", 123456789) === true);
t("tgValid: chat id en chaîne accepté", A.Auto_tgValid("123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", "123456789") === true);
t("tgValid: chat id de groupe (négatif) accepté", A.Auto_tgValid("123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", "-1001234567890") === true);
t("tgValid: token sans deux points → false", A.Auto_tgValid("123456789AAEhBOweik", "123") === false);
t("tgValid: token trop court → false", A.Auto_tgValid("12345:abc", "123") === false);
t("tgValid: chat id non numérique → false", A.Auto_tgValid("123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", "abc") === false);

// ---------- Auto_ntfyValid / Auto_notifyCfg (v5.2 : ntfy recommandé, Telegram en option) ----------
t("ntfyValid: sujet simple → true", A.Auto_ntfyValid("radar-paliers-jade") === true);
t("ntfyValid: lettres/chiffres/tirets/soulignés → true", A.Auto_ntfyValid("Radar_2026-x") === true);
t("ntfyValid: sujet à 64 caractères → true", A.Auto_ntfyValid(new Array(65).join("a")) === true);
t("ntfyValid: espace → false", A.Auto_ntfyValid("radar paliers") === false);
t("ntfyValid: slash → false (pas une URL)", A.Auto_ntfyValid("ntfy.sh/radar") === false);
t("ntfyValid: vide → false", A.Auto_ntfyValid("") === false);
t("ntfyValid: trop long (> 64) → false", A.Auto_ntfyValid(new Array(67).join("a")) === false);
t("ntfyValid: non-chaîne → false", A.Auto_ntfyValid(null) === false && A.Auto_ntfyValid(42) === false);
t("notifyCfg: ntfy avec channel → {channel:ntfy, topic}", JSON.stringify(A.Auto_notifyCfg({ channel: "ntfy", topic: "radar-paliers-jade" })) === JSON.stringify({ channel: "ntfy", topic: "radar-paliers-jade" }));
t("notifyCfg: telegram avec channel → {channel:telegram, token, chatId}", A.Auto_notifyCfg({ channel: "telegram", token: "123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", chatId: "123456789" }).channel === "telegram");
t("notifyCfg: rétrocompat v5.1 {token, chatId} sans channel → telegram", A.Auto_notifyCfg({ token: "123456789:AAEhBOweik6ad9r_QXMENQjcr7q6hRLTfF", chatId: "123456789" }).channel === "telegram");
t("notifyCfg: rétrocompat {topic} sans channel → ntfy", A.Auto_notifyCfg({ topic: "radar-paliers-jade" }).channel === "ntfy");
t("notifyCfg: config invalide → null", A.Auto_notifyCfg({ channel: "ntfy", topic: "avec espace" }) === null && A.Auto_notifyCfg({ channel: "smtp" }) === null);
t("notifyCfg: null/entrée non objet → null", A.Auto_notifyCfg(null) === null && A.Auto_notifyCfg("ntfy") === null);

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
t("pipeline: référence quasi identique (−1,9 %) → pas d'alerte",
  A.Auto_refUnstable(149.81, 147.0) === false);

// ---------- logic.js : module pur (v5 : extrait de index.html) ----------
t("logic.js: module pur requêrable sous Node", typeof L.radarAll === "function" && typeof L.strategyOf === "function" && typeof L.normalizeData === "function");
var srcLogic = fs.readFileSync(path.join(__dirname, "..", "logic.js"), "utf8");
t("logic.js: aucun accès DOM ni localStorage dans la logique pure", srcLogic.indexOf("document.") === -1 && srcLogic.indexOf("localStorage") === -1);
t("logic.js: encodage propre (pas de mojibake Ã)", srcLogic.indexOf("Ã") === -1);
t("logic.js: FIELDS inclut dateMacro (fraîcheur macro séparée)", L.FIELDS.some(function (f) { return f.k === "dateMacro"; }));
t("logic.js: libellés MSCI en euros", L.FIELDS.some(function (f) { return f.k === "msci" && f.l.indexOf("€") !== -1; }));
t("logic.js: DEFAULT_DATA en EUR, daté du 16/10 (clôture IWDA.AS)", L.DEFAULT_DATA.msci < 200 && L.DEFAULT_DATA.msci > 50 && L.DEFAULT_DATA.dateData === "2026-10-16" && L.DEFAULT_DATA.dateMacro === "2026-10-16");
t("logic.js: références 52 sem. EUR cohérentes (bas ≤ cours ≤ haut)", L.DEFAULT_DATA.msciLow52 <= L.DEFAULT_DATA.msci && L.DEFAULT_DATA.msci <= L.DEFAULT_DATA.msciHigh52);

// ---------- logic.js : scoring & stratégie (tests de fond ajoutés en v5) ----------
var dEU = JSON.parse(JSON.stringify(L.DEFAULT_DATA)); dEU.reserve = 1000;
var radarEU = L.radarAll(dEU);
t("scoring: 6 actifs, scores 0–100, triés décroissant",
  radarEU.list.length === 6 && radarEU.list.every(function (a) { return a.score >= 0 && a.score <= 100; }) && radarEU.list[0].score >= radarEU.list[5].score);
t("scoring: badges attribués partout", radarEU.list.every(function (a) { return a.badge && a.badge.cls; }));
t("scoring: chaque actif a son véhicule détaillé (parts)", radarEU.list.every(function (a) { return Array.isArray(a.parts) && a.parts.length >= 3; }));
t("scoring: drawdown EUR calculé (−1,29 %)", radarEU.der.ddMsci !== null && Math.abs(radarEU.der.ddMsci + 1.29) < 0.06);
t("scoring: vixEff = vix5 lissé quand disponible", radarEU.der.vixEff === L.DEFAULT_DATA.vix5);
t("scoring: taux réel ZE = dépôt − inflation", radarEU.der.tauxReelZE === 2.5 - 3.8);
t("scoring: spread OAT-Bund ≈ 137 pb", Math.round(radarEU.der.spreadOat) === 137);
t("régime: libellé du jour (Expansion · inflation élevée · BCE en relèvement)", L.regimeOf(dEU).label === "Expansion · inflation élevée · BCE en relèvement de taux");
var scoreActionsOf = function (d) { return L.radarAll(d).list.filter(function (a) { return a.id === "actions"; })[0].score; };
var dPanic = JSON.parse(JSON.stringify(dEU)); dPanic.vix = 45; dPanic.vix5 = null;
var dCalm = JSON.parse(JSON.stringify(dEU)); dCalm.vix = 11; dCalm.vix5 = null;
t("scoring: VIX panique (45) = opportunité d'achat vs complaisance (11)", scoreActionsOf(dPanic) > scoreActionsOf(dCalm));
var dCrash = JSON.parse(JSON.stringify(dEU)); dCrash.msci = L.DEFAULT_DATA.msciHigh52 * 0.85;
t("scoring: drawdown −15 % récompense l'opportunité de prix", scoreActionsOf(dCrash) > scoreActionsOf(dEU));
t("paliers: seuils 52 sem. en euros (125,65 / 119,03 / 112,42 / 105,81)",
  (function () { var pal = L.paliersOf(dEU, L.computeDerived(dEU)); return pal.length === 4 && Math.abs(pal[0].seuil - 125.65) < 0.01 && Math.abs(pal[1].seuil - 119.03) < 0.01 && Math.abs(pal[2].seuil - 112.42) < 0.01 && Math.abs(pal[3].seuil - 105.81) < 0.01; })());
var stratEU = L.strategyOf(dEU, radarEU.der, L.paliersOf(dEU, radarEU.der), radarEU.list[0]).lines.join(" | ");
t("stratégie: prochain palier en euros — « encore 3.8 % de baisse » (régression bug 1)",
  stratEU.indexOf("Prochain palier : −5 % à 125.65 €, soit encore 3.8 % de baisse") !== -1 && stratEU.indexOf("déjà franchi") === -1);
t("stratégie: anti-accumulation CAPE ≥ 30 présente", stratEU.indexOf("Anti-accumulation") !== -1);
// régression v4.1 (bug 1) : cas historique en USD — la distance restante doit rester juste
var dFix = L.normalizeData({ dateData: "2026-10-17", msci: 146.81, msciHigh52: 149.81, reserve: 1000, paliersDone: { p5: false, p10: false, p15: false, p20: false } });
var derFix = L.computeDerived(dFix);
var stratFix = L.strategyOf(dFix, derFix, L.paliersOf(dFix, derFix), null).lines.join(" | ");
t("régression bug 1 (cas v4.1) : « encore 3.1 % de baisse »", stratFix.indexOf("encore 3.1 % de baisse") !== -1 && stratFix.indexOf("déjà franchi") === -1);

// ---------- logic.js : normalizeData & sanitisation (régressions bugs 4 et injection) ----------
var ndClear = L.normalizeData({ dateData: "2026-10-16", vix5: null, cape: 41 });
t("régression bug 4 : champ vidé (null) reste manquant, pas la valeur du jour", ndClear.vix5 === null);
var ndAbsent = L.normalizeData({ dateData: "2026-10-16" });
t("régression bug 4 : champ absent → valeur du jour", ndAbsent.vix5 === L.DEFAULT_DATA.vix5 && ndAbsent.vix5 === 16.76);
t("régression bug 4 : dérivées sans panne sur données manquantes", typeof L.computeDerived(ndClear) === "object");
var sb = L.Auto_sanitizeImport({
  history: [{ date: "<img onerror=x>", top: "<script>alert(1)</script>", topScore: "999", scores: { actions: "<b>bad</b>" }, ddMsci: "NaN" }],
  episodes: [{ date: 123, oldHigh52: "<x>", newHigh52: "9", deployed: "<script>" }],
  refAlert: { date: "<i>", from: "a", to: "b" }
});
t("sanitize: historique typé (chaînes tronquées, nombres coercés)", sb.history.length === 1 && typeof sb.history[0].date === "string" && sb.history[0].date.length <= 10 && sb.history[0].topScore === null && sb.history[0].scores.actions === null && sb.history[0].ddMsci === null);
t("sanitize: épisodes typés (aucune string/HTML dans les nombres)", sb.episodes.length === 1 && sb.episodes[0].oldHigh52 === null && sb.episodes[0].newHigh52 === null && sb.episodes[0].deployed === null);
t("sanitize: refAlert non typé → null", sb.refAlert === null);
var sbOK = L.Auto_sanitizeImport({ history: [{ date: "2026-10-17", top: "Or (physique / ETF or)", topScore: 58, scores: { or: 58 }, ddMsci: -1.3 }], episodes: [{ date: "2026-10-17", oldHigh52: 149.81, newHigh52: 150.5, deployed: 2 }], refAlert: { date: "2026-10-17", from: 149.81, to: 150.5 } });
t("sanitize: import légitime passé intact", sbOK.history[0].topScore === 58 && sbOK.episodes[0].newHigh52 === 150.5 && sbOK.refAlert.to === 150.5);
t("sanitize: entrée null → vide et sans erreur", JSON.stringify(L.Auto_sanitizeImport(null)) === JSON.stringify({ history: [], episodes: [], refAlert: null }));

// ---------- data.json livré ----------
var ROOT = path.join(__dirname, "..");
var raw = JSON.parse(fs.readFileSync(path.join(ROOT, "data.json"), "utf8"));
t("data.json: structure valide pour auto.js", A.Auto_validRemote(raw) === raw);
t("data.json: dateData au format ISO", /^\d{4}-\d{2}-\d{2}$/.test(raw.dateData));
t("data.json: dateData ≥ 2026-10-18 (le switch EUR doit se propager sur les téléphones déjà au 17/10 — jamais de re-datage en arrière)", raw.dateData >= "2026-10-18");
t("data.json: msci numérique en EUR plausible (50–500)", typeof raw.data.msci === "number" && raw.data.msci >= 50 && raw.data.msci <= 500);
t("data.json: bceDir parmi les 3 valeurs autorisées", ["hausse", "stable", "baisse"].indexOf(raw.data.bceDir) >= 0);
t("data.json: ni reserve ni paliersDone (jamais poussés)", !("reserve" in raw.data) && !("paliersDone" in raw.data));
t("data.json: sources présentes", Array.isArray(raw.sources) && raw.sources.length >= 5);
t("data.json: sommet 52 sem. ≥ cours", raw.data.msciHigh52 >= raw.data.msci);
t("data.json: vix5 présent et numérique", typeof raw.data.vix5 === "number" && isFinite(raw.data.vix5));
t("data.json: dateMacro présent (fraîcheur macro séparée)", /^\d{4}-\d{2}-\d{2}$/.test(raw.data.dateMacro));
t("data.json: msciHigh52Date consigné (traçabilité du sommet)", /^\d{4}-\d{2}-\d{2}$/.test(raw.data.msciHigh52Date));
var mergedDefaults = A.Auto_merge({ msci: 146.81, msciHigh52Date: "", bceDir: "hausse", btcHigh52: null, orEUR: 3729.84, vix5: null }, raw.data);
t("data.json: fusion sur données par défaut OK", mergedDefaults.msci === raw.data.msci && mergedDefaults.bceDir === raw.data.bceDir && mergedDefaults.vix5 === raw.data.vix5);

// ---------- data-daily.json livré ----------
var daily = JSON.parse(fs.readFileSync(path.join(ROOT, "data-daily.json"), "utf8"));
t("data-daily.json: structure valide pour auto.js", A.Auto_validRemote(daily) === daily);
var ALLOWED_DAILY = A.AUTO_DAILY_FIELDS.concat(["bceDir", "msciHigh52", "msciLow52", "msciHigh52Date"]); // références 52 sem. livrées mais appliquées via Auto_refUpdate
t("data-daily.json: au moins un champ de marché", A.AUTO_DAILY_FIELDS.some(function (k) { return typeof daily.data[k] === "number"; }));
t("data-daily.json: ni reserve ni paliersDone", !("reserve" in daily.data) && !("paliersDone" in daily.data));
t("data-daily.json: aucun champ hors liste autorisée", Object.keys(daily.data).every(function (k) { return ALLOWED_DAILY.indexOf(k) !== -1; }));
t("data-daily.json: bceDir parmi les 3 valeurs", ["hausse", "stable", "baisse"].indexOf(daily.data.bceDir) >= 0);
t("data-daily.json: références 52 sem. présentes (même source que le cours)", typeof daily.data.msciHigh52 === "number" && typeof daily.data.msciLow52 === "number");
t("data-daily.json: sources présentes", Array.isArray(daily.sources) && daily.sources.length >= 3);
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
  fs.writeFileSync(path.join(ROOT, "tmp-bad.json"), JSON.stringify({ dateData: "2026-10-16", data: { msci: 999999, reserve: 100, vix: 5 } }));
  child_process.execSync("node " + JSON.stringify(path.join(ROOT, "tools", "validate-data.js")) + " " + JSON.stringify("tmp-bad.json"), { cwd: ROOT, stdio: "pipe" });
  t("validate-data: rejette msci aberrant + reserve poussé", false);
} catch (e) { t("validate-data: rejette msci aberrant + reserve poussé", true); }
fs.unlinkSync(path.join(ROOT, "tmp-bad.json"));

// ---------- fetch-daily.js (livré, hors réseau ici) ----------
var fd = fs.readFileSync(path.join(ROOT, "tools", "fetch-daily.js"), "utf8");
t("fetch-daily: fichier présent", fd.length > 1000);
t("fetch-daily: IWDA en EUR (IWDA.AS, Euronext Amsterdam), plus IWDA.L", fd.indexOf("IWDA.AS") !== -1 && fd.indexOf("IWDA.L") === -1);
t("fetch-daily: fenêtre 1 an pour cours + références 52 sem. (même source)", fd.indexOf('fetchChart("IWDA.AS", "1y")') !== -1);
t("fetch-daily: BCE officielle (ECB Data Portal, DFR)", fd.indexOf("B.U2.EUR.4F.KR.DFR.LEV") !== -1);
t("fetch-daily: direction BCE dérivée des 2 dernières décisions", fd.indexOf('"hausse" : last < prev ? "baisse" : "stable"') !== -1);
t("fetch-daily: Eurostat officielle (prc_hicp_manr)", fd.indexOf("prc_hicp_manr") !== -1);
t("fetch-daily: garde de fraîcheur Eurostat (période ≤ 3 mois)", fd.indexOf("eurostatAgeMonths") !== -1 && fd.indexOf("> 3") !== -1);
t("fetch-daily: garde-fous une séance (10 % msci / 25 % références / 30 % macro / 60 % VIX)", fd.indexOf("0.10") !== -1 && fd.indexOf("0.25") !== -1 && fd.indexOf("0.30") !== -1 && fd.indexOf("0.60") !== -1);
t("fetch-daily: référence de dérive = dernier relevé quotidien accepté", fd.indexOf("refDaily") !== -1 && fd.indexOf("previous.data") !== -1);
t("fetch-daily: dateData = date de clôture (last.date), pas la date d'exécution", fd.indexOf("dateData = last.date") !== -1 && fd.indexOf("dateData = today") === -1);
t("fetch-daily: no-op si relevé existant ≥ clôture (jamais d'écrasement ancien)", fd.indexOf("previous.dateData >= dateData") !== -1);
t("fetch-daily: échec macro silencieux (champs absents, marchés intacts)", fd.indexOf("macroNotes") !== -1);
t("fetch-daily: ne touche ni reserve ni paliersDone", fd.indexOf("reserve") === -1 && fd.indexOf("paliersDone") === -1);

// ---------- index.html, logic.js, sw.js, auto.js livrés ----------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
t("index.html: script auto.js référencé", html.indexOf('<script src="auto.js"></script>') !== -1);
t("index.html: badge v5.4", html.indexOf("<b>v5.4</b>") !== -1);
t("index.html: aucun ancien badge v5.3/v5.2/v5.1/v5/v4.2/v4.1/v4/v3/v2/v1", ["<b>v5.3</b>", "<b>v5.2</b>", "<b>v5.1</b>", "<b>v5</b>", "<b>v4.2</b>", "<b>v4.1</b>", "<b>v4</b>", "<b>v3</b>", "<b>v2</b>", "<b>v1</b>"].every(function (b) { return html.indexOf(b) === -1; }));
t("index.html: badge « Maj auto quotidienne »", html.indexOf("Maj auto quotidienne") !== -1);
t("index.html: logic.js chargé entre vehicles.js et le script UI inline",
  html.indexOf('<script src="vehicles.js"></script>') !== -1 &&
  html.indexOf('<script src="vehicles.js"></script>') < html.indexOf('<script src="logic.js"></script>') &&
  html.indexOf('<script src="logic.js"></script>') < html.indexOf("// ================== Couche UI"));
t("index.html: logique pure extraite (définitions absentes de l'inline)",
  html.indexOf("var DEFAULT_DATA") === -1 && html.indexOf("function strategyOf") === -1 && html.indexOf("function radarAll") === -1 && html.indexOf("===LOGIC_START===") === -1);
t("index.html: la logique reste appelée par l'UI", html.indexOf("radarAll(state.data)") !== -1 && html.indexOf("strategyOf(") !== -1);
t("index.html: carte notifications ntfy + Telegram (canal, sujet, token, chat id, test, oubli)",
  html.indexOf('id="notifyChannel"') !== -1 && html.indexOf('id="ntfyTopic"') !== -1 && html.indexOf('id="tgToken"') !== -1 && html.indexOf('id="tgChatId"') !== -1 && html.indexOf('id="btnTgTest"') !== -1 && html.indexOf('id="btnTgForget"') !== -1);
t("index.html: config notification jamais incluse dans l'export (données persos)", html.indexOf("NOTIFY_KEY") !== -1 && html.indexOf("data: state.data, history: state.history, refAlert: state.refAlert, episodes: state.episodes }, null, 2") !== -1);
t("index.html: rétrocompat config Telegram v5.1 lue (NOTIFY_OLD_KEY)", html.indexOf("NOTIFY_OLD_KEY") !== -1);
t("index.html: chip macro séparée + fraîcheur mensuelle", html.indexOf('id="macroChip"') !== -1 && html.indexOf("dateMacro") !== -1 && html.indexOf("macro fraîche") !== -1);
t("index.html: alerte référence échappée (anti-injection)", html.indexOf("esc(String(state.refAlert.from))") !== -1);
t("index.html: seuils affichés en euros", html.indexOf("p.seuil + \" €") !== -1);
t("index.html: import/export passés par la sanitisation", html.indexOf("Auto_sanitizeImport(raw)") !== -1 && html.indexOf("Auto_sanitizeImport(parsed)") !== -1);
t("index.html: alerte référence 52 sem. (id refAlert)", html.indexOf('id="refAlert"') !== -1 && html.indexOf("btnRefOk") !== -1);
t("index.html: carte Évolution des scores par actif", html.indexOf("Évolution des scores par actif") !== -1 && html.indexOf('id="scoresWrap"') !== -1);
t("index.html: carte Épisodes de paliers", html.indexOf("Épisodes de paliers") !== -1 && html.indexOf('id="episodesTable"') !== -1);
t("index.html: épisodes persistés (state.episodes)", html.indexOf("state.episodes") !== -1);
t("index.html: alerte référence persistée (state.refAlert)", html.indexOf("state.refAlert") !== -1);
t("index.html: rendu des instruments (VEHICULES[a.id])", html.indexOf("VEHICULES[a.id]") !== -1);
t("index.html: encodage propre (pas de mojibake Ã)", html.indexOf("Ã") === -1);
t("index.html: VIX lissé utilisé dans le scoring (vixEff, désormais dans logic.js)", srcLogic.indexOf("der.vixEff") !== -1 && srcLogic.indexOf("vixEff") !== -1);
var sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8");
t("sw.js: cache v10", sw.indexOf('CACHE = "radar-v10"') !== -1);
t("sw.js: anciens caches v9/v8/v7/v6/v5/v4/v3 absents", sw.indexOf("radar-v9") === -1 && sw.indexOf("radar-v8") === -1 && sw.indexOf("radar-v7") === -1 && sw.indexOf("radar-v6") === -1 && sw.indexOf("radar-v5") === -1 && sw.indexOf("radar-v4") === -1 && sw.indexOf("radar-v3") === -1);
t("sw.js: logic.js dans le shell", sw.indexOf('"./logic.js"') !== -1);
t("sw.js: vehicles.js dans le shell", sw.indexOf('"./vehicles.js"') !== -1);
t("sw.js: shell en stale-while-revalidate (cache d'abord, réseau en arrière-plan)", sw.indexOf("stale-while-revalidate") !== -1 && sw.indexOf("m || net") !== -1);
t("sw.js: data.json ET data-daily.json en réseau d'abord",
  sw.indexOf('url.pathname.indexOf("data.json")') !== -1 && sw.indexOf('url.pathname.indexOf("data-daily.json")') !== -1);
t("sw.js: auto.js dans le shell", sw.indexOf('"./auto.js"') !== -1);
// auto.js : le câblage ne tourne pas sous Node (guard module.exports)
t("auto.js: pas d'exception à l'import Node", true);
var autosrc = fs.readFileSync(path.join(ROOT, "auto.js"), "utf8");
t("auto.js: en-tête v5.2", autosrc.indexOf("module de mise à jour automatique (v5.2)") !== -1);
t("auto.js: récupère data-daily.json à l'ouverture", autosrc.indexOf('"data-daily.json"') !== -1);
t("auto.js: câble l'épisode et l'alerte référence", autosrc.indexOf("Auto_episodeUpdate(") !== -1 && autosrc.indexOf("Auto_refUnstable(") !== -1);
t("auto.js: garde anti-corruption 50 % msci uniquement (plus de dérive 15 %)",
  autosrc.indexOf("AUTO_DAILY_MAX_JUMP") !== -1 && autosrc.indexOf("AUTO_DAILY_MAX_DRIFT") === -1);
t("auto.js: fetchRemote sans paramètre anti-cache (?v= supprimé)", autosrc.indexOf("?v=") === -1);
t("auto.js: quotidien accepté à même date (>=) avec no-op si rien ne change",
  autosrc.indexOf("Auto_isSameOrNewerDate(daily.dateData, cur.dateData)") !== -1 && autosrc.indexOf("JSON.stringify(ov) !== JSON.stringify(cur)") !== -1);
t("auto.js: recale la référence via Auto_refUpdate (nouvel épisode, paliers réinitialisés)",
  autosrc.indexOf("Auto_refUpdate(cur, daily.data, daily.dateData)") !== -1 &&
  autosrc.indexOf("ru.unstable") !== -1 &&
  autosrc.indexOf("Référence 52 sem. recalée") !== -1);
t("auto.js: notifications ntfy + Telegram branchées (palier à déployer, 1/jour)",
  autosrc.indexOf("notifyPalier") !== -1 && autosrc.indexOf("Auto_palierToDeploy") !== -1 &&
  autosrc.indexOf("NOTIFY_SENT_KEY") !== -1 && autosrc.indexOf("ntfy.sh") !== -1 &&
  autosrc.indexOf("Auto_notifyCfg(raw)") !== -1);
t("auto.js: mini-API notifications exposée à la page (carte Suivi)",
  autosrc.indexOf("window.Auto_tgValid") !== -1 && autosrc.indexOf("window.Auto_sendTelegram") !== -1 &&
  autosrc.indexOf("window.Auto_ntfyValid") !== -1 && autosrc.indexOf("window.Auto_notifyCfg") !== -1 &&
  autosrc.indexOf("window.Auto_sendNtfy") !== -1);

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
var ciWf = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
t("ci.yml: présent et câblé sur push/PR", ciWf.indexOf("on:") !== -1 && ciWf.indexOf("push") !== -1 && ciWf.indexOf("pull_request") !== -1);
t("ci.yml: lance le harnais (0 échec) + la validation des données", ciWf.indexOf("tools/test-auto.js") !== -1 && ciWf.indexOf("tools/validate-data.js") !== -1);

// ---------- v5.4 : conseil d'allocation (adviceOf / allocOf) ----------
t("logic.js: exports adviceOf/allocOf/stanceOf", typeof L.adviceOf === "function" && typeof L.allocOf === "function" && typeof L.stanceOf === "function");
var RAD0 = L.radarAll(L.DEFAULT_DATA);
var ADV0 = L.adviceOf(L.DEFAULT_DATA, RAD0);
t("adviceOf: posture + score pilote 0-100", typeof ADV0.posture === "string" && ADV0.posture.length > 2 && ADV0.postureScore >= 0 && ADV0.postureScore <= 100);
t("adviceOf: 6 stances avec verbes valides et justifications", ADV0.assets.length === 6 && ADV0.assets.every(function (a) { return ["INVESTIR", "CONSERVER", "ATTENDRE", "ALLÉGER"].indexOf(a.verb) >= 0 && a.why.length > 0; }));
t("adviceOf: synthèse non vide, dérivée de la posture", typeof ADV0.synthese === "string" && ADV0.synthese.length > 20);
t("adviceOf: données du jour (CAPE 40, à 1,3 % du sommet) → allègement marginal signalé, CTO/AV uniquement", ADV0.desinv.some(function (x) { return x.indexOf("CTO/AV") !== -1; }));
t("adviceOf: BCE en hausse → poche obligations limitée aux maturités courtes", ADV0.desinv.some(function (x) { return x.indexOf("Obligations") !== -1 && x.indexOf("courtes") !== -1; }));
t("adviceOf: actions très attractives → posture Offensive et verbe INVESTIR", (function () {
  var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
  d.cape = 15; d.vix = 30; d.vix5 = 28; d.bceDir = "baisse"; d.pmiZE = 55; d.msciHigh52 = L.r2(d.msci * 1.2);
  var adv = L.adviceOf(d, L.radarAll(d));
  var a = adv.assets.filter(function (x) { return x.id === "actions"; })[0];
  return adv.posture === "Offensive" && a.verb === "INVESTIR";
})());
t("adviceOf: drawdown ≥ 5 % → on ne vend jamais sur la baisse", (function () {
  var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
  d.msciHigh52 = L.r2(d.msci * 1.12);
  return L.adviceOf(d, L.radarAll(d)).desinv.some(function (x) { return x.indexOf("JAMAIS") !== -1; });
})());
var AL0 = L.allocOf(5000, "une fois", null, L.DEFAULT_DATA, RAD0);
t("allocOf: somme des parts = montant exact au € près", AL0 && AL0.parts.reduce(function (s, p) { return s + p.euros; }, 0) === 5000);
t("allocOf: 6 lignes, pourcentages sommant à ~100", AL0.parts.length === 6 && Math.abs(AL0.parts.reduce(function (s, p) { return s + p.pct; }, 0) - 100) < 0.6);
t("allocOf: DCA 6 mois → mensualité = montant/6 et mois mémorisés", (function () { var a = L.allocOf(9000, "dca", 6, L.DEFAULT_DATA, RAD0); return a && a.mensualite === 1500 && a.months === 6; })());
t("allocOf: entrées invalides → null (0, négatif, texte, mode inconnu, mois 1/25, montant délirant)", L.allocOf(0, "une fois", null, L.DEFAULT_DATA, RAD0) === null && L.allocOf(-5, "une fois", null, L.DEFAULT_DATA, RAD0) === null && L.allocOf("abc", "une fois", null, L.DEFAULT_DATA, RAD0) === null && L.allocOf(1000, "bidon", null, L.DEFAULT_DATA, RAD0) === null && L.allocOf(1000, "dca", 1, L.DEFAULT_DATA, RAD0) === null && L.allocOf(1000, "dca", 25, L.DEFAULT_DATA, RAD0) === null && L.allocOf(100000001, "une fois", null, L.DEFAULT_DATA, RAD0) === null);
t("allocOf: le tilt suit le score (monétaire favorisé → part plus grosse)", (function () {
  var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
  d.bceDepot = 4;
  var mon = L.allocOf(10000, "une fois", null, d, L.radarAll(d)).parts.filter(function (p) { return p.id === "monetaire"; })[0];
  var mon0 = AL0.parts.filter(function (p) { return p.id === "monetaire"; })[0];
  return mon.euros > mon0.euros;
})());
t("allocOf: déterministe (2 appels identiques → même sortie)", (function () { var a = JSON.stringify(L.allocOf(1234, "dca", 3, L.DEFAULT_DATA, RAD0)); var b = JSON.stringify(L.allocOf(1234, "dca", 3, L.DEFAULT_DATA, RAD0)); return a === b; })());
t("allocOf: recommandation ∈ {une fois, hybride, dca} avec label", ["une fois", "hybride", "dca"].indexOf(AL0.recommande) >= 0 && AL0.recommandeLabel.length > 20);
t("allocOf: données du jour (CAPE 40 au contact du sommet) → DCA ou hybride, jamais « une fois »", AL0.recommande !== "une fois");
t("allocOf: actions bon marché + corrigées → « une fois » recommandé", (function () {
  var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
  d.cape = 18; d.vix = 30; d.vix5 = 28; d.bceDir = "baisse"; d.pmiZE = 54; d.msciHigh52 = L.r2(d.msci * 1.15);
  return L.allocOf(10000, "dca", 6, d, L.radarAll(d)).recommande === "une fois";
})());
t("index.html: carte conseil du jour (v5.4) rendue depuis adviceOf", html.indexOf('id="adviceCard"') !== -1 && html.indexOf('id="advicePosture"') !== -1 && html.indexOf("adviceOf(d, radar)") !== -1);
t("index.html: simulateur d'apport complet (montant, mode, mois, bouton, allocOf)", html.indexOf('id="allocMontant"') !== -1 && html.indexOf('id="allocMode"') !== -1 && html.indexOf('id="allocMonths"') !== -1 && html.indexOf('id="btnAlloc"') !== -1 && html.indexOf("allocOf(") !== -1);
t("index.html: méthode d'allocation documentée (transparence)", srcLogic.indexOf("pondération de référence") !== -1);
t("index.html: échappement des textes du conseil (esc sur stance, synthèse, arbitrages)", html.indexOf("esc(a.stance)") !== -1 && html.indexOf("esc(adv.synthese)") !== -1 && html.indexOf("esc(x)") !== -1);

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


// ---------- Régression v5.3 : chaque script servi doit compiler comme script navigateur ----------
// Un `return` au niveau global est légal en CommonJS/Node mais SyntaxError dans un <script>
// classique → page blanche. Le harnais Node (require) ne pouvait pas le voir ; vm.Script si.
var vm = require("vm");
function compilesAsBrowserScript(name, src) {
  try { new vm.Script(src, { filename: name }); return true; }
  catch (e) { console.log("   ⛔ " + name + " : " + e.message); return false; }
}
["logic.js", "auto.js", "vehicles.js"].forEach(function (f) {
  t("browser-compile: " + f + " compile comme script classique (aucun return top-level)",
    compilesAsBrowserScript(f, fs.readFileSync(path.join(ROOT, f), "utf8")));
});
var inlineBlocks = [];
var reInline = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, mInline;
while ((mInline = reInline.exec(html))) inlineBlocks.push(mInline[1]);
t("browser-compile: les " + inlineBlocks.length + " blocs <script> inline d'index.html compilent",
  inlineBlocks.length > 0 && inlineBlocks.every(function (blk, i) { return compilesAsBrowserScript("index.html#inline" + i, blk); }));

// ---------- Bilan ----------
var fail = results.filter(function (r) { return !r.ok; });
results.forEach(function (r) { console.log((r.ok ? "✅" : "❌") + " " + r.name); });
console.log("\n" + (results.length - fail.length) + "/" + results.length + " tests OK");
if (fail.length) { console.log("ÉCHECS :"); fail.forEach(function (r) { console.log("  ❌ " + r.name); }); process.exit(1); }
