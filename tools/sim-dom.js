/* Simulation DOM v7.0 (outillage) — rejoue le chargement complet de la page avec des stubs (aucun réseau).
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

// v7.0 : données de l'app Patrimoine pré-sensibilisées — comme sur le téléphone de Jade où
// l'ancienne app 💼 a déjà tout : même origine GitHub Pages → même stockage → zéro ressaisie.
store["suivi-patrimoine-v4"] = JSON.stringify({ savedAt: 1, envelopes: [
  { id: "e1", name: "PEA Bourse Direct", type: "PEA", assets: [
      { id: "a1", name: "DCAM Amundi PEA Monde", category: "ETF", quantity: 10, currentPrice: 130, buyPrice: 120 },
      { id: "a4", name: "PEA EUROPE", category: "Autre", quantity: 2, currentPrice: 100, buyPrice: 95 } ] },
  { id: "e2", name: "AV Linxia Spirit", type: "Assurance-vie", assets: [
      { id: "a2", name: "Fonds euro", category: "Fonds", quantity: 1, currentPrice: 5000, buyPrice: 5000 },
      { id: "a3", name: "SCPI Epargne Pierre", category: "SCPI", quantity: 2, currentPrice: 1000, buyPrice: 1000 } ] }
] });

function run(src, name) {
  try { vm.runInContext(src, sandbox, { filename: name }); return null; }
  catch (e) { return name + " ⛔ " + e.message; }
}

// 1. Scripts servis dans l'ordre du document (cac.js v7.7 : moteur du classement CAC 40, avant le script UI)
["vehicles.js", "logic.js", "cac.js"].forEach(function (f) {
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

// 7 bis. v5.12 : carte « 👤 Ton patrimoine réel » — les 7 actifs de Jade, TOUJOURS visibles
var patHtml = txt("patrimoineList");
ck("v5.12 : la carte patrimoine affiche exactement 7 lignes",
  (patHtml.match(/palrow/g) || []).length === 7);
ck("v5.12 : livret ET private equity visibles en permanence (pas seulement via le simulateur)",
  patHtml.indexOf("Livret") !== -1 && patHtml.indexOf("Private equity") !== -1 &&
  patHtml.indexOf("Fonds euro") !== -1 && patHtml.indexOf("SCPI") !== -1);
ck("v5.13 : lecture honnête — 6 scores « /100 » (timing Actions + 5 lectures marché) + 1 seul « hors radar — jamais alloué »",
  (patHtml.match(/\/100<\/b>/g) || []).length === 6 && (patHtml.match(/hors radar — jamais alloué/g) || []).length === 1);
ck("v5.13 : ligne Actions pilotée par le timing (44/100, pilote du conseil) + lectures marché des segments",
  patHtml.indexOf("timing <b>44/100</b>") !== -1 && patHtml.indexOf("pilote du conseil") !== -1 && patHtml.indexOf("lecture marché ") !== -1);

// 7 ter. v5.13 : cas runtime — ligne du radar absente du relevé, score partiel (revue de la carte)
var fakeRadar = { list: [
  { id: "actions", name: "Actions monde (MSCI World)", score: 20, timingScore: 44 },
  { id: "obligations", name: "Obligations zone euro", score: 41 },
  { id: "monetaire", name: "Monétaire", score: 52 },
  { id: "crypto", name: "Crypto", score: 44, partial: true }
] };   // « or » et « immo » ABSENTS du relevé → « lecture indisponible » ; crypto partiel → « (partiel) »
sandbox.renderPatrimoine(fakeRadar);
var fakeHtml = txt("patrimoineList");
ck("v5.13 : ligne mappée absente du radar → « lecture indisponible (donnée manquante) » ×2, JAMAIS « jamais alloué »",
  (fakeHtml.match(/lecture indisponible \(donnée manquante\)/g) || []).length === 2 && fakeHtml.indexOf("hors radar — jamais alloué") !== -1);
ck("v5.13 : score partiel tracé « (partiel) » sur la ligne crypto",
  fakeHtml.indexOf("(partiel)") !== -1);
sandbox.renderRadar();   // état normal restauré
ck("v5.13 : retour à l'état normal — 7 lignes, 6 scores, PE seul hors radar",
  (function () { var h = txt("patrimoineList"); return (h.match(/palrow/g) || []).length === 7 && (h.match(/\/100<\/b>/g) || []).length === 6; })());

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

// 9 sexies. v5.12.1 : SKEW — logic.js périmé (v5.11 : pas de PATRIMOINE_ACTIFS) servi avec
// un index v5.12 frais (cache SW/CDN pendant la bascule) : JAMAIS de page blanche.
var PA_SAVED = sandbox.PATRIMOINE_ACTIFS;
sandbox.PATRIMOINE_ACTIFS = undefined;
var skewOk = true;
try { sandbox.renderRadar(); } catch (e) { skewOk = false; }
ck("v5.12.1 skew : PATRIMOINE_ACTIFS absent → renderRadar NE LEVE PAS (page rendue, garde anti page blanche)",
  skewOk && txt("adviceSynthese").length > 0 && txt("advicePosture").length > 0);
sandbox.PATRIMOINE_ACTIFS = PA_SAVED;
sandbox.renderRadar();
ck("v5.12.1 : après guérison (logic.js à jour), la carte 👤 revient — 7 lignes",
  (txt("patrimoineList").match(/palrow/g) || []).length === 7);

// 9 septies. v5.12.1 : SKEW simulateur (logic.js v5.10 simulé : ni PATRIMOINE, ni parts[].ou)
var ALLOC_SAVED = sandbox.allocOf;
var PAT_SAVED = sandbox.PATRIMOINE, PHR_SAVED = sandbox.PATRIMOINE_HORS_RADAR;
var dSnap = sandbox.state.data, radarSnap = sandbox.radarAll(dSnap);
var allocSnap = ALLOC_SAVED(els.allocMontant.value, els.allocMode.value, els.allocMonths ? els.allocMonths.value : null, dSnap, radarSnap, sandbox.state.postureOverride);
allocSnap.parts.forEach(function (p) { delete p.ou; });   // parts « v5.10 » (sans destination)
sandbox.allocOf = function () { return allocSnap; };       // allocOf v5.10 : ne touche pas PATRIMOINE
sandbox.PATRIMOINE = undefined; sandbox.PATRIMOINE_HORS_RADAR = undefined;
var skewAllocOk = true;
try { els.btnAlloc.click(); } catch (e) { skewAllocOk = false; }
var skewAllocHtml = String(els.allocOut.innerHTML);
ck("v5.12.1 skew : simulateur « v5.10 » (ni PATRIMOINE ni ou) → le clic Calcule SANS lever (bloc « Concrètement » omis, répartition intacte)",
  skewAllocOk && skewAllocHtml.indexOf("Total") !== -1 && skewAllocHtml.indexOf("Concrètement chez toi") === -1);
sandbox.allocOf = ALLOC_SAVED; sandbox.PATRIMOINE = PAT_SAVED; sandbox.PATRIMOINE_HORS_RADAR = PHR_SAVED;
els.btnAlloc.click();
ck("v5.12.1 : simulateur guéri — le bloc « Concrètement chez toi » revient",
  String(els.allocOut.innerHTML).indexOf("Concrètement chez toi") !== -1);

// 9 octies. v6.0/v6.1 : carte 🎯 Ma décision — flux / supplément (lecture) / stock
ck("v6.0 : carte décision rendue — « Flux du mois » + SOCLE NORMAL sur les données du jour",
  txt("decFlux").indexOf("Flux du mois") !== -1 && txt("decFlux").indexOf("SOCLE NORMAL") !== -1);
ck("v6.1 : bloc supplément = LECTURE pure — verdict du jour + top stances + renvoi vers le simulateur 🧮 (aucune saisie, aucune répartition inventée)",
  txt("decSuppOut").indexOf("Supplément") !== -1 && txt("decSuppOut").indexOf("Entrée :") !== -1 &&
  (txt("decSuppOut").match(/INVESTIR|CONSERVER/g) || []).length >= 1 &&
  txt("decSuppOut").indexOf("saisis le montant dans le simulateur 🧮") !== -1);
ck("v6.1 : plus de champ de saisie dans la carte 🎯 (v6.0 decSuppMontant supprimé)",
  els.decSuppMontant === undefined && store["radar-dec-supp"] === undefined);
ck("v6.0/v7.0 : bloc stock à l'ouverture — l'auto 💼 alimente déjà le stock (1 300 + 5 000 + 2 000 = 8 300 €, écarts rendus) ; l'invitation ✏️ reste le comportement sans aucun montant (testé au harnais)",
  txt("decStock").indexOf("Ton stock") !== -1 && txt("decStock").indexOf("8 300 €") !== -1);
// éditeur ✏️ : saisie de montants réels → persistance + stock rendu
els.btnReelsEdit.click();
document.getElementById("reelIn0").value = "30000";   // Actions — MSCI World
document.getElementById("reelIn1").value = "10000";   // Fonds euro
els.btnReelsSave.click();
ck("v6.0/v7.0 : montants réels persistés (radar-reels) + stock affiché — 30 000 + 10 000 ✏️ et 2 000 € auto 💼 SCPI = 42 000 € hors PE",
  (store["radar-reels"] || "").indexOf("30000") !== -1 &&
  txt("decStock").indexOf("42 000 €") !== -1 && txt("decStock").indexOf("pts") !== -1);
ck("v6.0 : la carte 👤 patrimoine affiche le montant saisi dans la ligne",
  txt("patrimoineList").indexOf("30 000 €") !== -1);
ck("v6.2 : le montant est SOUS le nom (plus de 4e colonne nowrap qui débordait de la carte)",
  String(els.patrimoineList.innerHTML).indexOf("display:block;margin-top:2px") !== -1 &&
  String(els.patrimoineList.innerHTML).indexOf("min-width:70px") === -1);
ck("v6.3 : les 7 lectures sont SOUS l'enceinte en white-space:normal — plus aucune colonne .fl nowrap dans la carte patrimoine",
  (function () { var h = txt("patrimoineList");
    return (h.match(/class="fl"/g) || []).length === 7 &&
           (h.match(/class="fl" style="display:block;white-space:normal/g) || []).length === 7; })());

// v7.0 : fusion app Patrimoine 💼 — un seul app, données automatiques
ck("v7.0 : module 💼 intégré en IIFE — aucun global qui fuit (fmtEur/uid/APP_VERSION/viewResume privés), KEY du Radar intact",
  sandbox.fmtEur === undefined && sandbox.uid === undefined && sandbox.APP_VERSION === undefined &&
  sandbox.viewResume === undefined && sandbox.KEY === "radar-conjoncture-v1");
ck("v7.0 : onglet 💼 rendu — Résumé/Enveloppes/Actifs/Historique + total des données seedées (8 500 € — v7.3 : dont 200 € d'un actif non classé)",
  /8[\u202f\u00a0 ]500/.test(txt("patrimoineRoot")) && txt("patrimoineRoot").indexOf("Résumé") !== -1 &&
  txt("patrimoineRoot").indexOf("Enveloppes") !== -1 && txt("patrimoineRoot").indexOf("Historique") !== -1);
ck("v7.0 : montants auto 💼 dans la carte 👤 — SCPI 2 000 € taguée « auto 💼 » ; Actions/Fonds euro manuels ✏️ sans tag (priorité manuelle)",
  (function () { var h = txt("patrimoineList");
    return h.indexOf("2 000 €") !== -1 && (h.match(/auto 💼/g) || []).length === 1; })());
ck("v7.3 : actifs 💼 non classés rendus VISIBLES — la carte 👤 liste « PEA EUROPE » comme non classé (« non pris en compte dans cette carte ») au lieu de l'ignorer en silence ; le stock d'ouverture reste 8 300 € (les 200 € non classés ne fuient dans aucune des 7 lignes)",
  txt("patrimoineList").indexOf("non classé") !== -1 && txt("patrimoineList").indexOf("PEA EUROPE") !== -1 &&
  txt("patrimoineList").indexOf("non pris en compte dans cette carte") !== -1 &&
  (function () { var h = txt("patrimoineList"); return (h.match(/palrow/g) || []).length === 7; })());
sandbox.window.PatrimoineRender();
ck("v7.0 : hook PatrimoineRender — re-render idempotent de l'onglet 💼 (comme au changement d'onglet, aucune erreur)",
  /8[\u202f\u00a0 ]500/.test(txt("patrimoineRoot")));
// skew : logic.js périmé (pas de decisionOf) → carte omise SANS erreur
var DEC_SAVED = sandbox.decisionOf;
sandbox.decisionOf = undefined;
var skewDecOk = true;
try { sandbox.renderRadar(); } catch (e) { skewDecOk = false; }
ck("v6.0 skew : logic.js sans decisionOf → re-rendu SANS levée d'erreur (carte figée, page intacte)",
  skewDecOk && txt("adviceSynthese").length > 0);
sandbox.decisionOf = DEC_SAVED;
sandbox.renderRadar();
ck("v6.0 : après guérison, la carte décision revient (Flux du mois rendu)",
  txt("decFlux").indexOf("Flux du mois") !== -1);

// 9 decies. v7.5 : carte 🏆 Meilleure opportunité — dropdown des actifs à avoir
ck("v7.5 : carte rendue — bandeau « Meilleure opportunité du jour » (Or, Sur-pondérer, INVESTIR) + verdict d'entrée partagé (entryPrefOf)",
  txt("oppTop").indexOf("Meilleure opportunité du jour") !== -1 && txt("oppTop").indexOf("INVESTIR") !== -1 && txt("oppTop").indexOf("Entrée d'un éventuel supplément") !== -1);
ck("v7.5 : dropdown = 6 options dans l'ordre d'opportunité du jour, sélection par défaut = l'actif vedette (or n°1)",
  (els.oppSel.innerHTML.match(/<option/g) || []).length === 6 && els.oppSel.innerHTML.indexOf('value="or"') !== -1 && els.oppSel.value === "or");
ck("v7.5 : détail de la vedette — stance + barre de score + destination réelle (« Chez toi »)",
  txt("oppDetail").indexOf("Chez toi") !== -1 && txt("oppDetail").indexOf("Sur-pondérer") !== -1);
els.oppSel.value = "actions";
els.oppSel.fire("change");
ck("v7.5 : changement de dropdown → re-rendu SEUL du détail : actions avec timing 44/100 pilote + contexte paliers + « Jamais vendre sur la baisse »",
  txt("oppDetail").indexOf("timing <b>44/100</b>") !== -1 && txt("oppDetail").indexOf("Prochain palier") !== -1 && txt("oppDetail").indexOf("Jamais vendre sur la baisse") !== -1);
ck("v7.5 : le bandeau n'a pas bougé au changement de dropdown (seul le détail est re-rendu)",
  txt("oppTop").indexOf("Meilleure opportunité du jour") !== -1);
// skew : logic.js périmé (pas d'opportuniteOf) → carte omise SANS erreur (classe v5.12.1)
var OPP_SAVED = sandbox.opportuniteOf;
sandbox.opportuniteOf = undefined;
var skewOppOk = true;
try { sandbox.renderRadar(); } catch (e) { skewOppOk = false; }
ck("v7.5 skew : logic.js sans opportuniteOf → re-rendu SANS levée d'erreur (page intacte)", skewOppOk && txt("adviceSynthese").length > 0);
sandbox.opportuniteOf = OPP_SAVED;
sandbox.renderRadar();
ck("v7.5 : après guérison, la carte 🏆 revient (bandeau rendu)",
  txt("oppTop").indexOf("Meilleure opportunité du jour") !== -1);

// 9 undecies. v7.6 : 📉 drawdown par actif — la lecture « vs sommet 52 sem. » étendue du MSCI World à tout l'univers
ck("v7.6 : bloc « Drawdown par actif » rendu dans la carte 🏆 — 6 lignes, échelle identique à la carte World (pleine à −25 %)",
  txt("oppDD").indexOf("Drawdown par actif") !== -1 && txt("oppDD").indexOf("−25 %") !== -1 &&
  (txt("oppDD").match(/palrow/g) || []).length === 6);
ck("v7.6 : valeurs du jour — or −18,8 % (barre rouge, ≤ −15), actions −1,3 % (barre verte) avec la mention « pilote les paliers »",
  txt("oppDD").indexOf("-18.8 %") !== -1 && txt("oppDD").indexOf("-1.3 %") !== -1 && txt("oppDD").indexOf("pilote les paliers") !== -1);
ck("v7.6 : lignes sans drawdown de cours — lectures honnêtes (Bund pour les obligations, OAT pour l'immo, « capital stable » pour le monétaire, référence BTC manquante tracée)",
  txt("oppDD").indexOf("Bund") !== -1 && txt("oppDD").indexOf("OAT 10 ans") !== -1 &&
  txt("oppDD").indexOf("capital stable") !== -1 && txt("oppDD").indexOf("Or &amp; BTC en direct") !== -1);

// 9 nonies. v7.7 : onglet 🇫🇷 CAC 40 — fusion Sentinelle perso (classement d'achat + macro + détail au tap).
// Le sim est hors ligne : le fetch de loadCac rejette en microtâche → les vérifications puis le
// bilan sont chaînés sur la file de microtâches (ticks vides pour laisser le .catch de loadCac jouer).
sandbox.cacState.q = null; sandbox.cacState.query = "";
sandbox.cacState.loading = false; sandbox.cacState.lastTry = 0;
sandbox.loadCac(true);
Promise.resolve().then(function () {}).then(function () {}).then(function () {
  ck("v7.7 : loadCac hors ligne SANS cache → pas de crash, message « Relevé indisponible » (le classement apparaîtra au prochain passage en ligne)",
    String(els.cacList.innerHTML).indexOf("Relevé indisponible") !== -1);

  // fixture complète : indice dédié + macro (relevé d'hier, fraîche) + 3 lignes cac40 (dont une sans
  // fondamentaux) + 1 ligne mid60 qui ne doit JAMAIS passer le filtre du périmètre
  var dIso = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  var expAge = Math.floor((Date.now() - Date.parse(dIso + "T12:00:00Z")) / 86400000);
  var fx = {
    updated: new Date().toISOString(), source: "TradingView (repli) — cotes différées", sbUpdated: "2026-11-09",
    cacIdx: { name: "CAC 40", px: 7612.34, chg: 0.42 },
    macro: { dateData: dIso, vix: 14.2, vix5: 14.8, bund10: 2.6, oat10: 3.25, bceDepot: 2, bceDir: "baisse", inflZE: 1.9, pmiZE: 48.5, cape: 22.1 },
    list: [
      { y: "TTE.PA", n: "TOTALENERGIES", mn: "TTE", g: "cac40", isin: "FR0000120271", px: 60, chg: 0.8, per: 8.2, fper: 7.9, dY: 5.2, pb: 1.1, cap: 1.3e11, sec: "Energy", w52lo: 52, w52hi: 70, roe: 0.18, mOp: 0.14, gRev: 0.03, de: 35, tp: 72, tpLo: 65, tpHi: 80, tpN: 18, rec: "buy", nextRes: "2027-02-05", surp: 4.2 },
      { y: "AC.PA", n: "ACCOR", mn: "AC", g: "cac40", isin: "FR0000120404", px: 40, chg: -0.5, per: 12.5, fper: 14.1, dY: 1.6, pb: 1.8, cap: 1e10, sec: "Consumer Services", w52lo: 33, w52hi: 48, roe: 0.09, mOp: 0.11, gRev: 0.04, de: 80, tp: 46.3, tpN: 21, rec: "hold" },
      { y: "XSP.PA", n: "SANSPER", mn: "XSP", g: "cac40", px: 22, chg: 0.1, cap: 2e9, sec: "Industrials", w52lo: 20, w52hi: 25, roe: null, mOp: null, gRev: null, de: null, per: null, dY: null, pb: null },
      { y: "MID.PA", n: "MID60ECLUE", mn: "MID", g: "mid60", px: 30, chg: 0.2, per: 6, dY: 4, pb: 0.9, roe: 0.2, mOp: 0.2, gRev: 0.1, de: 20, sec: "Industrials", tp: 36 }
    ]
  };

  // garde anti-skew : cac.js absent/périmé (cache SW/CDN pendant la bascule) → onglet silencieux, JAMAIS de page blanche
  var CAC_SAVED = sandbox.CAC;
  sandbox.CAC = undefined;
  var skewCac = true;
  try { sandbox.renderCacData(fx); } catch (e) { skewCac = false; }
  ck("v7.7 : skew cac.js absent → renderCacData NE LEVE PAS (garde typeof CAC — onglet silencieux, jamais une page blanche)",
    skewCac && String(els.cacList.innerHTML).indexOf("Relevé indisponible") !== -1);
  sandbox.CAC = CAC_SAVED;

  // rendu synchrone complet du classement
  sandbox.cacState.q = fx;
  sandbox.renderCacData(fx);
  var cacHtml = String(els.cacList.innerHTML);
  var by = {};
  sandbox.CAC.cacSort(sandbox.CAC.cacFilter(sandbox.CAC.pipeline(fx.list))).forEach(function (r) { by[r.n] = r; });
  ck("v7.7 : ligne indice — « CAC 40 » + cours 7 612,34 + variation +0,42 %",
    String(els.cacIdxLine.innerHTML).indexOf("CAC 40") !== -1 && String(els.cacIdxLine.innerHTML).indexOf("7612,34") !== -1 && String(els.cacIdxLine.innerHTML).indexOf("+0,42 %") !== -1);
  ck("v7.7 : périmètre — 3/40 cotées (la mid60 est exclue du filtre, le compte suit la composition)",
    txt("cacN") === "3/40 cotées" && cacHtml.indexOf("MID60ECLUE") === -1 && cacHtml.indexOf("SANSPER") !== -1);
  ck("v7.7 : classement — TOTALENERGIES (tout meilleur : PER 8,2, rend. 5,2 %, objectif +20 %) DEVANT ACCOR, scores non nuls",
    cacHtml.indexOf("TOTALENERGIES") < cacHtml.indexOf("ACCOR") && by["TOTALENERGIES"].aScore > by["ACCOR"].aScore && by["TOTALENERGIES"].aScore != null && by["ACCOR"].aScore != null);
  ck("v7.7 : SANSPER (aucune composante) → pas de score inventé (« — », aScore null, « Composantes insuffisantes »), rang en fin de liste jamais cachée",
    by["SANSPER"].aScore === null && cacHtml.indexOf("Composantes insuffisantes") !== -1);
  ck("v7.7 : tableau compact — lignes .crow + cellule score .csc + détail .cdet masqué",
    cacHtml.indexOf('<div class="crow"') !== -1 && cacHtml.indexOf('class="csc') !== -1 && cacHtml.indexOf('<div class="cdet"') !== -1);
  ck("v7.7 : verdicts 🥇🥈🥉⏸ rendus (au moins une médaille ou un ⏸ sur les lignes scorées)",
    /(🥇|🥈|🥉|⏸)/.test(cacHtml) && by["TOTALENERGIES"].verdict != null && by["ACCOR"].verdict != null);

  // bandeau macro 🌍 — relevés publics du Radar transportés par quotes.json, contexte JAMAIS noté
  ck("v7.7 : carte macro visible — chips VIX (14,2 · lissé 5 j), OAT 10 ans 3,25 %, spread France-Allemagne 65 pb, BCE dépôt 2 % (baisse)",
    els.cacMacroCard.style.display === "" && txt("cacChips").indexOf("VIX 14,2") !== -1 && txt("cacChips").indexOf("lissé 5 j 14,8") !== -1 &&
    txt("cacChips").indexOf("OAT 10 ans 3,25 %") !== -1 && txt("cacChips").indexOf("spread France-Allemagne 65 pb") !== -1 && txt("cacChips").indexOf("BCE dépôt 2 % (baisse)") !== -1);
  ck("v7.7 : note macro — source Radar Conjoncture, âge du relevé (" + expAge + " j), pas d'alerte péremption à 1 j",
    txt("cacMNote").indexOf("relevés publics du Radar Conjoncture") !== -1 && txt("cacMNote").indexOf("(" + expAge + " j)") !== -1 && txt("cacMNote").indexOf("Relevé ancien") === -1);
  ck("v7.7 : meta relevé — source TradingView (différé ~15 min) + composition du 09/11/2026",
    txt("cacRel").indexOf("différé ~15 min") !== -1 && txt("cacRel").indexOf("composition du 09/11/2026") !== -1);
  ck("v7.7 : bandeau d'avertissement — les 37 valeurs sans cote de la fixture sont tracées honnêtement",
    els.cacBanner.style.display === "" && txt("cacBanner").indexOf("sans cote") !== -1);

  // détail complet au tap (rendu masqué dans la ligne)
  ck("v7.7 : détail TOTALENERGIES rendu — composantes + base 3/3, objectif 72 € (+20 %, 18 analystes), surprise EPS ✅ +4,2 %, publication 05/02/2027, 52 s., cote Boursorama",
    cacHtml.indexOf("Composantes du score") !== -1 && cacHtml.indexOf("(base 3/3)") !== -1 &&
    cacHtml.indexOf("72 €") !== -1 && cacHtml.indexOf("+20 %") !== -1 && cacHtml.indexOf("18 analystes") !== -1 &&
    cacHtml.indexOf("surprise EPS") !== -1 && cacHtml.indexOf("✅") !== -1 &&
    cacHtml.indexOf("05/02/2027") !== -1 && cacHtml.indexOf("52 s.") !== -1 && cacHtml.indexOf("boursorama.com") !== -1);

  // tap sur une ligne → déplie/replie le détail (délégation click sur cacList)
  var fakeRow = { classList: { contains: function (c) { return c === "crow"; } }, getAttribute: function (k) { return k === "data-i" ? "0" : null; }, parentNode: null };
  document.getElementById("cdet0").style.display = "none";   // comme dans le DOM réel : inline style du détail masqué
  els.cacList.fire("click", { target: fakeRow });
  ck("v7.7 : tap sur la ligne → le détail se déplie (display \"\")", els.cdet0.style.display === "");
  els.cacList.fire("click", { target: fakeRow });
  ck("v7.7 : re-tap → le détail se replie (display \"none\")", els.cdet0.style.display === "none");

  // recherche
  els.cacQ.fire("input", { target: { value: "total" } });
  var cacSearchHtml = String(els.cacList.innerHTML);
  ck("v7.7 : recherche « total » → TOTALENERGIES seule (ACCOR et SANSPER filtrés)",
    cacSearchHtml.indexOf("TOTALENERGIES") !== -1 && cacSearchHtml.indexOf("ACCOR") === -1 && cacSearchHtml.indexOf("SANSPER") === -1);
  els.cacQ.fire("input", { target: { value: "zzz" } });
  ck("v7.7 : recherche sans résultat → message « Aucune valeur du CAC 40 pour « zzz » », pas de liste vide muette",
    String(els.cacList.innerHTML).indexOf("Aucune valeur du CAC 40 pour") !== -1);
  els.cacQ.fire("input", { target: { value: "" } });
  ck("v7.7 : recherche effacée → les 3 cotées reviennent",
    String(els.cacList.innerHTML).indexOf("ACCOR") !== -1 && String(els.cacList.innerHTML).indexOf("SANSPER") !== -1);

  // cache localStorage : dernier relevé conservé → affiché même quand le réseau échoue
  sandbox.cacSave(fx);
  ck("v7.7 : cacSave → le relevé est persisté dans radar-cac-quotes-v1",
    (store["radar-cac-quotes-v1"] || "").indexOf("TOTALENERGIES") !== -1);
  sandbox.loadCac(true);   // forcé : fetch rejeté, mais le cache est rendu AVANT, et le catch ne l'écrase pas
}).then(function () {}).then(function () {
  ck("v7.7 : réseau en échec AVEC cache → le classement du cache reste affiché (« Relevé indisponible » ne l'écrase JAMAIS)",
    String(els.cacList.innerHTML).indexOf("TOTALENERGIES") !== -1 && String(els.cacList.innerHTML).indexOf("ACCOR") !== -1 &&
    String(els.cacList.innerHTML).indexOf("Relevé indisponible") === -1);

// 10. Bilan
var fail = checks.filter(function (c) { return !c.ok; });
checks.forEach(function (c) { console.log((c.ok ? "✅ " : "❌ ") + c.name); });
console.log("");
if (fail.length) { console.log("SIM ÉCHECS : " + fail.length); process.exit(1); }
console.log("SIM OK — " + checks.length + "/" + checks.length + " vérifications, aucune erreur d'exécution (charge complète + override daté + expiration + dates hostiles v5.9 + retour sur l'app + simulateur piloté par le forçage seul + synthèse à source partagée v5.10 + univers réel v5.11 + carte « Ton patrimoine réel » 7 actifs v5.12 + gardes anti-skew logic.js périmé v5.12.1 + lecture honnête ligne par ligne v5.13 + carte 🎯 Ma décision v6.0/v6.1 : flux/supplément-lecture/stock + plus de double saisie (renvoi 🧮) + éditeur ✏️ + skew + ligne patrimoine sans débordement v6.2 + lecture sous l'enceinte wrappable v6.3 + fusion app Patrimoine 💼 v7.0 : module v11 en IIFE, montants auto vers les 7 lignes 👤, ✏️ prioritaire, hook PatrimoineRender + v7.3 : actifs 💼 non classés affichés par leur nom, plus d'omission silencieuse + v7.5 : carte 🏆 Meilleure opportunité — dropdown des 6 actifs à avoir, bandeau vedette, détail par actif + destination réelle + contexte paliers actions + garde anti-skew + v7.6 : 📉 drawdown par actif — or/actions/BTC vs sommet 52 sem., lectures honnêtes pour obligations/immo/monétaire + onglet 🇫🇷 CAC 40 v7.7 : fusion Sentinelle perso — classement 🎯 qualité 40 %/valorisation 25 %/consensus 35 % (percentiles sur tout le SBF, filtre cac40 après), macro 🌍 du Radar en contexte jamais notée, tableau compact + détail complet au tap, garde anti-skew, hors ligne sans crash).");
}).catch(function (e) {
  console.log("SIM ÉCHEC INATTENDU : " + (e && e.stack || e));
  process.exit(1);
});
