/* Instruments exemples par actif — Radar Conjoncture v5.13
   v3 (17/10/2026) : instruments vérifiés — justETF, extraETF, Boursorama, DCA Tracker (éligibilité PEA), ASPIM-IEIF (SCPI).
   v5.11 (18/10/2026) : chaque ligne porte « reel » = la situation RÉELLE de Jade (patrimoine déclaré
   le 18/10/2026 : actions, or, BTC, fonds euro AV, SCPI AV, livret, private equity) — affichée sous
   forme 👤 dans la carte actif, distincte de l'instrument EXEMPLE (indicatif, pas une recommandation).
   v5.13 (18/10/2026) : crypto — « plateforme agréée CASP (MiCA) » : le régime transitoire PSAN a pris
   fin le 01/07/2026 (AMF ; PSAN sans agrément MiCA radiés automatiquement le 02/07/2026).
   Structure testée par tools/test-auto.js (Node). */
"use strict";
var VEHICULES = {
  actions: {
    nom: "Amundi PEA Monde — MSCI World (DCAM)",
    isin: "FR001400U5Q4",
    frais: "0,20 %/an",
    enceinte: "PEA",
    reel: "Ton socle actions réel — 800 €/mois en plan programmé, paliers déployés sur ce support.",
    note: "Ton socle DCA actuel. IWDA n'est PAS éligible PEA (réplication physique) : en PEA, le MSCI World passe par des ETF synthétiques (DCAM, WPEA, CW8)."
  },
  obligations: {
    nom: "iShares Core € Govt Bond (IEGA)",
    isin: "IE00B4WXJJ64",
    frais: "0,07 %/an",
    enceinte: "CTO / AV",
    reel: "Ton exposition obligataire réelle = le fonds euro de ton assurance vie (capital garanti, gains verrouillés chaque année) — un supplément « obligations » part sur l'AV, pas sur l'ETF (CTO en pause).",
    note: "Obligations d'État zone euro, 5,4 Md€ d'encours, l'un des moins chers du marché. Pas éligible PEA."
  },
  or: {
    nom: "Invesco Physical Gold ETC (SGLD)",
    isin: "IE00B579F325",
    frais: "0,12 %/an",
    enceinte: "CTO",
    reel: "Tu détiens déjà de l'or. Renfort possible à la reprise du CTO — en lecture d'ici là.",
    note: "Or physique alloué (26 Md€). Pas éligible PEA — les ETC or sont hors PEA ; en PEA, seule la piste minière existe (risque différent)."
  },
  monetaire: {
    nom: "BNP Easy EUR Overnight PEA (OVNI)",
    isin: "LU3215541056",
    frais: "0,05 %/an",
    enceinte: "PEA",
    reel: "Ta poche monétaire réelle = livret (épargne de précaution) + monétaire PEA (réserve tactique 200 €/mois). Le livret ne compte jamais dans la capacité paliers.",
    note: "Suit l'€STR (≈ dépôt BCE − 0,15 pt), éligible PEA — pour ta réserve tactique. Lancé mars 2026 (petit encours) ; sinon Amundi PEA Euro CT (OBLI, 0,25 %)."
  },
  immo: {
    nom: "SCPI (diversifiées ≈ 6 % de TD)",
    isin: "",
    frais: "10–11 % sur loyers",
    enceinte: "CTO / AV",
    reel: "Ton immobilier réel = tes SCPI en assurance vie. ⚠️ frais de souscription élevés : un supplément « immo » est pertinent en une fois, pas idéal en DCA mensuel.",
    note: "Taux de distribution moyen 4,91 % en 2025 (ASPIM-IEIF). Pas éligible PEA ; l'assurance-vie permet de petits tickets et l'héritage simplifié."
  },
  crypto: {
    nom: "CoinShares Physical Bitcoin (BITC)",
    isin: "GB00BLD4ZL17",
    frais: "0,15 %/an",
    enceinte: "CTO",
    reel: "Tu détiens déjà du Bitcoin. Renfort possible sur plateforme agréée CASP (MiCA) ou à la reprise du CTO.",
    note: "ETN adossé au BTC physique, 1,4 Md€. Pas éligible PEA. Alternative : achat direct sur plateforme agréée CASP (MiCA)."
  }
};
if (typeof module !== "undefined" && module.exports) { module.exports = VEHICULES; }
