/* Instruments exemples par actif — Radar Conjoncture v5
   Vérifiés le 17/10/2026 : justETF, extraETF, Boursorama, DCA Tracker (éligibilité PEA), ASPIM-IEIF (SCPI).
   Structure testée par tools/test-auto.js (Node). */
"use strict";
var VEHICULES = {
  actions: {
    nom: "Amundi PEA Monde — MSCI World (DCAM)",
    isin: "FR001400U5Q4",
    frais: "0,20 %/an",
    enceinte: "PEA",
    note: "Ton socle DCA actuel. IWDA n'est PAS éligible PEA (réplication physique) : en PEA, le MSCI World passe par des ETF synthétiques (DCAM, WPEA, CW8)."
  },
  obligations: {
    nom: "iShares Core € Govt Bond (IEGA)",
    isin: "IE00B4WXJJ64",
    frais: "0,07 %/an",
    enceinte: "CTO / AV",
    note: "Obligations d'État zone euro, 5,4 Md€ d'encours, l'un des moins chers du marché. Pas éligible PEA."
  },
  or: {
    nom: "Invesco Physical Gold ETC (SGLD)",
    isin: "IE00B579F325",
    frais: "0,12 %/an",
    enceinte: "CTO",
    note: "Or physique alloué (26 Md€). Pas éligible PEA — les ETC or sont hors PEA ; en PEA, seule la piste minière existe (risque différent)."
  },
  monetaire: {
    nom: "BNP Easy EUR Overnight PEA (OVNI)",
    isin: "LU3215541056",
    frais: "0,05 %/an",
    enceinte: "PEA",
    note: "Suit l'€STR (≈ dépôt BCE − 0,15 pt), éligible PEA — pour ta réserve tactique. Lancé mars 2026 (petit encours) ; sinon Amundi PEA Euro CT (OBLI, 0,25 %)."
  },
  immo: {
    nom: "SCPI (diversifiées ≈ 6 % de TD)",
    isin: "",
    frais: "10–11 % sur loyers",
    enceinte: "CTO / AV",
    note: "Taux de distribution moyen 4,91 % en 2025 (ASPIM-IEIF). Pas éligible PEA ; l'assurance-vie permet de petits tickets et l'héritage simplifié."
  },
  crypto: {
    nom: "CoinShares Physical Bitcoin (BITC)",
    isin: "GB00BLD4ZL17",
    frais: "0,15 %/an",
    enceinte: "CTO",
    note: "ETN adossé au BTC physique, 1,4 Md€. Pas éligible PEA. Alternative : achat direct sur plateforme enregistrée PSAN."
  }
};
if (typeof module !== "undefined" && module.exports) { module.exports = VEHICULES; }
