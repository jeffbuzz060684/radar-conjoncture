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

function stanceOf(score) {
  if (score >= 65) return { cls: "good", label: "Sur-pondérer", verb: "INVESTIR" };
  if (score >= 55) return { cls: "good", label: "Renforcer", verb: "INVESTIR" };
  if (score >= 45) return { cls: "mid", label: "Conserver", verb: "CONSERVER" };
  if (score >= 35) return { cls: "mid", label: "Ne pas renforcer", verb: "ATTENDRE" };
  return { cls: "bad", label: "Sous-pondérer", verb: "SOUS-PONDÉRER" };
}

function adviceOf(d, radar) {
  var der = radar.der;
  var byId = {};
  radar.list.forEach(function (a) { byId[a.id] = a; });
  var res = { posture: "", postureScore: 0, timingScore: null, detail: "", synthese: "", assets: [], contexte: [], desinv: [] };
  var act = byId.actions || null;
  // v5.6 : la posture suit le TIMING (drawdown, VIX, BCE, PMI) qui bouge ; la valorisation
  // (CAPE) est lente et structurelle → affichée en contexte, pas en signal du jour.
  var ap = (act && num(act.timingScore) !== null) ? act.timingScore : (act ? act.score : 50);
  res.timingScore = ap;
  res.postureScore = ap;
  if (ap >= 65) res.posture = "Offensive";
  else if (ap >= 55) res.posture = "Constructive";
  else if (ap >= 45) res.posture = "Neutre";
  else if (ap >= 35) res.posture = "Prudente";
  else res.posture = "Défensive";
  var top = radar.list[0];
  res.detail = "Pilotée par le timing actions (" + ap + "/100 — drawdown, VIX, direction BCE, PMI). Actif le plus favorable du jour : " + top.name + " (" + top.score + "/100).";
  var syn = {
    "Offensive": "Le timing domine à l'achat : les apports peuvent aller au marché sans attendre, l'étalement n'apporte que du confort psychologique.",
    "Constructive": "Contexte globalement favorable : investir reste la bonne trajectoire ; un gros apport se lisse pour réduire le risque d'entrée.",
    "Neutre": "Aucun signal de timing fort dans un sens ou l'autre : la régularité du socle prime, un apport exceptionnel se lisse plutôt qu'il ne se place d'un coup.",
    "Prudente": "Le timing dégradé appelle la prudence : privilégier monétaire et actifs défensifs, étaler tout apport sur les actifs risqués.",
    "Défensive": "Préservation du capital d'abord : monétaire, or en couverture, apports sur les actifs risqués différés — aucune précipitation."
  };
  res.synthese = syn[res.posture];
  radar.list.forEach(function (a) {
    var st = stanceOf(a.score);
    var why = a.parts.slice().sort(function (x, y) { return Math.abs(y.pts) - Math.abs(x.pts); }).slice(0, 2).map(function (p) { return p.label.split(" (")[0]; });
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
  return res;
}

// Simulateur d'apport : répartition d'un montant exceptionnel (hors socle mensuel).
var ALLOC_IDS = ["actions", "obligations", "or", "monetaire", "immo", "crypto"];
var ALLOC_BASE = { actions: 40, obligations: 15, or: 12, monetaire: 13, immo: 15, crypto: 5 };   // pondération de référence (somme 100)

function allocOf(montant, mode, months, d, radar) {
  var m = num(montant);
  if (m === null || m <= 0 || m > 10000000) return null;
  if (mode !== "une fois" && mode !== "dca") return null;
  var n = null;
  if (mode === "dca") {
    n = parseInt(months, 10);
    if (n !== n || n < 2 || n > 24) return null;   // NaN ou hors bornes
  }
  var byId = {};
  radar.list.forEach(function (a) { byId[a.id] = a; });
  // v5.6 : les actifs « Ne pas renforcer » (score < 45) sont EXCLUS de l'apport —
  // le simulateur ne doit jamais acheter ce que le conseil déconseille de renforcer.
  var raw = {}, total = 0, i, k;
  for (i = 0; i < ALLOC_IDS.length; i++) {
    k = ALLOC_IDS[i];
    var sc = (byId[k] && num(byId[k].score) !== null) ? byId[k].score : 50;
    raw[k] = (sc < 45) ? 0 : ALLOC_BASE[k] * Math.max(0.4, Math.min(1.6, sc / 50));
    total += raw[k];
  }
  if (total <= 0) {   // tous les actifs < 45 (marché extrême) → tout au monétaire, l'actif de préservation
    raw["monetaire"] = 1; total = 1;
  }
  var parts = [], sum = 0, firstIdx = -1;
  for (i = 0; i < ALLOC_IDS.length; i++) {
    k = ALLOC_IDS[i];
    var a = byId[k];
    var excl = (raw[k] === 0);
    if (!excl && firstIdx === -1) firstIdx = i;
    var share = raw[k] / total;
    var eur = Math.round(m * share);
    sum += eur;
    parts.push({ id: k, icon: a ? a.icon : "•", name: a ? a.name : k, pct: r1(share * 100), euros: eur, exclu: excl });
  }
  if (firstIdx !== -1) parts[firstIdx].euros += m - sum;   // reste d'arrondi au premier actif inclus (déterministe)
  // verdict « une fois » vs « DCA » : piloté par le TIMING actions (le CAPE, lent, pèse à part)
  var ddM = radar.der.ddMsci, cape = num(d.cape);
  var actA = byId.actions;
  var pref = (actA && num(actA.timingScore) !== null) ? actA.timingScore : (actA ? actA.score : 50);
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
  return {
    montant: m, mode: mode, months: n,
    mensualite: n ? r2(m / n) : null,
    parts: parts, pref: pref, recommande: recommande, recommandeLabel: labels[recommande],
    note: "Méthode : pondération de référence (actions 40 % · immo 15 % · obligations 15 % · monétaire 13 % · or 12 % · crypto 5 %) pondérée par le score du jour (× score/50, borné ×0,4 à ×1,6), renormalisée à 100 % — les actifs sous 45/100 sont exclus. En DCA, la répartition est recalculée à chaque échéance sur les données du jour. Repère : sur les actions US 1926-2015, l'étude Vanguard « Cost Averaging: Invest Now or Temporarily Hold Your Cash » trouve que l'investissement en une fois bat le DCA ~2 fois sur 3 — un résultat propre à cette étude, qui ne valide pas ce simulateur multi-actifs. Heuristique transparente, pas un conseil financier : l'allocation dépend aussi de ton horizon et de ta tolérance au risque."
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
    stanceOf: stanceOf, adviceOf: adviceOf, allocOf: allocOf
  };
}
