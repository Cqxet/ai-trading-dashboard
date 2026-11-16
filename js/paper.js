/* =====================================================================
 * paper.js — Sanal (paper) portföy motoru. Saf durum geçişleri.
 * GERÇEK EMİR GÖNDERMEZ. Hiçbir ağ çağrısı içermez.
 *  state = {cash, positions[], orders[], history[], equityLog[], seq}
 *  - market emri: anında verilen piyasa fiyatından dolar.
 *  - limit emri: long → fiyat <= limit, short → fiyat >= limit olduğunda
 *    limit fiyatından dolar. Verildiği anda zaten tetik bölgesindeyse
 *    (marketable) piyasa fiyatından anında dolar.
 *  - SL/TP: onPrice() ile her fiyat güncellemesinde kontrol edilir.
 *  - Short: teminat = giriş*miktar nakitten ayrılır; PnL = (giriş-fiyat)*miktar.
 * Tarayıcıda window.Paper, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Paper = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FEE = 0.001; // %0.1

  function create(initial) {
    initial = initial || 10000;
    return { initial: initial, cash: initial, positions: [], orders: [], history: [], equityLog: [], seq: 1, feeRate: FEE };
  }

  function validate(o, st, price) {
    if (!o.sym) return 'Sembol yok';
    if (o.side !== 'long' && o.side !== 'short') return 'Yön geçersiz';
    if (!(o.qty > 0)) return 'Miktar pozitif olmalı';
    if (o.type === 'limit' && !(o.price > 0)) return 'Limit fiyatı gerekli';
    var px = o.type === 'limit' ? o.price : price;
    if (!(px > 0)) return 'Fiyat bilinmiyor';
    var need = px * o.qty * (1 + st.feeRate);
    if (need > st.cash + 1e-9) return 'Yetersiz bakiye (gerekli ' + need.toFixed(2) + ' USDT, mevcut ' + st.cash.toFixed(2) + ')';
    if (o.sl != null && o.sl !== '' && o.sl > 0) {
      if (o.side === 'long' && o.sl >= px) return 'Long için stop girişten düşük olmalı';
      if (o.side === 'short' && o.sl <= px) return 'Short için stop girişten yüksek olmalı';
    }
    if (o.tp != null && o.tp !== '' && o.tp > 0) {
      if (o.side === 'long' && o.tp <= px) return 'Long için hedef girişten yüksek olmalı';
      if (o.side === 'short' && o.tp >= px) return 'Short için hedef girişten düşük olmalı';
    }
    return null;
  }

  function fill(st, o, px, now) {
    var cost = px * o.qty, fee = cost * st.feeRate;
    st.cash -= cost + fee;
    var p = { id: st.seq++, sym: o.sym, side: o.side, qty: o.qty, entry: px, margin: cost, fee: fee, sl: o.sl > 0 ? +o.sl : null, tp: o.tp > 0 ? +o.tp : null, openedAt: now };
    st.positions.push(p);
    return p;
  }

  /** Limit emir verildiği anda piyasa fiyatı zaten tetik bölgesinde mi? */
  function marketable(o, marketPrice) {
    if (o.type !== 'limit' || !(marketPrice > 0) || !(o.price > 0)) return false;
    return o.side === 'long' ? marketPrice <= o.price : marketPrice >= o.price;
  }

  /** Emir ver. Dönen: {ok, error?, position?, order?, marketable?} */
  function placeOrder(st, o, marketPrice, now) {
    o = Object.assign({ type: 'market' }, o);
    o.qty = +o.qty; if (o.price != null) o.price = +o.price; if (o.sl) o.sl = +o.sl; if (o.tp) o.tp = +o.tp;
    // Verildiği anda tetik bölgesindeki limit emir (ör. piyasanın üstünde alış limiti)
    // gerçek borsada olduğu gibi limit fiyatından değil, daha iyi olan piyasa fiyatından
    // hemen dolar. Doğrulama (bakiye, stop/hedef yönü) bu dolum fiyatına göre yapılır.
    // Not: burada onPrice() çağrılmaz; aksi halde aynı semboldeki diğer pozisyonların
    // SL/TP olayları sessizce yutulurdu (olaylar yalnızca ticker akışında üretilir).
    var asMarket = marketable(o, marketPrice);
    if (asMarket) o = Object.assign({}, o, { type: 'market' });
    var err = validate(o, st, marketPrice);
    if (err) return { ok: false, error: err };
    if (o.type === 'market') return { ok: true, position: fill(st, o, marketPrice, now), marketable: asMarket };
    // limit: teminat rezerve edilir
    var reserve = o.price * o.qty * (1 + st.feeRate);
    st.cash -= reserve;
    var ord = { id: st.seq++, sym: o.sym, side: o.side, type: 'limit', qty: o.qty, price: o.price, sl: o.sl || null, tp: o.tp || null, reserve: reserve, createdAt: now };
    st.orders.push(ord);
    return { ok: true, order: ord };
  }

  function cancelOrder(st, id) {
    var k = st.orders.findIndex(function (o) { return o.id === id; });
    if (k < 0) return false;
    st.cash += st.orders[k].reserve; st.orders.splice(k, 1); return true;
  }

  function closePosition(st, id, px, now, reason) {
    var k = st.positions.findIndex(function (p) { return p.id === id; });
    if (k < 0 || !(px > 0)) return null;
    var p = st.positions[k];
    var gross = p.side === 'long' ? (px - p.entry) * p.qty : (p.entry - px) * p.qty;
    var fee = px * p.qty * st.feeRate;
    st.cash += p.margin + gross - fee;
    var rec = { id: p.id, sym: p.sym, side: p.side, qty: p.qty, entry: p.entry, exit: px, pnl: gross - fee - p.fee, fees: fee + p.fee,
      openedAt: p.openedAt, closedAt: now, reason: reason || 'Manuel' };
    st.history.unshift(rec);
    st.positions.splice(k, 1);
    return rec;
  }

  /** Fiyat güncellemesi: limit emir dolumu ve SL/TP tetikleme. Dönen: olay listesi. */
  function onPrice(st, sym, px, now) {
    var ev = [];
    if (!(px > 0)) return ev;
    st.orders.slice().forEach(function (o) {
      if (o.sym !== sym) return;
      var hit = o.side === 'long' ? px <= o.price : px >= o.price;
      if (!hit) return;
      st.cash += o.reserve; st.orders.splice(st.orders.indexOf(o), 1);
      var p = fill(st, o, o.price, now);
      ev.push({ type: 'fill', order: o, position: p });
    });
    st.positions.slice().forEach(function (p) {
      if (p.sym !== sym) return;
      var L = p.side === 'long';
      if (p.sl && (L ? px <= p.sl : px >= p.sl)) ev.push({ type: 'sl', rec: closePosition(st, p.id, px, now, 'Stop-loss') });
      else if (p.tp && (L ? px >= p.tp : px <= p.tp)) ev.push({ type: 'tp', rec: closePosition(st, p.id, px, now, 'Kâr al') });
    });
    return ev;
  }

  function unrealized(p, px) { return p.side === 'long' ? (px - p.entry) * p.qty : (p.entry - px) * p.qty; }

  /** Toplam portföy değeri = nakit + rezervler + pozisyon teminatları + gerçekleşmemiş PnL */
  function equity(st, prices) {
    var v = st.cash;
    st.orders.forEach(function (o) { v += o.reserve; });
    st.positions.forEach(function (p) { var px = prices[p.sym] || p.entry; v += p.margin + unrealized(p, px); });
    return v;
  }

  function logEquity(st, prices, now, minGapSec) {
    var v = equity(st, prices), last = st.equityLog[st.equityLog.length - 1];
    var t = Math.floor(now / 1000);
    if (last && t - last.time < (minGapSec || 60)) { last.value = v; return; }
    st.equityLog.push({ time: t, value: v });
    if (st.equityLog.length > 5000) st.equityLog.shift();
  }

  return { create: create, placeOrder: placeOrder, marketable: marketable, cancelOrder: cancelOrder, closePosition: closePosition, onPrice: onPrice,
    equity: equity, unrealized: unrealized, logEquity: logEquity, FEE: FEE };
});
