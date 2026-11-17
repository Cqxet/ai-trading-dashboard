'use strict';
// Örneklem dışı SEMBOL sınavı: ayar seçiminde HİÇ kullanılmayan semboller (listede 21..30. sıra).
const R = require('./botreplay.js');
const K = { adaptive: true, mktFilter: true, minBreadth: 0.4, memZ: 0, probeMin: 240 };
(async () => {
  const sets = [['normal', 2400, '1h100'], ['normal', 6000, '1h250'], ['fast', 6000, '15m'], ['veryfast', 8000, '5m']];
  const syms = R.SYMBOLS.slice(20, 30);
  console.log('Semboller:', syms.join(' '));
  for (const [m, bars, label] of sets) {
    const tf = R.MODE_TF[m], data = {};
    for (const s of syms) { try { data[s] = await R.loadCandles(s, tf, bars); } catch (e) { console.error('yok ' + s); } }
    const P = R.prepare(data, tf);
    const a = R.replay(P, m, { botOpts: { initialTRY: 100000 }, topN: 10 }), b = R.replay(P, m, { botOpts: Object.assign({ initialTRY: 100000 }, K), topN: 10 });
    console.log(label.padEnd(7), `taban %${R.f(a.ret).padStart(7)} (işlem ${String(a.trades).padStart(4)}, ort/işl %${R.f(a.avgNetPct, 3)}) | akıllı %${R.f(b.ret).padStart(7)} (işlem ${String(b.trades).padStart(4)}, ort/işl %${R.f(b.avgNetPct, 3)}) | piyasa al-tut %${R.f(a.bh)}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
