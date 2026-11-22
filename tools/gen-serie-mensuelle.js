#!/usr/bin/env node
/*
 * Générateur de la série mensuelle IWDA.AS (clôtures fin de mois) → data-serie.json.
 * Source : Yahoo Finance (API chart, interval 1mo — chaque barre mensuelle porte la
 * clôture du dernier jour de bourse du mois). Le mois EN COURS est exclu : seule une
 * clôture réalisée entre au fichier (causalité stricte du backbone, pas de mois inventé).
 *
 * Usage : node tools/gen-serie-mensuelle.js             (retélécharge Yahoo → data-serie.json)
 *         node tools/gen-serie-mensuelle.js --if-stale  (ne retélécharge que si data-serie.json
 *                                                        manque le dernier mois COMPLETE)
 *
 * Le cache brut (backtest-data/iwda_monthly.json) est gitignoré comme tout backtest-data/.
 */
'use strict';
const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'backtest-data');
const RAW = path.join(DIR, 'iwda_monthly.json');
const OUT = path.join(__dirname, '..', 'data-serie.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } }, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + url));
      let b = '';
      res.on('data', c => (b += c));
      res.on('end', () => resolve(b));
    }).on('error', reject);
  });
}

// Dernier mois COMPLE au sens du calendrier (le mois courant n'est pas clos).
function lastCompleteYm(now) {
  const d = new Date(now || Date.now());
  let y = d.getUTCFullYear(), m = d.getUTCMonth(); // mois courant : 0-based
  m -= 1;
  if (m < 0) { m = 11; y -= 1; }
  return y + '-' + String(m + 1).padStart(2, '0');
}

function ymOfTs(ts) {
  // Yahoo étiquette chaque barre mensuelle au 1er du mois en HEURE LOCALE d'Amsterdam
  // (CET/CEST) : 22h–23h UTC la veille. +3 h ramène toujours au bon mois en UTC.
  const d = new Date(ts * 1000 + 3 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function buildSerie(raw) {
  const r = JSON.parse(raw).chart.result[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const c = r.indicators.quote[0].close[i];
    if (c == null) continue;
    out.push({ ym: ymOfTs(r.timestamp[i]), close: Math.round(c * 1000) / 1000 });
  }
  return out;
}

(async () => {
  const now = Date.now();
  const cutoff = lastCompleteYm(now);
  const ifStale = process.argv.includes('--if-stale');

  if (ifStale && fs.existsSync(OUT)) {
    const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const lastYm = cur.serie[cur.serie.length - 1].ym;
    if (lastYm >= cutoff) {
      console.log('data-serie.json à jour (dernier mois complet ' + lastYm + ' ≥ ' + cutoff + ') — pas de retéléchargement.');
      return;
    }
    console.log('data-serie.json périmé (' + lastYm + ' < ' + cutoff + ') — retéléchargement.');
  }

  const p1 = 1253862000; // 25/09/2009, première cotation IWDA.AS
  const p2 = Math.floor(now / 1000);
  const raw = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/IWDA.AS?interval=1mo&period1=' + p1 + '&period2=' + p2);
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(RAW, raw);

  let serie = buildSerie(raw);
  // causalité stricte : on ne garde que les mois complets (clôture réalisée), depuis 2009-09
  serie = serie.filter(s => s.ym <= cutoff && s.ym >= '2009-09');
  if (serie.length < 2) throw new Error('série mensuelle vide ou dégénérée — rien écrit');

  const payload = {
    actif: 'IWDA.AS',
    nom: 'iShares Core MSCI World (EUR, Euronext Amsterdam)',
    source: 'Yahoo Finance — API chart, interval 1mo (clôture du dernier jour de bourse du mois)',
    devise: 'EUR',
    maj: new Date(now).toISOString().slice(0, 10),
    serie: serie
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n');
  console.log('data-serie.json : ' + serie.length + ' clôtures mensuelles ' + serie[0].ym + ' → ' + serie[serie.length - 1].ym + ' (mois courant exclu).');
})().catch(e => { console.error('ERREUR :', e.message); process.exit(1); });
