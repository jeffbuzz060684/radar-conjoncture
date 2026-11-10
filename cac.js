// Radar Conjoncture — v7.8 : moteur du classement 🇫🇷 CAC 40 (onglet fusion Sentinelle perso).
// v7.8 (revue du 10/11/2026) : correctifs techniques UNIQUEMENT (isNum strict, vBase, pos52Of
// lo>0, upX tp>0, âge macro en jours calendaires, pipeline anti-null, départage des ex æquo)
// — méthode et pondérations INCHANGÉES.
// Porté À L'IDENTIQUE de Sentinelle perso logic.js v4.1.0 (revu champ par champ) : les briques
// de scoring déjà validées par les revues de Jade (v4.0.5-v4.0.12) ne se réécrivent pas.
// Le classement d'achat compose : qualité 40 % (ROE/marge/croissance/dette, par secteur) +
// valorisation 25 % (PER/rendement/P/B vs pairs) + consensus 35 % (percentile du potentiel
// vs objectif moyen — entré dans le score à la demande expresse de Jade pour CE classement).
// Les percentiles sont calculés sur TOUT le SBF coté (base stable, plus de pairs = rang plus
// stable), le filtre cac40 vient APRÈS : le périmètre suit la composition automatiquement.
// Composantes manquantes → poids RENORMALISÉS (base affichée) ; ≥ 2/3 EXIGÉES, sinon pas
// d'avis. La macro vit dans le bandeau 🌍 (macroState : contexte, jamais notée).
// Heuristique de tri jamais validée sur historique : pas un conseil.
"use strict";
var CAC = (function () {

  // v7.8 (revue du 10/11/2026) : validation numérique STRICTE du moteur. L'ancien
  // `isFinite(v)` global convertit avant de tester — isFinite("") et isFinite(true)
  // valent true, et des valeurs en texte se comparaient alphabétiquement ("10" < "9").
  // Le moteur exige désormais de VRAIS nombres : typeof v === "number" && isFinite(v).
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // percentile d'une métrique (rankPct de Sentinelle) : exclut les non positifs sauf dY,
  // ex æquo → RANG MOYEN, une seule valeur = pas de comparaison → percentile ABSENT.
  function rankPct(list, field, lowerIsBetter) {
    var idx = {}, n = 0;   // v7.8 : « vals » était un reste mort jamais lu (revue du 10/11)
    for (var i = 0; i < list.length; i++) {
      var v = list[i][field];
      if (v == null || !isNum(v)) continue;
      if (field !== "dY" && v <= 0) continue;
      idx[i] = v; n++;
    }
    var pcts = {};
    for (var a in idx) {
      if (!Object.prototype.hasOwnProperty.call(idx, a)) continue;
      if (n < 2) continue;
      var less = 0, tied = 0;
      for (var b in idx) {
        if (!Object.prototype.hasOwnProperty.call(idx, b) || b === a) continue;
        if (lowerIsBetter ? (idx[b] > idx[a]) : (idx[b] < idx[a])) less++;
        else if (idx[b] === idx[a]) tied++;
      }
      pcts[a] = Math.round(((less + tied / 2) / (n - 1)) * 100);
    }
    return pcts;
  }

  // percentile générique (rankPctAny de Sentinelle) : TOUTE valeur finie participe —
  // une croissance à -3 % est un fait, pas une absence. Ex æquo → rang moyen.
  function rankPctAny(list, field, lowerIsBetter) {
    var vals = {}, n = 0;
    for (var i = 0; i < list.length; i++) {
      var v = list[i][field];
      if (v == null || !isNum(v)) continue;
      vals[i] = v; n++;
    }
    var pcts = {};
    for (var a in vals) {
      if (!Object.prototype.hasOwnProperty.call(vals, a)) continue;
      var beaten = 0, tied = 0;
      for (var b in vals) {
        if (!Object.prototype.hasOwnProperty.call(vals, b) || b === a) continue;
        if (lowerIsBetter ? (vals[b] > vals[a]) : (vals[b] < vals[a])) beaten++;
        else if (vals[b] === vals[a]) tied++;
      }
      pcts[a] = n > 1 ? Math.round(((beaten + tied / 2) / (n - 1)) * 100) : undefined;
    }
    return pcts;
  }

  // garde-fous financiers avant percentile qualité (qMetricOf de Sentinelle) : capitaux
  // propres négatifs (P/B ≤ 0) → ROE et D/E non mesurables ; marges/croissances négatives
  // restent des faits et participent (au bas du classement).
  function qMetricOf(e) {
    var bad = (e.pb != null && isNum(e.pb) && e.pb <= 0);
    return {
      roe: (!bad && e.roe != null && isNum(e.roe)) ? e.roe : null,
      mOp: (e.mOp != null && isNum(e.mOp)) ? e.mOp : null,
      gRev: (e.gRev != null && isNum(e.gRev)) ? e.gRev : null,
      de: (!bad && e.de != null && isNum(e.de) && e.de >= 0) ? e.de : null
    };
  }

  // position dans la fourchette 52 s. : 0 = au plus bas, 100 = au plus haut (bornée),
  // écarts SIGNÉS au plus bas/plus haut, cours hors bornes signalé (jamais confondu).
  function pos52Of(e) {
    var lo = e.w52lo, hi = e.w52hi, px = e.px;
    if (lo == null || hi == null || !(hi > lo) || !(lo > 0) || !(px > 0)) return { pos: null, gapLo: null, dd: null, out: 0 };   // v7.8 : lo > 0 — un plus bas à 0 donnait gapLo = Infinity
    var pos = Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100));
    var out = px < lo ? -1 : (px > hi ? 1 : 0);
    return { pos: Math.round(pos), gapLo: Math.round((px / lo - 1) * 1000) / 10, dd: Math.round((px / hi - 1) * 1000) / 10, out: out };
  }

  // score 📐 valorisation (valScores de Sentinelle) : pPer/pDY/pPb/score/vBase/vMode sur une
  // copie de chaque ligne ; percentiles PAR SECTEUR quand ≥ 8 pairs et ≥ 5 observations
  // valides de la métrique dans le pool, sinon vs indice ; score null sans PER exploitable.
  function valScores(list) {
    var W = { per: 0.5, dY: 0.3, pb: 0.2 };
    var MIN_SEC = 8, MIN_MET = 5;
    var bySec = {};
    for (var i = 0; i < list.length; i++) {
      var sec = (typeof list[i].sec === "string" && list[i].sec) ? list[i].sec : null;
      if (sec) (bySec[sec] = bySec[sec] || []).push(i);
    }
    var METS = [["per", "pPer", true], ["dY", "pDY", false], ["pb", "pPb", true]];
    var res = [];
    for (var r0 = 0; r0 < list.length; r0++) res[r0] = { pPer: null, pDY: null, pPb: null, mPer: "index", mDY: "index", mPb: "index" };
    var full = { pPer: rankPct(list, "per", true), pDY: rankPct(list, "dY", false), pPb: rankPct(list, "pb", true) };
    for (var i1 = 0; i1 < list.length; i1++) {
      res[i1].pPer = full.pPer[i1] != null ? full.pPer[i1] : null;
      res[i1].pDY = full.pDY[i1] != null ? full.pDY[i1] : null;
      res[i1].pPb = full.pPb[i1] != null ? full.pPb[i1] : null;
    }
    function validCount(sub, field) {
      var n = 0;
      for (var k = 0; k < sub.length; k++) {
        var v = sub[k][field];
        if (v == null || !isNum(v)) continue;
        if (field !== "dY" && v <= 0) continue;
        n++;
      }
      return n;
    }
    for (var s2 in bySec) {
      if (!Object.prototype.hasOwnProperty.call(bySec, s2)) continue;
      if (bySec[s2].length < MIN_SEC) continue;
      var sub = bySec[s2].map(function (j) { return list[j]; });
      METS.forEach(function (m) {
        if (validCount(sub, m[0]) < MIN_MET) return;
        var p = rankPct(sub, m[0], m[2]);
        bySec[s2].forEach(function (j, k) {
          if (p[k] != null) { res[j][m[1]] = p[k]; res[j]["m" + m[1].slice(1)] = "sector"; }
        });
      });
    }
    return list.map(function (e, i) {
      var s = 0, w = 0;
      var p = res[i];
      if (p.pPer != null) { s += W.per * p.pPer; w += W.per; }
      if (p.pDY != null) { s += W.dY * p.pDY; w += W.dY; }
      if (p.pPb != null) { s += W.pb * p.pPb; w += W.pb; }
      var o = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
      o.pPer = p.pPer != null ? p.pPer : null;
      o.pDY = p.pDY != null ? p.pDY : null;
      o.pPb = p.pPb != null ? p.pPb : null;
      o.score = (p.pPer != null && w > 0) ? Math.round(s / w) : null;
      o.vBase = (p.pPer != null ? 1 : 0) + (p.pDY != null ? 1 : 0) + (p.pPb != null ? 1 : 0);   // v7.8 (revue du 10/11) : vBase compte les métriques DISPONIBLES même sans PER — le score reste null sans PER (une perte n'est pas « pas chère »), seule la couverture affichée est corrigée
      var modes = [];
      if (p.pPer != null) modes.push(p.mPer);
      if (p.pDY != null) modes.push(p.mDY);
      if (p.pPb != null) modes.push(p.mPb);
      o.vMode = modes.length === 0 ? "index"
        : (modes.every(function (m) { return m === "sector"; }) ? "sector"
        : (modes.every(function (m) { return m === "index"; }) ? "index" : "mix"));
      return o;
    });
  }

  // score 🧪 qualité + étiquettes (oppScores de Sentinelle) : ROE 35 % + marge op. 25 % +
  // croissance CA 20 % + dette/CP 20 %, PAR SECTEUR (≥ 8 pairs, ≥ 5 observations valides,
  // repli vs indice) ; ≥ 3/4 métriques EXIGÉES ; earnWarn (PER projeté au-dessus du passé) ;
  // pos52/gapLo/dd52/out52 = INFO, hors score ; oScore = composite 💎 57/43.
  function oppScores(list) {
    var W = { roe: 0.35, mOp: 0.25, gRev: 0.2, de: 0.2 };
    var MIN_SEC = 8;
    var MIN_MET = 5;
    var clean = list.map(qMetricOf);
    var bySec = {};
    for (var i = 0; i < list.length; i++) {
      var sec = (typeof list[i].sec === "string" && list[i].sec) ? list[i].sec : null;
      if (!sec) continue;
      (bySec[sec] = bySec[sec] || []).push(i);
    }
    var groups = [];
    for (var s in bySec) {
      if (!Object.prototype.hasOwnProperty.call(bySec, s) || bySec[s].length < MIN_SEC) continue;
      groups.push(bySec[s]);
    }
    function secPct(field, lowerIsBetter, modeOut) {
      var out = {};
      var full = rankPctAny(clean, field, lowerIsBetter);
      for (var j = 0; j < list.length; j++) { out[j] = full[j] != null ? full[j] : null; if (modeOut) modeOut[j] = "index"; }
      groups.forEach(function (g) {
        var sub = g.map(function (j) { return clean[j]; });
        var n = 0;
        for (var k = 0; k < sub.length; k++) if (sub[k][field] != null) n++;
        if (n < MIN_MET) return;
        var p = rankPctAny(sub, field, lowerIsBetter);
        g.forEach(function (j, k) {
          out[j] = p[k] != null ? p[k] : null;
          if (modeOut && p[k] != null) modeOut[j] = "sector";
        });
      });
      return out;
    }
    var mRoe = {}, mOp = {}, mRev = {}, mDe = {};
    var pRoe = secPct("roe", false, mRoe), pOp = secPct("mOp", false, mOp),
        pRev = secPct("gRev", false, mRev), pDe = secPct("de", true, mDe);
    return list.map(function (e, i) {
      var o = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
      var s = 0, w = 0;
      if (pRoe[i] != null) { s += W.roe * pRoe[i]; w += W.roe; }
      if (pOp[i] != null) { s += W.mOp * pOp[i]; w += W.mOp; }
      if (pRev[i] != null) { s += W.gRev * pRev[i]; w += W.gRev; }
      if (pDe[i] != null) { s += W.de * pDe[i]; w += W.de; }
      var used = (pRoe[i] != null ? 1 : 0) + (pOp[i] != null ? 1 : 0) + (pRev[i] != null ? 1 : 0) + (pDe[i] != null ? 1 : 0);
      o.pRoe = pRoe[i] != null ? pRoe[i] : null;
      o.pOp = pOp[i] != null ? pOp[i] : null;
      o.pRev = pRev[i] != null ? pRev[i] : null;
      o.pDe = pDe[i] != null ? pDe[i] : null;
      o.qBase = used;
      var qModes = [];
      if (pRoe[i] != null) qModes.push(mRoe[i]);
      if (pOp[i] != null) qModes.push(mOp[i]);
      if (pRev[i] != null) qModes.push(mRev[i]);
      if (pDe[i] != null) qModes.push(mDe[i]);
      o.qMode = qModes.length === 0 ? "index"
        : (qModes.every(function (m) { return m === "sector"; }) ? "sector"
        : (qModes.every(function (m) { return m === "index"; }) ? "index" : "mix"));
      o.qScore = (used >= 3 && w > 0) ? Math.round(s / w) : null;
      o.earnWarn = (e.fper != null && e.per != null && e.fper > e.per) ? true : undefined;
      var p52 = pos52Of(e);
      o.pos52 = p52.pos; o.gapLo = p52.gapLo; o.dd52 = p52.dd;
      o.out52 = p52.out || 0;
      o.oScore = (o.qScore != null && e.score != null) ? Math.round(0.57 * o.qScore + 0.43 * e.score) : null;
      return o;
    });
  }

  // potentiel vs objectif de consensus (upX de Sentinelle) : écart SIGNÉ au cours, en %
  // (arrondi au dixième) ; pas d'objectif ou pas de cours → null, on n'invente rien.
  function upXOf(e) {
    // v7.8 (revue du 10/11) : objectif strictement positif — une cible à 0 donnait un
    // potentiel absurde de -100 %, une cible négative entrait aussi dans le rang.
    return (e != null && e.tp != null && e.tp > 0 && e.px > 0 && isNum(e.tp) && isNum(e.px)) ? Math.round((e.tp / e.px - 1) * 1000) / 10 : null;
  }

  // percentile du potentiel consensus (upX) sur la base fournie — higherIsBetter, ex æquo rang moyen
  function consPct(list) {
    return rankPctAny(list, "upX", false);
  }

  // score 🎯 d'achat CAC 40 (cacScores de Sentinelle) : pUp (percentile consensus), aScore
  // (qualité 40 % + valorisation 25 % + consensus 35 %, RENORMALISÉ sur les composantes
  // disponibles), aBase (nb de composantes utilisées, affiché), verdict 🥇≥70 / 🥈55-69 /
  // 🥉40-54 / ⏸<40. ≥ 2/3 composantes EXIGÉES : une seule = pas d'avis.
  function cacScores(list) {
    var W = { q: 0.40, v: 0.25, c: 0.35 };
    var pUp = consPct(list);
    return list.map(function (e, i) {
      var o = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
      o.pUp = pUp[i] != null ? pUp[i] : null;
      var s = 0, w = 0, base = 0;
      if (o.qScore != null) { s += W.q * o.qScore; w += W.q; base++; }
      if (o.score != null) { s += W.v * o.score; w += W.v; base++; }
      if (o.pUp != null) { s += W.c * o.pUp; w += W.c; base++; }
      o.aBase = base;
      o.aScore = (base >= 2 && w > 0) ? Math.round(s / w) : null;
      o.verdict = o.aScore == null ? null
        : (o.aScore >= 70 ? "strong" : (o.aScore >= 55 ? "good" : (o.aScore >= 40 ? "mid" : "wait")));
      return o;
    });
  }

  // le groupe « cac40 » de la composition : LA source de vérité du périmètre — reconstruit
  // chaque mois par le pipeline sbf120.yml (Wikipédia FR), l'onglet suit l'indice MÊME quand
  // il change de composition.
  function cacFilter(list) {
    return (list || []).filter(function (e) { return e && e.g === "cac40"; });
  }

  // tri du classement d'achat : aScore décroissant, les scores null (composantes
  // insuffisantes) restent en fin de liste — jamais cachés.
  function cacSort(list) {
    return list.slice().sort(function (a, b) {
      var va = a.aScore, vb = b.aScore;
      var na = va == null || !isNum(va), nb = vb == null || !isNum(vb);
      if (na && nb) return cacTie(a, b);
      if (na) return 1;
      if (nb) return -1;
      if (vb - va !== 0) return vb - va;
      return cacTie(a, b);
    });
  }

  // v7.8 (revue du 10/11) : les scores sont des ENTIERS → ex æquo fréquents ; l'ancien tri
  // laissait l'ORDRE D'ENTRÉE décider. Départage déterministe : base la plus complète d'abord
  // (aBase décroissant), puis qualité (qScore décroissant, nulls en fin), puis nom (comparaison
  // directe sur points de code — reproductible partout, sans dépendre de l'ICU de l'hôte).
  function cacTie(a, b) {
    var ba = a.aBase || 0, bb = b.aBase || 0;
    if (ba !== bb) return bb - ba;
    var qa = a.qScore, qb = b.qScore;
    var nqa = qa == null || !isNum(qa), nqb = qb == null || !isNum(qb);
    if (nqa && nqb) return cacNameCmp(a, b);
    if (nqa) return 1;
    if (nqb) return -1;
    if (qb - qa !== 0) return qb - qa;
    return cacNameCmp(a, b);
  }
  function cacNameCmp(a, b) {
    var x = String(a.n || ""), y = String(b.n || "");
    return x < y ? -1 : (x > y ? 1 : 0);
  }

  // macro du Radar Conjoncture (relevés publics data.json hebdo + data-daily.json) → état
  // affichable : champs validés, spread OAT-Bund en pb, direction BCE en liste blanche,
  // âge en jours, péremption > 10 j. CONTEXTE affiché (bandeau 🌍), jamais noté.
  function macroState(m, nowMs) {
    if (!m || typeof m !== "object") return null;
    var out = { dateData: m.dateData || null, dateMacro: m.dateMacro || null, src: m.source || null };
    ["vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE", "pmiZE", "cape"].forEach(function (k) {
      out[k] = (m[k] != null && isNum(m[k])) ? m[k] : null;
    });
    out.bceDir = ["hausse", "baisse", "stable"].indexOf(m.bceDir) >= 0 ? m.bceDir : null;
    out.spread = (out.oat10 != null && out.bund10 != null) ? Math.round((out.oat10 - out.bund10) * 100) : null;
    var age = null;
    if (out.dateData && /^\d{4}-\d{2}-\d{2}$/.test(out.dateData)) {
      // v7.8 (revue du 10/11) : âge en JOURS CALENDAIRES. L'ancrage à midi UTC affichait
      // -1 j pour un relevé du jour lu avant midi, et `nowMs || Date.now()` écrasait un
      // nowMs légitimement égal à 0 (0 est une valeur, pas un « absent »).
      var t = Date.parse(out.dateData + "T00:00:00Z");
      if (isNum(t)) {
        var now2 = (nowMs != null) ? nowMs : Date.now();
        var nd = new Date(now2);
        var today = Date.UTC(nd.getUTCFullYear(), nd.getUTCMonth(), nd.getUTCDate());
        age = Math.round((today - t) / 86400000);
      }
    }
    out.ageDays = age;
    out.stale = age != null && age > 10;
    return out;
  }

  // pipeline complet du classement : quotes.list → upX (objectif consensus) → valorisation
  // → qualité → score 🎯. Les percentiles sont calculés sur TOUT le SBF coté (base stable —
  // plus de pairs, rang plus stable qu'un percentile sur 40 valeurs seules), le filtre
  // cac40 vient APRÈS : le périmètre suit la composition automatiquement.
  function pipeline(list) {
    // v7.8 (revue du 10/11) : un élément null de la source ne fait plus CRASHER le
    // pipeline (upXOf(null) levait) — il est écarté, comme le fait déjà cacFilter.
    var base = (list || []).filter(function (e) { return e != null && typeof e === "object"; }).map(function (e) {
      var o = {};
      for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) o[k] = e[k];
      o.upX = upXOf(e);
      return o;
    });
    return cacScores(oppScores(valScores(base)));
  }

  return {
    rankPct: rankPct, rankPctAny: rankPctAny, qMetricOf: qMetricOf, pos52Of: pos52Of,
    valScores: valScores, oppScores: oppScores, upXOf: upXOf, consPct: consPct,
    cacScores: cacScores, cacFilter: cacFilter, cacSort: cacSort, macroState: macroState,
    pipeline: pipeline
  };
})();
if (typeof module !== "undefined" && module.exports) { module.exports = CAC; }
