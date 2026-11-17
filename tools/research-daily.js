'use strict';
/* =====================================================================
 * research-daily.js — GÜNLÜK zaman diliminde, çok yıllık gerçek veride klasik trend/momentum kurallarının sınanması.
 *
 *  - Kurallar ve parametreler ÖNCEDEN sabit (literatürdeki klasik değerler); veriye bakarak seçilmedi.
 *    Duyarlılık tablosu SEÇİM için değil, "bıçak sırası mı?" kontrolü içindir; tüm sonuçlar raporlanır.
 *  - Karar günün KAPANIŞINDA (yalnızca o ana kadarki veriyle), işlem ertesi günün AÇILIŞINDA.
 *  - Maliyet: her pozisyon değişiminde yön başına %0,15 (komisyon %0,1 + kayma %0,05) — bot ile aynı.
 *  - Her sembol bağımsız "kol"; kollar eşit ağırlıkla (günlük yeniden dengelenen) birleştirilir.
 *    Karşılaştırma: aynı sembollerin maliyetsiz eşit ağırlıklı al-tut'u ve BTC al-tut.
 * ===================================================================== */
const R = require('./botreplay.js'), Sim = require('../js/aisim.js');
const C = 0.0015, WARM = 250;

const sma = (a, p) => a.map((_, i) => i < p - 1 ? null : a.slice(i - p + 1, i + 1).reduce((x, y) => x + y, 0) / p);
function ema(a, p) { const k = 2 / (p + 1), o = []; let e = null; for (let i = 0; i < a.length; i++) { e = e == null ? a[i] : a[i] * k + e * (1 - k); o.push(i < p - 1 ? null : e); } return o; }
const hi = (cs, i, n) => { let m = -Infinity; for (let j = i - n; j < i; j++) m = Math.max(m, cs[j].high); return m; };
const lo = (cs, i, n) => { let m = Infinity; for (let j = i - n; j < i; j++) m = Math.min(m, cs[j].low); return m; };

/* Her kural: pos[i] = i. günün kapanışında verilen karar (0/1), i+1. gün için geçerli */
const RULES = {
  'SMA200: kapanış > SMA(200)': (cs, p) => { const c = cs.map(x => x.close), m = sma(c, p || 200); return c.map((v, i) => m[i] != null && v > m[i] ? 1 : 0); },
  'EMA50 > EMA200 (altın kesişim)': (cs) => { const c = cs.map(x => x.close), a = ema(c, 50), b = ema(c, 200); return c.map((v, i) => a[i] != null && b[i] != null && a[i] > b[i] ? 1 : 0); },
  'Donchian: 55g kırılım, 20g dip çıkış': (cs, en, ex) => { en = en || 55; ex = ex || 20; let st = 0; return cs.map((x, i) => { if (i < en + 1) return 0; if (!st && x.close > hi(cs, i, en)) st = 1; else if (st && x.close < lo(cs, i, ex)) st = 0; return st; }); },
  'Zaman serisi momentumu: 90g getiri > 0': (cs, n) => { n = n || 90; return cs.map((x, i) => i >= n && x.close / cs[i - n].close - 1 > 0 ? 1 : 0); }
};

function sleeveReturns(cs, pos) {
  const out = new Array(cs.length).fill(null);
  for (let d = WARM + 1; d < cs.length; d++) {
    const p0 = pos[d - 2] || 0, p1 = pos[d - 1] || 0;
    out[d] = p0 * (cs[d].open / cs[d - 1].close - 1) + p1 * (cs[d].close / cs[d].open - 1) - Math.abs(p1 - p0) * C;
  }
  return out;
}
function tradesOf(pos) { let n = 0; for (let i = 1; i < pos.length; i++) if (pos[i] !== pos[i - 1]) n++; return n / 2; }

function aggregate(sleeves, days, minActive) {
  const rets = new Array(days).fill(null);
  for (let d = 0; d < days; d++) { let s = 0, n = 0; for (const sl of sleeves) { const v = sl[d]; if (v != null) { s += v; n++; } } if (n >= (minActive || 3)) rets[d] = s / n; }
  return rets;
}
function stats(rets, dayZero) {
  const r = rets.map((v, i) => [v, i]).filter(x => x[0] != null), v = r.map(x => x[0]);
  let eq = 1, peak = 1, mdd = 0; v.forEach(x => { eq *= 1 + x; peak = Math.max(peak, eq); mdd = Math.max(mdd, 1 - eq / peak); });
  const yrs = v.length / 365, ann = (Math.pow(eq, 1 / yrs) - 1) * 100, sh = Sim.sharpeOf(v, 365), ci = Sim.bootstrapSharpe(v, 365, 400, 7);
  const byYear = {}; r.forEach(([x, i]) => { const y = new Date((dayZero + i) * 86400e3).getUTCFullYear(); byYear[y] = (byYear[y] || 1) * (1 + x); });
  Object.keys(byYear).forEach(y => byYear[y] = (byYear[y] - 1) * 100);
  return { total: (eq - 1) * 100, ann, sh, ci, mdd: mdd * 100, byYear, n: v.length, yrs };
}
const f = R.f;

(async () => {
  const NS = +process.argv[2] || 30, NB = +process.argv[3] || 2500, syms = R.SYMBOLS.slice(0, NS), data = {};
  for (const s of syms) { try { const cs = await R.loadCandles(s, '1d', NB); if (cs.length >= WARM + 400) data[s] = cs; } catch (e) { console.error('yok ' + s); } }
  const names = Object.keys(data), MINACT = Math.min(3, names.length), day = t => Math.floor(t / 86400);
  const d0 = Math.min(...names.map(s => day(data[s][0].time))), d1 = Math.max(...names.map(s => day(data[s].at(-1).time))), days = d1 - d0 + 1;
  const place = (cs, arr) => { const o = new Array(days).fill(null); cs.forEach((c, i) => { o[day(c.time) - d0] = arr[i]; }); return o; };
  console.log(`${names.length} sembol (≥${WARM + 400} günlük veri), ${new Date(d0 * 86400e3).toISOString().slice(0, 10)} → ${new Date(d1 * 86400e3).toISOString().slice(0, 10)} (${f(days / 365, 1)} yıl), maliyet yön başına %${C * 100}`);

  // Karşılaştırmalar
  const bhSleeves = names.map(s => { const cs = data[s], a = cs.map((c, i) => i > WARM ? c.close / cs[i - 1].close - 1 : null); return place(cs, a); });
  const BH = stats(aggregate(bhSleeves, days, MINACT), d0), btcCs = data['BTCUSDT'];
  const BTC = stats(place(btcCs, btcCs.map((c, i) => i > WARM ? c.close / btcCs[i - 1].close - 1 : null)), d0);
  const rows = [['Eşit ağırlık al-tut (maliyetsiz)', BH], ['BTC al-tut (maliyetsiz)', BTC]];

  const run = (label, fn, ...args) => {
    const sl = [], tr = []; names.forEach(s => { const cs = data[s], pos = fn(cs, ...args); sl.push(place(cs, sleeveReturns(cs, pos))); tr.push(tradesOf(pos) / (cs.length / 365)); });
    const st = stats(aggregate(sl, days, MINACT), d0); st.tradesPerYear = tr.reduce((a, b) => a + b, 0) / tr.length; return [label, st];
  };
  for (const [name, fn] of Object.entries(RULES)) rows.push(run(name, fn));

  // Kesitsel momentum: haftalık yeniden dengeleme, 60g getiriye göre ilk 5, eşit ağırlık, yalnızca long
  function crossMomentum(lookback, K, absFilter) {
    const rets = new Array(days).fill(null); let w = {}; // {sym: ağırlık} i. kapanışta belirlenir
    const idx = {}; names.forEach(s => { idx[s] = {}; data[s].forEach((c, i) => idx[s][day(c.time) - d0] = i); });
    let wPrev = {};
    for (let d = 1; d < days; d++) {
      // bu gün (d) için: d-1 kapanışında belirlenmiş ağırlıklar
      let r = 0, to = 0; const wNew = ((d - 1) % 7 === 0) ? (() => {
        const c = []; names.forEach(s => { const i = idx[s][d - 1]; if (i != null && i >= WARM && i >= lookback) { const m = data[s][i].close / data[s][i - lookback].close - 1; if (!absFilter || m > 0) c.push([s, m]); } });
        c.sort((a, b) => b[1] - a[1]); const top = c.slice(0, K), o = {}; top.forEach(([s]) => o[s] = 1 / K); return o; })() : wPrev;
      let active = false;
      names.forEach(s => { const i = idx[s][d]; if (i == null || i < WARM + 1 || idx[s][d - 1] == null) return; active = true; const cs = data[s], a = wPrev[s] || 0, b = wNew[s] || 0;
        r += a * (cs[i].open / cs[i - 1].close - 1) + b * (cs[i].close / cs[i].open - 1); to += Math.abs(b - a); });
      if (active && d > 365) rets[d] = r - to * C; wPrev = wNew;
    }
    return rets;
  }
  if (names.length >= 15) rows.push(['Kesitsel momentum: 60g, ilk 5, haftalık', Object.assign(stats(crossMomentum(60, 5, false), d0), {})]);
  if (names.length >= 15) rows.push(['Kesitsel momentum + mutlak filtre (>0)', stats(crossMomentum(60, 5, true), d0)]);

  console.log('\n' + 'Strateji'.padEnd(42) + 'yıllık%'.padStart(9) + 'toplam%'.padStart(10) + 'maxDD%'.padStart(8) + 'Sharpe'.padStart(8) + '  Sharpe %95 GA      işlem/yıl/sembol');
  rows.forEach(([n, s]) => console.log(n.padEnd(42) + f(s.ann, 1).padStart(9) + f(s.total, 0).padStart(10) + f(s.mdd, 0).padStart(8) + f(s.sh, 2).padStart(8) + '  ' + (s.ci ? `[${f(s.ci.lo, 2)}, ${f(s.ci.hi, 2)}]`.padEnd(16) : ''.padEnd(16)) + (s.tradesPerYear != null ? f(s.tradesPerYear, 1).padStart(8) : '')));

  const years = [...new Set(rows.flatMap(([, s]) => Object.keys(s.byYear)))].sort();
  console.log('\nYıllara göre getiri %:'.padEnd(43) + years.map(y => y.padStart(8)).join(''));
  rows.forEach(([n, s]) => console.log(n.padEnd(42) + ' ' + years.map(y => (s.byYear[y] != null ? f(s.byYear[y], 0) : '–').padStart(8)).join('')));

  // Duyarlılık: "bıçak sırası" kontrolü (seçim için DEĞİL)
  console.log('\nDuyarlılık (komşu parametreler; yıllık % / Sharpe / maxDD%):');
  const sens = (label, fn, params) => console.log('  ' + label.padEnd(28) + params.map(p => { const [, s] = run('', fn, ...p); return `${p.join('/')}: ${f(s.ann, 0)}%/${f(s.sh, 2)}/${f(s.mdd, 0)}`.padEnd(26); }).join(''));
  sens('SMA periyodu', RULES['SMA200: kapanış > SMA(200)'], [[100], [150], [200], [250]]);
  sens('Momentum bakış (gün)', RULES['Zaman serisi momentumu: 90g getiri > 0'], [[60], [90], [120], [180]]);
  sens('Donchian giriş/çıkış', RULES['Donchian: 55g kırılım, 20g dip çıkış'], [[40, 20], [55, 20], [100, 50]]);
  console.log('\nNot: eşit ağırlıklı al-tut maliyetsizdir (kıyaslamayı strateji lehine zorlaştırır); kollar bağımsız ve eşit ağırlıklıdır. Geçmiş performans geleceği garanti etmez.');
})().catch(e => { console.error(e); process.exit(1); });
