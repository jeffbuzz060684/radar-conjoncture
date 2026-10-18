/* Simulation DOM v5.11 (outillage) — rejoue le chargement complet de la page avec des stubs (aucun réseau).
   Exécution : node sim.js  →  doit finir par "SIM OK" sans aucune erreur d'exécution. */
"use strict";
var fs = require("fs"), path = require("path"), vm = require("vm");
var ROOT = path.join(__dirname, "..");

function mkEl() {
  var el = {
    style: {}, children: [], handlers: {},
    value: "", textContent: "", innerHTML: "", className: "", href: "", files: null,
    dataset: {}, tagName: "INPUT", type: "text", checked: false, disabled: false,
    classList: { add: function () {}, remove: function () {}, contains: function () { return false; }, toggle: function () {} },
    addEventListener: function (t, f) { (el.handlers[t] = el.handlers[t] || []).push(f); },
    removeEventListener: function () {},
    appendChild: function (c) { el.children.push(c); return c; },
    remove: function () {}, setAttribute: function () {}, getAttribute: function () { return null; },
    querySelectorAll: function () { return []; }, querySelector: function () { return mkEl(); },
    click: function () { (el.handlers.click || []).forEach(function (f) { f({ target: el }); }); },
    fire: function (t, ev) { (el.handlers[t] || []).forEach(function (f) { f(ev || {}); }); }
  };
  return el;
}
var els = {};
var document = {
  getElementById: function (id) { if (!els[id]) els[id] = mkEl(); return els[id]; },
  querySelectorAll: function () { return []; },
  querySelector: function () { return mkEl(); },
  createElement: function () { return mkEl(); },
  documentElement: mkEl(),
  addEventListener: function (t, f) { (sandbox._listeners[t] = sandbox._listeners[t] || []).push(f); }
};
var store = {};
var localStorage = {
  getItem: function (k) { return store[k] === undefined ? null : store[k]; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};
var sandbox = {
  document: document, localStorage: localStorage, console: console,
  navigator: {
    storage: { persist: function () {} },
    serviceWorker: { register: function () { return Promise.resolve({}); }, controller: null, addEventListener: function () {} },
    onLine: true, userAgent: "sim"
  },
  setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; }, clearInterval: function () {},
  fetch: function () { return Promise.reject(new Error("sim hors ligne")); },
  Blob: function () {}, FileReader: function () { this.readAsText = function () {}; },
  URL: { createObjectURL: function () { return "blob:x"; }, revokeObjectURL: function () {} },
  location: { reload: function () {}, hash: "" },
  _listeners: {},
  addEventListener: function (t, f) { (sandbox._listeners[t] = sandbox._listeners[t] || []).push(f); },
  removeEventListener: function () {}
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

function run(src, name) {
  try { vm.runInContext(src, sandbox, { filename: name }); return null; }
  catch (e) { return name + " ⛔ " + e.message; }
}

// 1. Scripts servis dans l'ordre du document
["vehicles.js", "logic.js"].forEach(function (f) {
  var err = run(fs.readFileSync(path.join(ROOT, f), "utf8"), f);
  if (err) { console.log(err); process.exit(1); }
});

// 2. Blocs <script> inline d'index.html, dans l'ordre
var html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
var re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g, m, i = 0;
while ((m = re.exec(html))) {
  var err = run(m[1], "index.html#inline" + (i++));
  if (err) { console.log(err); process.exit(1); }
}

// 3. auto.js (après le script UI, comme dans la page)
var errA = run(fs.readFileSync(path.join(ROOT, "auto.js"), "utf8"), "auto.js");
if (errA) { console.log(errA); process.exit(1); }

// 4. Événement load (les listeners enregistrés)
(sandbox._listeners.load || []).forEach(function (f) { f(); });

// 5. Vérifications d'état
function txt(id) { return (els[id] ? String(els[id].textContent || els[id].innerHTML || "") : ""); }
var checks = [];
function ck(name, cond) { checks.push({ name: name, ok: !!cond }); }

ck("page rendue : posture affichée", /\/100\)/.test(txt("advicePosture")));
ck("risque macro descriptif affiché (vocabulaire v5.8)", /Risque macro/.test(txt("adviceRegime")) && /Modéré/.test(txt("adviceRegime")));
ck("auto (pas d'override) : pas de « choisie »", txt("advicePosture").indexOf("choisie") === -1);
ck("sous-titre auto : « score actions (timing) = pilote »", txt("advicePostureSub") === "score actions (timing) = pilote");
ck("synthèse v5.10 : la phrase d'entrée d'apport est celle du verdict partagé (« Entrée : … »)", /Entrée :/.test(txt("adviceSynthese")));
ck("state.data chargé (dateData)", sandbox.state && sandbox.state.data && sandbox.state.data.dateData);
ck("pas d'override au départ", sandbox.state.postureOverride === null);

// 6. Override manuel → conseil + persistance + affichage honnête (v5.8)
els.postureSel.value = "Offensive";
els.postureSel.fire("change");
ck("override Offensive : « choisie aujourd'hui · auto : Prudente (44/100) »",
  txt("advicePosture").indexOf("Offensive — choisie aujourd'hui") !== -1 && txt("advicePosture").indexOf("auto : Prudente (44/100)") !== -1);
ck("sous-titre forçage : « posture choisie — l'auto ne pilote plus »", txt("advicePostureSub") === "posture choisie — l'auto ne pilote plus");
ck("override + date persistés dans localStorage",
  (store["radar-conjoncture-v1"] || "").indexOf("\"Offensive\"") !== -1 && (store["radar-conjoncture-v1"] || "").indexOf("postureOverrideDate") !== -1);

// 7. Simulateur piloté par le forçage UNIQUEMENT (v5.8) — en Offensive, les actions (timing 44) redeviennent achetables
els.allocMontant.value = "5000";
els.allocMode.value = "une fois";
els.btnAlloc.click();
var allocHtml = String(els.allocOut.innerHTML);
ck("répartition calculée", allocHtml.indexOf("Total") !== -1);
ck("posture appliquée affichée (Offensive choisie, seuil 35)", allocHtml.indexOf("Posture appliquée") !== -1 && allocHtml.indexOf("35/100") !== -1 && allocHtml.indexOf("(choisie)") !== -1);
ck("aucune ligne exclue en Offensive (actions timing 44 ≥ 35 incluses)", (allocHtml.match(/opacity:\.45/g) || []).length === 0);
ck("actions incluses via le timing (36,5 %)", allocHtml.indexOf("36.5 %") !== -1);
ck("somme 5 000 € affichée", allocHtml.indexOf("5 000 €") !== -1);
ck("v5.11 : chaque ligne allouée porte sa destination réelle (« → AV — fonds euro », « → PEA — DCAM »)",
  allocHtml.indexOf("→ AV — fonds euro") !== -1 && allocHtml.indexOf("→ PEA — DCAM") !== -1 && allocHtml.indexOf("→ AV — SCPI") !== -1);
ck("v5.11 : bloc « Concrètement chez toi » avec le private equity affiché mais jamais alloué",
  allocHtml.indexOf("Concrètement chez toi") !== -1 && allocHtml.indexOf("Private equity") !== -1 && allocHtml.indexOf("jamais alloué") !== -1);
ck("v5.11 : le socle reste affiché 1 000 €/mois PEA seul (stratégie maîtresse inchangée)",
  allocHtml.indexOf("le socle des 1 000 €/mois reste PEA seul") !== -1);

// 8. Changement de posture → recalcul automatique + plancher monétaire (v5.8)
els.postureSel.value = "Défensive";
els.postureSel.fire("change");
var allocHtml2 = String(els.allocOut.innerHTML);
ck("recalcul auto : seuil 55 en Défensive", allocHtml2.indexOf("55/100") !== -1);
ck("recalcul auto : 4 lignes exclues (actions, obligations, immo, crypto)", (allocHtml2.match(/opacity:\.45/g) || []).length === 4);
ck("plancher monétaire Défensive : or 50 % / monétaire 50 % (plus de 57/43)", (allocHtml2.match(/50 %/g) || []).length >= 2);
ck("recalcul auto : total 5 000 € toujours", allocHtml2.indexOf("5 000 €") !== -1);
ck("risque macro inchangé + forçage = seuils, pas les scores", txt("adviceRegime").indexOf("déplace les seuils, pas les scores") !== -1);

// 9. Retour auto
els.postureSel.value = "";
els.postureSel.fire("change");
ck("retour auto : plus de « choisie », override et date remis à zéro",
  txt("advicePosture").indexOf("choisie") === -1 && sandbox.state.postureOverride === null && sandbox.state.postureOverrideDate === null);

// 9 bis. Expiration du forçage (v5.8) : plus de 30 jours → retour auto silencieux
store["radar-conjoncture-v1"] = JSON.stringify({ data: {}, postureOverride: "Offensive", postureOverrideDate: "2026-09-01" });
sandbox.load();
sandbox.renderRadar();
ck("forçage > 30 j expiré silencieusement (retour auto)",
  sandbox.state.postureOverride === null && sandbox.state.postureOverrideDate === null && txt("advicePosture").indexOf("Prudente") !== -1);

// 9 ter. v5.9 : dates hostiles — future ou impossible → expiration immédiate (isRealDate + days < 0)
store["radar-conjoncture-v1"] = JSON.stringify({ data: {}, postureOverride: "Offensive", postureOverrideDate: "2026-12-31" });
sandbox.load();
sandbox.renderRadar();
ck("forçage à date FUTURE expiré (retour auto)", sandbox.state.postureOverride === null && sandbox.state.postureOverrideDate === null);
store["radar-conjoncture-v1"] = JSON.stringify({ data: {}, postureOverride: "Offensive", postureOverrideDate: "2026-02-30" });
sandbox.load();
sandbox.renderRadar();
ck("forçage à date IMPOSSIBLE (2026-02-30) expiré (retour auto)", sandbox.state.postureOverride === null && sandbox.state.postureOverrideDate === null);

// 9 quater. v5.9 : compte à rebours affiché pour un forçage de 3 jours
var d3 = new Date(Date.now() - 3 * 86400000);
function pad2s(n) { return (n < 10 ? "0" : "") + n; }
var d3s = d3.getFullYear() + "-" + pad2s(d3.getMonth() + 1) + "-" + pad2s(d3.getDate());
store["radar-conjoncture-v1"] = JSON.stringify({ data: {}, postureOverride: "Prudente", postureOverrideDate: d3s });
sandbox.load();
sandbox.renderRadar();
ck("forçage de 3 j : « choisie depuis 3 j · expire dans 27 j »",
  txt("advicePosture").indexOf("choisie depuis 3 j") !== -1 && txt("advicePosture").indexOf("expire dans 27 j") !== -1);

// 9 quinquies. v5.9 : retour sur l'app (visibilitychange) → re-vérification sans erreur
els.postureSel.value = "Offensive";
els.postureSel.fire("change");
(sandbox._listeners.visibilitychange || []).forEach(function (f) { f({}); });
ck("retour sur l'app : re-vérification du forçage sans erreur, override conservé",
  sandbox.state.postureOverride === "Offensive" && txt("advicePosture").indexOf("Offensive — choisie aujourd'hui") !== -1);

// 10. Bilan
var fail = checks.filter(function (c) { return !c.ok; });
checks.forEach(function (c) { console.log((c.ok ? "✅ " : "❌ ") + c.name); });
console.log("");
if (fail.length) { console.log("SIM ÉCHECS : " + fail.length); process.exit(1); }
console.log("SIM OK — " + checks.length + "/" + checks.length + " vérifications, aucune erreur d'exécution (charge complète + override daté + expiration + dates hostiles v5.9 + retour sur l'app + simulateur piloté par le forçage seul + synthèse à source partagée v5.10 + univers réel v5.11).");
