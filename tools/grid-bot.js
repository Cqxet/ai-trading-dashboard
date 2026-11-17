'use strict';
// Küçük, önceden belirlenmiş ızgara: hafıza/devre kesici hassasiyeti. Tüm veri setlerinde birlikte değerlendirilir.
const R = require('./botreplay.js');
const base = { adaptive: true, mktFilter: true, minBreadth: 0.4 };
const G = {
  'K genel koruma (geri çekilmeli)': { ...base, memZ: 0, probeMin: 240 },
  'K2 probe 120': { ...base, memZ: 0, probeMin: 120 },
  'M2 koruma+kanıt': { ...base, memZ: 0, memRequire: true, probeMin: 240 },
  'P koruma, filtresiz': { adaptive: true, memZ: 0, probeMin: 240 }
};
(async () => {
  const sets = [['normal', 2400, '1h100'], ['normal', 6000, '1h250'], ['fast', 6000, '15m'], ['veryfast', 8000, '5m'], ['extreme', 6000, '3m'], ['super', 7000, '1m']];
  const res = {}; Object.keys(G).forEach(k => res[k] = []);
  for (const [m, bars, label] of sets) {
    const { tf, data } = await R.loadData(m, 20, bars), P = R.prepare(data, tf);
    for (const [name, o] of Object.entries(G)) { const r = R.replay(P, m, { botOpts: Object.assign({ initialTRY: 100000 }, o) }); res[name].push({ label, ret: r.ret, n: r.trades, avg: r.avgNetPct, r1: r.ret1, r2: r.ret2 }); }
  }
  console.log('config'.padEnd(18), sets.map(s => s[2].padStart(8)).join(''), '   ort   en kötü');
  for (const [k, v] of Object.entries(res)) console.log(k.padEnd(18), v.map(x => R.f(x.ret, 1).padStart(8)).join(''), R.f(v.reduce((a, x) => a + x.ret, 0) / v.length, 1).padStart(7), R.f(Math.min(...v.map(x => x.ret)), 1).padStart(8));
})().catch(e => { console.error(e); process.exit(1); });
