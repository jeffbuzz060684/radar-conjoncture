/* Radar Conjoncture — module de mise à jour automatique (v5.2)
   1. Applique data.json (relevé hebdo vérifié, poussé sur GitHub) si plus récent que le local.
   2. Applique data-daily.json (relevé quotidien automatique via GitHub Actions) par-dessus
      si même date ou plus récent : cours IWDA en EUR (IWDA.AS), VIX lissé, taux de dépôt BCE
      et direction (API ECB), inflation ZE (Eurostat, si période récente). No-op si rien ne
      change effectivement.
   3. Recale la référence 52 sem. à la hausse si la fenêtre 1 an (même source que le cours)
      révèle un sommet plus haut → nouvel épisode, paliers déployés réinitialisés.
   4. Signale une référence 52 sem. instable (écart > 2 % d'un relevé à l'autre) → alerte UI,
      y compris quand c'est le quotidien qui la déplace.
   5. Rafraîchit or & BTC via CoinGecko au plus 1 fois / 22 h, silencieusement.
   6. Envoie une notification — ntfy (recommandé, aucun compte) ou Telegram — quand un palier
      est franchi et à déployer (config stockée sur le téléphone, jamais poussée sur GitHub).
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
      } else if (Array.isArray(lv) || k === "sources") {
        // v5.6 : sources datées du relevé distant (paires de chaînes, sanitisation stricte)
        if (Array.isArray(rv)) {
          var srcs = rv.map(function (s) {
            return (Array.isArray(s) && typeof s[0] === "string" && s[0] && typeof s[1] === "string" && s[1]) ? [s[0], s[1]] : null;
          }).filter(Boolean).slice(0, 20);
          if (srcs.length) out.sources = srcs;
        }
      }
    });
    return out;
  }

  // v5.6 : garde-fou d'unité USD/EUR. Le téléphone resté en USD au passage EUR peut garder une
  // référence 52 sem. en dollars (ex. 149,81 $) alors que le quotidien applique un cours en
  // euros : le drawdown calculé serait faux et déclencherait des paliers à tort. Si la référence
  // locale diverge fortement (≥ 10 %) de la référence du relevé distant (même source que le
  // cours) alors que le cours est proche (≤ 8 %) de la référence distante → unités mélangées :
  // on adopte les références distantes à plat et on réinitialise les paliers déployés.
  function _n(x) { var v = parseFloat(x); return (typeof v === "number" && isFinite(v)) ? v : null; }
  function Auto_fixRefUnits(cur, remote) {
    var m = _n(cur.msci), ch = _n(cur.msciHigh52), rh = _n(remote.msciHigh52);
    if (m === null || ch === null || rh === null || ch <= 0 || rh <= 0) return null;
    var gap = Math.abs(ch / rh - 1) * 100;
    var near = Math.abs(m / rh - 1) * 100;
    if (gap < 10 || near > 8) return null;
    var fixed = JSON.parse(JSON.stringify(cur));
    fixed.msciHigh52 = rh;
    var rl = _n(remote.msciLow52); if (rl !== null) fixed.msciLow52 = rl;
    if (typeof remote.msciHigh52Date === "string" && remote.msciHigh52Date) fixed.msciHigh52Date = remote.msciHigh52Date;
    fixed.paliersDone = { p5: false, p10: false, p15: false, p20: false };
    return { data: fixed, oldHigh: ch, newHigh: rh };
  }

  // ---------- Relevé quotidien ----------

  // Champs numériques de marché autorisés dans data-daily.json (jamais les données
  // personnelles — la référence hebdo vérifiée reste maîtresse). Le quotidien porte AUSSI le
  // macro officiel (BCE/Eurostat). Les références 52 sem. ne sont PAS appliquées à plat :
  // elles passent par Auto_refUpdate (recale à la hausse uniquement, nouvel épisode).
  var AUTO_DAILY_FIELDS = ["msci", "vix", "vix5", "bund10", "oat10", "bceDepot", "inflZE"];
  // Champs texte autorisés (validés par liste ou format).
  var AUTO_DAILY_SEL = ["bceDir"];
  // Plages plausibles par champ : une valeur hors plage est aberrante → ignorée.
  // (msciHigh52/msciLow52 servent à Auto_refUpdate, pas à l'overlay à plat.)
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
    // Texte : direction BCE (liste fermée)
    AUTO_DAILY_SEL.forEach(function (k) {
      var rv = dailyData[k];
      if (typeof rv !== "string" || ["hausse", "stable", "baisse"].indexOf(rv) === -1) return;
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

  // ---------- Recalage de la référence 52 sem. (fenêtre 1 an, même source que le cours) ----------

  // Le relevé quotidien embarque le sommet/bas/date du sommet de la fenêtre 1 an (même
  // source Yahoo que le cours). La référence locale n'est JAMAIS abaissée ici : un sommet
  // 1 an plus haut que la référence → recale à la hausse, nouvel épisode, paliers déployés
  // réinitialisés. Garde anti-corruption : saut ≤ +10 % comme pour les épisodes.
  function Auto_refUpdate(data, refs, dateStr) {
    if (!data || typeof data !== "object" || !refs || typeof refs !== "object") return null;
    if (!Auto_isValidDate(dateStr)) return null;
    var hi = refs.msciHigh52, lo = refs.msciLow52, hd = refs.msciHigh52Date;
    if (typeof hi !== "number" || !isFinite(hi) || hi <= 0) return null;
    if (typeof data.msciHigh52 !== "number" || !isFinite(data.msciHigh52) || data.msciHigh52 <= 0) return null;
    var rngHi = AUTO_DAILY_RANGES.msciHigh52;
    if (hi < rngHi[0] || hi > rngHi[1]) return null;              // hors plage plausible
    if (hi <= data.msciHigh52) return null;                       // jamais abaissée
    if (hi > data.msciHigh52 * (1 + AUTO_EPISODE_MAX_JUMP)) return null; // saut aberrant
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
    if (typeof lo === "number" && isFinite(lo) && lo > 0) {
      var rngLo = AUTO_DAILY_RANGES.msciLow52;
      if (lo >= rngLo[0] && lo <= rngLo[1]) out.msciLow52 = Math.round(lo * 100) / 100;
    }
    out.paliersDone = { p5: false, p10: false, p15: false, p20: false };
    return { data: out, episode: episode, unstable: Auto_refUnstable(data.msciHigh52, hi) };
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

  // ---------- Notifications multi-canal : ntfy (recommandé) ou Telegram ----------

  // Sujet ntfy : lettres, chiffres, tirets, soulignés (1-64) — ni espace ni slash.
  // ntfy.sh : aucun compte, aucune clé — on s'abonne au sujet dans l'app et c'est tout.
  function Auto_ntfyValid(topic) {
    return typeof topic === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(topic);
  }

  // Normalise une config de notification (localStorage) en canal validé :
  //   {channel:"ntfy", topic} | {channel:"telegram", token, chatId} | null.
  // Rétrocompatible v5.1 : {token, chatId} sans channel → telegram ; {topic} sans channel → ntfy.
  function Auto_notifyCfg(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.channel === "ntfy" || (raw.channel === undefined && raw.topic !== undefined)) {
      return Auto_ntfyValid(raw.topic) ? { channel: "ntfy", topic: raw.topic } : null;
    }
    if (raw.channel === "telegram" || (raw.channel === undefined && raw.token !== undefined)) {
      return Auto_tgValid(raw.token, raw.chatId) ? { channel: "telegram", token: raw.token, chatId: raw.chatId } : null;
    }
    return null;
  }

  var AUTO_GEOCO_MIN_MS = 22 * 3600 * 1000; // max 1 rafraîchissement CoinGecko / 22 h

  function Auto_shouldGecko(nowMs, lastMs) {
    if (lastMs === null || lastMs === undefined) return true;
    if (typeof lastMs !== "number" || !isFinite(lastMs)) return true;
    return nowMs - lastMs >= AUTO_GEOCO_MIN_MS;
  }

  // Applique les résultats CoinGecko (or et/ou BTC) sur une copie des données.
  function Auto_applyGecko(data, g, c, nowMs) {
    if (!data || typeof data !== "object") return null;
    if (!g && !c) return null;
    var out = JSON.parse(JSON.stringify(data));
    if (g) {
      out.orEUR = g.cur; out.orHigh52 = g.high; out.orLow52 = g.low;
    }
    if (c) {
      out.btcEUR = c.cur; out.btcHigh52 = c.high;
    }
    // v5.6 : le relevé direct ne touche JAMAIS dateData (date des marchés) — il date or/BTC à part.
    out.dateGecko = new Date((nowMs === null || nowMs === undefined) ? Date.now() : nowMs).toISOString().slice(0, 10);
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
      Auto_episodeUpdate: Auto_episodeUpdate,
      Auto_refUpdate: Auto_refUpdate,
      Auto_refUnstable: Auto_refUnstable,
      Auto_palierToDeploy: Auto_palierToDeploy,
      Auto_tgValid: Auto_tgValid,
      Auto_ntfyValid: Auto_ntfyValid,
      Auto_notifyCfg: Auto_notifyCfg,
      Auto_shouldGecko: Auto_shouldGecko,
      Auto_applyGecko: Auto_applyGecko,
      Auto_fixRefUnits: Auto_fixRefUnits,
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
  var NOTIFY_KEY = "radar-notify-v1";            // config v5.2 : {channel:"ntfy"|"telegram", …}
  var NOTIFY_OLD_KEY = "radar-telegram-v1";     // config Telegram v5.1 (rétrocompatible)
  var NOTIFY_SENT_KEY = "radar-notify-last";    // anti-spam : une notification par palier et par jour
  var TG_NOTIFY_KEY = "radar-telegram-last-notify"; // anti-spam v5.1 (lu aussi)

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

  // ntfy.sh : POST JSON {topic, title, message} — aucun compte, aucune clé.
  function sendNtfy(topic, title, text) {
    return fetch("https://ntfy.sh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic, title: title, message: text, tags: ["chart_with_downwards_trend"] })
    }).then(function (r) { return r.ok; }).catch(function () { return false; });
  }
  function Auto_sendNtfy(topic, title, text) { return sendNtfy(topic, title, text); }

  // Mini-API exposée à la page : la carte Notifications de l'onglet Suivi (script inline UI)
  // utilise la validation et l'envoi définis ici.
  if (typeof window !== "undefined") {
    window.Auto_tgValid = Auto_tgValid;
    window.Auto_sendTelegram = Auto_sendTelegram;
    window.Auto_ntfyValid = Auto_ntfyValid;
    window.Auto_notifyCfg = Auto_notifyCfg;
    window.Auto_sendNtfy = Auto_sendNtfy;
  }

  function notifyPalier(data) {
    try {
      var raw = null;
      try { raw = JSON.parse(lsGet(NOTIFY_KEY) || "null") || null; } catch (e) {}
      if (raw === null) { try { raw = JSON.parse(lsGet(NOTIFY_OLD_KEY) || "null") || null; } catch (e) {} }
      var cfg = Auto_notifyCfg(raw);
      if (!cfg) return;
      var p = Auto_palierToDeploy(data);
      if (!p) return;
      var key = "p" + p + "@" + data.dateData; // une notification par palier et par jour
      if (lsGet(NOTIFY_SENT_KEY) === key || lsGet(TG_NOTIFY_KEY) === key) return;
      var seuil = Math.round(data.msciHigh52 * (1 - p / 100) * 100) / 100;
      var text = "Cours " + data.msci + " € (relevé du " + data.dateData + "), seuil " + seuil + " €.\n" +
        "➡️ À déployer : 25 % de la réserve sur DCAM, une seule fois cet épisode. " +
        "Ouvre l'app pour marquer le palier comme déployé.";
      var send = (cfg.channel === "ntfy")
        ? sendNtfy(cfg.topic, "📡 Palier −" + p + " % franchi", text)
        : sendTelegram(cfg.token, cfg.chatId, "📡 Radar Conjoncture — palier −" + p + " % FRANCHI\n" + text);
      send.then(function (ok) { if (ok) lsSet(NOTIFY_SENT_KEY, key); }).catch(function () {});
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
        var fuW = Auto_fixRefUnits(cur, weekly.data);
        if (fuW) { cur = fuW.data; msgs.push("🛠️ Références converties (" + fuW.oldHigh + " → " + fuW.newHigh + " €) — unités USD/EUR mélangées, paliers réinitialisés"); }
        if (Auto_refUnstable(cur.msciHigh52, weekly.data.msciHigh52)) {
          refAlert = { date: weekly.dateData, from: cur.msciHigh52, to: weekly.data.msciHigh52 };
        }
        var highPrev = _n(cur.msciHigh52);
        cur = Auto_merge(cur, weekly.data);
        cur.dateData = weekly.dateData;
        // v5.6 : si le merge a corrigé la référence de ≥ 10 % (données locales restées en USD
        // au passage EUR, ou re-basing de source), les paliers marqués déployés sous l'ancienne
        // référence ne veulent plus rien dire → réinitialisation, comme dans Auto_fixRefUnits.
        var highNow = _n(cur.msciHigh52);
        if (highPrev !== null && highNow !== null && highPrev > 0 && Math.abs(highNow / highPrev - 1) >= 0.10) {
          cur.paliersDone = { p5: false, p10: false, p15: false, p20: false };
          msgs.push("🛠️ Référence corrigée (" + highPrev + " → " + highNow + " €, ≥ 10 %) — paliers réinitialisés");
          if (!refAlert) refAlert = { date: weekly.dateData, from: highPrev, to: highNow };
        }
        if (Array.isArray(weekly.sources)) {
          var wsrc = weekly.sources.map(function (s) {
            return (Array.isArray(s) && typeof s[0] === "string" && s[0] && typeof s[1] === "string" && s[1]) ? [s[0], s[1]] : null;
          }).filter(Boolean).slice(0, 20);
          if (wsrc.length) cur.sources = wsrc;
        }
        msgs.push("✅ Relevé hebdo du " + weekly.dateData + (weekly.note ? " — " + weekly.note : ""));
      }

      // b) relevé quotidien automatique — même date acceptée (maj intraday du même jour),
      //    mais no-op strict si rien ne change effectivement.
      if (daily && Auto_isSameOrNewerDate(daily.dateData, cur.dateData)) {
        // v5.6 : répare d'abord les références mélangées USD/EUR si le quotidien le révèle
        // (téléphone resté en dollars au passage EUR : référence $ 149,81 vs cours € 130,55).
        var fuD = Auto_fixRefUnits(cur, daily.data);
        if (fuD) {
          cur = fuD.data;
          msgs.push("🛠️ Références converties (" + fuD.oldHigh + " → " + fuD.newHigh + " €) — unités USD/EUR mélangées, paliers réinitialisés");
          if (!refAlert) refAlert = { date: daily.dateData, from: fuD.oldHigh, to: fuD.newHigh };
        }
        var ov = Auto_overlayDaily(cur, daily.data);
        if (ov) {
          ov.dateData = daily.dateData;
          if (JSON.stringify(ov) !== JSON.stringify(cur)) {
            cur = ov;
            msgs.push("📈 Relevé du jour appliqué (" + daily.dateData + ")");
          }
        }
        // b2) recale la référence 52 sem. si la fenêtre 1 an révèle un sommet plus haut
        //     (même source que le cours) → nouvel épisode, paliers réinitialisés.
        var ru = Auto_refUpdate(cur, daily.data, daily.dateData);
        if (ru) {
          cur = ru.data;
          if (!state.episodes) state.episodes = [];
          state.episodes.push(ru.episode);
          if (state.episodes.length > 50) state.episodes = state.episodes.slice(-50);
          if (ru.unstable && !refAlert) {
            refAlert = { date: daily.dateData, from: ru.episode.oldHigh52, to: ru.episode.newHigh52 };
          }
          msgs.push("📐 Référence 52 sem. recalée sur le sommet 1 an (" + ru.episode.newHigh52 + " €) — paliers réinitialisés");
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
