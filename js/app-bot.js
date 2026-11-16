/* =====================================================================
 * app-bot.js — AI botu arayüzü (motor: bot.js). GERÇEK EMİR YOK.
 * Tek ağ çağrısı: USDTTRY kuru (Binance herkese açık fiyat). Durum localStorage'da.
 * Bot yalnızca sayfa açıkken çalışır.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Bot = root.Bot;
  var $ = App.$, fmt = U.fmt, esc = U.esc;
  var st = null, fx = 0, fxAt = 0, chart = null, series = null, lastStep = 0, lastRender = 0;

  function load() {
    st = App.store('bot');
    if (!st || typeof st.cash !== 'number' || !st.s) st = Bot.create();
    st.s = Object.assign({}, Bot.DEFAULTS, st.s);
  }
  function save() { App.store('bot', st); }
  function prices() { var p = {}; App.SYMBOLS.forEach(function (s) { if (App.tick[s]) p[s] = App.tick[s].price; }); return p; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function d(t) { return new Date(t).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); }
  function tl(v, n) { return fmt(v, n == null ? 2 : n) + ' ₺'; }

  async function loadFx() {
    try {
      var r = await root.Data.get('/api/v3/ticker/price?symbol=USDTTRY');
      if (+r.price > 0) { fx = +r.price; fxAt = Date.now(); }
    } catch (e) { /* eski kur kalır; 2 dk'dan eskiyse bot işlem yapmaz */ }
  }
  function fxOk() { return fx > 0 && Date.now() - fxAt < 120000; }

  function run() {
    var now = Date.now();
    if (!st.enabled || !fxOk() || now - lastStep < 3000) return;
    lastStep = now;
    var P = prices(), sigs = {};
    App.SYMBOLS.forEach(function (s) { if (App.sig[s]) sigs[s] = { g: App.sig[s].g, t: App.sig[s].t }; });
    var ev = Bot.step(st, { prices: P, fx: fx, sigs: sigs }, now);
    Bot.logEquity(st, P, fx, now, 30);
    ev.forEach(function (e) {
      var msg = e.type === 'buy' ? 'AL ' + App.pretty(e.position.sym) + ' — ' + tl(e.position.costTRY)
        : 'SAT ' + App.pretty(e.rec.sym) + ' (' + e.rec.reason + ') net ' + tl(e.rec.pnl);
      App.toast('[AI Bot] ' + msg, e.type === 'sell' && e.rec.pnl < 0 ? 'bad' : 'ok', 7000);
    });
    if (ev.length) save();
  }

  function render(full) {
    lastRender = Date.now();
    var P = prices(), eq = Bot.equity(st, P, fx || undefined), real = st.history.reduce(function (a, h) { return a + h.pnl; }, 0);
    var wins = st.history.filter(function (h) { return h.pnl > 0; }).length, T = st.totals;
    var c = function (k, v, cls) { return '<div class="card"><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    $('botCards').innerHTML = c('Portföy değeri', tl(eq)) + c('Toplam getiri', U.pct((eq / st.initial - 1) * 100), eq >= st.initial ? 'up' : 'down') +
      c('Serbest nakit', tl(st.cash)) + c('Gerçekleşen net PnL', tl(real), real >= 0 ? 'up' : 'down') +
      c('Kapanan işlem', st.history.length + (st.history.length ? ' (%' + (wins / st.history.length * 100).toFixed(0) + ' kazanç)' : '')) +
      c('Ödenen komisyon', tl(T.fee)) + c('Ödenen işlem vergisi', tl(T.tax)) + c('Ödenen kâr vergisi', tl(T.profitTax)) +
      c('USDT/TRY', fx ? fmt(fx, 4) + (fxOk() ? '' : ' (eski!)') : 'yükleniyor…');
    $('botToggle').textContent = st.enabled ? 'Durdur' : 'Başlat';
    $('botToggle').className = 'btn sm ' + (st.enabled ? 'sell' : 'buy');
    $('botNote').innerHTML = (st.enabled ? '● Bot çalışıyor' : '○ Bot durdu') + ' — yalnızca bu sayfa açıkken işlem yapar. Her işlemde komisyon + kayma + işlem vergisi düşülür; ' +
      'sinyaller izleme listesi taramasından (' + esc(App.S.scanTf) + ') gelir. Gerçek para/emir yok. Yatırım tavsiyesi değildir; geçmiş performans geleceği garanti etmez.';
    $('botPos').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Miktar</th><th>Giriş $</th><th>Güncel $</th><th>Maliyet ₺</th><th>Değer ₺</th><th>PnL ₺</th><th>Stop</th><th>Hedef</th><th>Açılış</th><th>Gerekçe</th><th></th></tr></thead><tbody>' +
      (st.positions.map(function (p) {
        var px = P[p.sym] || p.entry, v = p.qty * px * (fx || p.entryFx), u = v - p.costTRY;
        return '<tr><td><b>' + App.pretty(p.sym) + '</b></td><td>' + fmt(p.qty, 6) + '</td><td>' + fmt(p.entry) + '</td><td>' + fmt(px) + '</td><td>' + fmt(p.costTRY, 2) + '</td><td>' + fmt(v, 2) +
          '</td><td class="' + (u >= 0 ? 'up' : 'down') + '">' + fmt(u, 2) + '</td><td>' + fmt(p.stop) + '</td><td>' + fmt(p.target) + '</td><td class="mut">' + d(p.openedAt) + '</td><td class="mut">' + esc(p.why) +
          '</td><td><button class="btn sm" data-bclose="' + p.id + '">Kapat</button></td></tr>';
      }).join('') || '<tr><td colspan="12" class="mut">Açık pozisyon yok</td></tr>') + '</tbody></table>';
    if (!full) return;
    $('botLog').innerHTML = '<table class="t"><tbody>' + (st.log.slice(0, 60).map(function (l) { return '<tr><td class="mut">' + d(l.t) + '</td><td>' + esc(l.text) + '</td></tr>'; }).join('') || '<tr><td class="mut">Henüz karar yok</td></tr>') + '</tbody></table>';
    $('botHist').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Giriş $</th><th>Çıkış $</th><th>Net PnL ₺</th><th>Maliyet ₺</th><th>Neden</th><th>Kapanış</th></tr></thead><tbody>' +
      (st.history.slice(0, 100).map(function (h) { return '<tr><td>' + App.pretty(h.sym) + '</td><td>' + fmt(h.entry) + '</td><td>' + fmt(h.exit) + '</td><td class="' + (h.pnl >= 0 ? 'up' : 'down') + '">' + fmt(h.pnl, 2) + '</td><td>' + fmt(h.fees, 2) + '</td><td>' + esc(h.reason) + '</td><td class="mut">' + d(h.closedAt) + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="mut">Henüz işlem yok</td></tr>') + '</tbody></table>';
    drawChart();
  }

  function drawChart() {
    var el = $('botChart');
    if (!chart) {
      chart = LightweightCharts.createChart(el, { autoSize: true, timeScale: { timeVisible: true }, localization: { locale: 'tr-TR' } });
      series = chart.addAreaSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    }
    chart.applyOptions({ layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut') }, grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } } });
    series.applyOptions({ lineColor: cssVar('--acc'), topColor: cssVar('--acc') + '44', bottomColor: cssVar('--acc') + '05' });
    var data = st.equityLog.slice(), now = Math.floor(Date.now() / 1000);
    if (!data.length) data.push({ time: now - 60, value: st.initial });
    if (data[data.length - 1].time < now) data.push({ time: now, value: Bot.equity(st, prices(), fx || undefined) });
    series.setData(data);
  }

  function fillForm() {
    var s = st.s;
    $('botFee').value = +(s.feeRate * 100).toFixed(4); $('botSlip').value = +(s.slipRate * 100).toFixed(4);
    $('botTax').value = +(s.taxRate * 100).toFixed(4); $('botPTax').value = +(s.profitTaxRate * 100).toFixed(2);
    $('botConf').value = s.minConf; $('botMaxPos').value = s.maxPos;
  }

  App.bot = {
    init: function () {
      load(); fillForm(); loadFx(); setInterval(loadFx, 20000);
      $('botToggle').onclick = function () {
        st.enabled = !st.enabled; save(); render(true);
        App.toast(st.enabled ? 'AI Bot başlatıldı (sanal, TL)' : 'AI Bot durduruldu', 'ok');
      };
      $('botReset').onclick = function () {
        if (!confirm('Bot portföyü sıfırlansın mı? Tüm pozisyonlar ve geçmiş silinir; bakiye 100 TL olur.')) return;
        var s = st.s; st = Bot.create(s); st.cash = st.initial = s.initialTRY; save(); render(true); App.toast('Bot portföyü sıfırlandı', 'ok');
      };
      $('botApply').onclick = function () {
        var s = st.s, v = function (id) { return +$(id).value; };
        var fee = v('botFee') / 100, slip = v('botSlip') / 100, tax = v('botTax') / 100, ptax = v('botPTax') / 100, conf = v('botConf'), mp = Math.round(v('botMaxPos'));
        if (![fee, slip, tax, ptax].every(function (x) { return x >= 0 && x < 0.5; }) || !(conf >= 0 && conf <= 100) || !(mp >= 1 && mp <= 10)) { App.toast('Geçersiz ayar değeri', 'bad'); return; }
        s.feeRate = fee; s.slipRate = slip; s.taxRate = tax; s.profitTaxRate = ptax; s.minConf = conf; s.maxPos = mp;
        save(); App.toast('Ayarlar uygulandı', 'ok');
      };
      $('v-bot').addEventListener('click', function (e) {
        var c = e.target.dataset.bclose;
        if (!c) return;
        var p = st.positions.find(function (q) { return q.id === +c; }), px = p && App.price(p.sym);
        if (!px || !fxOk()) return App.toast('Fiyat/kur yok', 'bad');
        var rec = Bot.sell(st, +c, px, fx, Date.now(), 'Manuel'); App.toast('Kapatıldı, net ' + tl(rec.pnl), rec.pnl >= 0 ? 'ok' : 'bad'); save(); render(true);
      });
      App.on('tick', function () {
        run();
        if (App.view() === 'bot' && Date.now() - lastRender > 1000) render(false);
      });
      App.on('sigs', function () { run(); });
      App.on('view', function (v) { if (v === 'bot') setTimeout(function () { render(true); }, 30); });
      App.on('theme', function () { if (chart) drawChart(); });
      setInterval(function () { if (st.enabled && Date.now() - lastStep > 10000) run(); if (App.view() === 'bot') render(true); }, 15000);
      setInterval(save, 30000);
      root.addEventListener('beforeunload', save);
    },
    state: function () { return st; }
  };
})(typeof self !== 'undefined' ? self : this);
