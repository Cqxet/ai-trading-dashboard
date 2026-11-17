'use strict';
// Günlük trend modu: gerçek günlük veride, Bot.step ile (başlangıç sermayesi büyük; 10 TL asgari emir etkisi yok).
const R = require('./botreplay.js');
(async () => {
  const N = +process.argv[2] || 8, B = +process.argv[3] || 3000, data = {};
  for (const s of R.SYMBOLS.slice(0, N)) { try { const cs = await R.loadCandles(s, '1d', B); if (cs.length > 700) data[s] = cs; } catch (e) {} }
  console.log(`${Object.keys(data).length} sembol, maliyet: komisyon %0.1 + kayma %0.05 / yön (Bot varsayılanı), maks. ${8} eşzamanlı pozisyon`);
  const bhYears = {}; const names = Object.keys(data);
  for (const rule of ['donchian', 'sma', 'ema']) {
    const r = R.replayTrend(data, { botOpts: { initialTRY: 1e6, minOrderTRY: 10, trendRule: rule, maxPos: Math.min(8, names.length) }, topN: N });
    console.log(rule.padEnd(9), `${R.f(r.years, 1)} yıl  getiri %${R.f(r.ret, 0).padStart(6)}  yıllık %${R.f(r.ann, 1).padStart(5)}  maxDD %${R.f(r.mdd, 0).padStart(3)}  işlem ${String(r.trades).padStart(3)}  kazanma %${R.f(r.winRate, 0)}  komisyon ${R.f(r.fees / 1e6 * 100, 2)}%  | yıllık: ` + Object.keys(r.byYear).map(y => y + ':' + R.f(r.byYear[y], 0)).join(' '));
  }
  // referans: aynı dönemde eşit ağırlık al-tut (maliyetsiz, günlük yeniden dengelenen değil: ilk gün alınıp tutulan)
  const r0 = R.replayTrend(data, { botOpts: { initialTRY: 1e6, trendRule: 'sma', maxPos: Math.min(8, names.length) }, topN: N });
  const d0 = r0.dates[0], d1 = r0.dates.at(-1), day = t => Math.floor(t / 86400);
  let acc = 0, k = 0; for (const s of names) { const cs = data[s], a = cs.find(c => day(c.time) >= d0), b = cs.at(-1); if (a) { acc += b.close / a.open - 1; k++; } }
  console.log('Al-tut (ilk ' + Math.min(8, names.length) + ' sembol, ilk gün alınıp tutulan, maliyetsiz): toplam %' + R.f(acc / k * 100, 0));
})().catch(e => { console.error(e); process.exit(1); });
