/* Radar Conjoncture — module de mise à jour automatique (v5)
   1. Applique data.json (relevé hebdo vérifié, poussé sur GitHub) si plus récent que le local.
   2. Applique data-daily.json (relevé quotidien automatique via GitHub Actions) par-dessus
      si même date ou plus récent : cours IWDA en € + VIX lissé + références 52 sem. de la
      même source (fenêtre 1 an) — les paliers réagissent chaque jour.
   3. Recale la référence 52 sem. à la hausse si la fenêtre 1 an révèle un sommet plus haut
      que la référence locale → nouvel épisode, paliers déployés réinitialisés.
   4. Détecte un nouveau plus haut 52 sem. → réinitialise les paliers déployés (nouvel épisode).
   5. Signale une référence 52 sem. instable (écart > 2 % d'un relevé à l'autre) → alerte UI.
   6. Rafraîchit or & BTC via CoinGecko au plus 1 fois / 22 h, silencieusement.
   Les fonctions pures (Auto_*) sont testées par tools/test-auto.js (Node). */
"use strict";
(function () {
  // ---------- Fonctions pures (testées hors navigateur) ----------

  // Dates au format ISO YYYY-MM-DD : comparaison lexicographique fiable.
  function Auto_isNewerDate(a, b) {
    return typeof a === "string" && typeof b === "string" && a > b;
  }

  // Même date ou plus récent : sert pour le relevé quotidien, dont une révision peut être
  // repoussée le soir même avec la même date de clôture (le strict-plus-récent l'ignorerait).
  function Auto_isSameOrNewerDate(a, b) {
    return typeof a === "string" && typeof b === "string" && a >= b;
  }

  // Date ISO qui existe VRAIMENT dans le calendrier (rejette 2026-02-31, 2026-13-01…).
  function Auto_isValidDate(s) {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    var t = Date.parse(s + "T12:00:00Z");
    return !isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
  }

  function Auto_validRemote(json) {
    if (!json || typeof json !== "object") return null;
    if (!json.data || typeof json.data !== "object") return null;
    if (!Auto_isValidDate(json.dateData)) return null;
    return json;
  }

  // Fusion hebdo : n'écrase que les champs connus du schéma local et de même type.
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

  // ---------- v3 : relevé quotidien ----------

  // Champs de marché autorisés dans data-daily.json (jamais les références 52 sem.
  // ni les données personnelles — la référence hebdo vérifiée reste maîtresse).
  var AUTO_DAILY_FIELDS = ["msci", "vix", "vix5", "bund10", "oat10"];
  // Plages plausibles par champ : une valeur hors plage est aberrante → ignorée.
  var AUTO_DAILY_RANGES = { msci: [20, 1000], vix: [3, 100], vix5: [3, 100], bund10: [0, 20], oat10: [0, 20] };
  // Garde anti-corruption, msci UNIQUEMENT : un saut > 50 % vs la valeur locale en place est
  // impossible en une séance. La dérive fine est déjà filtrée côté serveur (écart max 10 %
  // vs le dernier relevé quotidien accepté) : un krach cumulé légitime sur plusieurs séances
  // ne doit PAS être bloqué ici — la valeur locale peut dater de plusieurs relevés.
  var AUTO_DAILY_MAX_JUMP = 0.50;

  // Applique les champs du relevé quotidien sur une copie des données locales.
  // Chaque champ est filtré individuellement ; renvoie null si rien d'appliqué.
  function Auto_overlayDaily(localData, dailyData) {
    if (!localData || typeof localData !== "object") return null;
    if (!dailyData || typeof dailyData !== "object") return null;
    var out = JSON.parse(JSON.stringify(localData));
    var applied = 0;
    AUTO_DAILY_FIELDS.forEach(function (k) {
      var rv = dailyData[k];
      if (typeof rv !== "number" || !isFinite(rv)) return;
      var rng = AUTO_DAILY_RANGES[k];
      if (rv < rng[0] || rv > rng[1]) return; // hors plage plausible → ignoré
      var lv = out[k];
      // garde anti-corruption (msci uniquement) : saut impossible en une séance
      if (k === "msci" && typeof lv === "number" && isFinite(lv) && lv > 0 && Math.abs(rv / lv - 1) > AUTO_DAILY_MAX_JUMP) return;
      out[k] = rv;
      applied++;
    });
    return applied ? out : null;
  }

  // ---------- v5 : recale de la référence 52 sem. (fenêtre 1 an, même source que le cours) ----------

  // Le relevé quotidien embarque `refs` = sommet/bas/date du sommet de la fenêtre 1 an
  // (même source Yahoo que le cours). La référence locale n'est JAMAIS abaissée ici :
  // un sommet 1 an plus haut que la référence → recale à la hausse, nouvel épisode,
  // paliers réinitialisés. Garde anti-corruption : saut ≤ +10 % comme pour les épisodes.
  function Auto_refUpdate(data, refs, dateStr) {
    if (!data || typeof data !== "object" || !refs || typeof refs !== "object") return null;
    if (!Auto_isValidDate(dateStr)) return null;
    var hi = refs.msciHigh52, lo = refs.msciLow52, hd = refs.msciHigh52Date;
    if (typeof hi !== "number" || !isFinite(hi) || hi <= 0) return null;
    if (typeof data.msciHigh52 !== "number" || !isFinite(data.msciHigh52) || data.msciHigh52 <= 0) return null;
    if (hi <= data.msciHigh52) return null;                       // jamais abaissée
    if (hi > data.msciHigh52 * (1 + AUTO_EPISODE_MAX_JUMP)) return null; // aberrant
    var deployed = 0;
    if (data.paliersDone) {
      ["p5", "p10", "p15", "p20"].forEach(function (k) { if (data.paliersDone[k]) deployed++; });
    }
    var episode = {
      date: dateStr,
      oldHigh52: data.msciHigh52,
      newHigh52: Math.round(hi * 100) / 100,
      deployed: deployed
    };
    var out = JSON.parse(JSON.stringify(data));
    out.msciHigh52 = episode.newHigh52;
    out.msciHigh52Date = (typeof hd === "string" && Auto_isValidDate(hd)) ? hd : dateStr;
    if (typeof lo === "number" && isFinite(lo) && lo > 0) out.msciLow52 = Math.round(lo * 100) / 100;
    out.paliersDone = { p5: false, p10: false, p15: false, p20: false };
    return { data: out, episode: episode, unstable: Auto_refUnstable(data.msciHigh52, hi) };
  }

  // ---------- v3 : nouvel épisode de paliers ----------

  // Nouveau plus haut 52 sem. (cours > référence) → la référence monte à hauteur du cours,
  // la date du sommet est consignée et les paliers déployés sont réinitialisés (nouvel épisode).
  // Garde-fou : un cours à plus de 10 % au-dessus de la référence est aberrant → ignoré.
  var AUTO_EPISODE_MAX_JUMP = 0.10;

  function Auto_episodeUpdate(data, dateStr) {
    if (!data || typeof data !== "object") return null;
    if (typeof dateStr !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
    if (typeof data.msci !== "number" || !isFinite(data.msci) || data.msci <= 0) return null;
    if (typeof data.msciHigh52 !== "number" || !isFinite(data.msciHigh52) || data.msciHigh52 <= 0) return null;
    if (data.msci <= data.msciHigh52) return null;
    if (data.msci > data.msciHigh52 * (1 + AUTO_EPISODE_MAX_JUMP)) return null;
    var deployed = 0;
    if (data.paliersDone) {
      ["p5", "p10", "p15", "p20"].forEach(function (k) { if (data.paliersDone[k]) deployed++; });
    }
    var episode = {
      date: dateStr,
      oldHigh52: data.msciHigh52,
      newHigh52: Math.round(data.msci * 100) / 100,
      deployed: deployed
    };
    var out = JSON.parse(JSON.stringify(data));
    out.msciHigh52 = episode.newHigh52;
    out.msciHigh52Date = dateStr;
    out.paliersDone = { p5: false, p10: false, p15: false, p20: false };
    return { data: out, episode: episode };
  }

  // ---------- v3 : stabilité de la référence 52 sem. ----------
  // Le sommet 52 sem. est la base des paliers : s'il bouge de plus de 2 % d'un relevé
  // à l'autre (source qui a changé), l'app doit prévenir — seuils recalculés.
  // Écart arrondi au point de base pour éviter les artefacts flottants (2,00 % ≠ > 2 %).
  function Auto_refUnstable(localHigh, remoteHigh) {
    if (typeof localHigh !== "number" || !isFinite(localHigh) || localHigh <= 0) return false;
    if (typeof remoteHigh !== "number" || !isFinite(remoteHigh) || remoteHigh <= 0) return false;
    return Math.abs(Math.round((remoteHigh / localHigh - 1) * 10000)) > 200;
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
      Auto_isSameOrNewerDate: Auto_isSameOrNewerDate,
      Auto_isValidDate: Auto_isValidDate,
      Auto_validRemote: Auto_validRemote,
      Auto_merge: Auto_merge,
      Auto_overlayDaily: Auto_overlayDaily,
      Auto_refUpdate: Auto_refUpdate,
      Auto_episodeUpdate: Auto_episodeUpdate,
      Auto_refUnstable: Auto_refUnstable,
      Auto_shouldGecko: Auto_shouldGecko,
      Auto_applyGecko: Auto_applyGecko,
      AUTO_DAILY_FIELDS: AUTO_DAILY_FIELDS,
      AUTO_DAILY_RANGES: AUTO_DAILY_RANGES,
      AUTO_DAILY_MAX_JUMP: AUTO_DAILY_MAX_JUMP,
      AUTO_EPISODE_MAX_JUMP: AUTO_EPISODE_MAX_JUMP,
      AUTO_GEOCO_MIN_MS: AUTO_GEOCO_MIN_MS
    };
    return;
  }

  // ---------- Câblage navigateur (utilise les globaux de la page) ----------

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  var GECKO_LAST_KEY = "radar-conjoncture-gecko-last";

  function fetchRemote(file) {
    return fetch(file + "?v=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(Auto_validRemote)
      .catch(function () { return null; }); // absent / hors ligne / format inattendu → silence
  }

  // 1) Maj hebdo (data.json vérifié) + quotidienne (data-daily.json auto), épisode, alerte référence.
  function runAutoUpdate() {
    return Promise.all([fetchRemote("data.json"), fetchRemote("data-daily.json")]).then(function (remotes) {
      var weekly = remotes[0], daily = remotes[1];
      var cur = state.data;
      var msgs = [];
      var refAlert = null;

      // a) relevé hebdo vérifié
      if (weekly && Auto_isNewerDate(weekly.dateData, cur.dateData)) {
        if (Auto_refUnstable(cur.msciHigh52, weekly.data.msciHigh52)) {
          refAlert = { date: weekly.dateData, from: cur.msciHigh52, to: weekly.data.msciHigh52 };
        }
        cur = Auto_merge(cur, weekly.data);
        cur.dateData = weekly.dateData;
        msgs.push("✅ Relevé hebdo du " + weekly.dateData + (weekly.note ? " — " + weekly.note : ""));
      }

      // b) relevé quotidien automatique (même date acceptée : une révision du soir
      //     avec la même clôture doit pouvoir passer ; jamais appliqué si plus ancien)
      if (daily && Auto_isSameOrNewerDate(daily.dateData, cur.dateData)) {
        var ov = Auto_overlayDaily(cur, daily.data);
        if (ov) {
          ov.dateData = daily.dateData;
          cur = ov;
          msgs.push("📈 Cours du jour appliqué (" + daily.dateData + ")");
        } else if (Auto_isNewerDate(daily.dateData, cur.dateData)) {
          cur.dateData = daily.dateData; // relevé récent mais aucun champ valable : au moins dater l'état
        }
        // b2) recale la référence 52 sem. si la fenêtre 1 an révèle un sommet plus haut
        if (daily.refs) {
          var ru = Auto_refUpdate(cur, daily.refs, daily.dateData);
          if (ru) {
            cur = ru.data;
            if (!state.episodes) state.episodes = [];
            state.episodes.push(ru.episode);
            if (state.episodes.length > 50) state.episodes = state.episodes.slice(-50);
            if (ru.unstable) refAlert = { date: daily.dateData, from: ru.episode.oldHigh52, to: ru.episode.newHigh52 };
            msgs.push("📐 Référence 52 sem. recalée sur le sommet 1 an (" + ru.episode.newHigh52 + " €) — paliers réinitialisés");
          }
        }
      }

      // c) nouveau plus haut 52 sem. → nouvel épisode, paliers réinitialisés
      var ep = Auto_episodeUpdate(cur, cur.dateData);
      if (ep) {
        cur = ep.data;
        if (!state.episodes) state.episodes = [];
        state.episodes.push(ep.episode);
        if (state.episodes.length > 50) state.episodes = state.episodes.slice(-50);
        msgs.push("🆕 Nouveau plus haut 52 sem. (" + ep.episode.newHigh52 + " €) — paliers réinitialisés (nouvel épisode)");
      }

      if (!msgs.length && !refAlert) return;
      state.data = cur;
      if (refAlert) state.refAlert = refAlert;
      commitSnapshot(false);
      save(); buildForm(); renderRadar();
      toast(msgs.join(" · ") || "Données à jour");
    });
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

  // Ordre : d'abord les relevés GitHub (valeurs vérifiées + quotidien), puis le direct par-dessus.
  function init() {
    runAutoUpdate().then(runAutoGecko, runAutoGecko);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
