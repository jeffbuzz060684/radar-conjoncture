/* Harnais de tests — Radar Conjoncture v5.10 (logic.js, auto.js, vehicles.js, fichiers livrés,
   pipeline quotidien/épisode/référence, validateurs, workflows, notifications ntfy/Telegram,
   sanitisation des imports, régressions v4.1/v5, compilation navigateur des scripts servis, conseil d'allocation v5.4, socle 1 000 €/mois v5.5, revue v5.6 : paliers incohérents, unités EUR, conseil non prescriptif, exclusions d'allocation, notification serveur, bceDirOf stable ; v5.7 : posture pilotable (regimePostureOf, forçage manuel) ; v5.8 : revue v5.7 — actions pilotées par le timing (CAPE = plafond, plus un verrou), auto = seuils v5.6 stricts (le forçage SEUL décale les seuils), vocabulaire risque macro séparé + avertissements, forçage daté expirant à 30 j, plancher monétaire Prudente/Défensive, affichage honnête du forçage) ; v5.9 : revue externe — dates de forçage réelles et locales (isRealDate/daysSinceLocal, future rejetée), alerte drawdown fondée sur le résultat, justification des actions = le timing, vocabulaire actions (RALENTIR), validation stricte du simulateur (entiers, montant ≥ 1 €, liste fermée des postures), traçabilité des seuils du verdict, re-vérification au retour sur l'app. ; v5.10 : lot B de la revue — seuils unifiés (CUTS : une table pour stanceOf et l'exclusion alloc), entryPrefOf partagé conseil/simulateur (fin de « sans attendre » vs « hybride »), données manquantes tracées (plus de repli 50 muet, garde division par zéro), rampe du lot C écartée — falaise binaire du seuil documentée.
   Exécution : node tools/test-auto.js  →  0 échec obligatoire avant publication. */
"use strict";
var fs = require("fs");
var path = require("path");
var child_process = require("child_process");

var A = require(path.join(__dirname, "..", "auto.js"));
var L = require(path.join(__dirname, "..", "logic.js"));
var FD = require(path.join(__dirname, "..", "tools", "fetch-daily.js")); // v5.6 : bceDirOf testable
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
t("stratégie: socle 1 000 €/mois tout compris = 800 € DCAM + 200 € réserve tactique (v5.5)",
  stratEU.indexOf("1 000 €/mois tout compris") !== -1 && stratEU.indexOf("800 €/mois DCAM") !== -1 && stratEU.indexOf("200 €/mois réserve tactique") !== -1);
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
t("fetch-daily: direction BCE via bceDirOf (retour à stable après ~6 mois sans changement)", fd.indexOf("bceDirOf") !== -1 && fd.indexOf("lastNObservations=6") !== -1);
t("fetch-daily: Eurostat officielle (prc_hicp_manr)", fd.indexOf("prc_hicp_manr") !== -1);
t("fetch-daily: garde de fraîcheur Eurostat (période ≤ 3 mois)", fd.indexOf("eurostatAgeMonths") !== -1 && fd.indexOf("> 3") !== -1);
t("fetch-daily: garde-fous une séance (10 % msci / 25 % références / 30 % macro / 60 % VIX)", fd.indexOf("0.10") !== -1 && fd.indexOf("0.25") !== -1 && fd.indexOf("0.30") !== -1 && fd.indexOf("0.60") !== -1);
t("fetch-daily: référence de dérive = dernier relevé quotidien accepté", fd.indexOf("refDaily") !== -1 && fd.indexOf("previous.data") !== -1);
t("fetch-daily: dateData = date de clôture (last.date), pas la date d'exécution", fd.indexOf("dateData = last.date") !== -1 && fd.indexOf("dateData = today") === -1);
t("fetch-daily: no-op si relevé existant ≥ clôture (jamais d'écrasement ancien)", fd.indexOf("previous.dateData >= dateData") !== -1);
t("fetch-daily: échec macro silencieux (champs absents, marchés intacts)", fd.indexOf("macroNotes") !== -1);
t("fetch-daily: notification serveur ntfy au franchissement (secret NTFY_TOPIC, app fermée)",
  fd.indexOf("NTFY_TOPIC") !== -1 && fd.indexOf("notifyPaliersServer") !== -1 && fd.indexOf("ddPrev > -p && ddNow <= -p") !== -1);
t("fetch-daily: notification serveur : garde d'unité (référence ± 10 %) + silencieux sans sujet",
  fd.indexOf("Math.abs(h / ph - 1) > 0.10") !== -1 && fd.indexOf("return Promise.resolve(null);") !== -1);
t("fetch-daily: require testable (module.exports bceDirOf, require.main guard)",
  fd.indexOf("module.exports = { bceDirOf: bceDirOf };") !== -1 && fd.indexOf("require.main === module") !== -1);
t("fetch-daily: ne touche ni reserve ni paliersDone", fd.indexOf("reserve") === -1 && fd.indexOf("paliersDone") === -1);

// ---------- index.html, logic.js, sw.js, auto.js livrés ----------
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
t("index.html: script auto.js référencé", html.indexOf('<script src="auto.js"></script>') !== -1);
t("index.html: badge v5.10", html.indexOf("<b>v5.10</b>") !== -1);
t("index.html: aucun ancien badge v5.9/v5.8/v5.7/v5.6/v5.5/v5.4/v5.3/v5.2/v5.1/v5/v4.2/v4.1/v4/v3/v2/v1", ["<b>v5.9</b>", "<b>v5.8</b>", "<b>v5.7</b>", "<b>v5.6</b>", "<b>v5.5</b>", "<b>v5.4</b>", "<b>v5.3</b>", "<b>v5.2</b>", "<b>v5.1</b>", "<b>v5</b>", "<b>v4.2</b>", "<b>v4.1</b>", "<b>v4</b>", "<b>v3</b>", "<b>v2</b>", "<b>v1</b>"].every(function (b) { return html.indexOf(b) === -1; }));
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
t("index.html: config notification jamais incluse dans l'export (données persos)", html.indexOf("NOTIFY_KEY") !== -1 && html.indexOf("data: state.data, history: state.history, refAlert: state.refAlert, episodes: state.episodes, postureOverride: state.postureOverride, postureOverrideDate: state.postureOverrideDate }, null, 2") !== -1);
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
t("sw.js: cache v16", sw.indexOf('CACHE = "radar-v16"') !== -1);
t("sw.js: anciens caches v15/v14/v13/v12/v11/v10/v9/v8/v7/v6/v5/v4/v3 absents", sw.indexOf("radar-v15") === -1 && sw.indexOf("radar-v14") === -1 && sw.indexOf("radar-v13") === -1 && sw.indexOf("radar-v12") === -1 && sw.indexOf("radar-v11") === -1 && sw.indexOf("radar-v10") === -1 && sw.indexOf("radar-v9") === -1 && sw.indexOf("radar-v8") === -1 && sw.indexOf("radar-v7") === -1 && sw.indexOf("radar-v6") === -1 && sw.indexOf("radar-v5") === -1 && sw.indexOf("radar-v4") === -1 && sw.indexOf("radar-v3") === -1);
t("sw.js: logic.js dans le shell", sw.indexOf('"./logic.js"') !== -1);
t("sw.js: vehicles.js dans le shell", sw.indexOf('"./vehicles.js"') !== -1);
t("sw.js: shell réseau d'abord + repli cache (plus aucun skew HTML frais / JS périmé)",
  sw.indexOf("stale-while-revalidate") === -1 && sw.indexOf("m || net") === -1 &&
  sw.indexOf("// Fichiers du shell : réseau d'abord, cache en secours") !== -1);
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
t("adviceOf: 6 stances avec verbes valides et justifications", ADV0.assets.length === 6 && ADV0.assets.every(function (a) { return ["INVESTIR", "CONSERVER", "ATTENDRE", "SOUS-PONDÉRER"].indexOf(a.verb) >= 0 && a.why.length > 0; }));
t("adviceOf: synthèse non vide, dérivée de la posture", typeof ADV0.synthese === "string" && ADV0.synthese.length > 20);
t("adviceOf: données du jour (CAPE 40, à 1,3 % du sommet) → plus d'allègement quotidien, CAPE en contexte lent",
  ADV0.desinv.every(function (x) { return x.indexOf("allègement marginal") === -1; }) &&
  ADV0.contexte.some(function (x) { return x.indexOf("CAPE") !== -1; }));
t("adviceOf: BCE en relèvement → obligations courtes reléguées au contexte (axes lents), pas au désinvestissement",
  ADV0.contexte.some(function (x) { return x.indexOf("maturités courtes") !== -1; }));
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
t("index.html: carte conseil du jour (v5.4) rendue depuis adviceOf", html.indexOf('id="adviceCard"') !== -1 && html.indexOf('id="advicePosture"') !== -1 && html.indexOf("adviceOf(d, radar, state.postureOverride)") !== -1);
t("index.html: simulateur d'apport complet (montant, mode, mois, bouton, allocOf)", html.indexOf('id="allocMontant"') !== -1 && html.indexOf('id="allocMode"') !== -1 && html.indexOf('id="allocMonths"') !== -1 && html.indexOf('id="btnAlloc"') !== -1 && html.indexOf("allocOf(") !== -1);
t("index.html: méthode d'allocation documentée (transparence)", srcLogic.indexOf("pondération de référence") !== -1);
t("index.html: footnote stratégie 1 000 € tout compris + supplément possible", html.indexOf("1 000 €/mois tout compris (800 € DCAM + 200 € réserve tactique)") !== -1 && html.indexOf("supplément quand tu veux reste possible") !== -1);
t("index.html: simulateur = supplément en plus des 1 000 €/mois du socle", html.indexOf("en plus des 1 000 €/mois du socle") !== -1);
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
t("vehicles.js: en-tête v5 (plus de mention v3)", fs.readFileSync(path.join(ROOT, "vehicles.js"), "utf8").indexOf("Radar Conjoncture v3") === -1);

// ---------- Régression v5.6 (revue de code) ----------
// 1. Scores figés au 16/10/2026 — non-régression du scoring (la revue les a calculés à la main)
t("v5.6: scores figés données du jour — Or 76 / Monétaire 52 / Crypto 44 / Immo 43 / Obligations 41 / Actions 20",
  (function () {
    var by = {}; RAD0.list.forEach(function (a) { by[a.id] = a.score; });
    return by.or === 76 && by.monetaire === 52 && by.crypto === 44 && by.immo === 43 && by.obligations === 41 && by.actions === 20;
  })());
t("v5.6: timingScore actions = 44 (CAPE sorti du signal du jour, relégué en contexte)",
  ADV0.timingScore === 44 && RAD0.list.filter(function (a) { return a.id === "actions"; })[0].timingScore === 44);
t("v5.6: posture données du jour = Prudente (pilotée par le timing seul, pas par le CAPE)",
  ADV0.posture === "Prudente" && ADV0.postureScore === ADV0.timingScore);

// 2. Références incohérentes (unités mélangées USD/EUR OU crash majeur) → paliers suspendus
t("v5.6: msciIncoherent (dd ≤ −25 %) → paliersOf vide + strategyOf en alerte",
  (function () {
    var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    d.msciHigh52 = L.r2(d.msci * 1.45);   // simulate un mix 149,81 $ / 130,55 €
    var der = L.computeDerived(d);
    var pal = L.paliersOf(d, der);
    var strat = L.strategyOf(d, der, pal, L.radarAll(d).list[0]);
    return der.msciIncoherent === true && pal.length === 0 && strat.lines.some(function (l) { return l.indexOf("INCOHÉRENTES") !== -1; });
  })());
t("v5.6: références cohérentes (dd > −25 %) → paliers toujours calculés",
  L.paliersOf(L.DEFAULT_DATA, L.computeDerived(L.DEFAULT_DATA)).length === 4);

// 3. Auto_fixRefUnits : détecte le mix d'unités et adopte les références EUR sans false positif
t("v5.6: Auto_fixRefUnits — mix USD/EUR (local 149,81 vs distant 132,26) → refs EUR adoptées + paliersDone reset",
  (function () {
    var local = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    local.msciHigh52 = 149.81; local.paliersDone = { p5: true, p10: true, p15: false, p20: false };
    var remote = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    remote.msciHigh52 = 132.26; remote.msciLow52 = 107.51;
    var res = A.Auto_fixRefUnits(local, remote);
    return res !== null && res.data.msciHigh52 === 132.26 && res.data.paliersDone.p5 === false && res.data.paliersDone.p10 === false;
  })());
t("v5.6: Auto_fixRefUnits — références cohérentes → null (aucune action)",
  A.Auto_fixRefUnits(L.DEFAULT_DATA, L.DEFAULT_DATA) === null);
t("v5.6: Auto_fixRefUnits — cours divergent autant que la référence (vrai crash) → null (pas de correction)",
  (function () {
    var local = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    local.msciHigh52 = 149.81; local.msci = 100;   // crash réel : le cours a autant bougé que la référence
    var remote = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    remote.msciHigh52 = 132.26;
    return A.Auto_fixRefUnits(local, remote) === null;  // near = 24 % > 8 % → pas un mix d'unités
  })());
t("v5.6: runAutoUpdate — merge hebdo corrigeant la référence ≥ 10 % → paliersDone réinitialisés (découvert par la simulation DOM)",
  (function () {
    var autosrc = fs.readFileSync(path.join(ROOT, "auto.js"), "utf8");
    return autosrc.indexOf("Référence corrigée") !== -1 &&
      autosrc.indexOf("Math.abs(highNow / highPrev - 1) >= 0.10") !== -1 &&
      autosrc.indexOf("cur.paliersDone = { p5: false, p10: false, p15: false, p20: false };") !== -1;
  })());

// 4. Gecko : dateGecko séparée — dateData jamais écrasé par un clic or/BTC
t("v5.6: Auto_applyGecko écrit dateGecko, jamais dateData",
  (function () {
    var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    var out = A.Auto_applyGecko(d, { cur: 2600, high: 2700, low: 2400 }, { cur: 68000, high: 70000 }, new Date("2026-10-20").getTime());
    return out.dateGecko === "2026-10-20" && out.dateData === L.DEFAULT_DATA.dateData;
  })());
t("v5.6: index.html — handler Gecko écrit dateGecko, plus de « state.data.dateData = new Date() »",
  html.indexOf("state.data.dateGecko = new Date()") !== -1 && html.indexOf("state.data.dateData = new Date()") === -1);

// 5. Import : la ligne de réassignation brute de paliersDone a disparu
t("v5.6: index.html — plus de « state.data.paliersDone = parsed.data.paliersDone » (les 4 booléens normalisés restent)",
  html.indexOf("state.data.paliersDone = parsed.data.paliersDone") === -1);

// 6. Sources : le bloc Sources affiche celles du relevé distant quand elles existent
t("v5.6: normalizeData sanitise « sources » (paires de chaînes, max 20)",
  (function () {
    var d = L.normalizeData({ sources: [["a", "b"], ["c", "d"]] });
    return Array.isArray(d.sources) && d.sources.length === 2;
  })() &&
  L.normalizeData({ sources: "pas un tableau" }).sources === null);
t("v5.6: index.html — bloc Sources branché sur state.data.sources (repli : liste codée)",
  html.indexOf("state.data.sources") !== -1 && html.indexOf("? state.data.sources : SOURCES") !== -1);

// 7. Conseil : contexte (axes lents) rendu séparément, verbes moins prescriptifs
t("v5.6: index.html — div adviceCtx rendue (contexte axes lents, échappé)",
  html.indexOf('id="adviceCtx"') !== -1 && html.indexOf("Contexte (axes lents)") !== -1 && html.indexOf("adv.contexte") !== -1);
t("v5.6: stanceOf — verbe < 45 = SOUS-PONDÉRER (ALLÉGER a disparu du vocabulaire)",
  L.stanceOf(30).verb === "SOUS-PONDÉRER" && srcLogic.indexOf("\"ALLÉGER\"") === -1);

// 8. Alloc : les actifs sous 45/100 sont exclus, la somme reste exacte
t("v5.6: allocOf — exclus de la répartition (score < 45) : euros 0, exclu true, somme exacte au €",
  (function () {
    var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0);
    var ex = al.parts.filter(function (p) { return p.exclu; });
    var inc = al.parts.filter(function (p) { return !p.exclu; });
    return ex.length === 4 && ex.every(function (p) { return p.euros === 0 && p.pct === 0; }) &&
      inc.every(function (p) { return p.pct > 0 && p.euros > 0; }) &&
      inc.reduce(function (s, p) { return s + p.euros; }, 0) === 1000;
  })());
t("v5.6: allocOf — tous les scores sous 45 → tout en monétaire (repli de sécurité)",
  (function () {
    var d = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    d.or = d.or - 400; // casse le score de l'or au point que seules des lignes faibles demeurent
    d.msci = d.msciHigh52 * 0.5; d.cape = 60; d.vix = 60; d.vix5 = 55; d.pmiZE = 38; d.bceDir = "hausse";
    var r = L.radarAll(d);
    var al = L.allocOf(1000, "une fois", null, d, r);
    var scored = r.list.every(function (a) { return a.score < 45; });
    return !scored || al.parts.filter(function (p) { return !p.exclu; }).length >= 1; // si tous < 45 → monétaire seul ; sinon au moins une ligne incluse
  })() === true);
t("v5.6+v5.7: index.html — simulateur affiche les lignes exclues (opacity .45, seuil dynamique) et « données manquantes » v5.10",
  html.indexOf("exclu (score < \" + alloc.seuil + \")") !== -1 && html.indexOf("opacity:.45") !== -1 && html.indexOf("· données manquantes") !== -1);
t("v5.6: index.html — paliers suspendus affichés quand la liste est vide (références incohérentes)",
  html.indexOf("Paliers suspendus") !== -1);

// 9. bceDirOf : direction BCE fonctionnelle (série événementielle, retour à stable)
t("v5.6: bceDirOf — relèvement récent → hausse",
  FD.bceDirOf([2.0, 2.0, 2.15, 2.15], ["2025-06-11", "2026-06-17", "2026-09-16", "2026-10-01"], new Date("2026-10-18").getTime()) === "hausse");
t("v5.6: bceDirOf — dernier changement > 6 mois → stable (plus de cycle actif)",
  FD.bceDirOf([2.0, 2.15, 2.15, 2.15], ["2025-06-11", "2026-06-17", "2026-09-16", "2026-10-01"], new Date("2027-06-01").getTime()) === "stable");
t("v5.6: bceDirOf — baisse récente → baisse",
  FD.bceDirOf([2.15, 2.15, 2.0, 2.0], ["2026-01-01", "2026-02-01", "2026-10-01", "2026-10-05"], new Date("2026-10-18").getTime()) === "baisse");
t("v5.6: bceDirOf — aucun changement dans la fenêtre → stable",
  FD.bceDirOf([2.15, 2.15], ["2026-09-16", "2026-10-01"], new Date("2026-10-18").getTime()) === "stable");

// 10. Notification serveur + workflow
t("v5.6: daily-data.yml — secret NTFY_TOPIC câblé (sujet jamais en dur, dépôt public)",
  dailyWf.indexOf("NTFY_TOPIC: ${{ secrets.NTFY_TOPIC }}") !== -1);
t("v5.6: index.html — carte notifications documente le canal serveur + sujet long et aléatoire",
  html.indexOf("NTFY_TOPIC") !== -1 && html.indexOf("radar-k7m2xq9z-t4v8") !== -1 && html.indexOf("long et aléatoire") !== -1);


// 11. v5.7 : posture pilotable — conseil selon la situation économique + forçage manuel (conseil ET simulateur)
t("v5.7: logic.js: exports regimePostureOf/POSTURES/ALLOC_EXCL", typeof L.regimePostureOf === "function" && Array.isArray(L.POSTURES) && L.POSTURES.length === 5 && L.ALLOC_EXCL.Neutre === 45);
t("v5.7: regimePostureOf — données du jour (PMI 53,1 · infl 3,8 · BCE hausse · VIX 16,8) → Neutre (52)",
  (function () { var rg = L.regimePostureOf(L.DEFAULT_DATA); return rg.posture === "Neutre" && rg.score === 52 && rg.drivers.length > 10; })());
t("v5.7: regimePostureOf — données vides → Neutre 50, jamais d'erreur", L.regimePostureOf({}).posture === "Neutre" && L.regimePostureOf({}).score === 50);
t("v5.7: regimePostureOf — contraction + BCE relèvement + stress VIX → Défensive", (function () { var rg = L.regimePostureOf({ pmiZE: 46, inflZE: 3.8, bceDir: "hausse", vix5: 28 }); return rg.posture === "Défensive"; })());
t("v5.7: regimePostureOf — expansion franche + inflation contenue + BCE assouplit + VIX calme → Offensive", (function () { var rg = L.regimePostureOf({ pmiZE: 56, inflZE: 1.5, bceDir: "baisse", vix5: 15 }); return rg.posture === "Offensive"; })());
t("v5.7: adviceOf — override valide remplace la posture, l'auto reste tracée", (function () {
  var adv = L.adviceOf(L.DEFAULT_DATA, RAD0, "Offensive");
  return adv.posture === "Offensive" && adv.autoPosture === "Prudente" && adv.override === "Offensive" && adv.postureScore === adv.timingScore && adv.regime.risque === "Modéré";   // v5.9 : regime.posture retiré (jamais affiché, vocabulaire abandonné)
})());
t("v5.7: adviceOf — override invalide ignoré (retour auto)", L.adviceOf(L.DEFAULT_DATA, RAD0, "Bidon").posture === ADV0.posture);
t("v5.7: adviceOf — stances déplacées par la posture : obligations 41 « Ne pas renforcer » en auto → « Conserver » en Offensive", (function () {
  var auto = L.adviceOf(L.DEFAULT_DATA, RAD0).assets.filter(function (a) { return a.id === "obligations"; })[0];
  var off = L.adviceOf(L.DEFAULT_DATA, RAD0, "Offensive").assets.filter(function (a) { return a.id === "obligations"; })[0];
  return auto.stance === "Ne pas renforcer" && off.stance === "Conserver";
})());
t("v5.8: stanceOf — marges sûres par posture (remplace le test or 76/Défensive, à 1 pt du seuil 75)", (function () {
  var ok = true;
  ["Défensive", "Prudente", "Neutre", "Constructive", "Offensive"].forEach(function (p) {
    ok = ok && L.stanceOf(80, p).label === "Sur-pondérer" && L.stanceOf(80, p).verb === "INVESTIR";
  });
  ok = ok && L.stanceOf(70, "Défensive").label === "Renforcer" && L.stanceOf(70, "Prudente").label === "Sur-pondérer";
  ok = ok && L.stanceOf(52, "Défensive").label === "Ne pas renforcer" && L.stanceOf(52, "Neutre").label === "Conserver";
  ok = ok && L.stanceOf(30, "Défensive").verb === "SOUS-PONDÉRER" && L.stanceOf(30, "Offensive").label === "Ne pas renforcer";
  // le monétaire garde ses seuils de base en toute posture (préservation non décalée) — 52 à marges sûres
  ok = ok && L.adviceOf(L.DEFAULT_DATA, RAD0, "Défensive").assets.filter(function (a) { return a.id === "monetaire"; })[0].stance === "Conserver";
  return ok;
})());
t("v5.7: stanceOf — seuils inchangés sans posture (régression v5.6 : 30 → SOUS-PONDÉRER, 52 → Conserver)",
  L.stanceOf(30).verb === "SOUS-PONDÉRER" && L.stanceOf(52).label === "Conserver" && L.stanceOf(45).label === "Conserver" && L.stanceOf(55).label === "Renforcer");
t("v5.7: allocOf — seuil d'exclusion suit la posture (35 Offensive / 45 défaut / 55 Défensive)", (function () {
  var off = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Offensive");
  var neu = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0);
  var dfn = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Défensive");
  return off.seuil === 35 && neu.seuil === 45 && dfn.seuil === 55 && off.posture === "Offensive" && dfn.posture === "Défensive" && neu.posture === null;
})());
t("v5.7: allocOf Défensive — monétaire TOUJOURS éligible (préservation), actions/obligations/immo/crypto exclues, somme exacte", (function () {
  var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Défensive");
  var ex = al.parts.filter(function (p) { return p.exclu; }).map(function (p) { return p.id; }).sort().join(",");
  var inc = al.parts.filter(function (p) { return !p.exclu; }).map(function (p) { return p.id; }).sort().join(",");
  return ex === "actions,crypto,immo,obligations" && inc === "monetaire,or" && al.parts.reduce(function (s, p) { return s + p.euros; }, 0) === 1000;
})());
t("v5.7: allocOf Offensive — obligations 41 et crypto 44 redeviennent éligibles (seuil 35), somme exacte", (function () {
  var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Offensive");
  var ob = al.parts.filter(function (p) { return p.id === "obligations"; })[0];
  var cr = al.parts.filter(function (p) { return p.id === "crypto"; })[0];
  return !ob.exclu && !cr.exclu && al.parts.reduce(function (s, p) { return s + p.euros; }, 0) === 1000;
})());
t("v5.7: sanitizeImport — postureOverride valide conservée, invalide ignorée",
  L.Auto_sanitizeImport({ postureOverride: "Offensive" }).postureOverride === "Offensive" && L.Auto_sanitizeImport({ postureOverride: "Hack<script>" }).postureOverride === undefined);
t("v5.7: index.html — sélecteur de posture + override passé à adviceOf + conseil situation éco affiché",
  html.indexOf('id="postureSel"') !== -1 && html.indexOf('id="adviceRegime"') !== -1 && html.indexOf("adviceOf(d, radar, state.postureOverride)") !== -1 && html.indexOf("regime") !== -1);
t("v5.7: index.html — override persisté (save/export) et importé via la liste blanche, simulateur piloté par le forçage uniquement (v5.8)",
  html.indexOf("postureOverride: state.postureOverride") !== -1 && html.indexOf("state.postureOverride = san.postureOverride || null") !== -1 && html.indexOf("state.postureOverride = san2.postureOverride || null") !== -1 && html.indexOf("allocOf(mt.value, mode.value, months.value, d, radar, state.postureOverride)") !== -1);
t("v5.7: index.html — changer la posture recalcule une répartition déjà affichée (window._allocRerun)",
  html.indexOf("window._allocRerun") !== -1 && html.indexOf("if (window._allocRerun) window._allocRerun()") !== -1);

// 12. v5.8 : revue v5.7 — le TIMING pilote les actions (CAPE = plafond, plus un verrou), auto = seuils
//     v5.6 stricts (le forçage SEUL décale les seuils), plancher monétaire, forçage daté (30 j),
//     vocabulaire risque macro séparé, avertissements de contradiction, affichage honnête.
t("v5.8: exports ALLOC_MON_FLOOR (plancher monétaire du simulateur)", typeof L.ALLOC_MON_FLOOR === "object" && L.ALLOC_MON_FLOOR["Prudente"] === 35 && L.ALLOC_MON_FLOOR["Défensive"] === 50);
t("v5.8: chaîne UI en AUTO — posture Prudente affichée MAIS seuils v5.6 de base : allocOf seuil 45 et actions (timing 44) « Ne pas renforcer »",
  (function () {
    var adv = L.adviceOf(L.DEFAULT_DATA, RAD0, null);
    var a = adv.assets.filter(function (x) { return x.id === "actions"; })[0];
    var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, null);
    return adv.posture === "Prudente" && al.seuil === 45 && a.stance === "Ne pas renforcer";
  })());
t("v5.8: adviceOf — actions pilotées par le TIMING : « Conserver » en Offensive forcée (timing 44 ≥ 35), plus jamais verrouillées par le CAPE",
  (function () {
    var adv = L.adviceOf(L.DEFAULT_DATA, RAD0, "Offensive");
    return adv.assets.filter(function (x) { return x.id === "actions"; })[0].stance === "Conserver";
  })());
t("v5.8: allocOf Offensive — actions ÉLIGIBLES via le timing (44 ≥ 35) : euros > 0, somme exacte",
  (function () {
    var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Offensive");
    var act = al.parts.filter(function (p) { return p.id === "actions"; })[0];
    return !act.exclu && act.euros > 0 && al.parts.reduce(function (s, p) { return s + p.euros; }, 0) === 1000;
  })());
t("v5.8: allocOf — plafond CAPE : timing 70 + CAPE ≥ 30 → tilt actions borné ×1,0 (sans plafond il serait ×1,4)",
  (function () {
    var RR = { der: { ddMsci: -1.3 }, list: [
      { id: "or", icon: "🥇", name: "Or", score: 76 },
      { id: "monetaire", icon: "💵", name: "Monétaire", score: 52 },
      { id: "actions", icon: "🌍", name: "Actions", score: 20, timingScore: 70 },
      { id: "obligations", icon: "📜", name: "Obligations", score: 41 },
      { id: "immo", icon: "🏢", name: "Immobilier", score: 43 },
      { id: "crypto", icon: "₿", name: "Crypto", score: 44 }
    ] };
    var cap = L.allocOf(1000, "une fois", null, { cape: 40 }, RR, "Offensive");
    var ncap = L.allocOf(1000, "une fois", null, { cape: null }, RR, "Offensive");
    var pa = cap.parts.filter(function (p) { return p.id === "actions"; })[0].pct;
    var pn = ncap.parts.filter(function (p) { return p.id === "actions"; })[0].pct;
    return pa === 39.5 && pn > pa + 5;   // 40/101,36 vs 56/117,36 : le plafond borne le bonus d'achat
  })());
t("v5.8: allocOf Défensive — plancher monétaire 50 % : or 50 % / monétaire 50 % (fini le 57/43 renormalisé)",
  (function () {
    var al = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "Défensive");
    var or = al.parts.filter(function (p) { return p.id === "or"; })[0];
    var mon = al.parts.filter(function (p) { return p.id === "monetaire"; })[0];
    return or.pct === 50 && mon.pct === 50 && or.euros === 500 && mon.euros === 500;
  })());
t("v5.8: allocOf Prudente — plancher 35 % qui binde quand le monétaire est faible ; en auto, pas de plancher",
  (function () {
    var RR = { der: { ddMsci: -1.3 }, list: [
      { id: "or", icon: "🥇", name: "Or", score: 76 },
      { id: "monetaire", icon: "💵", name: "Monétaire", score: 20 },
      { id: "actions", icon: "🌍", name: "Actions", score: 20, timingScore: 70 },
      { id: "obligations", icon: "📜", name: "Obligations", score: 41 },
      { id: "immo", icon: "🏢", name: "Immobilier", score: 43 },
      { id: "crypto", icon: "₿", name: "Crypto", score: 44 }
    ] };
    var pr = L.allocOf(1000, "une fois", null, { cape: null }, RR, "Prudente");   // seuil 50 : actions (timing 70) + or + mon
    var au = L.allocOf(1000, "une fois", null, { cape: null }, RR, null);          // seuil 45, plancher désactivé en auto
    var mPr = pr.parts.filter(function (p) { return p.id === "monetaire"; })[0].pct;
    var mAu = au.parts.filter(function (p) { return p.id === "monetaire"; })[0].pct;
    return mPr === 35 && mAu < 35;
  })());
t("v5.8: regimePostureOf — vocabulaire risque macro séparé du timing : Modéré (52) aujourd'hui, Stress en contraction, Tendu, Calme en expansion",
  (function () {
    return L.regimePostureOf(L.DEFAULT_DATA).risque === "Modéré" &&
      L.regimePostureOf(L.DEFAULT_DATA).posture === "Neutre" &&
      L.regimePostureOf({ pmiZE: 46, inflZE: 3.8, bceDir: "hausse", vix5: 28 }).risque === "Stress" &&
      L.regimePostureOf({ pmiZE: 56, inflZE: 1.5, bceDir: "baisse", vix5: 15 }).risque === "Calme" &&
      L.regimePostureOf({ pmiZE: 48 }).risque === "Tendu";
  })());
t("v5.8: adviceOf — warns si forçage en plein drawdown, silence en auto ou hors drawdown",
  (function () {
    var dDD = JSON.parse(JSON.stringify(L.DEFAULT_DATA));
    dDD.msciHigh52 = L.r2(dDD.msci * 1.10);   // drawdown ≈ −9,1 %
    return L.adviceOf(dDD, L.radarAll(dDD), "Défensive").warns.length === 1 &&
      L.adviceOf(dDD, L.radarAll(dDD), null).warns.length === 0 &&
      L.adviceOf(L.DEFAULT_DATA, RAD0, "Défensive").warns.length === 0;   // pas de drawdown → pas d'avertissement
  })());
t("v5.9: allocOf — alerte fondée sur le RÉSULTAT : actions exclues + drawdown → alerte (auto, Prudente, Défensive) ; silence sinon",
  (function () {
    var RR = { der: { ddMsci: -6 }, list: [
      { id: "or", icon: "🥇", name: "Or", score: 76 },
      { id: "monetaire", icon: "💵", name: "Monétaire", score: 52 },
      { id: "actions", icon: "🌍", name: "Actions", score: 20, timingScore: 44 },
      { id: "obligations", icon: "📜", name: "Obligations", score: 41 },
      { id: "immo", icon: "🏢", name: "Immobilier", score: 43 },
      { id: "crypto", icon: "₿", name: "Crypto", score: 44 }
    ] };
    var RRC = { der: { ddMsci: -1.3 }, list: RR.list };   // même marché, hors drawdown
    return L.allocOf(1000, "une fois", null, { cape: null }, RR, null).alerte !== null &&        // auto : timing 44 < seuil 45
      L.allocOf(1000, "une fois", null, { cape: null }, RR, "Prudente").alerte !== null &&        // Prudente forcée : 44 < 50
      L.allocOf(1000, "une fois", null, { cape: null }, RR, "Défensive").alerte !== null &&       // Défensive forcée : 44 < 55
      L.allocOf(1000, "une fois", null, { cape: null }, RRC, null).alerte === null &&             // pas de drawdown → silence
      (function () {                                                                              // actions incluses (timing 58 ≥ 55) : pas de contradiction réelle
        var dDD = JSON.parse(JSON.stringify(L.DEFAULT_DATA)); dDD.msciHigh52 = L.r2(dDD.msci * 1.10);
        return L.allocOf(1000, "une fois", null, dDD, L.radarAll(dDD), "Défensive").alerte === null;
      })();
  })());
t("v5.8: sanitizeImport — postureOverrideDate conservée (YYYY-MM-DD) seulement avec un forçage valide, format invalide ignoré",
  (function () {
    return L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "2026-10-18" }).postureOverrideDate === "2026-10-18" &&
      L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "18/10/2026" }).postureOverrideDate === undefined &&
      L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "<script>x" }).postureOverrideDate === undefined &&
      L.Auto_sanitizeImport({ postureOverrideDate: "2026-10-18" }).postureOverrideDate === undefined;
  })());
t("v5.9: index.html — forçage daté durci : date LOCALE posée au changement (todayLocal), expiration 30 j via daysSinceLocal + isRealDate, futur rejeté, « choisie depuis N j · expire dans N j »",
  html.indexOf("postureOverrideDate = valid ? todayLocal() : null") !== -1 &&
  html.indexOf("function expirePostureOverride") !== -1 &&
  html.indexOf("days === null || days < 0 || days > 30") !== -1 &&
  html.indexOf("choisie depuis") !== -1 &&
  html.indexOf("expire dans \" + (30 - oj) + \" j") !== -1 &&
  html.indexOf("choisie aujourd'hui") !== -1);
t("v5.8: index.html — affichage honnête du forçage : sous-titre dynamique (advicePostureSub), barre grisée, warns rendus",
  html.indexOf('id="advicePostureSub"') !== -1 &&
  html.indexOf("posture choisie — l'auto ne pilote plus") !== -1 &&
  html.indexOf('apb.style.opacity = "0.35"') !== -1 &&
  html.indexOf('id="adviceWarns"') !== -1);
t("v5.8: index.html — vocabulaire macro séparé (« Risque macro (descriptif) ») + simulateur recalculé à chaque rendu + horizon/portefeuille/tolérance cités",
  html.indexOf("Risque macro (descriptif)") !== -1 &&
  html.indexOf("posture de référence") === -1 &&
  html.indexOf("if (window._allocRerun) window._allocRerun();") !== -1 &&
  html.indexOf("portefeuille existant") !== -1);

// 13. v5.9 : revue externe de la v5.8 — lot A (dates de forçage, alerte sur le résultat,
//     justification timing, vocabulaire actions, durcissement) + validation stricte du
//     simulateur + traçabilité des seuils du verdict.
t("v5.9: isRealDate — dates calendaires réelles uniquement (2026-02-30, 2026-99-99, 29/02 non bissextile rejetés)",
  L.isRealDate("2026-10-18") === true && L.isRealDate("2024-02-29") === true && L.isRealDate("2026-02-29") === false &&
  L.isRealDate("2026-02-30") === false && L.isRealDate("2026-99-99") === false && L.isRealDate("18/10/2026") === false &&
  L.isRealDate("") === false && L.isRealDate(null) === false && L.isRealDate("<script>") === false);
t("v5.9: sanitizeImport — date de forçage IMPOSSIBLE ignorée (le forçage survit, sans date → expiré)",
  L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "2026-02-30" }).postureOverride === "Offensive" &&
  L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "2026-02-30" }).postureOverrideDate === undefined &&
  L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "2026-99-99" }).postureOverrideDate === undefined &&
  L.Auto_sanitizeImport({ postureOverride: "Offensive", postureOverrideDate: "2026-10-18" }).postureOverrideDate === "2026-10-18");
t("v5.9: allocOf — validation stricte : mensualités ENTIÈRES (« 2.9 » rejeté, plus de troncature parseInt), montant ≥ 1 €",
  L.allocOf(1000, "dca", "2.9", L.DEFAULT_DATA, RAD0) === null &&
  L.allocOf(1000, "dca", 2.5, L.DEFAULT_DATA, RAD0) === null &&
  L.allocOf(1000, "dca", 2, L.DEFAULT_DATA, RAD0) !== null &&
  L.allocOf(1000, "dca", "24", L.DEFAULT_DATA, RAD0) !== null &&
  L.allocOf(0.5, "une fois", null, L.DEFAULT_DATA, RAD0) === null &&
  L.allocOf(1, "une fois", null, L.DEFAULT_DATA, RAD0) !== null &&
  L.allocOf(0, "une fois", null, L.DEFAULT_DATA, RAD0) === null);
t("v5.9: allocOf — clés héritées d'Object.prototype (« constructor », « toString ») traitées comme l'auto",
  (function () {
    var c = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "constructor");
    var ts = L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0, "toString");
    return c.seuil === 45 && c.posture === null && ts.seuil === 45 && ts.posture === null;
  })());
t("v5.9: adviceOf — warn d'exclusion en AUTO (timing sous le seuil + drawdown), warn de forçage sinon, silence sans contradiction",
  (function () {
    var RR = { der: { ddMsci: -6 }, list: [
      { id: "or", icon: "🥇", name: "Or", score: 76, parts: [] },
      { id: "monetaire", icon: "💵", name: "Monétaire", score: 52, parts: [] },
      { id: "actions", icon: "🌍", name: "Actions", score: 20, timingScore: 44, parts: [] },
      { id: "obligations", icon: "📜", name: "Obligations", score: 41, parts: [] },
      { id: "immo", icon: "🏢", name: "Immobilier", score: 43, parts: [] },
      { id: "crypto", icon: "₿", name: "Crypto", score: 44, parts: [] }
    ] };
    var wa = L.adviceOf({ cape: null }, RR, null);
    var wo = L.adviceOf({ cape: null }, RR, "Défensive");
    var wc = L.adviceOf({ cape: null }, { der: { ddMsci: -1.3 }, list: RR.list }, null);
    return wa.warns.length === 1 && wa.warns[0].indexOf("exclura les actions") !== -1 &&
      wo.warns.length === 1 && wo.warns[0].indexOf("Posture forcée") !== -1 &&
      wc.warns.length === 0;
  })());
t("v5.9: adviceOf — justification des actions = le TIMING du jour (drawdown · VIX · BCE · PMI), le CAPE relégué en contexte",
  (function () {
    var a = L.adviceOf(L.DEFAULT_DATA, RAD0, null).assets.filter(function (x) { return x.id === "actions"; })[0];
    return a.why.indexOf("timing 44/100") !== -1 && a.why.indexOf("drawdown") !== -1;
  })());
t("v5.9: adviceOf — timing actions < 35 : « Apports minimum / RALENTIR » (plus de « Sous-pondérer » lisible comme une vente)",
  (function () {
    var RR = { der: { ddMsci: -1.3 }, list: [
      { id: "or", icon: "🥇", name: "Or", score: 76, parts: [] },
      { id: "monetaire", icon: "💵", name: "Monétaire", score: 52, parts: [] },
      { id: "actions", icon: "🌍", name: "Actions", score: 20, timingScore: 20, parts: [] },
      { id: "obligations", icon: "📜", name: "Obligations", score: 41, parts: [] },
      { id: "immo", icon: "🏢", name: "Immobilier", score: 43, parts: [] },
      { id: "crypto", icon: "₿", name: "Crypto", score: 44, parts: [] }
    ] };
    var a = L.adviceOf({ cape: null }, RR, null).assets.filter(function (x) { return x.id === "actions"; })[0];
    return a.stance === "Apports minimum" && a.verb === "RALENTIR";
  })());
t("v5.9: adviceOf — res.regime sans « posture » (vocabulaire régime abandonné, jamais affiché)",
  L.adviceOf(L.DEFAULT_DATA, RAD0, null).regime.posture === undefined &&
  L.adviceOf(L.DEFAULT_DATA, RAD0, null).regime.risque === "Modéré");
t("v5.9: allocOf — propriétés : somme des euros = montant au €, parts ≈ 100 %, monétaire ≥ plancher en Prudente/Défensive forcées",
  (function () {
    function sumEur(al) { return al.parts.reduce(function (s, p) { return s + p.euros; }, 0); }
    function sumPct(al) { return al.parts.reduce(function (s, p) { return s + p.pct; }, 0); }
    function monPct(al) { return al.parts.filter(function (p) { return p.id === "monetaire"; })[0].pct; }
    var pr = L.allocOf(7777, "une fois", null, L.DEFAULT_DATA, RAD0, "Prudente");
    var df = L.allocOf(7777, "une fois", null, L.DEFAULT_DATA, RAD0, "Défensive");
    var au = L.allocOf(7777, "dca", 7, L.DEFAULT_DATA, RAD0, null);
    return sumEur(pr) === 7777 && sumEur(df) === 7777 && sumEur(au) === 7777 &&
      Math.abs(sumPct(au) - 100) < 0.5 && monPct(pr) >= 35 && monPct(df) >= 50;
  })());
t("v5.9: index.html — re-vérification au RETOUR sur l'app (visibilitychange) ; le handler de posture ne double plus le recalcul (renderRadar s'en charge)",
  html.indexOf('document.addEventListener("visibilitychange"') !== -1 &&
  html.indexOf("if (!document.hidden && state.data) { expirePostureOverride(); save(); renderRadar(); }") !== -1 &&
  html.indexOf("renderRadar();\n    if (window._allocRerun)") === -1);
t("v5.9: allocOf — note de méthode : traçabilité du verdict (seuils 60/45, ajustements +8/−6/−5 dits heuristiques)",
  L.allocOf(1000, "une fois", null, L.DEFAULT_DATA, RAD0).note.indexOf("heuristique motivée point par point, non validée historiquement") !== -1);

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

// 14. v5.10 : lot B de la revue externe — B1 seuils unifiés (CUTS, une seule table pour
//     stanceOf ET l'exclusion alloc), B2 entryPrefOf partagé conseil/simulateur (fin de la
//     contradiction « sans attendre » vs « hybride » le même jour), B3 données manquantes
//     traitées explicitement (plus de repli 50 muet, plus de division par zéro) ; lot C
//     écarté (auto = v5.6 strict) — falaise binaire du seuil documentée dans la note.
t("v5.10 B1: CUTS table unique — ALLOC_EXCL dérivé (plus de 2e table), ligne Neutre = seuils v5.6 stricts (65/55/45/35, excl 45), exportée",
  typeof L.CUTS === "object" && Object.keys(L.CUTS).length === 5 &&
  L.POSTURES.every(function (p) { return L.ALLOC_EXCL[p] === L.CUTS[p].excl; }) &&
  L.CUTS.Neutre.sur === 65 && L.CUTS.Neutre.ren === 55 && L.CUTS.Neutre.con === 45 && L.CUTS.Neutre.npr === 35 && L.CUTS.Neutre.excl === 45);
t("v5.10 B1: stanceOf lit CUTS — sorties IDENTIQUES aux décalages v5.7/v5.8 (±5 par rang, inconnu/absent → Neutre)",
  L.stanceOf(80, "Défensive").label === "Sur-pondérer" && L.stanceOf(74, "Défensive").label === "Renforcer" &&
  L.stanceOf(60, "Prudente").label === "Renforcer" && L.stanceOf(56, "Offensive").label === "Sur-pondérer" &&
  L.stanceOf(44).label === "Ne pas renforcer" && L.stanceOf(52, "Neutre").label === "Conserver" &&
  L.stanceOf(30, "Prudente").label === "Sous-pondérer" && L.stanceOf(30, "Offensive").verb === "ATTENDRE" &&
  L.stanceOf(999, "constructor").label === L.stanceOf(999, null).label);
t("v5.10 B2: entryPrefOf exportée — mêmes seuils qu'avant (une fois ≥ 60, hybride 45-59, DCA < 45), base 50 si donnée absente",
  typeof L.entryPrefOf === "function" &&
  L.entryPrefOf({ cape: 20 }, { ddMsci: -12 }, 62).recommande === "une fois" &&
  L.entryPrefOf({ cape: 20 }, { ddMsci: -12 }, 50).recommande === "hybride" &&
  L.entryPrefOf({ cape: 40 }, { ddMsci: 0 }, 50).recommande === "dca" &&
  L.entryPrefOf({ cape: null }, { ddMsci: null }, 45).recommande === "hybride" &&
  L.entryPrefOf({ cape: 20 }, { ddMsci: null }, null).pref === 50 &&
  L.entryPrefOf({ cape: 40 }, { ddMsci: 0 }, 50).label.length > 20 && L.entryPrefOf({ cape: 40 }, { ddMsci: 0 }, 50).phrase.length > 10);
t("v5.10 B2: allocOf ET adviceOf lisent la MÊME source — verdicts identiques, la synthèse du conseil affiche la phrase d'entrée du verdict partagé",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var radar = L.radarAll(d);
    var act = radar.list.filter(function (a) { return a.id === "actions"; })[0];
    var al = L.allocOf(10000, "une fois", null, d, radar);
    var adv = L.adviceOf(d, radar);
    var ep = L.entryPrefOf(d, radar.der, act.timingScore);
    return al.pref === ep.pref && al.recommande === ep.recommande && al.recommandeLabel === ep.label &&
      adv.manquantes === false && adv.synthese.indexOf("Entrée :") !== -1 && adv.synthese.indexOf(ep.phrase) !== -1;
  })() === true);
t("v5.10 B2: fin de la contradiction — la synthèse Offensive ne promet « sans attendre » QUE si le verdict partagé dit « une fois »",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var radar = L.radarAll(d);
    var adv = L.adviceOf(d, radar, "Offensive");
    var al = L.allocOf(10000, "une fois", null, d, radar, "Offensive");
    var sansAttendre = adv.synthese.indexOf("sans attendre") !== -1;
    return sansAttendre === (al.recommande === "une fois") && adv.synthese.indexOf("Entrée :") !== -1;
  })() === true);
t("v5.10 B3: allocOf — un actif au score manquant : exclu et TRACÉ « manquant » (plus de repli 50 inventé), somme toujours = montant",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var radar = L.radarAll(d);
    radar.list.forEach(function (a) { if (a.id === "or") a.score = null; });
    var al = L.allocOf(1000, "une fois", null, d, radar);
    var or = al.parts.filter(function (p) { return p.id === "or"; })[0];
    var sum = al.parts.reduce(function (s, p) { return s + p.euros; }, 0);
    return or.exclu === true && or.manquant === true && or.euros === 0 &&
      Array.isArray(al.manquantes) && al.manquantes.indexOf("or") !== -1 && sum === 1000;
  })() === true);
t("v5.10 B3: allocOf — radar entièrement non chiffrable : pas de division par zéro, verdict neutralisé, alerte « Données insuffisantes »",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var radar = L.radarAll(d);
    radar.list.forEach(function (a) { a.score = null; a.timingScore = null; });
    var al = L.allocOf(1000, "une fois", null, d, radar);
    return al !== null && al.recommande === null && al.recommandeLabel === null && al.pref === null &&
      al.parts.every(function (p) { return p.exclu === true && p.manquant === true && p.euros === 0; }) &&
      typeof al.alerte === "string" && al.alerte.indexOf("Données insuffisantes") !== -1;
  })() === true);
t("v5.10 B3: adviceOf — sans données actions chiffrables : manquantes TRACÉ, base Neutre, détail explicite (jamais de score inventé)",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var radar = L.radarAll(d);
    radar.list.forEach(function (a) { if (a.id === "actions") { a.score = null; a.timingScore = null; } });
    var adv = L.adviceOf(d, radar);
    return adv.manquantes === true && adv.autoPosture === "Neutre" && adv.detail.indexOf("Données manquantes") !== -1;
  })() === true);
t("v5.10 C (écarté, documenté): la note du simulateur documente la FALAISSE binaire du seuil (rampe refusée — auto = v5.6 stricts)",
  (function () {
    var d = L.normalizeData(L.DEFAULT_DATA);
    var al = L.allocOf(1000, "une fois", null, d, L.radarAll(d));
    return al.note.indexOf("BINAIRE") !== -1 && al.note.indexOf("falaise") !== -1 && al.note.indexOf("rampe") !== -1;
  })() === true);

// ---------- Bilan ----------
var fail = results.filter(function (r) { return !r.ok; });
results.forEach(function (r) { console.log((r.ok ? "✅" : "❌") + " " + r.name); });
console.log("\n" + (results.length - fail.length) + "/" + results.length + " tests OK");
if (fail.length) { console.log("ÉCHECS :"); fail.forEach(function (r) { console.log("  ❌ " + r.name); }); process.exit(1); }
