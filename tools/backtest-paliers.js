#!/usr/bin/env node
/*
 * Backtest de la mécanique de paliers du Radar Conjoncture / stratégie épargne de Jade.
 * Reproduit fidèlement : 800 €/mois DCAM (plan programmé, 0 €) + 200 €/mois réserve
 * (monétaire PEA, taux de dépôt BCE), paliers −5/−10/−15/−20 % vs plus haut 52 sem.
 * (fenêtre glissante 252 séances, comme l'app), 25 % de la réserve par palier,
 * une fois par épisode, ordre tactique 0,99 € (Bourse Direct), épisode réinitialisé
 * au retour au plus haut. Benchmark : 1 000 €/mois tout DCAM le même jour.
 *
 * Usage : node tools/backtest-paliers.js            (lit ../backtest-data/ ou le crée)
 *         node tools/backtest-paliers.js --fetch    (retélécharge Yahoo + BCE)
 *
 * DONNÉES : IWDA.AS (iShares Core MSCI World, ETF capitalisant en EUR, Euronext A'dam)
 * via l'API chart de Yahoo Finance ; taux de dépôt BCE via data-api.ecb.europa.eu
 * (série FM.B.U2.EUR.4F.KR.DFR.LEV, dates de changement). Toutes deux publiques.
 *
 * LIMITES ASSUMÉES (à lire avant de citer un chiffre) :
 * - IWDA.AS existe depuis le 25/09/2009 → le krach de 2008 n'est PAS couvert ;
 *   les épisodes testés sont 2011, 2015-16, 2018, 2020, 2022, 2025-26.
 * - DCAM (réplication synthétique, 0,20 %/an) et IWDA (0,50 %/an) suivent le même
 *   indice MSCI World Net EUR ; l'écart de TER est ignoré (il frappe A et B pareil).
 * - L'anti-accumulation réelle exige une vérification du CAPE par Jade ; la
 *   variante V2 automatise « déploiement de l'excédent > 3 000 € après 6 mois
 *   sans signal » SANS vérification CAPE — simplification affichée comme telle.
 * - Backtest descriptif IN-SAMPLE : il valide une mécanique sur l'historique,
 *   il ne promet rien sur le futur.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'backtest-data');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/csv' } }, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      let b = ''; res.on('data', c => (b += c)); res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

function loadOrFetch() {
  const dailyP = path.join(DIR, 'iwda_daily.json');
  const dfrP = path.join(DIR, 'dfr.csv');
  const force = process.argv.includes('--fetch');
  if (!force && fs.existsSync(dailyP) && fs.existsSync(dfrP)) {
    return Promise.resolve({
      daily: JSON.parse(fs.readFileSync(dailyP, 'utf8')),
      dfr: fs.readFileSync(dfrP, 'utf8')
    });
  }
  fs.mkdirSync(DIR, { recursive: true });
  const p1 = 1253862000; // 25/09/2009, première cotation IWDA.AS
  const p2 = Math.floor(Date.now() / 1000);
  return Promise.all([
    fetch(`https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS?interval=1d&period1=${p1}&period2=${p2}`),
    fetch('https://data-api.ecb.europa.eu/service/data/FM/B.U2.EUR.4F.KR.DFR.LEV?format=csvdata&startPeriod=2009-01-01')
  ]).then(([daily, dfr]) => {
    fs.writeFileSync(dailyP, daily);
    fs.writeFileSync(dfrP, dfr);
    return { daily: JSON.parse(daily), dfr };
  });
}

// ---- taux de dépôt BCE : liste triée de {date, rate} (en fraction annuelle)
function parseDfr(csv) {
  const rows = [];
  const lines = csv.trim().split('\n');
  for (const l of lines) {
    if (l.startsWith('KEY,') || !l) continue;
    const c = l.split(',');
    const per = c[8], val = parseFloat(c[9]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(per) && !isNaN(val)) rows.push({ date: per, rate: val / 100 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  return rows;
}
function dfrAt(dfr, isoDate) {
  let r = dfr.length ? dfr[0].rate : 0;
  for (const d of dfr) { if (d.date <= isoDate) r = d.rate; else break; }
  return r;
}

// ---- série prix : [{date, close}] sans trous (forward-fill des nulls)
function parseDaily(j) {
  const r = j.chart.result[0];
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

const PALIERS = [0.05, 0.10, 0.15, 0.20]; // −5 −10 −15 −20 %
const RESERVE_PAR_MOIS = 200;
const SOCLE_PAR_MOIS = 800;
const FRAIS_ORDRE = 0.99;
const ANTICIPATION_CASH_0 = process.argv.includes('--cash0');

function simulate(prices, dfr, opts) {
  const { antiAccu, cashRateMode } = opts; // antiAccu: bool ; cashRateMode: 'dfr' | 'zero'
  // état
  let socle = 0, socleParts = 0, reserve = 0;
  let paliersDone = [false, false, false, false];
  let refHigh = null; // référence de l'épisode = plus haut 52 sem. courant
  let lastDeploy = prices[0].date;
  const deploys = [];
  const monthly = []; // snapshot mensuel du portefeuille total
  let yyyymm = '', invested = 0, cash0 = cashRateMode === 'zero';

  // fenêtre 52 sem. = 252 séances
  const W = 252;
  for (let i = 0; i < prices.length; i++) {
    const { date, close } = prices[i];
    const winStart = Math.max(0, i - W + 1);
    let high52 = -Infinity;
    for (let k = winStart; k <= i; k++) high52 = Math.max(high52, prices[k].close);

    // --- retour au plus haut → nouvel épisode (les paliers se réarment)
    if (close >= high52 * 0.999) { // nouveau plus haut 52 sem.
      if (paliersDone.some(Boolean)) deploys.push({ type: 'episode', date });
      paliersDone = [false, false, false, false];
      refHigh = high52;
    }

    // --- apport mensuel (1er jour ouvré du mois)
    const ym = date.slice(0, 7);
    if (ym !== yyyymm) {
      yyyymm = ym;
      if (i > 0) {
        socle += SOCLE_PAR_MOIS; invested += SOCLE_PAR_MOIS;
        socleParts += SOCLE_PAR_MOIS / close;
        reserve += RESERVE_PAR_MOIS; invested += RESERVE_PAR_MOIS;
      }
    }

    // --- rémunération de la réserve (taux de dépôt BCE, accrétion quotidienne)
    if (i > 0 && !cash0) {
      const r = dfrAt(dfr, date);
      const days = (new Date(date) - new Date(prices[i - 1].date)) / 86400000;
      reserve *= Math.pow(1 + r, days / 365.25);
    }

    // --- franchissement de palier (convention app : dd = close/high52 − 1, négatif sous le sommet)
    const dd = close / high52 - 1;
    for (let p = 0; p < PALIERS.length; p++) {
      if (!paliersDone[p] && dd <= -PALIERS[p] && reserve > 1) {
        const montant = Math.min(reserve * 0.25, reserve);
        const net = montant - FRAIS_ORDRE;
        reserve -= montant;
        socleParts += net / close;
        paliersDone[p] = true;
        lastDeploy = date;
        deploys.push({ type: 'palier', palier: PALIERS[p], date, montant, prix: close, dd: dd * 100 });
      }
    }

    // --- anti-accumulation (variante) : > 6 mois sans signal et réserve > 3 000 €
    if (antiAccu) {
      const mois = (new Date(date) - new Date(lastDeploy)) / (30.44 * 86400000);
      if (mois > 6 && reserve > 3000) {
        const excess = reserve - 3000;
        const net = excess - FRAIS_ORDRE;
        reserve -= excess;
        socleParts += net / close;
        deploys.push({ type: 'anti-accu', date, montant: excess, prix: close });
        lastDeploy = date;
      }
    }

    // --- snapshot mensuel
    const ym2 = date.slice(0, 7);
    if (!monthly.length || monthly[monthly.length - 1].ym !== ym2) {
      monthly.push({ ym: ym2, total: socleParts * close + reserve, socle: socleParts * close, reserve, invested });
    }
  }
  const last = prices[prices.length - 1].close;
  const total = socleParts * last + reserve;
  return { total, socleParts: socleParts * last, reserve, invested, deploys, monthly, lastPrice: last };
}

function simulateBenchmark(prices) {
  let parts = 0, invested = 0, yyyymm = '';
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) { yyyymm = prices[i].date.slice(0, 7); continue; }
    const ym = prices[i].date.slice(0, 7);
    if (ym !== yyyymm) { yyyymm = ym; parts += 1000 / prices[i].close; invested += 1000; }
  }
  const last = prices[prices.length - 1].close;
  return { total: parts * last, invested, lastPrice: last };
}

// TRI money-weighted (Newton + bissection, mensuel approx.)
function xirr(flows) {
  // flows: [{months, amount}] (négatif = sortie de poche)
  const f = r => flows.reduce((s, c) => s + c.amount / Math.pow(1 + r, c.months / 12), 0);
  let lo = -0.9, hi = 2;
  for (let it = 0; it < 200; it++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

function pct(x) { return (x * 100).toFixed(2) + ' %'; }
function eur(x) { return Math.round(x).toLocaleString('fr-FR') + ' €'; }

(async () => {
  const { daily, dfr } = await loadOrFetch();
  const prices = parseDaily(daily);
  const dfrRows = parseDfr(dfr);
  const lastPrice = prices[prices.length - 1];
  console.log('Données : ' + prices.length + ' séances, ' + prices[0].date + ' → ' + lastPrice.date + ' (IWDA.AS, EUR, capitalisant)');
  console.log('Dernier cours : ' + lastPrice.close.toFixed(2) + ' € — source Yahoo Finance, API chart.');
  console.log('');

  const B = simulateBenchmark(prices);

  const variants = [
    { nom: 'V1 — paliers purs (aucune règle anti-accumulation)', opts: { antiAccu: false, cashRateMode: 'dfr' } },
    { nom: 'V1b — paliers purs, réserve NON rémunérée (0 %)', opts: { antiAccu: false, cashRateMode: 'zero' } },
    { nom: 'V2 — paliers + anti-accumulation auto (>6 mois, réserve>3 000 €, SANS vérif CAPE)', opts: { antiAccu: true, cashRateMode: 'dfr' } }
  ];

  for (const v of variants) {
    const S = simulate(prices, dfrRows, v.opts);
    const nPal = S.deploys.filter(d => d.type === 'palier').length;
    const ep = S.deploys.filter(d => d.type === 'episode').length;
    const diff = S.total - B.total;
    console.log('=== ' + v.nom + ' ===');
    console.log('Investi total : ' + eur(S.invested) + '  ·  benchmark investi : ' + eur(B.invested));
    console.log('Valeur finale strat : ' + eur(S.total) + '  (dont socle ' + eur(S.socleParts) + ' + réserve ' + eur(S.reserve) + ')');
    console.log('Valeur finale DCA 1000 € : ' + eur(B.total));
    console.log('Écart strat − DCA : ' + eur(diff) + '  (' + pct(diff / B.total) + ')');
    console.log('Déploiements palier : ' + nPal + ' sur ' + ep + ' épisodes de baisse réarmés');
    // TRI : flux mensuel -800/-200 (investi) + valeur finale ; DCA : -1000/mois + final
    const months = (new Date(lastPrice.date) - new Date(prices[0].date)) / (30.44 * 86400000);
    const flowsS = [{ months: months, amount: S.total }];
    const flowsB = [{ months: months, amount: B.total }];
    for (let m = 1; m <= months; m++) {
      flowsS.push({ months: m - 1.5, amount: -1000 });
      flowsB.push({ months: m - 1.5, amount: -1000 });
    }
    console.log('TRI money-weighted approx. : strat ' + pct(xirr(flowsS)) + ' · DCA ' + pct(xirr(flowsB)));
    console.log('');
    if (v === variants[0]) {
      console.log('Détail des déploiements (V1) :');
      for (const d of S.deploys) {
        if (d.type === 'palier') {
          const gain = (S.lastPrice - d.prix) * (d.montant - FRAIS_ORDRE) / d.prix;
          console.log('  ' + d.date + '  palier −' + (d.palier * 100) + ' %  ' + eur(d.montant) + ' à ' + d.prix.toFixed(2) + ' €  → gain à ce jour ' + eur(gain));
        } else if (d.type === 'episode') {
          console.log('  ' + d.date + '  ↺ nouvel épisode (retour au plus haut 52 sem.)');
        } else {
          console.log('  ' + d.date + '  anti-accu : ' + eur(d.montant) + ' à ' + d.prix.toFixed(2) + ' €');
        }
      }
      console.log('');
    }
  }

  console.log('--- Sensibilité au seuil du 1er palier (V1, réserve DFR) : autre −5 % vs −7 % vs −3 % ---');
  for (const seuil of [0.03, 0.05, 0.07]) {
    PALIERS[0] = seuil;
    const S = simulate(prices, dfrRows, { antiAccu: false, cashRateMode: 'dfr' });
    console.log('Seuil 1er palier −' + (seuil * 100) + ' % → écart vs DCA : ' + eur(S.total - B.total) + ' (' + pct((S.total - B.total) / B.total) + '), ' + S.deploys.filter(d => d.type === 'palier').length + ' déploiements');
  }
  PALIERS[0] = 0.05;
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
