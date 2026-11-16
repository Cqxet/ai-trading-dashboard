/* =====================================================================
 * backtest.js — Sinyal stratejisi backtest motoru (saf fonksiyon).
 *
 * ZAMANLAMA (lookahead yok):
 *   - Sinyal i. mumun KAPANIŞINDA, sadece 0..i verisiyle hesaplanır.
 *   - Emir (giriş/çıkış) i+1. mumun AÇILIŞINDA gerçekleşir (+kayma).
 *   - Stop/hedef, girişten SONRAKİ mumlarda high/low ile kontrol edilir;
 *     aynı mumda ikisi de değerse muhafazakâr varsayım: önce STOP.
 *     Giriş mumunun kendisinde de (açılıştan sonra) kontrol edilir.
 *   - Mum açılışı stop'un ötesinde gap'lerse çıkış açılış fiyatındandır.
 * Tarayıcıda window.Backtest, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var S = (typeof module === 'object' && module.exports) ? require('./signals.js') : root.Signals;
  var m = factory(S);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Backtest = m;
})(typeof self !== 'undefined' ? self : this, function (Signals) {
  'use strict';

  var TF_SEC = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '2h': 7200, '4h': 14400, '6h': 21600, '12h': 43200, '1d': 86400, '1w': 604800 };

  var DEFAULT_PARAMS = {
    initial: 10000, buyTh: 30, sellTh: -30, atrStop: 1.5, atrTarget: 3,
    feePct: 0.1, slippagePct: 0.02, allowShort: false, exitOnOpposite: true,
    warmup: 200, riskPct: 100   // her işlemde sermayenin % kaçı kullanılır
  };

  /**
   * @param candles  [{time,open,high,low,close,volume}] (artan zaman)
   * @param params   DEFAULT_PARAMS üzerine yazılır
   * @param signalFn opsiyonel (candles, ind, i, params) → {label, atr} — testler için
   */
  function run(candles, params, signalFn) {
    var P = Object.assign({}, DEFAULT_PARAMS, params || {});
    var n = candles.length;
    if (n < P.warmup + 10) throw new Error('Backtest için en az ' + (P.warmup + 10) + ' mum gerekli (mevcut: ' + n + ')');
    var ind = Signals.computeIndicators(candles);
    var sigFn = signalFn || function (cs, ind_, i) {
      var g = Signals.scoreAt(cs, ind_, i, { buyTh: P.buyTh, sellTh: P.sellTh, atrStop: P.atrStop, atrTarget: P.atrTarget });
      return g ? { label: g.label, atr: g.snap.atr, score: g.score } : null;
    };
    var fee = P.feePct / 100, slip = P.slippagePct / 100;
    var cash = P.initial, pos = null, pending = null;
    var trades = [], equity = [], signals = [];

    function openPos(side, i, atrv, sigIdx) {
      var o = candles[i].open, px = side === 'long' ? o * (1 + slip) : o * (1 - slip);
      var alloc = cash * Math.min(1, P.riskPct / 100);
      var qty = alloc / (px * (1 + fee));
      var cost = qty * px, f = cost * fee;
      cash -= cost + f;
      pos = { side: side, qty: qty, entry: px, entryIdx: i, sigIdx: sigIdx, entryTime: candles[i].time, fees: f,
        stop: side === 'long' ? px - P.atrStop * atrv : px + P.atrStop * atrv,
        target: side === 'long' ? px + P.atrTarget * atrv : px - P.atrTarget * atrv, margin: cost };
    }
    function closePos(i, rawPx, reason) {
      var px = pos.side === 'long' ? rawPx * (1 - slip) : rawPx * (1 + slip);
      var gross = pos.side === 'long' ? (px - pos.entry) * pos.qty : (pos.entry - px) * pos.qty;
      var f = px * pos.qty * fee;
      cash += pos.margin + gross - f;
      var pnl = gross - f - pos.fees;
      trades.push({ side: pos.side, entryTime: pos.entryTime, exitTime: candles[i].time, entryIdx: pos.entryIdx, exitIdx: i, sigIdx: pos.sigIdx,
        entry: pos.entry, exit: px, qty: pos.qty, pnl: pnl, ret: pnl / (pos.margin + pos.fees) * 100, reason: reason, bars: i - pos.entryIdx + 1 });
      pos = null;
    }
    function markEquity(i) {
      var c = candles[i].close, v = cash;
      if (pos) v += pos.margin + (pos.side === 'long' ? (c - pos.entry) : (pos.entry - c)) * pos.qty;
      equity.push({ time: candles[i].time, value: v });
    }

    for (var i = P.warmup; i < n; i++) {
      var bar = candles[i];
      // 1) Önceki kapanışta verilen bekleyen emir bu mumun AÇILIŞINDA işlenir
      if (pending) {
        if (pending.type === 'exit' && pos) closePos(i, bar.open, pending.reason);
        if (pending.type === 'enter' && !pos) openPos(pending.side, i, pending.atr, pending.sigIdx);
        if (pending.type === 'flip') { if (pos) closePos(i, bar.open, 'Ters sinyal'); openPos(pending.side, i, pending.atr, pending.sigIdx); }
        pending = null;
      }
      // 2) Mum içi stop / hedef kontrolü
      if (pos) {
        var L = pos.side === 'long';
        var hitStop = L ? bar.low <= pos.stop : bar.high >= pos.stop;
        var hitTgt = L ? bar.high >= pos.target : bar.low <= pos.target;
        if (hitStop) {
          var sp = L ? Math.min(bar.open, pos.stop) : Math.max(bar.open, pos.stop);
          if (pos.entryIdx === i) sp = pos.stop; // giriş açılıştaydı; stop açılıştan sonra
          closePos(i, sp, 'Stop');
        } else if (hitTgt) {
          var tp = L ? Math.max(bar.open, pos.target) : Math.min(bar.open, pos.target);
          if (pos.entryIdx === i) tp = pos.target;
          closePos(i, tp, 'Hedef');
        }
      }
      // 3) Kapanışta sinyal (sadece 0..i)
      if (i < n - 1) {
        var s = sigFn(candles, ind, i, P);
        if (s) {
          signals.push({ i: i, time: bar.time, label: s.label, score: s.score });
          if (!pos) {
            if (s.label === 'AL') pending = { type: 'enter', side: 'long', atr: s.atr, sigIdx: i };
            else if (s.label === 'SAT' && P.allowShort) pending = { type: 'enter', side: 'short', atr: s.atr, sigIdx: i };
          } else if (P.exitOnOpposite) {
            if (pos.side === 'long' && s.label === 'SAT') pending = P.allowShort ? { type: 'flip', side: 'short', atr: s.atr, sigIdx: i } : { type: 'exit', reason: 'Ters sinyal' };
            else if (pos.side === 'short' && s.label === 'AL') pending = { type: 'flip', side: 'long', atr: s.atr, sigIdx: i };
          }
        }
      }
      markEquity(i);
    }
    // Açık pozisyon son kapanıştan kapatılır (raporlama için)
    if (pos) closePos(n - 1, candles[n - 1].close, 'Dönem sonu');
    if (equity.length) equity[equity.length - 1].value = cash;

    return { params: P, trades: trades, equity: equity, signals: signals, metrics: metrics(candles, equity, trades, P) };
  }

  function metrics(candles, equity, trades, P) {
    var start = P.initial, end = equity.length ? equity[equity.length - 1].value : start;
    var peak = -Infinity, mdd = 0;
    equity.forEach(function (e) { if (e.value > peak) peak = e.value; var dd = (peak - e.value) / peak; if (dd > mdd) mdd = dd; });
    var rets = [];
    for (var i = 1; i < equity.length; i++) rets.push(equity[i].value / equity[i - 1].value - 1);
    var mean = rets.reduce(function (a, b) { return a + b; }, 0) / (rets.length || 1);
    var sd = Math.sqrt(rets.reduce(function (a, b) { return a + (b - mean) * (b - mean); }, 0) / Math.max(1, rets.length - 1));
    var barSec = candles.length > 1 ? candles[1].time - candles[0].time : 3600;
    var perYear = 365 * 86400 / barSec;
    var sharpe = sd > 0 ? mean / sd * Math.sqrt(perYear) : 0;
    var wins = trades.filter(function (t) { return t.pnl > 0; });
    var grossW = wins.reduce(function (a, t) { return a + t.pnl; }, 0);
    var grossL = trades.filter(function (t) { return t.pnl <= 0; }).reduce(function (a, t) { return a - t.pnl; }, 0);
    var first = candles[P.warmup], last = candles[candles.length - 1];
    var bh = (last.close / first.open - 1) * 100;
    // Buy & hold equity (aynı başlangıç sermayesi, aynı komisyon ile)
    var bhQty = start / (first.open * (1 + P.feePct / 100));
    var bhEq = equity.map(function (e, k) { return { time: e.time, value: bhQty * candles[P.warmup + k].close }; });
    return {
      start: start, end: end, totalReturn: (end / start - 1) * 100, buyHold: bh, maxDD: mdd * 100, sharpe: sharpe,
      trades: trades.length, winRate: trades.length ? wins.length / trades.length * 100 : 0,
      profitFactor: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
      avgTrade: trades.length ? trades.reduce(function (a, t) { return a + t.ret; }, 0) / trades.length : 0,
      exposure: trades.reduce(function (a, t) { return a + t.bars; }, 0) / Math.max(1, equity.length) * 100,
      bhEquity: bhEq, fromTime: first.time, toTime: last.time, bars: equity.length
    };
  }

  /** Binance klines'ı geriye doğru sayfalayarak `total` mum getirir. fetchFn(url) → JSON */
  async function fetchHistory(fetchFn, symbol, interval, total) {
    var out = [], end = null, guard = 0;
    while (out.length < total && guard++ < 20) {
      var lim = Math.min(1000, total - out.length);
      var q = '/api/v3/klines?symbol=' + symbol + '&interval=' + interval + '&limit=' + lim + (end ? '&endTime=' + end : '');
      var k = await fetchFn(q);
      if (!k.length) break;
      var cs = k.map(function (r) { return { time: Math.floor(r[0] / 1000), open: +r[1], high: +r[2], low: +r[3], close: +r[4], volume: +r[5] }; });
      out = cs.concat(out);
      end = k[0][0] - 1;
      if (k.length < lim) break;
    }
    // tekrarları temizle, sırala
    var seen = {}, res = [];
    out.sort(function (a, b) { return a.time - b.time; }).forEach(function (c) { if (!seen[c.time]) { seen[c.time] = 1; res.push(c); } });
    return res;
  }

  return { run: run, metrics: metrics, fetchHistory: fetchHistory, DEFAULT_PARAMS: DEFAULT_PARAMS, TF_SEC: TF_SEC };
});
