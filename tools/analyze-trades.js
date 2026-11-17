'use strict';
// Taban stratejinin işlemlerini özellik kovalarına ayırır: hangi koşulda net ortalama pozitif? (yarılar ayrı)
const R = require('./botreplay.js');
(async () => {
  const modes = ['normal', 'fast', 'veryfast', 'extreme', 'super'], all = [];
  for (const m of modes) {
    const { tf, data } = await R.loadData(m, 20), P = R.prepare(data, tf);
    // minOrder/ölçek etkisini kaldırmak için büyük başlangıç bakiyesiyle (oranlar aynı) işlemleri topla
    const r = R.replay(P, m, { botOpts: { initialTRY: 100000, minOrderTRY: 10 } });
    const h = r.st.history.slice().reverse(), mid = h.length ? h[Math.floor(h.length / 2)].closedAt : 0;
    h.forEach(x => all.push({ m, ret: x.pnl / x.costTRY * 100, half: x.closedAt < mid ? 1 : 2, f: x.feat, reason: x.reason, mfe: x.mfe }));
    console.log(m.padEnd(9), 'işlem', h.length, 'ort net %' + R.f(h.reduce((a, x) => a + x.pnl / x.costTRY * 100, 0) / Math.max(1, h.length), 3));
  }
  const groups = {};
  const add = (k, t) => { const g = groups[k] = groups[k] || { n: 0, sum: 0, h1: [0, 0], h2: [0, 0] }; g.n++; g.sum += t.ret; const hh = t.half === 1 ? g.h1 : g.h2; hh[0]++; hh[1] += t.ret; };
  all.forEach(t => { if (!t.f) return; add('mod:' + t.m + '|reg:' + t.f.reg, t); add('reg:' + t.f.reg, t); add('conf:' + t.f.conf, t); add('rsi:' + t.f.rsi, t); add('vol:' + t.f.vol, t); add('mkt:' + t.f.mkt, t); add('mod:' + t.m + '|mkt:' + t.f.mkt, t); add('reg:' + t.f.reg + '|mkt:' + t.f.mkt, t); add('reg:' + t.f.reg + '|rsi:' + t.f.rsi, t); });
  const rows = Object.entries(groups).filter(([k, g]) => g.n >= 80).map(([k, g]) => ({ k, n: g.n, avg: g.sum / g.n, a1: g.h1[0] ? g.h1[1] / g.h1[0] : null, a2: g.h2[0] ? g.h2[1] / g.h2[0] : null }));
  rows.sort((a, b) => b.avg - a.avg);
  console.log('\nEn iyi kovalar (n>=80), ort net %/işlem, 1.yarı / 2.yarı:');
  rows.slice(0, 14).forEach(r => console.log(r.k.padEnd(38), String(r.n).padStart(5), R.f(r.avg, 3).padStart(8), '|', R.f(r.a1, 3).padStart(8), R.f(r.a2, 3).padStart(8)));
  console.log('\nEn kötü kovalar:');
  rows.slice(-8).forEach(r => console.log(r.k.padEnd(38), String(r.n).padStart(5), R.f(r.avg, 3).padStart(8), '|', R.f(r.a1, 3).padStart(8), R.f(r.a2, 3).padStart(8)));
  const e = (fn) => { const a = all.filter(fn); return a.length ? R.f(a.reduce((x, t) => x + t.ret, 0) / a.length, 3) + ' (n=' + a.length + ')' : '–'; };
  console.log('\nÇıkış nedenine göre ort net %:'); ['Stop-loss', 'Kâr koruma stopu', 'Hedef', 'Sinyal SAT', 'Süre doldu'].forEach(r => console.log('  ' + r.padEnd(18), e(t => t.reason === r)));
})().catch(e => { console.error(e); process.exit(1); });
