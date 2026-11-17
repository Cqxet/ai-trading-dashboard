'use strict';
/* Araştırma: maliyet sonrası (Bot ile AYNI komisyon+kayma) pozitif beklentisi olan bir giriş/çıkış yapısı var mı?
 * Parametreler ÖNCEDEN sabit (aşırı uydurma yok); her aday iki yarıda ve iki zaman diliminde ayrı raporlanır.
 * Her işlem: sinyal i. mum kapanışında, giriş i+1 açılışı (+kayma), çıkış kuralları high/low ile (aynı mumda önce stop). */
const R = require('./botreplay.js'), Signals = require('../js/signals.js');
const FEE = 0.001, SLIP = 0.0005;
const net = (entry, exit) => (exit * (1 - SLIP) * (1 - FEE)) / (entry * (1 + SLIP) * (1 + FEE)) * 100 - 100;

/** rule(i, ctx) → {enter:true,stopAtr,trail,maxBars,exitFn} ; işlem döngüsü ortak */
function runCandidate(P, name, cfg) {
  const trades = [];
  for (const s of P.syms) {
    const { cs, ind } = P.by[s], n = cs.length;
    const hh = cs.map((c, i) => i >= 20 ? Math.max(...cs.slice(i - 20, i).map(x => x.high)) : null);
    let i = 210;
    while (i < n - 2) {
      if (!cfg.enter(cs, ind, i, hh, P)) { i++; continue; }
      const entry = cs[i + 1].open, atr = ind.atr[i]; let stop = entry - cfg.stopAtr * atr, peak = entry, exit = null, j = i + 1;
      for (; j < n; j++) {
        const c = cs[j];
        if (c.low <= stop) { exit = Math.min(c.open, stop); break; }
        if (cfg.tp && c.high >= entry + cfg.tp * atr) { exit = Math.max(c.open, entry + cfg.tp * atr); break; }
        if (cfg.trail) { peak = Math.max(peak, c.high); stop = Math.max(stop, peak - cfg.trail * atr); }
        if (j - i >= cfg.maxBars) { exit = c.close; break; }
        if (j < n - 1 && cfg.exit && cfg.exit(cs, ind, j)) { exit = cs[j + 1].open; j++; break; }
      }
      if (exit == null) break;
      trades.push({ s, t: cs[i].time, r: net(entry, exit), bars: j - i });
      i = j + 1;
    }
  }
  return trades;
}
function summarize(name, tr, mid) {
  if (!tr.length) return `${name.padEnd(34)} işlem yok`;
  const m = a => a.length ? a.reduce((x, t) => x + t.r, 0) / a.length : NaN, sd = Math.sqrt(tr.reduce((x, t) => x + (t.r - m(tr)) ** 2, 0) / Math.max(1, tr.length - 1));
  const h1 = tr.filter(t => t.t < mid), h2 = tr.filter(t => t.t >= mid), win = tr.filter(t => t.r > 0).length / tr.length * 100;
  const tstat = m(tr) / (sd / Math.sqrt(tr.length));
  return `${name.padEnd(34)} n=${String(tr.length).padStart(5)} ort %${R.f(m(tr), 3).padStart(7)} kaz %${R.f(win, 0).padStart(3)} t=${R.f(tstat, 1).padStart(5)} | 1.yarı %${R.f(m(h1), 3).padStart(7)} (n=${h1.length}) 2.yarı %${R.f(m(h2), 3).padStart(7)} (n=${h2.length}) ort tutma ${R.f(tr.reduce((x, t) => x + t.bars, 0) / tr.length, 0)} mum`;
}
const C = {
  'rastgele-giriş (24 mum tut)': { enter: (cs, ind, i) => i % 7 === 0, stopAtr: 99, maxBars: 24 },
  'ortalamaya dönüş (RSI<28,%B<0)': { enter: (cs, ind, i) => ind.rsi[i] < 28 && ind.bb[i] && ind.bb[i].pctB < 0, stopAtr: 2.5, maxBars: 48, exit: (cs, ind, j) => ind.rsi[j] > 50 },
  'Donchian20 kırılım + ADX>25 trend': { enter: (cs, ind, i, hh) => hh[i] && cs[i].close > hh[i] && ind.adx.adx[i] > 25 && ind.ema50[i] > ind.ema200[i], stopAtr: 3, trail: 3, maxBars: 120 },
  'trend içi geri çekilme (EMA dizilimi,RSI<45)': { enter: (cs, ind, i) => ind.ema20[i] > ind.ema50[i] && ind.ema50[i] > ind.ema200[i] && ind.rsi[i] < 45 && cs[i].close > ind.ema50[i], stopAtr: 2.5, maxBars: 96, exit: (cs, ind, j) => ind.rsi[j] > 68 || cs[j].close < ind.ema50[j] },
  'EMA200 üstü + Supertrend dönüşü': { enter: (cs, ind, i) => cs[i].close > ind.ema200[i] && ind.st.dir[i] === 1 && ind.st.dir[i - 1] === -1, stopAtr: 2, trail: 3, maxBars: 120 }
};
(async () => {
  // 1 saatlik ~250 gün: ADAYLAR son 100 günde seçildi; önceki ~150 gün GERÇEK örneklem dışı sınavdır.
  const data = {}, syms = R.SYMBOLS.slice(0, 20);
  for (const sy of syms) { try { data[sy] = await R.loadCandles(sy, '1h', 6000); } catch (e) { console.error('yok ' + sy); } }
  const P = R.prepare(data, '1h'), n = P.times.length, cut = P.times[n - 2400], mid2 = P.times[Math.floor((n - 2400) / 2)];
  console.log('1h ' + R.f((P.times[n - 1] - P.times[0]) / 86400, 0) + ' gün, ' + P.syms.length + ' sembol; OOS = ilk ' + R.f((cut - P.times[0]) / 86400, 0) + ' gün');
  const drift = (a, b) => R.f(P.syms.reduce((x, s) => x + (P.by[s].cs[b].close / P.by[s].cs[a].open - 1) * 100, 0) / P.syms.length);
  console.log('piyasa al-tut ort: OOS dönemi %' + drift(210, n - 2400) + ' | son 100 gün %' + drift(n - 2400, n - 1));
  for (const [name, cfg] of Object.entries(C)) {
    const tr = runCandidate(P, name, cfg), oos = tr.filter(t => t.t < cut), recent = tr.filter(t => t.t >= cut);
    console.log('\n' + name);
    console.log('   ' + summarize('OOS (eski dönem)', oos, mid2));
    console.log('   ' + summarize('son 100 gün', recent, P.times[n - 1200]));
  }
})().catch(e => { console.error(e); process.exit(1); });
