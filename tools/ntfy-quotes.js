#!/usr/bin/env node
"use strict";
// Radar Conjoncture — notifications ntfy pour le pipeline cotations (v9.1, migration du
// pipeline de sentinelle--perso : alertes de panne des cotes SBF 120). Remplace l'ancienne
// dépendance à fetch-insiders.js (jamais copié ici : le Radar ne fait pas de relevé d'initiés).
// Topic = secret GitHub NTFY_TOPIC (jamais en dur : le dépôt est public). Un sujet ntfy n'est
// pas authentifié — il doit rester long et aléatoire. Toute erreur est avalée : une
// notification en échec ne doit JAMAIS faire échouer un relevé de cotes.
function notifyNtfy(topic, msgs, title) {
  if (!topic || !msgs || msgs.length === 0) return Promise.resolve(0);
  var impl = (typeof fetch === "function") ? fetch : null;
  if (!impl) return Promise.resolve(0);
  var body = msgs.slice(0, 5).join("\n\n") + (msgs.length > 5 ? "\n\n… +" + (msgs.length - 5) + " autre(s)" : "");
  return impl("https://ntfy.sh/" + encodeURIComponent(topic), {
    method: "POST",
    headers: { "Title": title || "Radar Conjoncture — cotes", "Priority": "high", "Tags": "chart_with_upwards_trend" },
    body: body
  }).then(function (r) {
    // une alerte n'est "envoyée" que sur un 2xx — un 4xx/5xx de ntfy n'est pas un succès muet
    if (r && typeof r.status === "number" && !(r.status >= 200 && r.status < 300)) {
      console.log("[ntfy] réponse HTTP " + r.status + " — notification NON délivrée");
      return 0;
    }
    return msgs.length;
  }, function () { return 0; }); // jamais faire échouer le run
}
module.exports = { notifyNtfy: notifyNtfy };
