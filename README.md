# 📡 Radar Conjoncture

PWA « quel actif est le plus intéressant maintenant ? » — scoring 0–100 de 6 actifs selon la conjoncture, régime conjoncturel détecté, et intégration de la stratégie PEA par paliers (−5/−10/−15/−20 %).

**App en ligne** : https://jeffbuzz060684.github.io/radar-conjoncture/

## Actifs suivis
Actions monde (IWDA) · Obligations zone euro · Or · Monétaire · Immobilier · Crypto (BTC)

## Fonctionnalités
- **Radar** : scores 0–100, verdict du jour, « pourquoi ce score » dépliable par actif
- **Données** : saisie guidée + bouton « Or & BTC en direct » (API CoinGecko)
- **Suivi** : snapshots historiques, export/import JSON (symétrique : épisodes et alertes inclus)
- Alertes anti-accumulation : CAPE ≥ 30, réserve > 3 000 €
- Sources affichées pour chaque donnée
- Installable sur mobile (« Partager → Sur l'écran d'accueil »)

## Mise à jour automatique (v5)
- **Quotidienne (GitHub Actions, jours ouvrés 21:45 UTC)** : `tools/fetch-daily.js` relève le cours IWDA en **euros** (IWDA.AS, Euronext Amsterdam) + VIX lissé + références 52 sem. (fenêtre 1 an, même source) → `data-daily.json`, puis redéploie GitHub Pages.
- **Hebdo (~1 min, lundi)** : ressaisir le macro : inflation ZE/US, taux BCE/Bund/OAT, PMI, CAPE, or, BTC — le cours et le VIX sont déjà automatisés.
- Les paliers PEA (−5/−10/−15/−20 %) sont calculés en **euros** : même devise que le PEA, pas de bruit USD/EUR.

---

Données initiales vérifiées le 17/10/2026 (cours IWDA.AS vérifié le 18/10/2026). Usage personnel.
