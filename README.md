# 📡 Radar Conjoncture

PWA « quel actif est le plus intéressant maintenant ? » — scoring 0–100 de 6 actifs selon la conjoncture, régime conjoncturel détecté, et intégration de la stratégie PEA par paliers (−5/−10/−15/−20 %).

**App en ligne** : https://jeffbuzz060684.github.io/radar-conjoncture/

## Actifs suivis
Actions monde (IWDA) · Obligations zone euro · Or · Monétaire · Immobilier · Crypto (BTC)

## Fonctionnalités
- **Radar** : scores 0–100, verdict du jour, « pourquoi ce score » dépliable par actif
- **Données** : saisie guidée + bouton « Or & BTC en direct » (API CoinGecko)
- **Suivi** : snapshots historiques, export/import JSON (symétrique : épisodes et alertes inclus)
- **Backbone monde (v9)** : carte ⚖️ « Mon portefeuille vs backbone monde » — un fantôme 100 % IWDA avec les mêmes versements (causalité stricte : achat à la dernière clôture mensuelle connue avant le versement), XIRR réel vs backbone, écart en pts de %/an (série mensuelle `data-serie.json`, régénérée chaque jour ouvré par le workflow)
- Alertes anti-accumulation : CAPE ≥ 30, réserve > 3 000 €
- Sources affichées pour chaque donnée
- Installable sur mobile (« Partager → Sur l'écran d'accueil »)

## Mise à jour automatique (v5)
- **Quotidienne (GitHub Actions, jours ouvrés 21:45 UTC)** : `tools/fetch-daily.js` relève le cours IWDA en **euros** (IWDA.AS, Euronext Amsterdam) + VIX lissé + références 52 sem. (fenêtre 1 an, même source) → `data-daily.json`, puis redéploie GitHub Pages.
- **Hebdo (~1 min, lundi)** : ressaisir le macro : inflation ZE/US, taux BCE/Bund/OAT, PMI, CAPE, or, BTC — le cours et le VIX sont déjà automatisés.
- Les paliers PEA (−5/−10/−15/−20 %) sont calculés en **euros** : même devise que le PEA, pas de bruit USD/EUR.

## Backtest v9 (honnête)
`tools/backtest-moteur.js` : paliers (réserve 20 % du flux) vs buy-and-hold 100 % flux sur monde / obligations zone euro / or EUR / BTC (Yahoo + BCE), XIRR + vol/Sharpe/maxDD/pire année mesurés sur l'actif, CSV dans `backtest-data/out/` (gitignoré). **Résultat : les paliers ne surperforment le buy-and-hold sur aucune classe qui compte** — monde 11,96 vs 12,18 %/an de XIRR, or 9,44 vs 9,67 %/an, BTC 53,67 vs 54,51 %/an (et +0,18 pt/an seulement sur les obligations, classe perdante sur la période). La réserve est un confort anti-panique, pas un alpha (SPIVA) ; CAPE/PMI non backtestés, échantillon in-sample.

---

Données initiales vérifiées le 17/10/2026 (cours IWDA.AS vérifié le 18/10/2026). Usage personnel.
