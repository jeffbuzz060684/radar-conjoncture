/* Radar Conjoncture — module de mise à jour automatique (v2)
   1. Applique data.json (mis à jour chaque semaine sur GitHub) si plus récent que les données locales.
   2. Rafraîchit or & BTC via CoinGecko au plus 1 fois / 22 h, silencieusement.
   Les fonctions pures (Auto_*) sont testées par tools/test-auto.js (Node). */
"use strict";
(function () {
  // ---------- Fonctions pures (testées hors navigateur) ----------

  // Dates au format ISO YYYY-MM-DD : comparaison lexicographique fiable.
  function Auto_isNewerDate(a, b) {
    return typeof a === "string" && typeof b === "string" && a > b;
  }

  function Auto_validRemote(json) {
    if (!json || typeof json !== "object") return null;
    if (!json.data || typeof json.data !== "object") return null;
    if (typeof json.dateData !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(json.dateData)) return null;
    return json;
  }

  // Fusion : n'écrase que les champs connus du schéma local et de même type.
  // Jamais reserve, paliersDone ni dateData (gérés séparément).
  function Auto_merge(localData, remoteData) {
    var out = JSON.parse(JSON.stringify(localData));
    Object.keys(remoteData).forEach(function (k) {
      if (k === "reserve" || k === "paliersDone" || k === "dateData") return;
      if (!(k in out)) return;
      var lv = out[k], rv = remoteData[k];
      if (rv === null || rv === undefined) return;
      if (typeof lv === "number") {
        if (typeof rv === "number" && isFinite(rv)) out[k] = rv;
      } else if (typeof lv === "string") {
        if (typeof rv === "string" && rv) out[k] = rv;
      } else if (lv === null) {
        // champ optionnel non renseigné localement : une valeur distante valide est acceptée
        if (typeof rv === "number" && isFinite(rv)) out[k] = rv;
      }
    });
    return out;
  }

  var AUTO_GEOCO_MIN_MS = 22 * 3600 * 1000; // max 1 rafraîchissement CoinGecko / 22 h

  function Auto_shouldGecko(nowMs, lastMs) {
    if (lastMs === null || lastMs === undefined) return true;
    if (typeof lastMs !== "number" || !isFinite(lastMs)) return true;
    return nowMs - lastMs >= AUTO_GEOCO_MIN_MS;
  }

  // Applique les résultats CoinGecko (or et/ou BTC) sur une copie des données.
  function Auto_applyGecko(data, g, c) {
    if (!data || typeof data !== "object") return null;
    if (!g && !c) return null;
    var out = JSON.parse(JSON.stringify(data));
    if (g) {
      out.orEUR = g.cur; out.orHigh52 = g.high; out.orLow52 = g.low;
    }
    if (c) {
      out.btcEUR = c.cur; out.btcHigh52 = c.high;
    }
    return out;
  }

  // Export Node pour le harnais de tests.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      Auto_isNewerDate: Auto_isNewerDate,
      Auto_validRemote: Auto_validRemote,
      Auto_merge: Auto_merge,
      Auto_shouldGecko: Auto_shouldGecko,
      Auto_applyGecko: Auto_applyGecko,
      AUTO_GEOCO_MIN_MS: AUTO_GEOCO_MIN_MS
    };
    return;
  }

  // ---------- Câblage navigateur (utilise les globaux de la page) ----------

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var GECKO_LAST_KEY = "radar-conjoncture-gecko-last";

  // 1) Maj hebdo : data.json poussé sur GitHub, récupéré à chaque ouverture.
  function runAutoUpdate() {
    return fetch("data.json?v=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (json) {
        var rem = Auto_validRemote(json);
        if (!rem) return;                    // format inattendu → silence
        if (!Auto_isNewerDate(rem.dateData, state.data.dateData)) return; // pas plus récent → rien
        state.data = Auto_merge(state.data, rem.data);
        state.data.dateData = rem.dateData;
        commitSnapshot(false);
        save(); buildForm(); renderRadar();
        toast("✅ Maj auto du " + rem.dateData + (rem.note ? " — " + rem.note : ""));
      })
      .catch(function () { /* pas de data.json / hors ligne → silence */ });
  }

  // 2) Or & BTC en direct, silencieux, max 1 fois / 22 h.
  function runAutoGecko() {
    var last = lsGet(GECKO_LAST_KEY);
    var lastMs = last === null ? null : Number(last);
    if (!Auto_shouldGecko(Date.now(), lastMs)) return;
    var GOLD = "https://api.coingecko.com/api/v3/coins/pax-gold/market_chart?vs_currency=eur&days=365";
    var BTC = "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=eur&days=365";
    Promise.all([
      fetch(GOLD).then(function (r) { if (!r.ok) throw new Error("or " + r.status); return r.json(); }).then(parseGecko).catch(function () { return null; }),
      fetch(BTC).then(function (r) { if (!r.ok) throw new Error("btc " + r.status); return r.json(); }).then(parseGecko).catch(function () { return null; })
    ]).then(function (res) {
      if (!res[0] && !res[1]) return;       // CoinGecko indisponible → retry à la prochaine ouverture
      lsSet(GECKO_LAST_KEY, String(Date.now()));
      var merged = Auto_applyGecko(state.data, res[0], res[1]);
      if (!merged) return;
      state.data = merged;
      save(); buildForm(); renderRadar();
      toast("🔄 Or & BTC actualisés en direct");
    }).catch(function () { /* silencieux */ });
  }

  // Ordre : d'abord la maj hebdo (valeurs vérifiées), puis le direct par-dessus.
  function init() {
    runAutoUpdate().then(runAutoGecko, runAutoGecko);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
