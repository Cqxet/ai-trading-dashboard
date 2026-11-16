/* =====================================================================
 * app-paper.js — Sanal portföy arayüzü (motor: paper.js).
 * GERÇEK EMİR GÖNDERİLMEZ: bu dosyada hiçbir ağ çağrısı yoktur; fiyatlar
 * yalnızca canlı ticker akışından okunur. Durum localStorage'da tutulur.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Paper = root.Paper;
  var $ = App.$, fmt = U.fmt, esc = U.esc;
  var st = null, chart = null, series = null, lastRender = 0;

  function load() {
    st = App.store('paper');
    if (!st || typeof st.cash !== 'number') st = Paper.create(10000);
  }
  function save() { App.store('paper', st); }
  function prices() { var p = {}; App.SYMBOLS.forEach(function (s) { if (App.tick[s]) p[s] = App.tick[s].price; }); return p; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function d(t) { return new Date(t).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); }

  function order(side) {
    var sym = $('ppSym').value, type = $('ppType').value, px = App.price(sym);
    if (!px) { App.toast('Canlı fiyat henüz yok', 'bad'); return; }
    var lim = +$('ppPrice').value, ref = type === 'limit' ? lim : px, amt = +$('ppAmt').value;
    if (!(amt > 0) || !(ref > 0)) { App.toast('Tutar ve fiyat pozitif olmalı', 'bad'); return; }
    var qty = amt / ref;
    var r = Paper.placeOrder(st, { sym: sym, side: side, type: type, qty: qty, price: type === 'limit' ? lim : null, sl: +$('ppSl').value || null, tp: +$('ppTp').value || null }, px, Date.now());
    if (!r.ok) { App.toast('Emir reddedildi: ' + r.error, 'bad'); return; }
    App.toast(r.position ? 'Sanal ' + (side === 'long' ? 'LONG' : 'SHORT') + ' açıldı: ' + fmt(qty, 6) + ' ' + App.base(sym) + ' @ ' + fmt(px) + (r.marketable ? ' (limit tetik bölgesindeydi, piyasa fiyatından doldu)' : '') : 'Sanal limit emir eklendi @ ' + fmt(lim), 'ok');
    save(); render(true);
  }

  function onTick(syms) {
    var now = Date.now(), changed = false;
    syms.forEach(function (s) {
      var px = App.price(s); if (!px) return;
      Paper.onPrice(st, s, px, now).forEach(function (ev) {
        changed = true;
        var msg = ev.type === 'fill' ? 'Limit emir doldu: ' + App.pretty(ev.order.sym) + ' @ ' + fmt(ev.order.price)
          : (ev.type === 'sl' ? 'Stop-loss tetiklendi: ' : 'Kâr al tetiklendi: ') + App.pretty(ev.rec.sym) + ' PnL ' + fmt(ev.rec.pnl, 2) + ' $';
        App.toast('[Sanal] ' + msg, ev.type === 'sl' ? 'bad' : 'ok', 8000); App.beep(); App.notify('Sanal portföy', msg);
      });
    });
    if (st.positions.length || st.orders.length || changed) Paper.logEquity(st, prices(), now, 60);
    if (changed) save();
    if (App.view() === 'paper' && (changed || now - lastRender > 1000)) render(changed);
    else if (now - (onTick._s || 0) > 30000) { onTick._s = now; save(); }
  }

  function render(full) {
    lastRender = Date.now();
    var P = prices(), eq = Paper.equity(st, P), unr = st.positions.reduce(function (a, p) { return a + Paper.unrealized(p, P[p.sym] || p.entry); }, 0);
    var real = st.history.reduce(function (a, h) { return a + h.pnl; }, 0), wins = st.history.filter(function (h) { return h.pnl > 0; }).length;
    var c = function (k, v, cls) { return '<div class="card"><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    $('ppCards').innerHTML = c('Portföy değeri', fmt(eq, 2) + ' $') + c('Toplam getiri', U.pct((eq / st.initial - 1) * 100), eq >= st.initial ? 'up' : 'down') +
      c('Serbest nakit', fmt(st.cash, 2) + ' $') + c('Gerçekleşmemiş PnL', fmt(unr, 2) + ' $', unr >= 0 ? 'up' : 'down') +
      c('Gerçekleşen PnL', fmt(real, 2) + ' $', real >= 0 ? 'up' : 'down') + c('Kapanan işlem', st.history.length + (st.history.length ? ' (%' + (wins / st.history.length * 100).toFixed(0) + ' kazanç)' : '')) +
      c('Komisyon', '%' + (st.feeRate * 100).toFixed(2) + ' / işlem');
    $('ppPos').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Yön</th><th>Miktar</th><th>Giriş</th><th>Güncel</th><th>Değer</th><th>PnL</th><th>PnL %</th><th>Stop</th><th>Hedef</th><th>Açılış</th><th></th></tr></thead><tbody>' +
      (st.positions.map(function (p) {
        var px = P[p.sym] || p.entry, u = Paper.unrealized(p, px), pc = u / p.margin * 100;
        return '<tr><td><b>' + App.pretty(p.sym) + '</b></td><td class="' + (p.side === 'long' ? 'up' : 'down') + '">' + (p.side === 'long' ? 'Long' : 'Short') + '</td><td>' + fmt(p.qty, 6) + '</td><td>' + fmt(p.entry) + '</td><td>' + fmt(px) +
          '</td><td>' + fmt(p.margin + u, 2) + '</td><td class="' + (u >= 0 ? 'up' : 'down') + '">' + fmt(u, 2) + '</td><td class="' + (u >= 0 ? 'up' : 'down') + '">' + U.pct(pc) + '</td><td>' + (p.sl ? fmt(p.sl) : '–') + '</td><td>' + (p.tp ? fmt(p.tp) : '–') +
          '</td><td class="mut">' + d(p.openedAt) + '</td><td><button class="btn sm" data-close="' + p.id + '">Kapat</button></td></tr>';
      }).join('') || '<tr><td colspan="12" class="mut">Açık pozisyon yok</td></tr>') + '</tbody></table>';
    if (!full) return;
    $('ppOrd').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Yön</th><th>Limit</th><th>Miktar</th><th>Güncel</th><th>Tarih</th><th></th></tr></thead><tbody>' +
      (st.orders.map(function (o) { return '<tr><td>' + App.pretty(o.sym) + '</td><td class="' + (o.side === 'long' ? 'up' : 'down') + '">' + (o.side === 'long' ? 'Al' : 'Sat') + '</td><td>' + fmt(o.price) + '</td><td>' + fmt(o.qty, 6) + '</td><td>' + fmt(P[o.sym]) + '</td><td class="mut">' + d(o.createdAt) + '</td><td><button class="btn sm" data-cancel="' + o.id + '">İptal</button></td></tr>'; }).join('') || '<tr><td colspan="7" class="mut">Bekleyen emir yok</td></tr>') + '</tbody></table>';
    $('ppHist').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Yön</th><th>Giriş</th><th>Çıkış</th><th>PnL $</th><th>Neden</th><th>Kapanış</th></tr></thead><tbody>' +
      (st.history.slice(0, 200).map(function (h) { return '<tr><td>' + App.pretty(h.sym) + '</td><td class="' + (h.side === 'long' ? 'up' : 'down') + '">' + (h.side === 'long' ? 'Long' : 'Short') + '</td><td>' + fmt(h.entry) + '</td><td>' + fmt(h.exit) + '</td><td class="' + (h.pnl >= 0 ? 'up' : 'down') + '">' + fmt(h.pnl, 2) + '</td><td>' + esc(h.reason) + '</td><td class="mut">' + d(h.closedAt) + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="mut">Henüz işlem yok</td></tr>') + '</tbody></table>';
    drawChart();
  }

  function drawChart() {
    var el = $('ppChart');
    if (!chart) {
      chart = LightweightCharts.createChart(el, { autoSize: true, timeScale: { timeVisible: true }, localization: { locale: 'tr-TR' } });
      series = chart.addAreaSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    }
    chart.applyOptions({ layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut') }, grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } } });
    series.applyOptions({ lineColor: cssVar('--acc'), topColor: cssVar('--acc') + '44', bottomColor: cssVar('--acc') + '05' });
    var data = st.equityLog.slice();
    var now = Math.floor(Date.now() / 1000), cur = Paper.equity(st, prices());
    if (!data.length) data.push({ time: now - 60, value: st.initial });
    if (data[data.length - 1].time < now) data.push({ time: now, value: cur });
    series.setData(data);
  }

  App.paper = {
    init: function () {
      load();
      App.fillSymbolSelect($('ppSym'), App.S.sym);
      $('ppType').onchange = function () { $('ppPrice').disabled = this.value !== 'limit'; if (this.value === 'limit' && !$('ppPrice').value) $('ppPrice').value = App.price($('ppSym').value) || ''; };
      $('ppSym').onchange = function () { $('ppPrice').value = ''; $('ppSl').value = ''; $('ppTp').value = ''; hint(); };
      $('ppBuy').onclick = function () { order('long'); };
      $('ppSell').onclick = function () { order('short'); };
      $('ppReset').onclick = function () {
        if (!confirm('Sanal portföy sıfırlansın mı? Tüm pozisyonlar, emirler ve geçmiş silinir; bakiye 10.000 USDT olur.')) return;
        st = Paper.create(10000); save(); render(true); App.toast('Sanal portföy sıfırlandı', 'ok');
      };
      $('v-paper').addEventListener('click', function (e) {
        var c = e.target.dataset.close, x = e.target.dataset.cancel;
        if (c) { var p = st.positions.find(function (q) { return q.id === +c; }); var px = p && App.price(p.sym); if (!px) return App.toast('Fiyat yok', 'bad'); var rec = Paper.closePosition(st, +c, px, Date.now(), 'Manuel'); App.toast('Pozisyon kapatıldı, PnL ' + fmt(rec.pnl, 2) + ' $', rec.pnl >= 0 ? 'ok' : 'bad'); save(); render(true); }
        if (x) { Paper.cancelOrder(st, +x); save(); render(true); }
      });
      App.on('tick', onTick);
      App.on('view', function (v) { if (v === 'paper') { $('ppSym').value = App.S.sym; hint(); setTimeout(function () { render(true); }, 30); } });
      App.on('theme', function () { if (chart) drawChart(); });
      root.addEventListener('beforeunload', save);
      function hint() {
        var s = $('ppSym').value, g = App.sig[s] && App.sig[s].g;
        $('ppHint').innerHTML = g ? 'AI (' + g.display + ', ' + App.sig[s].tf + '): önerilen stop ' + fmt(g.stop) + ', hedef ' + fmt(g.target) + ' — <a href="#" id="ppUseAi">doldur</a>' : '';
        var a = $('ppUseAi'); if (a) a.onclick = function (e) { e.preventDefault(); $('ppSl').value = +g.stop.toPrecision(6); $('ppTp').value = +g.target.toPrecision(6); };
      }
    },
    state: function () { return st; }
  };
})(typeof self !== 'undefined' ? self : this);
