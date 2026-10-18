/* Radar Conjoncture — module de mise à jour automatique (v4.2)
   1. Applique data.json (relevé hebdo vérifié, poussé sur GitHub) si plus récent que le local.
   2. Applique data-daily.json (relevé quotidien automatique via GitHub Actions) par-dessus
      si même date ou plus récent : cours IWDA en EUR (IWDA.AS), références 52 sem. de la
      même source, VIX lissé, taux de dépôt BCE et direction (API ECB), inflation ZE (Eurostat,
      si période récente). No-op si rien ne change effectivement.
   3. Détecte un nouveau plus haut 52 sem. → réinitialise les paliers déployés (nouvel épisode).
   4. Signale une référence 52 sem. instable (écart > 2 % d'un relevé à l'autre) → alerte UI,
      y compris quand c'est le quotidien qui la déplace.
   5. Rafraîchit or & BTC via CoinGecko au plus 1 fois / 22 h, silencieusement.
   6. Envoie une notification Telegram quand un palier est franchi et à déployer
      (config stockée sur le téléphone, jamais poussée sur GitHub).
   Les fonctions pures (Auto_*) sont testées par tools/test-auto.js (Node). */
"use strict";
(function () {
  // ---------- Fonctions pures (testées hors navigateur) ----------

  // Dates au format ISO YYYY-MM-DD : comparaison lexicographique fiable.
  function Auto_isNewerDate(a, b) {
    return typeof a === "string" && typeof b === "string" && a > b;
  }

  // Validation d'un relevé distant : structure + date RÉELLE (jour existant du calendrier,
  // pas dans un futur lointain). nowMs injectable pour des tests déterministes.
  function Auto_validRemote(json, nowMs) {
    if (!json || typeof json !== "object") return null;
    if (!json.data || typeof json.data !== "object") return null;
    if (typeof json.dateData !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(json.dateData)) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(json.dateData);
    var y = +m[1], mo = +m[2], da = +m[3];
    if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    var t = Date.UTC(y, mo - 1, da);
    if (new Date(t).getUTCFullYear() !== y || new Date(t).getUTCMonth() !== mo - 1 || new Date(t).getUTCDate() !== da) return null; // 2026-02-30, 2026-13-01…
    var now = (nowMs === null || nowMs === undefined) ? Date.now() : nowMs;
    if (t > now + 2 * 86400000) return null; // plus de 2 jours dans le futur → aberrant
    if (t < Date.UTC(2000, 0, 1)) return null;
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

  // ---------- Relevé quotidien ----------

  // Champs numériques de marché autorisés dans data-daily.json (jamais les données
  // personnelles — la référence hebdo vérifiée reste maîtresse). Depuis v4.2, le quotidien
  // porte AUSSI les références 52 sem. (même source Yahoo que le cours : plus d'alerte
  // « référence instable » due à un changement de source) et le macro officiel (BCE/Eurostat).
  var AUTO_DAILY_FIELDS = ["msci", "msciHigh52", "msciLow52", "vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE"];
  // Champs texte autorisés (validés par liste ou format).
  var AUTO_DAILY_SEL = ["bceDir"];
  var AUTO_DAILY_DATE_STR = ["msciHigh52Date"]; // suit msciHigh52 quand il est appliqué
  // Plages plausibles par champ : une valeur hors plage est aberrante → ignorée.
  var AUTO_DAILY_RANGES = { msci: [15, 1000], msciHigh52: [15, 1000], msciLow52: [15, 1000], vix: [3, 100], vix5: [3, 100], bund10: [0, 20], oat10: [0, 20], bceDepot: [-1, 10], inflZE: [-2, 15] };
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
    var applied = 0, appliedKeys = {};
    AUTO_DAILY_FIELDS.forEach(function (k) {
      var rv = dailyData[k];
      if (typeof rv !== "number" || !isFinite(rv)) return;
      var rng = AUTO_DAILY_RANGES[k];
      if (rv < rng[0] || rv > rng[1]) return; // hors plage plausible → ignoré
      var lv = out[k];
      // garde anti-corruption (msci uniquement) : saut impossible en une séance
      if (k === "msci" && typeof lv === "number" && isFinite(lv) && lv > 0 && Math.abs(rv / lv - 1) > AUTO_DAILY_MAX_JUMP) return;
      out[k] = rv;
      applied++; appliedKeys[k] = true;
    });
    // Texte : direction BCE (liste fermée)
    AUTO_DAILY_SEL.forEach(function (k) {
      var rv = dailyData[k];
      if (typeof rv !== "string" || ["hausse", "stable", "baisse"].indexOf(rv) === -1) return;
      out[k] = rv; applied++;
    });
    // Date du sommet 52 sem. : suit la référence quand elle vient d'être appliquée
    AUTO_DAILY_DATE_STR.forEach(function (k) {
      var rv = dailyData[k];
      if (typeof rv !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rv)) return;
      if (k === "msciHigh52Date" && !appliedKeys.msciHigh52) return;
      out[k] = rv; applied++;
    });
    return applied ? out : null;
  }

  // ---------- Nouvel épisode de paliers ----------

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

  // ---------- Stabilité de la référence 52 sem. ----------
  // Le sommet 52 sem. est la base des paliers : s'il bouge de plus de 2 % d'un relevé
  // à l'autre, l'app doit prévenir — seuils recalculés.
  function Auto_refUnstable(localHigh, remoteHigh) {
    if (typeof localHigh !== "number" || !isFinite(localHigh) || localHigh <= 0) return false;
    if (typeof remoteHigh !== "number" || !isFinite(remoteHigh) || remoteHigh <= 0) return false;
    return Math.abs(Math.round((remoteHigh / localHigh - 1) * 10000)) > 200;
  }

  // ---------- Notifications Telegram (palier à déployer) ----------

  // Premier palier franchi NON déployé (le plus proche du sommet), sinon null.
  function Auto_palierToDeploy(data) {
    if (!data || typeof data !== "object") return null;
    var cur = (typeof data.msci === "number" && isFinite(data.msci)) ? data.msci : null;
    var hi = (typeof data.msciHigh52 === "number" && isFinite(data.msciHigh52)) ? data.msciHigh52 : null;
    if (cur === null || hi === null || hi <= 0) return null;
    var dd = (cur / hi - 1) * 100;
    var paliers = [5, 10, 15, 20];
    for (var i = 0; i < paliers.length; i++) {
      var done = data.paliersDone && data.paliersDone["p" + paliers[i]];
      if (dd <= -paliers[i] && !done) return paliers[i];
    }
    return null;
  }

  // Format : token « 123456789:AA… » (via @BotFather), chat id numérique (user ou groupe).
  function Auto_tgValid(token, chatId) {
    if (typeof token !== "string" || !/^\d{6,12}:[A-Za-z0-9_-]{25,}$/.test(token)) return false;
    if (typeof chatId === "number" && isFinite(chatId)) return true;
    if (typeof chatId === "string" && /^-?\d{2,15}$/.test(chatId)) return true;
    return false;
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
      Auto_overlayDaily: Auto_overlayDaily,
      Auto_episodeUpdate: Auto_episodeUpdate,
      Auto_refUnstable: Auto_refUnstable,
      Auto_palierToDeploy: Auto_palierToDeploy,
      Auto_tgValid: Auto_tgValid,
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
  var TG_KEY = "radar-telegram-v1";
  var TG_NOTIFY_KEY = "radar-telegram-last-notify";

  function fetchRemote(file) {
    // Pas de paramètre anti-cache à version variable : le service worker sert
    // data*.json réseau-first, et un tel paramètre remplirait le cache
    // d'entrées jamais réutilisées.
    return fetch(file)
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (j) { return Auto_validRemote(j, Date.now()); })
      .catch(function () { return null; }); // absent / hors ligne / format inattendu → silence
  }

  function sendTelegram(token, chatId, text) {
    return fetch("https://api.telegram.org/bot" + encodeURIComponent(token) + "/sendMessage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function Auto_sendTelegram(token, chatId, text) { return sendTelegram(token, chatId, text); }

  // Mini-API exposée à la page : la carte Telegram de l'onglet Suivi (script inline UI)
  // utilise la validation et l'envoi définis ici.
  if (typeof window !== "undefined") {
    window.Auto_tgValid = Auto_tgValid;
    window.Auto_sendTelegram = Auto_sendTelegram;
  }

  function notifyPalier(data) {
    try {
      var cfg = JSON.parse(lsGet(TG_KEY) || "null");
      if (!cfg || !Auto_tgValid(cfg.token, cfg.chatId)) return;
      var p = Auto_palierToDeploy(data);
      if (!p) return;
      var key = "p" + p + "@" + data.dateData; // une notification par palier et par jour
      if (lsGet(TG_NOTIFY_KEY) === key) return;
      var seuil = Math.round(data.msciHigh52 * (1 - p / 100) * 100) / 100;
      sendTelegram(cfg.token, cfg.chatId,
        "📡 Radar Conjoncture — palier −" + p + " % FRANCHI\nCours " + data.msci + " € (relevé du " + data.dateData +
        "), seuil " + seuil + " €.\n➡️ À déployer : 25 % de la réserve sur DCAM, une seule fois cet épisode. " +
        "Ouvre l'app pour marquer le palier comme déployé.")
        .then(function (ok) { if (ok) lsSet(TG_NOTIFY_KEY, key); }).catch(function () {});
    } catch (e) { /* notification = bonus, jamais bloquante */ }
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

      // b) relevé quotidien automatique — même date acceptée (maj intraday du même jour),
      //    mais no-op strict si rien ne change effectivement.
      if (daily && typeof daily.dateData === "string" && daily.dateData >= cur.dateData) {
        var ov = Auto_overlayDaily(cur, daily.data);
        if (ov) {
          ov.dateData = daily.dateData;
          if (JSON.stringify(ov) !== JSON.stringify(cur)) {
            // la référence 52 sem. peut être déplacée par le quotidien (fenêtre 52 sem. qui défile)
            if (!refAlert && Auto_refUnstable(cur.msciHigh52, ov.msciHigh52)) {
              refAlert = { date: daily.dateData, from: cur.msciHigh52, to: ov.msciHigh52 };
            }
            cur = ov;
            msgs.push("📈 Relevé du jour appliqué (" + daily.dateData + ")");
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

      var applied = msgs.length > 0;
      if (!applied && !refAlert) {
        notifyPalier(cur); // rien de neuf, mais un palier reste peut-être à déployer
        return;
      }
      state.data = cur;
      if (refAlert) state.refAlert = refAlert;
      commitSnapshot(false);
      save(); buildForm(); renderRadar();
      toast(msgs.join(" · ") || "Données à jour");
      notifyPalier(cur);
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
