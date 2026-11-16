/* =====================================================================
 * app-backtest.js — Backtest sekmesi arayüzü (motor: backtest.js).
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Data = root.Data, BT = root.Backtest;
  var $ = App.$, fmt = U.fmt, esc = U.esc;
  var chart = null, running = false;

  var FIELDS = ['btTf', 'btN', 'btBuy', 'btSell', 'btStop', 'btTgt', 'btFee', 'btSlip'];

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }

  async function run() {
    if (running) return; running = true;
    var sym = $('btSym').value, tf = $('btTf').value, n = +$('btN').value;
    var P = { buyTh: +$('btBuy').value, sellTh: +$('btSell').value, atrStop: +$('btStop').value, atrTarget: +$('btTgt').value,
      feePct: +$('btFee').value, slippagePct: +$('btSlip').value, allowShort: $('btShort').checked, exitOnOpposite: $('btOpp').checked };
    var saved = { sym: sym, short: P.allowShort, opp: P.exitOnOpposite }; FIELDS.forEach(function (f) { saved[f] = $(f).value; }); App.store('bt', saved);
    var out = $('btOut');
    if (!(P.buyTh > P.sellTh)) { out.innerHTML = '<div class="err">AL eşiği SAT eşiğinden büyük olmalı.</div>'; running = false; return; }
    out.innerHTML = '<div class="loading">' + App.pretty(sym) + ' ' + tf + ' için ' + n + ' mum indiriliyor (Binance sayfalama)…</div>';
    $('btRun').disabled = true;
    try {
      var cs = await BT.fetchHistory(Data.get, sym, tf, n + 1);
      cs = cs.slice(0, -1); // son (henüz kapanmamış) mumu at
      out.innerHTML = '<div class="loading">' + cs.length + ' mum üzerinde strateji çalıştırılıyor…</div>';
      await new Promise(function (r) { setTimeout(r, 30); });
      var t0 = performance.now();
      var r = BT.run(cs, P);
      render(r, sym, tf, cs, performance.now() - t0);
    } catch (e) { out.innerHTML = '<div class="err">Backtest başarısız: ' + esc(e.message || e) + '</div>'; }
    $('btRun').disabled = false; running = false;
  }

  function render(r, sym, tf, cs, ms) {
    var m = r.metrics, c = function (k, v, cls, title) { return '<div class="card"' + (title ? ' title="' + title + '"' : '') + '><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    var d = function (t) { return new Date(t * 1000).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); };
    var beat = m.totalReturn - m.buyHold;
    $('btOut').innerHTML =
      '<div class="note">' + App.pretty(sym) + ' · ' + tf + ' · ' + d(m.fromTime) + ' → ' + d(m.toTime) + ' · ' + m.bars + ' işlem mumu (+200 ısınma) · hesaplama ' + ms.toFixed(0) + ' ms</div>' +
      '<div class="cards">' +
      c('Strateji getirisi', U.pct(m.totalReturn), m.totalReturn >= 0 ? 'up' : 'down') +
      c('Al & tut', U.pct(m.buyHold), m.buyHold >= 0 ? 'up' : 'down') +
      c('Fark', U.pct(beat), beat >= 0 ? 'up' : 'down') +
      c('Son bakiye', fmt(m.end, 2) + ' $') +
      c('İşlem sayısı', m.trades) +
      c('Kazanma oranı', '%' + m.winRate.toFixed(1)) +
      c('Kâr faktörü', isFinite(m.profitFactor) ? m.profitFactor.toFixed(2) : '∞', m.profitFactor >= 1 ? 'up' : 'down', 'Brüt kâr / brüt zarar') +
      c('Maks. düşüş', '-%' + m.maxDD.toFixed(2), 'down') +
      c('Sharpe (yıllık)', m.sharpe.toFixed(2), m.sharpe >= 1 ? 'up' : m.sharpe < 0 ? 'down' : '', 'Mum bazlı getirilerden, risksiz faiz 0 varsayımıyla yıllıklandırılmış') +
      c('Ort. işlem', U.pct(m.avgTrade)) +
      c('Piyasada kalma', '%' + m.exposure.toFixed(0)) +
      '</div>' +
      '<div class="eqchart" id="btChart"></div>' +
      '<div class="note"><span style="color:' + cssVar('--acc') + '">━</span> Strateji &nbsp; <span style="color:' + cssVar('--mut') + '">━</span> Al & tut (aynı komisyonla). Komisyon %' + r.params.feePct + ' + kayma %' + r.params.slippagePct + ' her iki yönde uygulanmıştır. <b>Backtest geleceği garanti etmez</b>; aşırı parametre optimizasyonu geçmişe aşırı uyum (overfitting) riskini artırır.</div>' +
      '<div class="scroll" style="max-height:420px"><table class="t"><thead><tr><th>#</th><th>Yön</th><th>Giriş zamanı</th><th>Giriş</th><th>Çıkış zamanı</th><th>Çıkış</th><th>Neden</th><th>Mum</th><th>Getiri</th><th>PnL $</th></tr></thead><tbody>' +
      r.trades.slice().reverse().map(function (t, i) {
        return '<tr><td>' + (r.trades.length - i) + '</td><td class="' + (t.side === 'long' ? 'up' : 'down') + '">' + (t.side === 'long' ? 'Long' : 'Short') + '</td><td>' + d(t.entryTime) + '</td><td>' + fmt(t.entry) + '</td><td>' + d(t.exitTime) + '</td><td>' + fmt(t.exit) + '</td><td>' + t.reason + '</td><td>' + t.bars + '</td><td class="' + (t.ret >= 0 ? 'up' : 'down') + '">' + U.pct(t.ret) + '</td><td class="' + (t.pnl >= 0 ? 'up' : 'down') + '">' + fmt(t.pnl, 2) + '</td></tr>';
      }).join('') + (r.trades.length ? '' : '<tr><td colspan="10" class="mut">Bu parametrelerle hiç işlem oluşmadı. Eşikleri gevşetmeyi deneyin (ör. AL 20 / SAT -20).</td></tr>') + '</tbody></table></div>';

    if (chart) { try { chart.remove(); } catch (e) {} }
    var el = $('btChart');
    chart = LightweightCharts.createChart(el, { autoSize: true, layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut') },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } }, timeScale: { timeVisible: true }, localization: { locale: 'tr-TR' } });
    var s1 = chart.addAreaSeries({ lineColor: cssVar('--acc'), topColor: cssVar('--acc') + '44', bottomColor: cssVar('--acc') + '05', lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
    s1.setData(r.equity.map(function (e) { return { time: e.time, value: e.value }; }));
    var s2 = chart.addLineSeries({ color: cssVar('--mut'), lineWidth: 1, priceLineVisible: false });
    s2.setData(m.bhEquity);
    s1.setMarkers(r.trades.slice(-150).reduce(function (acc, t) {
      acc.push({ time: t.entryTime, position: 'belowBar', color: t.side === 'long' ? cssVar('--up') : cssVar('--down'), shape: t.side === 'long' ? 'arrowUp' : 'arrowDown', text: '' });
      return acc;
    }, []).sort(function (a, b) { return a.time - b.time; }));
    chart.timeScale().fitContent();
  }

  App.backtest = {
    init: function () {
      var saved = App.store('bt') || {};
      App.fillSymbolSelect($('btSym'), saved.sym || App.S.sym);
      FIELDS.forEach(function (f) { if (saved[f] != null) $(f).value = saved[f]; });
      if (saved.short != null) $('btShort').checked = saved.short;
      if (saved.opp != null) $('btOpp').checked = saved.opp;
      $('btRun').onclick = run;
      $('btOut').innerHTML = '<div class="note">Parametreleri seçip "Backtest çalıştır"a basın. Varsayılan: AI skor ≥ 30 → long, ≤ -30 → çık (short kapalı), stop 1.5×ATR, hedef 3×ATR, komisyon %0.1.</div>';
    }
  };
})(typeof self !== 'undefined' ? self : this);
