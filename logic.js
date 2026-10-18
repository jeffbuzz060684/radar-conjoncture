"use strict";
// ---------- Valeurs du jour, vérifiées le 18/10/2026 (sources cf. onglet Données) ----------
// Depuis la v5, le MSCI World (IWDA) est suivi en EUR via la cotation Euronext Amsterdam
// (IWDA.AS) : les paliers de la stratégie PEA (exécutée en euros via DCAM) réagissent au
// cours en euros, pas au cours en dollars.
var DEFAULT_DATA = {
  dateData: "2026-10-16",
  msci: 130.55, msciHigh52: 132.26, msciHigh52Date: "2026-10-12", msciLow52: 107.51,   // IWDA en € (Euronext Amsterdam, IWDA.AS) ; fenêtre 52 sem. Yahoo
  dateMacro: "2026-10-16",                                                                                  // date du dernier relevé macro (inflation, BCE…)
  cape: 40.38, vix: 19.99, vix5: 16.76,                                      // VIX clôture 16/10 ; moyenne 5 séances Yahoo
  inflZE: 3.8, inflUS: 3.7,
  bceDepot: 2.5, bceDir: "hausse",                       // +25 pb le 10/09/2026, effectif 16/09/2026
  bund10: 3.42, oat10: 4.79, pmiZE: 53.1,
  orEUR: 3729.84, orHigh52: 4592, orLow52: 3387.45,       // €/once
  btcEUR: 72598, btcHigh52: null,                        // 52 sem BTC : bouton « en direct » ou saisie
  dateGecko: "",
  imoRendement: 5.0,
  reserve: 0,
  paliersDone: { p5: false, p10: false, p15: false, p20: false }
};

var FIELDS = [
  { g: "Marchés actions" },
  { k: "dateData", l: "Date des données", t: "date", h: "date du relevé" },
  { k: "msci", l: "Cours MSCI World (IWDA, €)", t: "num", h: "clôture Euronext Amsterdam (IWDA.AS), en euros" },
  { k: "msciHigh52", l: "Plus haut 52 sem. MSCI (€)", t: "num", h: "sommet 52 semaines" },
  { k: "msciHigh52Date", l: "Date du sommet 52 sem.", t: "date", h: "optionnel — trace la référence des paliers" },
  { k: "msciLow52", l: "Plus bas 52 sem. MSCI (€)", t: "num", h: "optionnel, jauge de position" },
  { k: "cape", l: "CAPE Shiller (S&P 500)", t: "num", h: "valorisation actions US — proxy du monde, lent" },
  { k: "vix", l: "VIX", t: "num", h: "volatilité implicite S&P 500 à ~30 j — proxy de stress, non directionnel" },
  { k: "vix5", l: "VIX lissé 5 j", t: "num", h: "optionnel — moyenne 5 séances, lisse les spikes" },
  { g: "Macro zone euro & US" },
  { k: "dateMacro", l: "Date du relevé macro", t: "date", h: "date du dernier relevé vérifié (inflation, BCE, PMI…)" },
  { k: "inflZE", l: "Inflation zone euro (%), YoY", t: "num", h: "dernier mois publié, glissement sur un an (pas un taux annualisé)" },
  { k: "inflUS", l: "Inflation US (%), YoY", t: "num", h: "dernier mois publié, glissement sur un an (pas un taux annualisé)" },
  { k: "bceDepot", l: "Taux de dépôt BCE (%)", t: "num", h: "taux directeur" },
  { k: "bceDir", l: "Direction BCE", t: "sel", o: ["hausse", "stable", "baisse"], h: "dernière décision" },
  { k: "bund10", l: "Rendement Bund 10 ans (%)", t: "num", h: "obligations souveraines ZE" },
  { k: "oat10", l: "Rendement OAT 10 ans (%)", t: "num", h: "dette française" },
  { k: "pmiZE", l: "PMI composite zone euro", t: "num", h: "activité : >50 = croissance" },
  { g: "Or, BTC, immobilier" },
  { k: "orEUR", l: "Or (€ / once)", t: "num", h: "cours spot" },
  { k: "orHigh52", l: "Plus haut 52 sem. or (€)", t: "num", h: "sommet 52 semaines" },
  { k: "orLow52", l: "Plus bas 52 sem. or (€)", t: "num", h: "optionnel" },
  { k: "btcEUR", l: "Bitcoin (€)", t: "num", h: "cours" },
  { k: "btcHigh52", l: "Plus haut 52 sem. BTC (€)", t: "num", h: "optionnel — auto via bouton en direct" },
  { k: "dateGecko", l: "Date du relevé or/BTC en direct", t: "date", h: "optionnel — date du dernier « Or & BTC en direct », sans toucher aux marchés" },
  { k: "imoRendement", l: "Rendement locatif immo (%)", t: "num", h: "proxy SCPI (hors frais)" },
  { g: "Ta stratégie (PEA)" },
  { k: "reserve", l: "Réserve tactique actuelle (€)", t: "num", h: "montant disponible sur le monétaire PEA" }
];

var PALIERS = [5, 10, 15, 20];

function num(x) { var v = parseFloat(x); return (typeof v === "number" && isFinite(v)) ? v : null; }
function r1(x) { return Math.round(x * 10) / 10; }
function r2(x) { return Math.round(x * 100) / 100; }
function pctDD(cur, high) { if (num(cur) === null || num(high) === null || high <= 0) return null; return (cur / high - 1) * 100; }
function clampScore(s) { return Math.max(0, Math.min(100, Math.round(s))); }
function fmtPts(p) { return (p > 0 ? "+" + r1(p) : p < 0 ? r1(p) : "0"); }

// paliers croissants : [[borne sup, points], ...] ; renvoie les points de la 1re borne ≥ v (sinon dernière)
function stepScore(v, brackets) {
  if (num(v) === null) return 0;
  for (var i = 0; i < brackets.length; i++) { if (v < brackets[i][0]) return brackets[i][1]; }
  return brackets[brackets.length - 1][1];
}

function computeDerived(d) {
  var der = {};
  der.vixEff = (num(d.vix5) !== null) ? d.vix5 : num(d.vix);   // VIX lissé 5 j si dispo, sinon VIX du jour
  der.ddMsci = pctDD(d.msci, d.msciHigh52);
  der.ddOr = pctDD(d.orEUR, d.orHigh52);
  der.ddBtc = pctDD(d.btcEUR, d.btcHigh52);
  der.tauxReelZE = (num(d.bceDepot) !== null && num(d.inflZE) !== null) ? d.bceDepot - d.inflZE : null;   // dépôt BCE − inflation ZE
  der.bundReal = (num(d.bund10) !== null && num(d.inflZE) !== null) ? d.bund10 - d.inflZE : null;         // rendement réel Bund
  der.spreadOat = (num(d.oat10) !== null && num(d.bund10) !== null) ? (d.oat10 - d.bund10) * 100 : null;  // points de base
  der.imoMarge = (num(d.imoRendement) !== null && num(d.oat10) !== null) ? d.imoRendement - d.oat10 : null; // rendement immo − coût crédit
  if (num(d.orEUR) !== null && num(d.orHigh52) !== null && num(d.orLow52) !== null && d.orHigh52 > d.orLow52) {
    der.posOr = (d.orEUR - d.orLow52) / (d.orHigh52 - d.orLow52) * 100;
  } else der.posOr = null;
  // v5.6 : garde-fou d'unité — un drawdown ≤ −25 % sur MSCI World signale presque sûrement
  // des références mélangeant dollars et euros (ex. téléphone resté en USD au passage EUR).
  der.msciIncoherent = (der.ddMsci !== null && der.ddMsci <= -25);
  return der;
}

// ---------- Scores par actif (base 50, sous-scores cumulés, bornés 0-100) ----------
function mkPart(label, pts, detail) { return { label: label, pts: pts, detail: detail || "" }; }

function scoreActions(d, der) {
  var parts = [];
  parts.push(mkPart("Valorisation (CAPE " + (num(d.cape) !== null ? r1(d.cape) : "?") + ")",
    stepScore(d.cape, [[20, 20], [25, 10], [30, 0], [35, -10], [40, -18], [Infinity, -24]]),
    num(d.cape) === null ? "donnée manquante" : d.cape >= 30 ? "CAPE élevé : rendements long terme attendus faibles" : "CAPE raisonnable"));
  var dd = der.ddMsci;
  parts.push(mkPart("Opportunité de prix (drawdown)",
    dd === null ? 0 : stepScore(-dd, [[3, -4], [5, 4], [10, 10], [15, 18], [20, 24], [Infinity, 30]]),
    dd === null ? "données manquantes" : "cours à " + r1(dd) + " % du sommet 52 sem."));
  parts.push(mkPart("Volatilité (VIX " + (der.vixEff !== null ? r1(der.vixEff) : "?") + (num(d.vix5) !== null ? " lissé" : "") + ")",
    stepScore(der.vixEff, [[13, -6], [20, 0], [27, 8], [Infinity, 12]]),
    der.vixEff === null ? "données manquantes" : (der.vixEff >= 27 ? "peur sur les marchés = acheter à rabais" : (der.vixEff < 13 ? "complaisance" : "normal"))));
  var dirPts = d.bceDir === "baisse" ? 8 : d.bceDir === "hausse" ? -8 : 0;
  parts.push(mkPart("Politique monétaire BCE (" + d.bceDir + ")", dirPts,
    d.bceDir === "baisse" ? "des taux qui baissent soutiennent les actions" : "des taux qui montent pèsent sur les valorisations"));
  parts.push(mkPart("Croissance (PMI " + (num(d.pmiZE) !== null ? r1(d.pmiZE) : "?") + ")",
    stepScore(d.pmiZE, [[47, -8], [50, -3], [53, 3], [Infinity, 6]]),
    d.pmiZE >= 50 ? "l'économie européenne grandit" : "l'économie ralentit"));
  var _tot = parts.reduce(function (s, p) { return s + p.pts; }, 0);
  var _timing = _tot - parts[0].pts;   // v5.6 : timing = tout sauf la valorisation (CAPE, lente)
  return { id: "actions", icon: "🌍", name: "Actions monde (MSCI World)", score: clampScore(50 + _tot), timingScore: clampScore(50 + _timing), parts: parts };
}

function scoreObligations(d, der) {
  var parts = [];
  parts.push(mkPart("Rendement Bund 10 ans (" + (num(d.bund10) !== null ? r1(d.bund10) : "?") + " %)",
    stepScore(d.bund10, [[1, -15], [2, -5], [3, 5], [4, 10], [Infinity, 14]]),
    "plus le rendement d'entrée est haut, mieux c'est"));
  parts.push(mkPart("Rendement réel (Bund − inflation)",
    der.bundReal === null ? 0 : stepScore(der.bundReal, [[-2, -12], [-1, -8], [0, -4], [1, 4], [Infinity, 8]]),
    der.bundReal === null ? "données manquantes" : (r1(der.bundReal) + " % réel : l'inflation " + (der.bundReal < 0 ? "ronge" : "respecte") + " le coupon")));
  var dirPts = d.bceDir === "baisse" ? 12 : d.bceDir === "hausse" ? -10 : 0;
  parts.push(mkPart("Direction des taux BCE (" + d.bceDir + ")", dirPts,
    d.bceDir === "hausse" ? "les taux qui montent font baisser les obligations existantes" : "des taux qui baissent font monter les cours"));
  parts.push(mkPart("Risque dette française (spread " + (der.spreadOat !== null ? Math.round(der.spreadOat) + " pb" : "?") + ")",
    (der.spreadOat !== null && der.spreadOat >= 120) ? -5 : 0,
    "prime de risque sur la zone euro si le spread OAT-Bund dépasse 120 pb"));
  return { id: "obligations", icon: "📜", name: "Obligations zone euro (Bund 10 ans)", score: clampScore(50 + parts.reduce(function (s, p) { return s + p.pts; }, 0)), parts: parts };
}

function scoreOr(d, der) {
  var parts = [];
  parts.push(mkPart("Inflation (" + (num(d.inflZE) !== null ? r1(d.inflZE) : "?") + " %)",
    stepScore(d.inflZE, [[2, 0], [3, 6], [Infinity, 12]]),
    num(d.inflZE) === null ? "donnée manquante" : d.inflZE >= 3 ? "l'or est la couverture classique de l'inflation" : "peu de besoin de couverture"));
  parts.push(mkPart("Taux réels courts (" + (der.tauxReelZE !== null ? r1(der.tauxReelZE) : "?") + " %)",
    der.tauxReelZE === null ? 0 : stepScore(der.tauxReelZE, [[0, 8], [1, 3], [Infinity, 0]]),
    der.tauxReelZE !== null && der.tauxReelZE < 0 ? "taux réels négatifs = historiquement favorable à l'or" : "taux réels positifs = coût de portage pour l'or"));
  var dd = der.ddOr;
  parts.push(mkPart("Prix vs sommet 52 sem.",
    dd === null ? 0 : stepScore(-dd, [[5, -4], [12, 6], [20, 10], [Infinity, 12]]),
    dd === null ? "données manquantes" : (r1(dd) + " % sous le sommet" + (dd <= -12 ? " : corrigé, meilleur point d'entrée qu'au pic" : ""))));
  parts.push(mkPart("Position dans la fourchette 52 sem.",
    der.posOr === null ? 0 : stepScore(der.posOr, [[30, -4], [70, 0], [Infinity, -6]]),
    der.posOr === null ? "données manquantes" : Math.round(der.posOr) + " % de la fourchette annuelle"));
  return { id: "or", icon: "🥇", name: "Or (physique / ETF or)", score: clampScore(50 + parts.reduce(function (s, p) { return s + p.pts; }, 0)), parts: parts };
}

function scoreMonetaire(d, der) {
  var parts = [];
  parts.push(mkPart("Taux de dépôt BCE (" + (num(d.bceDepot) !== null ? r1(d.bceDepot) : "?") + " %)",
    stepScore(d.bceDepot, [[1, -15], [2, -5], [3, 8], [4, 14], [Infinity, 18]]),
    "rendement sans risque du monétaire"));
  parts.push(mkPart("Rendement réel (" + (der.tauxReelZE !== null ? r1(der.tauxReelZE) : "?") + " %)",
    der.tauxReelZE === null ? 0 : stepScore(der.tauxReelZE, [[0, -6], [1, 2], [Infinity, 6]]),
    der.tauxReelZE !== null && der.tauxReelZE < 0 ? "l'inflation dépasse le taux : le monétaire perd du pouvoir d'achat" : "préserve le pouvoir d'achat"));
  var refuge = ((der.vixEff !== null && der.vixEff >= 25) || (der.ddMsci !== null && der.ddMsci <= -15)) ? 6 : 0;
  parts.push(mkPart("Rôle de refuge", refuge, refuge ? "marchés stressés : le monétaire protège" : "marchés calmes : peu d'avantage refuge"));
  return { id: "monetaire", icon: "🛡️", name: "Monétaire zone euro", score: clampScore(50 + parts.reduce(function (s, p) { return s + p.pts; }, 0)), parts: parts };
}

function scoreImmo(d, der) {
  var parts = [];
  parts.push(mkPart("Rendement − coût du crédit (" + (der.imoMarge !== null ? r1(der.imoMarge) : "?") + " pts)",
    der.imoMarge === null ? 0 : stepScore(der.imoMarge, [[0, -15], [0.5, -5], [1.5, 5], [Infinity, 10]]),
    der.imoMarge === null ? "données manquantes" : "rendement locatif " + (der.imoMarge > 0 ? "au-dessus" : "sous") + " du taux OAT 10 ans"));
  var dirPts = d.bceDir === "baisse" ? 8 : d.bceDir === "hausse" ? -8 : 0;
  parts.push(mkPart("Direction des taux (" + d.bceDir + ")", dirPts,
    d.bceDir === "hausse" ? "le crédit se renchérit : pression sur les prix et les SCPI" : "des taux qui baissent soutiennent l'immobilier"));
  parts.push(mkPart("Indexation des loyers (inflation " + (num(d.inflZE) !== null ? r1(d.inflZE) : "?") + " %)",
    stepScore(d.inflZE, [[2, 0], [3, 3], [Infinity, 6]]),
    "loyers indexés sur l'inflation : actif réel"));
  return { id: "immo", icon: "🏠", name: "Immobilier (SCPI / ETF immo)", score: clampScore(50 + parts.reduce(function (s, p) { return s + p.pts; }, 0)), parts: parts };
}

function scoreCrypto(d, der) {
  var parts = [];
  var dd = der.ddBtc;
  parts.push(mkPart("Prix vs sommet 52 sem.",
    dd === null ? 0 : stepScore(-dd, [[10, -6], [30, 4], [50, 10], [Infinity, 14]]),
    dd === null ? "donnée manquante : « Or & BTC en direct » ou saisie du sommet 52 sem." : (r1(dd) + " % sous le sommet 52 sem.")));
  var dirPts = d.bceDir === "baisse" ? 10 : d.bceDir === "hausse" ? -10 : 0;
  parts.push(mkPart("Liquidité mondiale (BCE " + d.bceDir + ")", dirPts,
    d.bceDir === "hausse" ? "le resserrement monétaire prive les actifs spéculatifs de liquidité" : "la baisse des taux ravive l'appétit pour le risque"));
  parts.push(mkPart("Inflation (" + (num(d.inflZE) !== null ? r1(d.inflZE) : "?") + " %)",
    stepScore(d.inflZE, [[2, 0], [Infinity, 4]]),
    num(d.inflZE) === null ? "donnée manquante" : d.inflZE >= 3 ? "thèse « réserve de valeur hors monnaie fiat » relancée" : "peu d'attrait spécifique"));
  var panique = (der.vixEff !== null && der.vixEff >= 30) ? -8 : 0;
  parts.push(mkPart("Stress marché (VIX)", panique, panique ? "panique généralisée : le BTC tombe avec le marché" : "pas de stress marqué"));
  return { id: "crypto", icon: "₿", name: "Crypto (BTC)", score: clampScore(50 + parts.reduce(function (s, p) { return s + p.pts; }, 0)), parts: parts, partial: dd === null };
}

function badgeOf(score) {
  if (score >= 65) return { cls: "good", icon: "🟢", label: "À privilégier" };
  if (score >= 45) return { cls: "mid", icon: "🟡", label: "Neutre" };
  return { cls: "bad", icon: "🔴", label: "Défavorable" };
}

function radarAll(d) {
  var der = computeDerived(d);
  var list = [scoreOr(d, der), scoreMonetaire(d, der), scoreActions(d, der), scoreObligations(d, der), scoreImmo(d, der), scoreCrypto(d, der)];
  list.forEach(function (a) { a.badge = badgeOf(a.score); });
  list.sort(function (a, b) { return b.score - a.score; });
  return { der: der, list: list };
}

function regimeOf(d) {
  var vx = (num(d.vix5) !== null) ? d.vix5 : num(d.vix);
  var pmi = num(d.pmiZE), inf = num(d.inflZE), infUS = num(d.inflUS), dep = num(d.bceDepot), bund = num(d.bund10);
  var growth = pmi === null ? "Données manquantes" : pmi >= 53 ? "Expansion" : pmi >= 50 ? "Croissance modérée" : pmi >= 47 ? "Ralentissement" : "Contraction";
  var infl = inf === null ? "donnée manquante" : inf >= 3 ? "élevée" : inf >= 2 ? "au-dessus de la cible" : "sous contrôle";
  var dirTxt = d.bceDir === "hausse" ? "en relèvement de taux" : d.bceDir === "baisse" ? "en assouplissement" : "en pause";
  var label = growth + " · inflation " + infl + " · BCE " + dirTxt;
  var recs = [];
  if (inf !== null && inf >= 3) recs.push("l'inflation > 3 % favorise l'or et les actifs réels (immo indexé)");
  if (d.bceDir === "hausse") recs.push("le resserrement monétaire pèse sur les obligations et les valorisations élevées");
  if (pmi !== null && pmi >= 52) recs.push("la croissance soutenue soutient les bénéfices des entreprises");
  if (num(d.cape) !== null && d.cape >= 35) recs.push("CAPE ≥ 35 : les actions vivent au-dessus de leurs valorisations historiques — rendements long terme attendus modestes");
  var desc = "PMI " + (pmi === null ? "—" : r1(pmi)) + " · inflation ZE " + (inf === null ? "—" : r1(inf)) + " % (US " + (infUS === null ? "—" : r1(infUS)) + " %) · dépôt BCE " + (dep === null ? "—" : r1(dep)) + " % · Bund " + (bund === null ? "—" : r1(bund)) + " % · VIX " + (vx === null ? "—" : r1(vx)) + (num(d.vix5) !== null ? " (lissé 5 j)" : "") + ". Historiquement dans ce régime : " + (recs.length ? recs.join(" ; ") + "." : "pas de biais marqué.");
  return { label: label, desc: desc };
}

function paliersOf(d, der) {
  if (num(d.msciHigh52) === null) return [];
  if (der && der.msciIncoherent) return [];   // v5.6 : références incohérentes → aucun palier calculé
  return PALIERS.map(function (p) {
    return { p: p, seuil: r2(d.msciHigh52 * (1 - p / 100)), atteint: der.ddMsci !== null && der.ddMsci <= -p };
  });
}

function strategyOf(d, der, paliers, top) {
  var lines = [];
  if (der && der.msciIncoherent && num(d.msci) !== null && num(d.msciHigh52) !== null) {
    lines.push("⛔ RÉFÉRENCES INCOHÉRENTES : le cours (" + d.msci + " €) est à " + r1(der.ddMsci) + " % du sommet 52 sem. (" + d.msciHigh52 + " €) — unités probablement mélangées (USD/EUR). Les paliers sont désactivés. Utilise « Valeurs du 16/10/2026 » (onglet Données) pour réparer, ou réinstalle la carte.");
  } else {
  lines.push("Socle inchangé : 1 000 €/mois tout compris — 800 €/mois DCAM (Amundi PEA Monde) + 200 €/mois réserve tactique (monétaire PEA). La conjoncture ne change pas le socle, et on ne vend jamais sur baisse.");
  var next = null, i;
  for (i = 0; i < paliers.length; i++) {
    if (paliers[i].atteint && !d.paliersDone["p" + paliers[i].p]) { next = paliers[i]; break; }
  }
  var reserve = num(d.reserve);
  if (next) {
    var montant = (reserve !== null && reserve > 0) ? Math.round(reserve * 0.25) : null;
    lines.push("Palier −" + next.p + " % FRANCHI (cours " + num(d.msci) + " €, seuil " + next.seuil + " €)" + (montant !== null ? " → déployer 25 % de la réserve ≈ " + montant + " € sur DCAM, une seule fois cet épisode." : " → déployer 25 % de la réserve sur DCAM, une seule fois cet épisode."));
    lines.push("Après déploiement, marque le palier comme « déployé » ci-dessus pour l'ignorer jusqu'au prochain épisode.");
  } else {
    var pending = paliers.filter(function (p) { return p.atteint; });
    if (pending.length) {
      lines.push("Tous les paliers franchis sont marqués déployés — plus rien à faire jusqu'au palier suivant.");
    }
    var nxt = null;
    for (i = 0; i < paliers.length; i++) { if (!paliers[i].atteint) { nxt = paliers[i]; break; } }
    if (nxt && num(d.msci) !== null && nxt.seuil > 0) {
      // nxt = premier palier NON atteint → seuil toujours SOUS le cours : dist > 0 = baisse restante
      var dist = 1 - nxt.seuil / d.msci;
      lines.push("Prochain palier : −" + nxt.p + " % à " + nxt.seuil + " €, soit encore " + r1(dist * 100) + " % de baisse sous le cours actuel (" + d.msci + " €).");
    }
  }
  if (num(d.cape) !== null && d.cape >= 30) lines.push("Anti-accumulation : CAPE à " + r1(d.cape) + " (≥ 30) — hors paliers, la réserve reste au monétaire, pas de déploiement « par ennui ».");
  if (top) lines.push("Radar du jour : l'actif le plus favorable est " + top.name + " (" + top.score + "/100) — information, la stratégie PEA reste la règle.");
  }
  var warns = [];
  if (der && der.msciIncoherent) warns.push("Paliers désactivés : références incohérentes avec le cours (−" + r1(Math.abs(der.ddMsci)) + " %) — unités USD/EUR mélangées ?");
  if (reserve !== null && reserve > 3000) warns.push("Réserve > 3 000 € : règle anti-accumulation — vérifie le CAPE avant tout déploiement hors palier (actuellement " + (num(d.cape) !== null ? r1(d.cape) : "?") + ").");
  return { lines: lines, warns: warns };
}

// ---------- v5.4 : conseil d'allocation — posture, stances par actif, simulateur d'apport ----------
// Tout dérive du scoring existant (transparence) : aucune donnée nouvelle, une lecture orientée décision.
// Rappel maison : le socle PEA ne se vend jamais sur la baisse ; « alléger » ne concerne que l'enveloppe libre.

// v5.7 : la posture devient PILOTABLE — auto (timing), conseil selon la situation économique
// (regimePostureOf), ou forçage manuel par Jade. Chaque poste déplace les seuils :
// Offensive libère l'achat plus tôt, Défensive n'accepte que les scores élevés.
var POSTURES = ["Défensive", "Prudente", "Neutre", "Constructive", "Offensive"];   // rang 0 → 4
// v5.10 (B1, revue externe) : UNE SEULE table de seuils pour le conseil ET le simulateur.
// Avant : stanceOf recalculait ses seuils par décalage de rang (±5) et ALLOC_EXCL était une
// 2e table maintenue à la main — deux sources qui pouvaient diverger en silence. Chaque
// posture fixe désormais 4 seuils de stance (sur/ren/con/npr) + le seuil d'exclusion
// alloc (excl) au même endroit. La ligne « Neutre » = seuils v5.6 stricts (65/55/45/35,
// excl 45) inchangés — c'est la base en auto ; les autres lignes reproduisent EXACTEMENT
// les décalages de rang v5.7/v5.8 (vérifié au harnais : mêmes sorties, mêmes entrées).
var CUTS = {
  "Défensive":    { sur: 75, ren: 65, con: 55, npr: 45, excl: 55 },
  "Prudente":     { sur: 70, ren: 60, con: 50, npr: 40, excl: 50 },
  "Neutre":       { sur: 65, ren: 55, con: 45, npr: 35, excl: 45 },
  "Constructive": { sur: 60, ren: 50, con: 40, npr: 30, excl: 40 },
  "Offensive":    { sur: 55, ren: 45, con: 35, npr: 25, excl: 35 }
};
var ALLOC_EXCL = {};   // v5.10 : dérivé de CUTS — plus jamais une 2e table écrite à la main
POSTURES.forEach(function (p) { ALLOC_EXCL[p] = CUTS[p].excl; });
// v5.8 : plancher monétaire du simulateur — l'exclusion renormalisait les actifs restants et
// pouvait laisser la majorité du lot en or (57 %) ; en Prudente/Défensive forcées, la part de
// préservation ne descend jamais sous ce plancher.
var ALLOC_MON_FLOOR = { "Prudente": 35, "Défensive": 50 };   // en % du montant
// v5.9 : liste fermée pour toute clé de posture — « constructor »/« toString » (hérités
// d'Object.prototype) passaient le test ALLOC_EXCL[p] !== undefined et ouvraient les seuils.
function isPosture(p) { return typeof p === "string" && POSTURES.indexOf(p) !== -1; }

// v5.11 : UNIVERS RÉEL de Jade (déclaré le 18/10/2026) — le simulateur d'apport place un
// SUPPLÉMENT dans ce qu'il détient VRAIMENT, pas dans un univers théorique. Le socle mensuel
// reste « 1 000 €/mois PEA seul » (stratégie maîtresse INCHANGÉE, cf. strategie-epargne) ;
// seul le supplément (prime, don, virement) peut aller partout où il possède déjà quelque
// chose. Chaque ligne du radar = un actif réellement détenu ; « ou » = la destination
// concrète de l'argent, « reel » = le détail affiché dans le simulateur. Le private equity
// (7e actif réel) est ILLIQUIDE (fenêtres de souscription, horizon long) : affiché pour
// couvrir tout le patrimoine, jamais alloué par le simulateur. Le livret est l'épargne de
// précaution : destination possible du monétaire, mais JAMAIS compté dans la capacité paliers.
var PATRIMOINE = {
  actions:     { ou: "PEA — DCAM",                 reel: "ton socle actions (Amundi PEA Monde) — exécutable en une fois ou en DCA, paliers possibles" },
  obligations: { ou: "AV — fonds euro",            reel: "ton exposition obligataire réelle : le fonds euro de ton assurance vie (capital garanti, gains verrouillés chaque année) — l'ETF IEGA reste l'exemple marché, CTO en pause" },
  immo:        { ou: "AV — SCPI",                  reel: "tes SCPI en assurance vie — frais de souscription élevés : pertinent en une fois, pas idéal en DCA mensuel" },
  monetaire:   { ou: "Livret ou monétaire PEA",    reel: "ton livret (épargne de précaution) ou la réserve tactique du monétaire PEA — le livret ne compte jamais dans la capacité paliers" },
  or:          { ou: "Or détenu",                  reel: "tu détiens déjà de l'or — renfort possible à la reprise du CTO (SGLD), lecture d'ici là" },
  crypto:      { ou: "BTC détenu",                 reel: "tu détiens déjà du Bitcoin — renfort possible sur plateforme enregistrée PSAN ou à la reprise du CTO (BITC)" }
};
var PATRIMOINE_HORS_RADAR = [
  { nom: "Private equity", reel: "illiquide — souscriptions aux fenêtres seulement, horizon long ; affiché pour couvrir tout le patrimoine, jamais alloué par le simulateur" }
];

// v5.12 : les 7 actifs RÉELLEMENT détenus par Jade, pour l'affichage PERMANENT (carte
// « 👤 Ton patrimoine réel », onglet Radar). Avant la v5.12, l'univers réel n'était visible
// qu'en sortie de simulateur — et seulement les lignes allouées : le livret et le private
// equity n'apparaissaient nulle part en tant qu'actifs. Chaque entrée pointe vers la ligne
// du radar qui la note (radar: id → score du jour affiché), ou null = hors radar
// (private equity : illiquide, jamais alloué). Le livret est un actif à part entière
// (épargne de précaution), pas seulement la destination du monétaire.
var PATRIMOINE_ACTIFS = [
  { nom: "Actions — MSCI World",  enceinte: "PEA · DCAM",           radar: "actions",     reel: "ton socle actions (Amundi PEA Monde) — 800 €/mois en plan programmé, paliers déployés sur ce support" },
  { nom: "Fonds euro",            enceinte: "Assurance vie",        radar: "obligations", reel: "capital garanti, gains verrouillés chaque année — ton exposition obligataire réelle (l'ETF IEGA reste l'exemple marché, CTO en pause)" },
  { nom: "SCPI",                  enceinte: "Assurance vie",        radar: "immo",        reel: "frais de souscription élevés : pertinent en une fois, pas idéal en DCA mensuel" },
  { nom: "Livret",                enceinte: "Épargne de précaution", radar: "monetaire",  reel: "ta poche de sécurité — jamais compté dans la capacité paliers, jamais déployé en paliers" },
  { nom: "Or",                    enceinte: "Détenu",               radar: "or",          reel: "déjà détenu — renfort possible à la reprise du CTO (SGLD), lecture d'ici là" },
  { nom: "Bitcoin",               enceinte: "Détenu",               radar: "crypto",      reel: "déjà détenu — renfort possible sur plateforme enregistrée PSAN ou à la reprise du CTO (BITC)" },
  { nom: "Private equity",        enceinte: "Hors radar",           radar: null,          reel: "illiquide — souscriptions aux fenêtres seulement, horizon long ; jamais alloué par le simulateur" }
];

function stanceOf(score, posture) {
  var c = isPosture(posture) ? CUTS[posture] : CUTS["Neutre"];   // inconnu/absent → base v5.6 (v5.10 : lit CUTS, plus de recalcul de rang)
  if (score >= c.sur) return { cls: "good", label: "Sur-pondérer", verb: "INVESTIR" };
  if (score >= c.ren) return { cls: "good", label: "Renforcer", verb: "INVESTIR" };
  if (score >= c.con) return { cls: "mid", label: "Conserver", verb: "CONSERVER" };
  if (score >= c.npr) return { cls: "mid", label: "Ne pas renforcer", verb: "ATTENDRE" };
  return { cls: "bad", label: "Sous-pondérer", verb: "SOUS-PONDÉRER" };
}

// v5.7/v5.8 : lecture descriptive du contexte macro (croissance PMI, inflation, direction BCE,
// stress de marché). ATTENTION : PMI/BCE/VIX sont PARTAGÉS avec le timing — ce n'est pas un
// signal indépendant, d'où un vocabulaire séparé (risque macro : Calme/Modéré/Tendu/Stress)
// pour ne pas prêter à confusion avec la posture de timing (Offensive…Défensive).
// Heuristique transparente (base 50, déplacements motivés un par un), non validée historiquement.
function regimePostureOf(d) {
  var pmi = num(d.pmiZE), inf = num(d.inflZE), vx = (num(d.vix5) !== null) ? num(d.vix5) : num(d.vix);
  var sc = 50, drv = [];
  if (pmi !== null) {
    if (pmi >= 53) { sc += 8; drv.push("PMI " + r1(pmi) + " (expansion franche)"); }
    else if (pmi >= 50) { sc += 4; drv.push("PMI " + r1(pmi) + " (croissance modérée)"); }
    else if (pmi >= 47) { sc -= 6; drv.push("PMI " + r1(pmi) + " (ralentissement)"); }
    else { sc -= 12; drv.push("PMI " + r1(pmi) + " (contraction)"); }
  }
  if (inf !== null) {
    if (inf >= 3) { sc -= 4; drv.push("inflation " + r1(inf) + " % (élevée)"); }
    else if (inf < 2) { sc += 4; drv.push("inflation " + r1(inf) + " % (sous contrôle)"); }
    else drv.push("inflation " + r1(inf) + " % (au-dessus de la cible)");
  }
  if (d.bceDir === "hausse") { sc -= 6; drv.push("BCE en relèvement"); }
  else if (d.bceDir === "baisse") { sc += 6; drv.push("BCE en assouplissement"); }
  else if (d.bceDir === "stable") { drv.push("BCE en pause"); }
  if (vx !== null) {
    if (vx >= 25) { sc -= 8; drv.push("VIX lissé " + r1(vx) + " (stress)"); }
    else if (vx < 18) { sc += 4; drv.push("VIX lissé " + r1(vx) + " (calme)"); }
  }
  sc = clampScore(sc);
  var posture = (sc >= 65) ? "Offensive" : (sc >= 55) ? "Constructive" : (sc >= 45) ? "Neutre" : (sc >= 35) ? "Prudente" : "Défensive";
  var risque = (sc >= 55) ? "Calme" : (sc >= 45) ? "Modéré" : (sc >= 35) ? "Tendu" : "Stress";   // v5.8 : vocabulaire macro séparé du timing
  return { score: sc, posture: posture, risque: risque, drivers: drv.join(" · ") };
}

// v5.10 (B2, revue externe) : UNE SEULE source pour « une fois / hybride / DCA ». Avant, la
// synthèse du conseil (adviceOf) promettait « les apports peuvent aller au marché sans
// attendre » (texte Offensive inconditionnel) alors que le verdict du simulateur, calculé
// séparément dans allocOf, disait « hybride » ou « DCA » le même jour — contradiction réelle
// signalée par la revue. Les deux lisent maintenant cette fonction : impossible de se
// contredire. Traçabilité (v5.9, inchangée) : +8 si drawdown ≤ −10 % (marché déjà corrigé) ;
// −6 à moins de 3 % du sommet 52 sem. (risque d'acheter le pic) ; −5 si CAPE ≥ 30
// (valorisations tendues) ; « une fois » ≥ 60, « hybride » 45-59, « DCA » < 45 — heuristique
// motivée point par point, NON validée historiquement (cf. note de méthode).
function entryPrefOf(d, der, timingScore) {
  var cape = num(d.cape), ddM = (der && num(der.ddMsci) !== null) ? der.ddMsci : null;
  var pref = (num(timingScore) !== null) ? num(timingScore) : null;
  if (pref === null) pref = 50;   // v5.10 (B3) : sans donnée chiffrable, base Neutre — le résultat est TRACÉ manquant par l'appelant, jamais glissé en silence
  if (ddM !== null && ddM <= -10) pref += 8;     // marché déjà corrigé : moins de risque d'entrée
  if (ddM !== null && ddM > -3) pref -= 6;       // au contact du sommet : risque d'acheter le pic
  if (cape !== null && cape >= 30) pref -= 5;    // valorisations tendues : prudence sur la mise en une fois
  pref = clampScore(pref);
  var recommande = (pref >= 60) ? "une fois" : (pref >= 45) ? "hybride" : "dca";
  var labels = {
    "une fois": "Les signaux d'opportunité suffisent, inutile d'attendre un point d'entrée meilleur.",
    "hybride": "Moitié immédiate, moitié étalée — le compromis entre regret et rendement.",
    "dca": "Étaler l'apport : le contexte ne se prête pas à tout miser aujourd'hui."
  };
  var phrases = {
    "une fois": "un apport du jour peut aller au marché sans attendre",
    "hybride": "un apport du jour se lisse — moitié immédiate, moitié étalée",
    "dca": "un apport du jour s'étale plutôt qu'il ne se place d'un coup"
  };
  return { pref: pref, recommande: recommande, label: labels[recommande], phrase: phrases[recommande] };
}

function adviceOf(d, radar, override) {
  var der = radar.der;
  var byId = {};
  radar.list.forEach(function (a) { byId[a.id] = a; });
  var res = { posture: "", postureScore: 0, timingScore: null, detail: "", synthese: "", assets: [], contexte: [], desinv: [] };
  var act = byId.actions || null;
  // v5.6 : la posture suit le TIMING (drawdown, VIX, BCE, PMI) qui bouge ; la valorisation
  // (CAPE) est lente et structurelle → affichée en contexte, pas en signal du jour.
  // v5.10 (B3) : plus de repli muet sur 50 — si le timing ET le score des actions sont
  // absents, la base Neutre est prise mais TRACÉE (res.manquantes) : le conseil dit
  // « données manquantes » au lieu d'inventer un score.
  var ap = (act && num(act.timingScore) !== null) ? act.timingScore : (act ? num(act.score) : null);
  res.manquantes = (ap === null);
  if (ap === null) ap = 50;
  res.timingScore = ap;
  res.postureScore = ap;
  if (ap >= 65) res.posture = "Offensive";
  else if (ap >= 55) res.posture = "Constructive";
  else if (ap >= 45) res.posture = "Neutre";
  else if (ap >= 35) res.posture = "Prudente";
  else res.posture = "Défensive";
  // v5.7 : forçage manuel — une posture choisie prime sur l'auto (tracée), stances et simulateur alignés.
  res.autoPosture = res.posture;
  res.autoPostureScore = ap;
  res.override = (typeof override === "string" && POSTURES.indexOf(override) !== -1) ? override : null;
  if (res.override) res.posture = res.override;
  var top = radar.list[0];
  if (res.manquantes)
    res.detail = "Données manquantes : ni le timing ni le score des actions ne sont chiffrables aujourd'hui — conseil affiché sur la base Neutre (50), mets à jour le relevé. Règles de sécurité (jamais vendre sur la baisse) et stratégie PEA restent maîtresses.";
  else if (res.override)
    res.detail = "Posture choisie : " + res.override + " — elle déplace les SEUILS des stances et du simulateur, jamais les scores ; en auto, ce sont les seuils de base qui s'appliquent. L'auto (timing actions " + ap + "/100) aurait dit " + res.autoPosture + ", l'auto reste affichée pour comparaison. Règles de sécurité (jamais vendre sur la baisse) et stratégie PEA restent maîtresses.";
  else
    res.detail = "Pilotée par le timing actions (" + ap + "/100 — drawdown, VIX, direction BCE, PMI). Actif le plus favorable du jour : " + top.name + " (" + top.score + "/100).";
  var syn = {
    "Offensive": "Le timing domine à l'achat : la trajectoire d'investissement reste la bonne.",
    "Constructive": "Contexte globalement favorable : investir reste la bonne trajectoire.",
    "Neutre": "Aucun signal de timing fort dans un sens ou l'autre : la régularité du socle prime.",
    "Prudente": "Le timing dégradé appelle la prudence : privilégier monétaire et actifs défensifs.",
    "Défensive": "Préservation du capital d'abord : monétaire, or en couverture, aucune précipitation."
  };
  // v5.10 (B2) : la phrase d'entrée d'apport vient de la MÊME source que le verdict du
  // simulateur (entryPrefOf) — conseil et simulateur ne peuvent plus se contredire le même
  // jour. Les textes de posture ci-dessus ne promettent plus rien sur l'entrée d'un apport.
  var ep = entryPrefOf(d, der, res.manquantes ? null : ap);
  res.synthese = syn[res.posture] + " Entrée : " + ep.phrase + " (" + ep.pref + "/100).";
  // v5.7/v5.8 : risque macro descriptif (vocabulaire séparé du timing : Calme/Modéré/Tendu/Stress)
  var rg = regimePostureOf(d);
  res.regime = { risque: rg.risque, score: rg.score, drivers: rg.drivers };   // v5.9 : plus de « posture » régime — jamais affichée, vocabulaire abandonné
  radar.list.forEach(function (a) {
    // v5.8 : les seuils ne sont déplacés QUE par le FORÇAGE manuel (en auto, seuils de base v5.6) ;
    // le monétaire (préservation) garde toujours ses seuils de base ; les actions sont pilotées
    // par leur TIMING — le score global, verrouillé par le CAPE structurel, interdisait tout achat.
    var st;
    if (a.id === "monetaire") st = stanceOf(a.score);
    else if (a.id === "actions") st = stanceOf(ap, res.override);
    else st = stanceOf(a.score, res.override);
    // v5.9 : « Sous-pondérer » sur les actions se lirait comme un conseil de VENTE, en
    // contradiction avec la règle maison (le socle PEA ne se vend jamais sur la baisse) —
    // vocabulaire d'apports à la place.
    if (a.id === "actions" && st.verb === "SOUS-PONDÉRER") st = { cls: "mid", label: "Apports minimum", verb: "RALENTIR" };
    var why = a.parts.slice().sort(function (x, y) { return Math.abs(y.pts) - Math.abs(x.pts); }).slice(0, 2).map(function (p) { return p.label.split(" (")[0]; });
    if (a.id === "actions") why = ["timing " + ap + "/100 — drawdown · VIX · BCE · PMI"];   // v5.9 : la stance actions est pilotée par le timing — la justification aussi (le CAPE reste en « contexte »)
    if (a.partial) why = ["score partiel : 52 sem. manquantes"];
    res.assets.push({ id: a.id, icon: a.icon, name: a.name, score: a.score, stance: st.label, cls: st.cls, verb: st.verb, why: why.join(" · ") });
  });
  // ---- contexte de valorisation (axes LENTS : information structurelle, pas des signaux du jour) ----
  var cape = num(d.cape), ddM = der.ddMsci, ddO = der.ddOr, tr = der.tauxReelZE, marge = der.imoMarge;
  if (cape !== null && cape >= 30)
    res.contexte.push("Valorisation lente : CAPE " + r1(cape) + " — les actions vivent au-dessus de leurs valorisations historiques, rendements long terme attendus faibles. C'est un contexte structurel, pas un signal du jour : il ne déclenche rien à lui seul.");
  if (d.bceDir === "hausse")
    res.contexte.push("BCE en relèvement : tant que le cycle n'est pas retourné, la poche obligations se limite aux maturités courtes ou au taux variable.");
  if (marge !== null && marge < 0)
    res.contexte.push("Immobilier : rendement locatif (" + r1(num(d.imoRendement)) + " %) sous le coût du crédit (OAT " + r1(num(d.oat10)) + " %) — défavorable aux nouvelles souscriptions SCPI.");
  // ---- signaux d'arbitrage / désinvestissement (uniquement DÉCLENCHÉS par le prix, jamais permanents) ----
  if (ddM !== null && ddM <= -5)
    res.desinv.push("Actions en drawdown (" + r1(ddM) + " %) — règle maison absolue : on ne vend JAMAIS sur la baisse ; les paliers tactiques achètent cette faiblesse au contraire.");
  if (byId.or && ddO !== null && ddO > -3 && tr !== null && tr > 0 && byId.or.score < 55)
    res.desinv.push("Or : à " + r1(-ddO) + " % du sommet 52 sem. avec des taux réels positifs (" + r1(tr) + " %) — prise de profit partielle possible sur l'ETF ou le physique si besoin de liquidités.");
  // v5.8 : avertissement de cohérence — forcer une posture en plein drawdown ne suspend jamais
  // la règle maison (les paliers tactiques ACHÈTENT cette faiblesse).
  res.warns = [];
  if (res.override && ddM !== null && ddM <= -5)
    res.warns.push("Posture forcée en plein drawdown (" + r1(ddM) + " %) : la règle maison des paliers reste maîtresse — elle achète cette faiblesse ; le forçage déplace des seuils d'entrée, il ne remplace jamais la stratégie PEA.");
  else if (ddM !== null && ddM <= -5 && ap < (res.override ? ALLOC_EXCL[res.override] : 45))
    res.warns.push("Le simulateur exclura les actions de tout apport (timing " + ap + " < seuil " + (res.override ? ALLOC_EXCL[res.override] : 45) + ") alors que le marché est en drawdown (" + r1(ddM) + " %) : la règle maison des paliers ACHÈTE cette faiblesse — le simulateur ne remplace jamais la stratégie PEA.");
  return res;
}

// Simulateur d'apport : répartition d'un montant exceptionnel (hors socle mensuel).
var ALLOC_IDS = ["actions", "obligations", "or", "monetaire", "immo", "crypto"];
var ALLOC_BASE = { actions: 40, obligations: 15, or: 12, monetaire: 13, immo: 15, crypto: 5 };   // pondération de référence (somme 100)

function allocOf(montant, mode, months, d, radar, posture) {
  var m = num(montant);
  if (m === null || m < 1 || m > 10000000) return null;   // v5.9 : borne basse alignée sur le message d'erreur (« entre 1 et 10 000 000 »)
  if (mode !== "une fois" && mode !== "dca") return null;
  var n = null;
  if (mode === "dca") {
    n = Number(months);
    if (n !== Math.floor(n) || n < 2 || n > 24) return null;   // v5.9 : ENTIER strict — « 2.9 » n'est plus silencieusement tronqué en 2 (parseInt), NaN/1/25 rejetés
  }
  var byId = {};
  radar.list.forEach(function (a) { byId[a.id] = a; });
  // v5.7/v5.8 : le seuil d'exclusion suit UNIQUEMENT la posture FORCÉE — en auto, seuil de base
  // 45 (comportement v5.6 strict) : la posture auto ne décale plus rien. En Défensive forcée on
  // n'achète que ce qui est solide (≥ 55), en Offensive forcée le seuil descend à 35. Le monétaire
  // reste TOUJOURS éligible : c'est l'actif de préservation, l'exclure n'a pas de sens.
  var seuil = isPosture(posture) ? CUTS[posture].excl : 45;   // v5.9 : liste fermée — « constructor » n'ouvre plus les seuils ; v5.10 (B1) : lu dans CUTS, la même table que stanceOf
  var cape = num(d.cape);
  var raw = {}, total = 0, i, k, manquantes = [];
  for (i = 0; i < ALLOC_IDS.length; i++) {
    k = ALLOC_IDS[i];
    var sc = byId[k] ? num(byId[k].score) : null;
    if (sc === null) { raw[k] = 0; manquantes.push(k); continue; }   // v5.10 (B3) : actif non chiffrable = exclu et TRACÉ « données manquantes » — plus de score inventé (repli 50 muet)
    if (k === "actions") {
      // v5.8 : les actions sont pilotées par leur TIMING — le score global, verrouillé par le
      // CAPE structurel (−24 en données du jour), les excluait à jamais, même en Offensive.
      // Éligibilité ET tilt sur le timing ; CAPE ≥ 30 → tilt plafonné à ×1,0 (valorisations
      // tendues : jamais de bonus d'achat) — la valorisation reste un garde-fou, plus un verrou.
      var actA = byId.actions;
      var ts = (actA && num(actA.timingScore) !== null) ? actA.timingScore : sc;
      var multA = Math.max(0.4, Math.min(1.6, ts / 50));
      if (cape !== null && cape >= 30) multA = Math.min(multA, 1.0);
      raw[k] = (ts >= seuil) ? ALLOC_BASE[k] * multA : 0;
    } else {
      raw[k] = (k === "monetaire" || sc >= seuil) ? ALLOC_BASE[k] * Math.max(0.4, Math.min(1.6, sc / 50)) : 0;
    }
    total += raw[k];
  }
  // v5.10 (B3) : le monétaire était « toujours éligible » par construction (scores clampés par
  // radarAll) — depuis qu'un score manquant est traité honnêtement (exclu, tracé), total peut
  // être nul. Plus de répartition inventée ni de division par zéro : lot signalé manquant,
  // alerte explicite, verdict neutralisé. La propriété (somme = montant au €) est testée au harnais.
  if (total <= 0) {
    var partsVides = [], pi, pk, pa;
    for (pi = 0; pi < ALLOC_IDS.length; pi++) {
      pk = ALLOC_IDS[pi]; pa = byId[pk];
      partsVides.push({ id: pk, icon: pa ? pa.icon : "•", name: pa ? pa.name : pk, pct: 0, euros: 0, exclu: true, manquant: true, ou: (PATRIMOINE[pk] ? PATRIMOINE[pk].ou : null) });   // v5.11
    }
    return {
      montant: m, mode: mode, months: n, mensualite: n ? r2(m / n) : null,
      parts: partsVides, pref: null, recommande: null, recommandeLabel: null,
      posture: isPosture(posture) ? posture : null, seuil: seuil,
      alerte: "Données insuffisantes : aucun actif n'est chiffrable aujourd'hui (" + manquantes.join(", ") + ") — mets à jour le relevé avant de simuler un apport.",
      manquantes: manquantes,
      note: "Aucune répartition calculée : le simulateur n'invente pas de score."
    };
  }
  var shares = {};
  for (i = 0; i < ALLOC_IDS.length; i++) { k = ALLOC_IDS[i]; shares[k] = raw[k] / total; }
  // v5.8 : plancher monétaire en Prudente (35 %) et Défensive (50 %) forcées — l'exclusion
  // renormalisait les actifs restants (or jusqu'à 57 % en Défensive) : la préservation ne se
  // dilue pas. Les actifs risqués restants sont renormalisés sur (100 − plancher).
  var floor = (isPosture(posture) && ALLOC_MON_FLOOR[posture] !== undefined) ? ALLOC_MON_FLOOR[posture] / 100 : 0;   // v5.9 : liste fermée
  if (floor > 0 && shares.monetaire < floor) {
    var restRaw = 0;
    for (i = 0; i < ALLOC_IDS.length; i++) { k = ALLOC_IDS[i]; if (k !== "monetaire") restRaw += raw[k]; }
    if (restRaw > 0) {
      for (i = 0; i < ALLOC_IDS.length; i++) {
        k = ALLOC_IDS[i];
        shares[k] = (k === "monetaire") ? floor : raw[k] / restRaw * (1 - floor);
      }
    }
  }
  var parts = [], sum = 0, firstIdx = -1;
  for (i = 0; i < ALLOC_IDS.length; i++) {
    k = ALLOC_IDS[i];
    var a = byId[k];
    var excl = !(shares[k] > 0);
    if (!excl && firstIdx === -1) firstIdx = i;
    var eur = Math.round(m * shares[k]);
    sum += eur;
    parts.push({ id: k, icon: a ? a.icon : "•", name: a ? a.name : k, pct: r1(shares[k] * 100), euros: eur, exclu: excl, manquant: (manquantes.indexOf(k) !== -1), ou: (PATRIMOINE[k] ? PATRIMOINE[k].ou : null) });   // v5.11 : destination réelle de l'argent chez Jade
  }
  if (firstIdx !== -1) parts[firstIdx].euros += m - sum;   // reste d'arrondi au premier actif inclus (déterministe)
  // verdict « une fois » vs « DCA » : piloté par le TIMING actions (le CAPE, lent, pèse à part).
  // v5.9 — traçabilité des seuils (heuristiques motivées point par point, NON validées
  // historiquement — cf. note de méthode) : +8 si drawdown ≤ −10 % (marché déjà corrigé, prix
  // bas absorbés) ; −6 à moins de 3 % du sommet 52 sem. (risque d'acheter le pic maximal) ;
  // −5 si CAPE ≥ 30 (valorisations tendues) ; « une fois » à ≥ 60, « hybride » sur 45-59
  // (l'indécision honnête entre regret et rendement — repère Vanguard ~2/3).
  var ddM = radar.der.ddMsci;
  // v5.10 (B2) : le verdict passe par entryPrefOf — la MÊME fonction que la synthèse du conseil
  // (adviceOf). Fin de la contradiction « sans attendre » (conseil) vs « hybride » (simulateur)
  // le même jour : une seule source, deux affichages. Traçabilité des seuils : cf. entryPrefOf
  // (v5.9, conservée telle quelle : +8 / −6 / −5 ; « une fois » ≥ 60, « hybride » 45-59, « DCA » < 45).
  var actTs = (actA && num(actA.timingScore) !== null) ? actA.timingScore : (actA ? actA.score : null);
  var ver = entryPrefOf(d, radar.der, actTs);
  var pref = ver.pref;
  var recommande = ver.recommande;
  // v5.9 : alerte fondée sur le RÉSULTAT (actions réellement exclues de ce lot), plus sur la
  // posture choisie — la contradiction avec la règle maison existe aussi en auto ou en Prudente
  // forcée, dès que le timing passe sous le seuil pendant un drawdown.
  var actExclues = false;
  for (i = 0; i < parts.length; i++) if (parts[i].id === "actions" && parts[i].exclu) actExclues = true;
  var alerte = (actExclues && ddM !== null && ddM <= -5)
    ? "Actions exclues de ce lot alors que le marché est en drawdown (" + r1(ddM) + " %) : ta règle maison ACHÈTE cette faiblesse aux paliers (−5/−10/−15/−20 %) — le simulateur ne remplace jamais la stratégie PEA."
    : null;
  return {
    montant: m, mode: mode, months: n,
    mensualite: n ? r2(m / n) : null,
    parts: parts, pref: pref, recommande: recommande, recommandeLabel: ver.label,
    manquantes: (manquantes.length > 0) ? manquantes : null,
    posture: isPosture(posture) ? posture : null,
    seuil: seuil,
    alerte: alerte,
    note: "Méthode : pondération de référence (actions 40 % · immo 15 % · obligations 15 % · monétaire 13 % · or 12 % · crypto 5 %) pondérée par le score du jour (× score/50, borné ×0,4 à ×1,6) — pour les actions, le TIMING du jour pilote éligibilité et tilt, avec tilt plafonné à ×1,0 si CAPE ≥ 30 ; renormalisée à 100 %. Les actifs sous le seuil de la posture CHOISIE sont exclus (en auto, seuil de base 45 quelle que soit la posture automatique ; 35 en Offensive forcée, 55 en Défensive forcée). L'éligibilité au seuil est BINAIRE : un score juste sous le seuil reçoit 0 %, juste au-dessus la pondération pleine — une falaise, pas une rampe ; choix assumé pour garder « auto = seuils v5.6 stricts », documenté ici plutôt que lissé (rampe écartée en revue v5.10). Le monétaire reste toujours éligible (actif de préservation) avec un plancher de 35 % en Prudente et 50 % en Défensive forcées. Un actif sans score chiffrable est exclu et affiché « données manquantes », jamais noté 50 en silence. En DCA, la répartition est recalculée à chaque échéance sur les données du jour. Repère : sur les actions US 1926-2015, l'étude Vanguard « Cost Averaging: Invest Now or Temporarily Hold Your Cash » trouve que l'investissement en une fois bat le DCA ~2 fois sur 3 — un résultat propre à cette étude, qui ne valide pas ce simulateur multi-actifs. Heuristique transparente, pas un conseil financier : l'allocation dépend aussi de ton horizon, de ton portefeuille existant et de ta tolérance au risque (non demandés ici). Le verdict « une fois / hybride / DCA » (seuils 60/45, ajustements +8 / −6 / −5) est une heuristique motivée point par point, non validée historiquement."
  };
}

function parseGecko(json) {
  try {
    var prices = json && json.prices;
    if (!prices || !prices.length) return null;
    var high = -Infinity, low = Infinity, cur = prices[prices.length - 1][1];
    for (var i = 0; i < prices.length; i++) {
      var v = prices[i][1];
      if (typeof v !== "number" || !isFinite(v)) return null;
      if (v > high) high = v;
      if (v < low) low = v;
    }
    if (typeof cur !== "number" || !isFinite(cur)) return null;
    return { cur: r2(cur), high: r2(high), low: r2(low) };
  } catch (e) { return null; }
}

function staleDays(dateStr, nowMs) {
  var t = Date.parse(dateStr + "T12:00:00Z");
  if (isNaN(t)) return null;
  return Math.floor((nowMs - t) / 86400000);
}

// v5.9 : validité CALENDAIRE stricte d'une date YYYY-MM-DD — le regex seul acceptait 2026-02-30
// ou 2026-99-99. Utilisée par la sanitisation d'import du forçage daté ; l'UI a son équivalent
// en jours locaux (daysSinceLocal) pour l'expiration.
function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var y = +s.slice(0, 4), m = +s.slice(5, 7), d = +s.slice(8, 10), t = new Date(y, m - 1, d);
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d;
}

function normalizeData(d) {
  // Un champ PRÉSENT mais vidé (null / "") reste vide → « donnée manquante » (jamais la valeur
  // par défaut du 17/10, sinon vix5 reviendrait à 16,76 pour toujours). Seule l'ABSENCE
  // totale du champ retombe sur DEFAULT_DATA.
  var out = {};
  FIELDS.forEach(function (f) {
    if (!f.k) return;
    var has = Object.prototype.hasOwnProperty.call(d, f.k);
    if (f.t === "num") {
      out[f.k] = num(d[f.k]) !== null ? num(d[f.k]) : (has ? null : num(DEFAULT_DATA[f.k]));
    } else if (f.t === "sel") {
      out[f.k] = ["hausse", "stable", "baisse"].indexOf(d[f.k]) >= 0 ? d[f.k] : DEFAULT_DATA[f.k];
    } else {
      out[f.k] = has ? (typeof d[f.k] === "string" ? d[f.k] : "") : DEFAULT_DATA[f.k];
    }
  });
  out.paliersDone = { p5: false, p10: false, p15: false, p20: false };
  if (d.paliersDone) PALIERS.forEach(function (p) { out.paliersDone["p" + p] = !!d.paliersDone["p" + p]; });
  // v5.6 : sources datées véhiculées par data.json/data-daily.json (affichées dans l'onglet
  // Données à la place de SOURCES codées en dur). Sanitisation stricte : paires de chaînes.
  out.sources = null;
  if (Array.isArray(d.sources)) {
    var srcs = d.sources.map(function (s) {
      return (Array.isArray(s) && typeof s[0] === "string" && s[0] && typeof s[1] === "string" && s[1]) ? [s[0], s[1]] : null;
    }).filter(Boolean).slice(0, 20);
    if (srcs.length) out.sources = srcs;
  }
  return out;
}

function snapshotOf(d, radar) {
  return {
    date: d.dateData,
    top: radar.list[0].name,
    topScore: radar.list[0].score,
    scores: radar.list.reduce(function (m, a) { m[a.id] = a.score; return m; }, {}),
    ddMsci: radar.der.ddMsci
  };
}

var SOURCES = [
  ["MSCI World (IWDA) : 130,55 € (clôture du 16/10/2026, IWDA.AS Euronext Amsterdam) ; plus haut 52 sem. 132,26 € (12/10/2026) ; plus bas 107,51 €", "Yahoo Finance (IWDA.AS) — même source pour le cours et les références 52 sem."],
  ["CAPE Shiller : 40,38 (01/10/2026) — 98,9e percentile historique, seule la bulle 1999-2000 a été plus haute", "GuruFocus, corroboré par thetrading.tools (40,7)"],
  ["VIX : 19,99 (+21,5 %, clôture du 16/10/2026) ; moyenne 5 séances : 16,76", "CBOE via Yahoo Finance (^VIX)"],
  ["Inflation zone euro : 3,8 % en septembre 2026 (confirmé le 16/10, en hausse depuis 3 mois ; énergie +18,8 %)", "Eurostat, communiqués du 02/10 et du 16/10/2026"],
  ["Inflation US : 3,7 % en septembre 2026 (core 2,6 %) ; essence +34,2 % sur un an", "BLS via CNBC / Trading Economics (14/10/2026)"],
  ["BCE : taux de dépôt 2,50 % (+25 pb, décision du 10/09/2026) ; marché attend stable le 29/10 (90 %)", "Communiqué BCE, ECB Watch Tool"],
  ["Bund 10 ans : 3,42 % ; OAT 10 ans : 4,79 % ; spread ≈ 137 pb (16/10/2026)", "Trading Economics / suivi spread OAT-Bund"],
  ["PMI composite zone euro : 53,1 en septembre 2026 (plus haut depuis 3,5 ans)", "S&P Global"],
  ["Or : 3 729,84 €/once (16/10/2026, 4 186,70 $ / taux ECB 1,1225) ; fourchette 52 sem. 3 387–4 592 €", "Yahoo Finance / BCE"],
  ["Bitcoin : 72 598 € (17/10/2026)", "CoinGecko"]
];

// ---------- Sanitisation des imports (anti-injection HTML) ----------
// Les exports/imports JSON contiennent de l'état (historique, épisodes, alertes) qui est
// injecté dans l'UI : un fichier malveillant ne doit jamais pouvoir y glisser du HTML.
// Coercition stricte : chaînes tronquées, nombres ou rien.

function Auto_sanStr(x, maxLen) {
  if (typeof x === "string") return x.slice(0, maxLen || 60);
  if (typeof x === "number" && isFinite(x)) return String(x);
  return "";
}
function Auto_sanNum(x) {
  return (typeof x === "number" && isFinite(x)) ? x : null;
}

function Auto_sanitizeImport(raw) {
  var out = { history: [], episodes: [], refAlert: null };
  if (!raw || typeof raw !== "object") return out;
  if (Array.isArray(raw.history)) {
    out.history = raw.history.slice(0, 200).map(function (h) {
      if (!h || typeof h !== "object") return null;
      var o = {
        date: Auto_sanStr(h.date, 10),
        top: Auto_sanStr(h.top, 60),
        topScore: Auto_sanNum(h.topScore),
        scores: {},
        ddMsci: Auto_sanNum(h.ddMsci)
      };
      if (h.scores && typeof h.scores === "object") {
        Object.keys(h.scores).slice(0, 12).forEach(function (k) {
          o.scores[Auto_sanStr(k, 20)] = Auto_sanNum(h.scores[k]);
        });
      }
      return o;
    }).filter(Boolean);
  }
  if (Array.isArray(raw.episodes)) {
    out.episodes = raw.episodes.slice(0, 50).map(function (e) {
      if (!e || typeof e !== "object") return null;
      return {
        date: Auto_sanStr(e.date, 10),
        oldHigh52: Auto_sanNum(e.oldHigh52),
        newHigh52: Auto_sanNum(e.newHigh52),
        deployed: Auto_sanNum(e.deployed)
      };
    }).filter(Boolean);
  }
  if (raw.refAlert && typeof raw.refAlert === "object") {
    var ra = { date: Auto_sanStr(raw.refAlert.date, 10), from: Auto_sanNum(raw.refAlert.from), to: Auto_sanNum(raw.refAlert.to) };
    out.refAlert = (ra.date && ra.from !== null && ra.to !== null) ? ra : null;
  }
  // v5.7/v5.8 : forçage importé seulement s'il est dans la liste (anti-injection), avec sa date
  // de forçage (YYYY-MM-DD) — le forçage expire après 30 jours (v5.8).
  if (typeof raw.postureOverride === "string" && POSTURES.indexOf(raw.postureOverride) !== -1) {
    out.postureOverride = raw.postureOverride;
    if (typeof raw.postureOverrideDate === "string" && isRealDate(raw.postureOverrideDate))
      out.postureOverrideDate = raw.postureOverrideDate;   // v5.9 : date calendaire RÉELLE (2026-02-30 rejeté), pas seulement le format
  }
  return out;
}

// Export Node pour le harnais de tests (logique pure, aucun accès DOM).
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_DATA: DEFAULT_DATA, FIELDS: FIELDS, PALIERS: PALIERS, SOURCES: SOURCES,
    num: num, r1: r1, r2: r2, pctDD: pctDD, clampScore: clampScore, fmtPts: fmtPts,
    stepScore: stepScore, computeDerived: computeDerived, regimeOf: regimeOf,
    paliersOf: paliersOf, strategyOf: strategyOf, normalizeData: normalizeData,
    snapshotOf: snapshotOf, badgeOf: badgeOf, radarAll: radarAll, parseGecko: parseGecko,
    staleDays: staleDays, Auto_sanStr: Auto_sanStr, Auto_sanNum: Auto_sanNum, Auto_sanitizeImport: Auto_sanitizeImport,
    stanceOf: stanceOf, adviceOf: adviceOf, allocOf: allocOf, entryPrefOf: entryPrefOf,
    regimePostureOf: regimePostureOf, POSTURES: POSTURES, ALLOC_EXCL: ALLOC_EXCL, ALLOC_MON_FLOOR: ALLOC_MON_FLOOR, CUTS: CUTS,
    isRealDate: isRealDate, isPosture: isPosture,
    PATRIMOINE: PATRIMOINE, PATRIMOINE_HORS_RADAR: PATRIMOINE_HORS_RADAR, PATRIMOINE_ACTIFS: PATRIMOINE_ACTIFS   // v5.11/v5.12 : univers réel de Jade (mapping + liste des 7 actifs)
  };
}
