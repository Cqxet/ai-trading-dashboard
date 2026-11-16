/* =====================================================================
 * bot.js — AI otomatik sanal alım-satım botu (SAF durum geçişleri, ağ yok).
 * GERÇEK EMİR GÖNDERMEZ. Defter TL cinsindendir (100 TL ile başlar);
 * işlemler Binance USDT fiyatı x USDTTRY kuru ile TL'ye çevrilir.
 * Yalnızca spot LONG (alış -> satış); short/kaldıraç yok.
 * Maliyet modeli (her işlem yönü için): komisyon + kayma + işlem vergisi.
 * Kâr vergisi (opsiyonel) yalnızca pozitif kapanış kârı üzerinden alınır.
 * Varsayılan oranlar tahminidir; kendi borsanıza/vergi mevzuatınıza göre ayarlayın.
 * Tarayıcıda window.Bot, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Bot = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULTS = {
    initialTRY: 100,
    feeRate: 0.001,        // Binance spot komisyonu %0,1 / işlem
    slipRate: 0.0005,      // kayma/spread tahmini %0,05 / işlem
    taxRate: 0,            // işlem vergisi: 2026 itibarıyla yürürlükte kripto işlem vergisi yok (teklif geri çekildi); gerekirse ayarlardan açın
    profitTaxRate: 0,      // kâr vergisi (varsayılan 0)
    minConf: 55,           // sinyal güveni alt sınırı
    minRR: 1.5,            // risk/ödül alt sınırı
    minNetGain: 0.01,      // maliyet sonrası beklenen min. kazanç (oran)
    maxPos: 3,             // eşzamanlı pozisyon
    minOrderTRY: 10,       // min emir tutarı
    cooldownMin: 60,       // aynı sembolde çıkış sonrası bekleme
    maxHoldH: 48,          // azami tutma süresi
    maxTradesPerHour: 6,
    sigMaxAgeMin: 15       // sinyal verisi azami yaşı
  };

  function create(opts) {
    var s = Object.assign({}, DEFAULTS, opts || {});
    return { s: s, enabled: false, initial: s.initialTRY, cash: s.initialTRY, positions: [], history: [], equityLog: [], log: [],
      lastExit: {}, tradeTimes: [], seq: 1, totals: { fee: 0, tax: 0, profitTax: 0 } };
  }
  function costRate(s) { return s.feeRate + s.slipRate + s.taxRate; }

  function note(st, now, text) { st.log.unshift({ t: now, text: text }); if (st.log.length > 200) st.log.pop(); }

  /** Alış: invest TL harcar (maliyetler dahil). */
  function buy(st, sym, px, fx, invest, stop, target, now, why) {
    var s = st.s;
    if (!(px > 0 && fx > 0 && invest > 0) || invest > st.cash + 1e-9) return null;
    var notional = invest / (1 + s.feeRate + s.taxRate);
    var fillPx = px * (1 + s.slipRate);
    var qty = notional / (fillPx * fx);
    var fee = notional * s.feeRate, tax = notional * s.taxRate;
    st.cash -= invest; st.totals.fee += fee; st.totals.tax += tax;
    var p = { id: st.seq++, sym: sym, qty: qty, entry: fillPx, entryFx: fx, costTRY: invest, stop: stop, target: target, peak: fillPx, openedAt: now, why: why || '' };
    st.positions.push(p); st.tradeTimes.push(now);
    return p;
  }

  /** Satış: pozisyonu kapatır; net PnL (TL) döner. */
  function sell(st, id, px, fx, now, reason) {
    var s = st.s, k = st.positions.findIndex(function (p) { return p.id === id; });
    if (k < 0 || !(px > 0 && fx > 0)) return null;
    var p = st.positions[k];
    var gross = p.qty * px * (1 - s.slipRate) * fx;
    var fee = gross * s.feeRate, tax = gross * s.taxRate;
    var proceeds = gross - fee - tax, profit = proceeds - p.costTRY;
    var ptax = profit > 0 ? profit * s.profitTaxRate : 0;
    st.cash += proceeds - ptax;
    st.totals.fee += fee; st.totals.tax += tax; st.totals.profitTax += ptax;
    var rec = { id: p.id, sym: p.sym, qty: p.qty, entry: p.entry, exit: px * (1 - s.slipRate), costTRY: p.costTRY, proceedsTRY: proceeds - ptax,
      pnl: proceeds - ptax - p.costTRY, fees: fee + tax + ptax, openedAt: p.openedAt, closedAt: now, reason: reason };
    st.history.unshift(rec); if (st.history.length > 500) st.history.pop();
    st.positions.splice(k, 1); st.lastExit[p.sym] = now; st.tradeTimes.push(now);
    return rec;
  }

  function equity(st, prices, fx) {
    var v = st.cash;
    st.positions.forEach(function (p) { v += p.qty * (prices[p.sym] || p.entry) * (fx || p.entryFx); });
    return v;
  }
  function logEquity(st, prices, fx, now, gapSec) {
    var v = equity(st, prices, fx), t = Math.floor(now / 1000), last = st.equityLog[st.equityLog.length - 1];
    if (last && t - last.time < (gapSec || 30)) { last.value = v; return; }
    st.equityLog.push({ time: t, value: v });
    if (st.equityLog.length > 5000) st.equityLog.shift();
  }

  /** Bir karar turu. ctx = {prices:{sym:USDT}, fx:USDTTRY, sigs:{sym:{g,t}}}. Dönen: olay listesi. */
  function step(st, ctx, now) {
    var s = st.s, ev = [], fx = ctx.fx, cr = costRate(s);
    if (!(fx > 0)) return ev;
    st.tradeTimes = st.tradeTimes.filter(function (t) { return now - t < 3600e3; });

    // 1) Çıkışlar
    st.positions.slice().forEach(function (p) {
      var px = ctx.prices[p.sym]; if (!(px > 0)) return;
      if (px > p.peak) p.peak = px;
      var dist = p.target - p.entry, reason = null;
      // Kâr koruma: hedefin yarısında stop başa baş (maliyet dahil) seviyesine, %80'inde kârın %50'sine çekilir
      if (dist > 0) {
        var be = p.entry * (1 + 2 * cr + 0.001);
        if (p.peak >= p.entry + 0.5 * dist) p.stop = Math.max(p.stop, be);
        if (p.peak >= p.entry + 0.8 * dist) p.stop = Math.max(p.stop, p.entry + 0.5 * dist);
      }
      var sg = ctx.sigs && ctx.sigs[p.sym], g = sg && sg.g;
      if (px <= p.stop) reason = p.stop > p.entry ? 'Kâr koruma stopu' : 'Stop-loss';
      else if (px >= p.target) reason = 'Hedef';
      else if (g && g.label === 'SAT' && g.confidence >= s.minConf) reason = 'Sinyal SAT';
      else if (now - p.openedAt > s.maxHoldH * 3600e3) reason = 'Süre doldu';
      if (reason) {
        var rec = sell(st, p.id, px, fx, now, reason);
        if (rec) { ev.push({ type: 'sell', rec: rec }); note(st, now, 'SAT ' + p.sym + ' (' + reason + ') net ' + rec.pnl.toFixed(2) + ' TL'); }
      }
    });

    // 2) Girişler
    if (st.positions.length >= s.maxPos || st.tradeTimes.length >= s.maxTradesPerHour) return ev;
    var eq = equity(st, ctx.prices, fx), cands = [];
    Object.keys(ctx.sigs || {}).forEach(function (sym) {
      var sg = ctx.sigs[sym], g = sg && sg.g, px = ctx.prices[sym];
      if (!g || !(px > 0) || g.side !== 'long') return;
      if (now - sg.t > s.sigMaxAgeMin * 60e3) return;
      if (g.confidence < s.minConf || g.rr < s.minRR || (g.regime && g.regime.key === 'highvol')) return;
      if (st.positions.some(function (p) { return p.sym === sym; })) return;
      if (st.lastExit[sym] && now - st.lastExit[sym] < s.cooldownMin * 60e3) return;
      if (px > g.price * 1.01) return;                       // sinyal fiyatından fazla kaçmış
      var stop = px - (g.price - g.stop), target = px + (g.target - g.price);
      if (!(stop > 0 && stop < px)) return;
      var net = target / px - 1 - 2 * cr;                    // gidiş-dönüş maliyet sonrası beklenen kazanç
      if (net < s.minNetGain) return;
      cands.push({ sym: sym, px: px, g: g, stop: stop, target: target, net: net, rank: g.confidence * Math.abs(g.score) });
    });
    cands.sort(function (a, b) { return b.rank - a.rank; });
    for (var i = 0; i < cands.length && st.positions.length < s.maxPos && st.tradeTimes.length < s.maxTradesPerHour; i++) {
      var c = cands[i], invest = Math.min(st.cash, eq / s.maxPos);
      if (invest < s.minOrderTRY) break;
      var p = buy(st, c.sym, c.px, fx, invest, c.stop, c.target, now, 'skor ' + c.g.score + ', güven %' + c.g.confidence + ', R/R ' + c.g.rr.toFixed(1));
      if (p) { ev.push({ type: 'buy', position: p }); note(st, now, 'AL ' + c.sym + ' ' + invest.toFixed(2) + ' TL (' + p.why + ')'); }
    }
    return ev;
  }

  return { DEFAULTS: DEFAULTS, create: create, costRate: costRate, buy: buy, sell: sell, step: step, equity: equity, logEquity: logEquity };
});
