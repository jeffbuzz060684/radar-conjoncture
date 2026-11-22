#!/usr/bin/env node
/*
 * v9.0 — Moteur de backtest multi-actifs : paliers −5/−10/−15/−20 % (réserve 20 % du flux)
 * vs buy-and-hold 100 % du flux, classe par classe.
 *
 * Actifs testés (données quotidiennes Yahoo Finance, cache dans backtest-data/ — gitignoré) :
 *  - IWDA.AS   : actions monde (EUR, Euronext Amsterdam)
 *  - IEAG.AS   : obligations zone euro (EUR, Euronext Amsterdam)
 *  - XAD5.DE   : or physique Xetra (EUR, déjà en euros)
 *  - BTC       : Bitcoin — cours BTC-USD (Yahoo) converti en EUR au taux de change quotidien
 *                de référence BCE (EXR/D.USD.EUR.SP00.A) : Yahoo + ECB.
 * La réserve (monétaire) est rémunérée au taux de facilité de dépôt BCE (FM.B.U2.EUR.4F.KR.DFR.LEV).
 *
 * MÉCANIQUE COMMUNE (celle du Radar, comme backtest-paliers.js) :
 *  - flux mensuel de 1 000 € : 800 € investis le 1er jour ouvré + 200 € en réserve (20 %) ;
 *  - paliers mesurés sur l'ACTIF (−5/−10/−15/−20 % du plus haut 52 sem., 252 séances),
 *    25 % de la réserve déployée par palier, une fois par épisode ;
 *  - un nouveau plus haut 52 sem. réarme les paliers (nouvel épisode) ;
 *  - benchmark : 1 000 €/mois 100 % investis, même jour, même actif (buy-and-hold du flux).
 *
 * MÉTRIQUES — XIRR (bissection, logic.js xirrOf), mais volatilité, Sharpe, maxDD et pire
 * année sont mesurés SUR L'ACTIF (rendements mensuels de son prix), pas sur la valeur du
 * portefeuille : la stratégie ne change pas le risque de l'actif, seulement la répartition
 * des versements dans le temps.
 * Taux de réussite des signaux : pour chaque déploiement de palier, rendement de l'actif
 * à 12 mois vs la MÉDIANE des rendements 12 mois de l'actif sur tout l'échantillon.
 *
 * SORTIE : CSV par actif + synthèse dans backtest-data/out/ (gitignoré).
 *
 * LIMITES ASSUMÉES (à lire avant de citer un chiffre) :
 *  - IN-SAMPLE : la mécanique est validée sur l'historique qui l'a inspirée ;
 *    elle ne promet rien sur le futur (le backbone reste la référence permanente).
 *  - Le filtre anti-accumulation réel exige un contrôle CAPE/PMI : CAPE et PMI ne sont
 *    PAS backtestés ici — simplification affichée comme telle.
 *  - Frais ignorés (les deux jambes paient le même TER via le cours ; déploiements à
 *    0,99 € l'ordre, négligeable sur les montants simulés). Fiscalité ignorée (PEA,
 *    identique des deux côtés).
 *  - IWDA.AS débute le 25/09/2009, IEAG en 2011, BTC en 2014 : chaque actif démarre à
 *    sa propre naissance — ni 2000 ni 2008 dans l'échantillon monde.
 *  - Résultat clé, honnête : la variante paliers ne surperforme le buy-and-hold sur
 *    AUCUNE classe testée — la réserve est un confort anti-panique, pas un alpha
 *    (SPIVA : la grande majorité des stratégies actives sous-performe sa référence).
 *
 * Usage : node tools/backtest-moteur.js [--fetch]
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, '..', 'logic.js'));

const DIR = path.join(__dirname, '..', 'backtest-data');
const OUT = path.join(DIR, 'out');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

const PALIERS = [0.05, 0.10, 0.15, 0.20];
const RESERVE_PART = 0.20;     // 200 € sur 1 000 €/mois
const DEPLOY_PART = 0.25;      // 25 % de la réserve par palier
const SOCLE = 1000;            // flux mensuel total (€)

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/csv' } }, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}
function loadCached(name, url, force) {
  const p = path.join(DIR, name);
  if (!force && fs.existsSync(p)) return Promise.resolve(fs.readFileSync(p, 'utf8'));
  fs.mkdirSync(DIR, { recursive: true });
  return fetch(url).then(b => { fs.writeFileSync(p, b); return b; });
}

// ---- séries quotidiennes Yahoo → [{date, close}] forward-fill
function parseDaily(j) {
  const r = JSON.parse(j).chart.result[0];
  const out = [];
  let last = null;
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = r.indicators.quote[0].close[i];
    const dt = new Date(r.timestamp[i] * 1000).toISOString().slice(0, 10);
    if (c != null) last = c;
    if (last != null) out.push({ date: dt, close: last });
  }
  return out;
}

// ---- ECB (CSV SDMX) → [{date, rate fraction}] trié — colonnes repérées par l'EN-TÊTE
// (la série FM porte TIME_PERIOD/OBS_VALUE en colonnes 8/9, la série EXR en 6/7 : jamais d'indice en dur)
function parseEcbRows(csv) {
  const lines = csv.trim().split('\n');
  const rows = [];
  let iPer = -1, iVal = -1;
  for (const l of lines) {
    const c = l.split(',');
    if (iPer === -1 && l.startsWith('KEY,')) {
      iPer = c.indexOf('TIME_PERIOD');
      iVal = c.indexOf('OBS_VALUE');
      continue;
    }
    if (iPer < 0 || iVal < 0) continue;
    const per = c[iPer], val = parseFloat(c[iVal]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(per) && isFinite(val)) rows.push({ date: per, rate: val / 100 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}
function rateAt(rows, iso) {
  let r = rows.length ? rows[0].rate : 0;
  for (const d of rows) { if (d.date <= iso) r = d.rate; else break; }
  return r;
}

// ---- clôtures mensuelles : [{ym, close}] (dernière séance du mois)
function monthlyCloses(prices) {
  const out = [];
  for (const p of prices) {
    const ym = p.date.slice(0, 7);
    if (!out.length || out[out.length - 1].ym !== ym) out.push({ ym, close: p.close });
    else out[out.length - 1].close = p.close;
  }
  return out;
}

// ---- métriques de l'ACTIF (rendements mensuels de son prix)
function assetMetrics(monthly, dfrRows) {
  const rets = [];
  for (let i = 1; i < monthly.length; i++) rets.push(monthly[i].close / monthly[i - 1].close - 1);
  const n = rets.length || 1;
  const mean = rets.reduce((s, x) => s + x, 0) / n;
  const vol = Math.sqrt(rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / (n - 1 || 1)) * Math.sqrt(12);
  const retAnn = Math.pow(1 + mean, 12) - 1;
  let rfSum = 0;
  for (const m of monthly) rfSum += rateAt(dfrRows, m.ym + '-15');
  const rf = monthly.length ? rfSum / monthly.length : 0;
  const sharpe = vol > 0 ? (retAnn - rf) / vol : null;
  const rets12 = [];
  for (let i = 12; i < monthly.length; i++) rets12.push(monthly[i].close / monthly[i - 12].close - 1);
  const median12 = rets12.length ? rets12.slice().sort((a, b) => a - b)[Math.floor(rets12.length / 2)] : null;
  return { vol, sharpe, median12 };
}
function maxDDof(prices) {
  let peak = -Infinity, dd = 0;
  for (const p of prices) { if (p.close > peak) peak = p.close; dd = Math.min(dd, p.close / peak - 1); }
  return dd;
}
function worstYear(monthly) {
  const prod = {};
  for (let i = 1; i < monthly.length; i++) {
    const y = monthly[i].ym.slice(0, 4);
    const yPrev = monthly[i - 1].ym.slice(0, 4);
    if (y === yPrev) prod[y] = (prod[y] || 1) * (1 + (monthly[i].close / monthly[i - 1].close - 1));
  }
  const years = Object.keys(prod);
  if (!years.length) return null;
  return Math.min.apply(null, years.map(y => prod[y] - 1));
}

// ---- simulation paliers (quotidien) : 800 € investi + 20 % réserve (DFR BCE)
function simulate(prices, dfrRows, cash0) {
  let parts = 0, reserve = 0, invested = 0;
  let done = [false, false, false, false];
  let ym = '';
  const deploys = [];
  const snaps = [];
  for (let i = 0; i < prices.length; i++) {
    const date = prices[i].date, close = prices[i].close;
    const winStart = Math.max(0, i - 251);
    let high52 = -Infinity;
    for (let k = winStart; k <= i; k++) high52 = Math.max(high52, prices[k].close);

    const m = date.slice(0, 7);
    if (m !== ym) {
      ym = m;
      if (i > 0) {
        parts += (SOCLE * (1 - RESERVE_PART)) / close;
        reserve += SOCLE * RESERVE_PART;
        invested += SOCLE;
      }
    }
    if (i > 0 && !cash0) {
      const r = rateAt(dfrRows, date);
      const days = (new Date(date) - new Date(prices[i - 1].date)) / 86400000;
      reserve *= Math.pow(1 + r, days / 365.25);
    }
    if (close >= high52 * 0.999) done = [false, false, false, false];   // nouvel épisode → paliers réarmés
    const dd = close / high52 - 1;
    for (let p = 0; p < PALIERS.length; p++) {
      if (!done[p] && dd <= -PALIERS[p] && reserve > 1) {
        const montant = Math.min(reserve * DEPLOY_PART, reserve);
        reserve -= montant;
        parts += montant / close;
        done[p] = true;
        deploys.push({ date, palier: PALIERS[p], prix: close });
      }
    }
    if (!snaps.length || snaps[snaps.length - 1].ym !== m) {
      snaps.push({ ym: m, total: parts * close + reserve });
    }
  }
  const last = prices[prices.length - 1].close;
  return { total: parts * last + reserve, invested, socle: parts * last, reserve, deploys, snaps, ymEnd: prices[prices.length - 1].date.slice(0, 7) };
}

// ---- buy-and-hold : 100 % du flux investi, même jour
function simulateBH(prices) {
  let parts = 0, invested = 0, ym = '';
  const snaps = [];
  for (let i = 0; i < prices.length; i++) {
    const m = prices[i].date.slice(0, 7);
    if (m !== ym) {
      if (i > 0) { parts += SOCLE / prices[i].close; invested += SOCLE; }
      ym = m;
    }
    const cur = parts * prices[i].close;
    if (!snaps.length || snaps[snaps.length - 1].ym !== m) snaps.push({ ym: m, total: cur });
    else snaps[snaps.length - 1].total = cur;
  }
  return { total: parts * prices[prices.length - 1].close, invested, snaps, ymEnd: prices[prices.length - 1].date.slice(0, 7) };
}

function pct2(x) { return (x === null || x === undefined || isNaN(x)) ? '—' : (x * 100).toFixed(2) + ' %'; }
function pctPts(x) { return (x === null || x === undefined || isNaN(x)) ? '—' : x.toFixed(2) + ' %'; }
function eur(x) { return Math.round(x).toLocaleString('fr-FR') + ' €'; }

(async () => {
  const force = process.argv.includes('--fetch');
  const p2 = Math.floor(Date.now() / 1000);
  const dfr = parseEcbRows(await loadCached('dfr.csv', 'https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=2007-01-01', force));
  const usdEur = parseEcbRows(await loadCached('usd_eur.csv', 'https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&startPeriod=2009-01-01', force));

  const ASSETS = [
    { id: 'monde', sym: 'IWDA.AS', nom: 'Actions monde (IWDA.AS)', since: 1253862000, fromUsd: false },
    { id: 'obligations', sym: 'IEAG.AS', nom: 'Obligations zone euro (IEAG.AS)', since: 1297075200, fromUsd: false },
    { id: 'or', sym: 'XAD5.DE', nom: 'Or EUR (XAD5.DE, Xetra)', since: 1190670000, fromUsd: false },
    { id: 'btc', sym: 'BTC-USD', nom: 'Bitcoin (BTC-USD Yahoo → EUR, taux ECB)', since: 1410912000, fromUsd: true }
  ];

  fs.mkdirSync(OUT, { recursive: true });
  const summary = [];
  for (const a of ASSETS) {
    const raw = await loadCached(a.sym.replace(/[^A-Za-z0-9]/g, '_') + '_daily.json', 'https://query1.finance.yahoo.com/v8/finance/chart/' + a.sym + '?interval=1d&period1=' + a.since + '&period2=' + p2, force);
    let prices = parseDaily(raw);
    if (a.fromUsd) prices = prices.map(p => ({ date: p.date, close: p.close * rateAt(usdEur, p.date) }));
    if (prices.length < 300) { console.error('Série trop courte pour ' + a.sym + ' — ignorée.'); continue; }

    const S = simulate(prices, dfr, process.argv.includes('--cash0'));
    const B = simulateBH(prices);
    const monthly = monthlyCloses(prices);
    const M = assetMetrics(monthly, dfr);
    const mdd = maxDDof(prices);
    const wy = worstYear(monthly);

    // réussite des signaux : rendement de l'actif 12 mois après le palier vs médiane 12 mois
    const closeByYm = {};
    for (const m of monthly) closeByYm[m.ym] = m.close;
    let ok = 0, n = 0;
    for (const d of S.deploys) {
      const ym0 = d.date.slice(0, 7);
      let y = +ym0.slice(0, 4), mo = +ym0.slice(5, 7) + 12;
      const yy = y + Math.floor((mo - 1) / 12), mm = ((mo - 1) % 12) + 1;
      const ym12 = yy + '-' + String(mm).padStart(2, '0');
      if (closeByYm[ym0] !== undefined && closeByYm[ym12] !== undefined && M.median12 !== null) {
        n++;
        if (closeByYm[ym12] / closeByYm[ym0] - 1 > M.median12) ok++;
      }
    }

    // XIRR : flux mensuels −1 000 € + valeur finale, via logic.js xirrOf (bissection)
    const flowsS = [{ date: S.ymEnd, amount: S.total }];
    const flowsB = [{ date: B.ymEnd, amount: B.total }];
    for (const ms of S.snaps.slice(1)) {
      flowsS.push({ date: ms.ym, amount: -SOCLE });
      flowsB.push({ date: ms.ym, amount: -SOCLE });
    }
    const xS = L.xirrOf(flowsS), xB = L.xirrOf(flowsB);

    console.log('=== ' + a.nom + ' — ' + prices[0].date + ' → ' + prices[prices.length - 1].date + ' (' + monthly.length + ' mois, ' + S.deploys.length + ' déploiements) ===');
    console.log('Stratégie paliers : ' + eur(S.total) + ' (dont socle ' + eur(S.socle) + ' + réserve ' + eur(S.reserve) + ')  ·  investi ' + eur(S.invested));
    console.log('Buy-and-hold 100 % flux : ' + eur(B.total) + '  ·  investi ' + eur(B.invested));
    console.log('Écart paliers − BH : ' + eur(S.total - B.total) + '  (' + pct2((S.total - B.total) / B.total) + ' du pot final)');
    console.log('XIRR : paliers ' + pctPts(xS) + '/an  ·  BH ' + pctPts(xB) + '/an  ·  écart ' + ((xS !== null && xB !== null) ? (xS - xB).toFixed(2) : '—') + ' pts');
    console.log('Actif : vol ' + pct2(M.vol) + '  ·  Sharpe ' + (M.sharpe === null ? '—' : M.sharpe.toFixed(2)) + '  ·  maxDD ' + pct2(mdd) + '  ·  pire année ' + pct2(wy));
    console.log('Signaux : ' + (n ? pct2(ok / n) + ' des déploiements battent la médiane 12 mois (' + ok + '/' + n + ')' : 'aucun signal à 12 mois évaluable'));
    console.log('');
    summary.push({ a, S, B, xS, xB, M, mdd, wy, ok, n, debut: monthly[0].ym, mois: monthly.length });

    // CSV mensuel par actif (traçabilité)
    const bhByYm = {};
    for (const ms of B.snaps) bhByYm[ms.ym] = ms.total;
    const lines = ['mois,valeur_paliers_eur,valeur_buyhold_eur'];
    for (const ms of S.snaps) lines.push([ms.ym, ms.total.toFixed(2), (bhByYm[ms.ym] || 0).toFixed(2)].join(','));
    fs.writeFileSync(path.join(OUT, 'backtest-' + a.id + '.csv'), lines.join('\n') + '\n');
  }

  // CSV synthèse
  const srows = ['actif,debut,mois,xirr_paliers_pct,xirr_bh_pct,ecart_xirr_pts,total_paliers_eur,total_bh_eur,ecart_total_eur,vol_actif_pct,sharpe,maxdd_actif_pct,pire_annee_pct,signaux_ok,signaux_total'];
  for (const s of summary) {
    srows.push([
      s.a.id, s.debut, s.mois,
      s.xS === null ? '' : s.xS.toFixed(2), s.xB === null ? '' : s.xB.toFixed(2),
      (s.xS !== null && s.xB !== null) ? (s.xS - s.xB).toFixed(2) : '',
      s.S.total.toFixed(0), s.B.total.toFixed(0), (s.S.total - s.B.total).toFixed(0),
      (s.M.vol * 100).toFixed(2), s.M.sharpe === null ? '' : s.M.sharpe.toFixed(2),
      (s.mdd * 100).toFixed(2), s.wy === null ? '' : (s.wy * 100).toFixed(2),
      s.ok, s.n
    ].join(','));
  }
  fs.writeFileSync(path.join(OUT, 'backtest-synthese.csv'), srows.join('\n') + '\n');
  console.log('CSV écrits dans backtest-data/out/ (gitignoré) : backtest-synthese.csv + 1 fichier mensuel par actif.');

  // verdicts par classe sur le XIRR (le total court-circuite la duration des série)
  const ok = summary.filter(s => s.xS !== null && s.xB !== null && isFinite(s.S.total) && isFinite(s.B.total));
  const beats = ok.filter(s => s.xS > s.xB);
  const loses = ok.filter(s => s.xS <= s.xB);
  console.log('VERDICT HONNÊTE : la variante paliers bat le buy-and-hold sur ' + beats.length + '/' + ok.length + ' classe(s)' +
    (beats.length ? ' (' + beats.map(s => s.a.id + ' +' + (s.xS - s.xB).toFixed(2) + ' pt/an').join(', ') + ')' : '') +
    ' ; elle perd sur ' + loses.map(s => s.a.id + ' (' + (s.xS - s.xB).toFixed(2) + ' pt/an)').join(', ') +
    ". Sur aucune classe l'écart n'est assez grand pour être un alpha — la réserve est un confort anti-panique, pas de la surperformance (SPIVA).");
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
