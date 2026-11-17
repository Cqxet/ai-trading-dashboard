'use strict';
/* =====================================================================
 * botreplay.js — AI botu GERÇEK GEÇMİŞ mumlar üzerinde, canlıya eşdeğer mantıkla tekrar oynatır.
 *
 *  - Aynı Bot.step (bot.js) ve aynı sinyal motoru (signals.js); maliyet oranları DEĞİŞTİRİLMEZ (Bot.DEFAULTS).
 *  - Her mumda: (1) düşük fiyat → (2) yüksek fiyat → (3) kapanış fiyatıyla adım atılır.
 *    İlk iki adımda yalnızca fiyata bağlı çıkışlar (stop/hedef) çalışır; sinyaller yalnızca kapanışta verilir
 *    (canlıda da sinyal son KAPANMIŞ mumdan hesaplanır). Aynı mumda hem stop hem hedef değerse önce stop varsayılır (muhafazakâr).
 *  - Hiçbir gösterge geleceği kullanmaz (scoreAt yalnızca 0..i verisini kullanır).
 *
 *  CLI:  node tools/botreplay.js --mode super --symbols 20 [--bars 6000] [--start 0.5]
 * ===================================================================== */
const fs = require('fs'), path = require('path');
const Signals = require('../js/signals.js'), Bot = require('../js/bot.js'), Backtest = require('../js/backtest.js');

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'LINKUSDT',
  'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT', 'ETCUSDT', 'APTUSDT', 'ARBUSDT',
  'OPUSDT', 'FILUSDT', 'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT', 'HBARUSDT', 'ICPUSDT', 'RENDERUSDT'];
const MODE_TF = { normal: '1h', fast: '15m', veryfast: '5m', extreme: '3m', super: '1m' };
const MODE_BARS = { normal: 2400, fast: 6000, veryfast: 8000, extreme: 6000, super: 7000 };
const TF_SEC = Backtest.TF_SEC;
const CACHE = process.env.REPLAY_CACHE || path.join(__dirname, '.cache');
const REST = ['https://data-api.binance.vision', 'https://api.binance.com'];

async function getJSON(p) { let e; for (const b of REST) { try { const r = await fetch(b + p); if (r.ok) return await r.json(); e = new Error('HTTP ' + r.status); } catch (x) { e = x; } } throw e; }
async function loadCandles(sym, tf, n) {
  fs.mkdirSync(CACHE, { recursive: true });
  const f = path.join(CACHE, `${sym}_${tf}_${n}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let cs = await Backtest.fetchHistory(getJSON, sym, tf, n + 1); cs = cs.slice(0, -1);
  fs.writeFileSync(f, JSON.stringify(cs)); return cs;
}
async function loadData(mode, nSym, bars) {
  const tf = MODE_TF[mode], n = bars || MODE_BARS[mode], out = {};
  const syms = SYMBOLS.slice(0, nSym || 20); let k = 0;
  async function worker() { while (k < syms.length) { const s = syms[k++]; try { out[s] = await loadCandles(s, tf, n); } catch (e) { console.error('veri alınamadı ' + s + ': ' + e.message); } } }
  await Promise.all([worker(), worker(), worker()]);
  return { tf, data: out };
}

/** Sembolleri ortak zaman eksenine hizalar ve göstergeleri bir kez hesaplar. */
function prepare(data, tf) {
  const syms = Object.keys(data).filter(s => data[s] && data[s].length > 300);
  let common = null;
  syms.forEach(s => { const set = new Set(data[s].map(c => c.time)); common = common ? new Set([...common].filter(t => set.has(t))) : set; });
  const times = [...common].sort((a, b) => a - b), P = { times, syms, by: {}, tf };
  syms.forEach(s => { const m = new Map(data[s].map(c => [c.time, c])); const cs = times.map(t => m.get(t)); P.by[s] = { cs, ind: Signals.computeIndicators(cs) }; });
  return P;
}

/**
 * @param P       prepare() çıktısı
 * @param mode    'normal' | 'fast' | 'veryfast' | 'extreme' | 'super'
 * @param o       {from: 0..1, to: 0..1 (dönem dilimi), topN, botOpts (Bot ayarlarını ezer), hooks:{onEntryCtx}, stepFn}
 */
function replay(P, mode, o) {
  o = o || {};
  const st = Bot.create(o.botOpts); Bot.applyMode(st, mode); if (o.botOpts) Object.assign(st.s, o.botOpts); st.s.histCap = 1e6;
  const S = st.s, n = P.times.length, warm = 210, i0 = Math.max(warm, Math.floor(n * (o.from || 0))), i1 = Math.min(n - 1, Math.floor(n * (o.to == null ? 1 : o.to)));
  const syms = P.syms.slice(0, o.topN || S.topN || 20), fx = 50, tfSec = TF_SEC[P.tf];
  const buyTh = S.buyTh != null ? S.buyTh : 30;
  const sigOpts = mode === 'normal' ? {} : { buyTh: buyTh, sellTh: -buyTh, atrStop: S.atrStop, atrTarget: S.atrTarget };
  st.enabled = true; const start = P.times[i0];
  let bh = 0, bhN = 0;
  for (const s of syms) { const cs = P.by[s].cs; bh += cs[i1].close / cs[i0].open - 1; bhN++; }
  const eq = [];
  for (let i = i0; i <= i1; i++) {
    const now = (P.times[i] + tfSec) * 1000;
    const lows = {}, highs = {}, closes = {}, sigs = {};
    for (const s of syms) {
      const c = P.by[s].cs[i]; lows[s] = c.low; highs[s] = c.high; closes[s] = c.close;
      const mk = JSON.stringify(sigOpts), memo = (P.memo = P.memo || {})[mk] = P.memo[mk] || {}, ms = memo[s] = memo[s] || {};
      let g = ms[i]; if (g === undefined) g = ms[i] = Signals.scoreAt(P.by[s].cs, P.by[s].ind, i, sigOpts);
      if (g) sigs[s] = { g: g, t: now };
    }
    // Pozisyonu olmayan semboller için düşük/yüksek adımında fiyat verilmez (yalnızca açık pozisyonlar izlenir)
    const held = new Set(st.positions.map(p => p.sym));
    const sub = (m) => { const r = {}; held.forEach(s => { if (m[s] != null) r[s] = m[s]; }); return r; };
    if (held.size) { Bot.step(st, { prices: sub(lows), fx: fx, sigs: {} }, now - 2); Bot.step(st, { prices: sub(highs), fx: fx, sigs: {} }, now - 1); }
    if (o.stepFn) o.stepFn(st, { prices: closes, fx: fx, sigs: sigs }, now); else Bot.step(st, { prices: closes, fx: fx, sigs: sigs }, now);
    eq.push(Bot.equity(st, closes, fx));
  }
  const h = st.history, wins = h.filter(x => x.pnl > 0), gw = wins.reduce((a, x) => a + x.pnl, 0), gl = h.filter(x => x.pnl <= 0).reduce((a, x) => a - x.pnl, 0);
  let peak = -Infinity, mdd = 0; eq.forEach(v => { if (v > peak) peak = v; mdd = Math.max(mdd, (peak - v) / peak); });
  const byReason = {}; h.forEach(x => { const r = byReason[x.reason] = byReason[x.reason] || { n: 0, pnl: 0 }; r.n++; r.pnl += x.pnl; });
  const end = eq.length ? eq[eq.length - 1] : st.initial;
  return { mode, tf: P.tf, days: (P.times[i1] - start) / 86400, bars: i1 - i0 + 1, symbols: syms.length, end: end, ret: (end / st.initial - 1) * 100, bh: bh / bhN * 100,
    trades: h.length, winRate: h.length ? wins.length / h.length * 100 : 0, pf: gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0), avgNetPct: h.length ? h.reduce((a, x) => a + x.pnl / x.costTRY * 100, 0) / h.length : 0,
    fees: st.totals.fee, mdd: mdd * 100, byReason, st: st, eq: eq,
    ret1: eq.length ? (eq[Math.floor(eq.length / 2)] / st.initial - 1) * 100 : 0, ret2: eq.length ? (eq[eq.length - 1] / eq[Math.floor(eq.length / 2)] - 1) * 100 : 0 };
}

const f = (x, d = 2) => x == null || !isFinite(x) ? '–' : (+x).toFixed(d);
function line(r, label) {
  return `${(label || r.mode).padEnd(26)} ${f(r.days, 1).padStart(5)}g ${String(r.trades).padStart(5)} işl  getiri %${f(r.ret).padStart(7)}  (al-tut %${f(r.bh).padStart(6)})  kazanma %${f(r.winRate, 0).padStart(3)}  PF ${f(r.pf).padStart(5)}  ort/işl %${f(r.avgNetPct, 3).padStart(7)}  maxDD %${f(r.mdd).padStart(5)}  komisyon ${f(r.fees)}`;
}

module.exports = { SYMBOLS, MODE_TF, MODE_BARS, loadData, loadCandles, prepare, replay, line, f };

if (require.main === module) {
  const A = {}; const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i++) if (a[i].startsWith('--')) { const nx = a[i + 1]; if (nx === undefined || nx.startsWith('--')) A[a[i].slice(2)] = true; else { A[a[i].slice(2)] = nx; i++; } }
  (async () => {
    const modes = A.mode ? [A.mode] : ['normal', 'fast', 'veryfast', 'extreme', 'super'];
    for (const m of modes) {
      const { tf, data } = await loadData(m, +A.symbols || 20, A.bars ? +A.bars : undefined), P = prepare(data, tf);
      const r = replay(P, m, { from: +A.start || 0, to: A.end ? +A.end : 1 });
      console.log(line(r)); Object.keys(r.byReason).forEach(k => console.log('      ' + k.padEnd(20) + String(r.byReason[k].n).padStart(5) + ' işlem  net ' + f(r.byReason[k].pnl) + ' TL'));
    }
  })().catch(e => { console.error(e); process.exit(1); });
}
