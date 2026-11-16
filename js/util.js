/* =====================================================================
 * util.js — Saf yardımcılar: biçimlendirme, ısı haritası yerleşimi
 * (squarified treemap), risk hesaplayıcı, alarm değerlendirme.
 * Tarayıcıda window.Util, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Util = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function fmt(n, d) {
    if (n == null || !isFinite(n)) return '–';
    if (d == null) { var a = Math.abs(n); d = a >= 1000 ? 2 : a >= 1 ? 3 : a >= 0.01 ? 4 : a >= 0.0001 ? 6 : 8; }
    return Number(n).toLocaleString('tr-TR', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtBig(n) {
    if (n == null || !isFinite(n)) return '–';
    var a = Math.abs(n);
    if (a >= 1e12) return (n / 1e12).toFixed(2) + ' T';
    if (a >= 1e9) return (n / 1e9).toFixed(2) + ' Mr';
    if (a >= 1e6) return (n / 1e6).toFixed(2) + ' Mn';
    if (a >= 1e3) return (n / 1e3).toFixed(1) + ' B';
    return n.toFixed(0);
  }
  function pct(n, d) { if (n == null || !isFinite(n)) return '–'; return (n >= 0 ? '+' : '') + n.toFixed(d == null ? 2 : d) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---------- Squarified treemap (Bruls vd.) ----------
   * items: [{value, ...}] → [{x,y,w,h,item}] ; toplam alan = W*H */
  function squarify(items, W, H) {
    var data = items.filter(function (d) { return d.value > 0; }).slice().sort(function (a, b) { return b.value - a.value; });
    var total = data.reduce(function (s, d) { return s + d.value; }, 0);
    var out = [];
    if (!total || W <= 0 || H <= 0) return out;
    var scale = W * H / total;
    var rect = { x: 0, y: 0, w: W, h: H };
    var queue = data.map(function (d) { return { item: d, area: d.value * scale }; });
    function worst(row, side) {
      var s = 0, mx = -Infinity, mn = Infinity;
      row.forEach(function (r) { s += r.area; if (r.area > mx) mx = r.area; if (r.area < mn) mn = r.area; });
      var s2 = s * s, side2 = side * side;
      return Math.max(side2 * mx / s2, s2 / (side2 * mn));
    }
    function layout(row) {
      var s = row.reduce(function (a, r) { return a + r.area; }, 0);
      if (rect.w >= rect.h) {
        var cw = s / rect.h, y = rect.y;
        row.forEach(function (r) { var h = r.area / cw; out.push({ x: rect.x, y: y, w: cw, h: h, item: r.item }); y += h; });
        rect = { x: rect.x + cw, y: rect.y, w: rect.w - cw, h: rect.h };
      } else {
        var ch = s / rect.w, x = rect.x;
        row.forEach(function (r) { var w = r.area / ch; out.push({ x: x, y: rect.y, w: w, h: ch, item: r.item }); x += w; });
        rect = { x: rect.x, y: rect.y + ch, w: rect.w, h: rect.h - ch };
      }
    }
    var row = [];
    while (queue.length) {
      var side = Math.min(rect.w, rect.h), c = queue[0];
      if (!row.length || worst(row.concat([c]), side) <= worst(row, side)) { row.push(c); queue.shift(); }
      else { layout(row); row = []; }
    }
    if (row.length) layout(row);
    return out;
  }

  /* ---------- Risk / pozisyon büyüklüğü ---------- */
  function positionSize(o) {
    var balance = +o.balance, riskPct = +o.riskPct, entry = +o.entry, stop = +o.stop, target = o.target ? +o.target : null;
    if (!(balance > 0) || !(riskPct > 0) || !(entry > 0) || !(stop > 0) || entry === stop) return { error: 'Bakiye, risk %, giriş ve stop pozitif olmalı; giriş ≠ stop' };
    var side = stop < entry ? 'long' : 'short';
    var riskAmt = balance * riskPct / 100, perUnit = Math.abs(entry - stop);
    var qty = riskAmt / perUnit, notional = qty * entry;
    var res = { side: side, riskAmt: riskAmt, qty: qty, notional: notional, leverage: notional / balance, stopPct: perUnit / entry * 100 };
    if (target) { res.rr = Math.abs(target - entry) / perUnit; res.reward = Math.abs(target - entry) * qty; }
    return res;
  }

  /* ---------- Alarm değerlendirme ----------
   * alarm: {type:'price_above'|'price_below'|'rsi_above'|'rsi_below'|'signal_change', sym, value, tf, lastLabel}
   * ctx: {price, rsi, label} → {fire:boolean, msg, newLabel?} */
  function evalAlert(a, ctx) {
    var s = a.sym.replace('USDT', '/USDT');
    switch (a.type) {
      case 'price_above': if (ctx.price != null && ctx.price >= a.value) return { fire: true, msg: s + ' fiyatı ' + a.value + ' üzerine çıktı (' + ctx.price + ')' }; break;
      case 'price_below': if (ctx.price != null && ctx.price <= a.value) return { fire: true, msg: s + ' fiyatı ' + a.value + ' altına indi (' + ctx.price + ')' }; break;
      case 'rsi_above': if (ctx.rsi != null && ctx.rsi >= a.value) return { fire: true, msg: s + ' ' + a.tf + ' RSI ' + ctx.rsi.toFixed(1) + ' ≥ ' + a.value }; break;
      case 'rsi_below': if (ctx.rsi != null && ctx.rsi <= a.value) return { fire: true, msg: s + ' ' + a.tf + ' RSI ' + ctx.rsi.toFixed(1) + ' ≤ ' + a.value }; break;
      case 'signal_change':
        if (ctx.label) {
          if (a.lastLabel && a.lastLabel !== ctx.label) return { fire: true, msg: s + ' ' + a.tf + ' sinyali değişti: ' + a.lastLabel + ' → ' + ctx.label, newLabel: ctx.label };
          return { fire: false, newLabel: ctx.label };
        }
        break;
    }
    return { fire: false };
  }

  return { fmt: fmt, fmtBig: fmtBig, pct: pct, esc: esc, squarify: squarify, positionSize: positionSize, evalAlert: evalAlert };
});
