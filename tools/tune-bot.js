'use strict';
// Akıllı katman deneyleri: aynı gerçek veride yapılandırmaları karşılaştırır. Büyük başlangıç bakiyesi kullanılır ki 10 TL asgari emir
// tabanı sonucu bozmasın (oranlar ve maliyetler aynı). Metrik: işlem başına ort. net %, toplam net PnL (başlangıcın %'si), maxDD.
const R = require('./botreplay.js');
const CONFIGS = { 'kapalı (eski davranış)': { adaptive: false, mktFilter: false }, 'varsayılan (akıllı katman)': {} };
(async () => {
  const sets = [['normal', 2400, '1h ~100g'], ['normal', 6000, '1h ~250g'], ['fast', 6000, '15m ~62g'], ['veryfast', 8000, '5m ~28g'], ['extreme', 6000, '3m ~12g'], ['super', 7000, '1m ~5g']];
  const only = process.argv[2] ? process.argv[2].split(',') : null;
  for (const [m, bars, label] of sets) {
    if (only && !only.includes(label.split(' ')[0] + ':' + m) && !only.includes(m)) continue;
    const { tf, data } = await R.loadData(m, 20, bars), P = R.prepare(data, tf);
    console.log(`\n== ${m} · ${label} ==`);
    for (const [name, opts] of Object.entries(CONFIGS)) {
      const r = R.replay(P, m, { botOpts: Object.assign({ initialTRY: 100000, minOrderTRY: 10 }, opts) });
      const pnl = r.st.history.reduce((a, x) => a + x.pnl, 0) / 1000;
      console.log(`${name.padEnd(24)} getiri %${R.f(r.ret).padStart(7)} (1.yarı %${R.f(r.ret1).padStart(6)} / 2.yarı %${R.f(r.ret2).padStart(6)}) işlem ${String(r.trades).padStart(4)} kaz %${R.f(r.winRate, 0).padStart(3)} ort/işl %${R.f(r.avgNetPct, 3).padStart(7)} maxDD %${R.f(r.mdd).padStart(5)} bloklanan ${r.st.mem.blocked}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
