/* =====================================================================
 * boot.js — Başlatma sırası. En son yüklenir.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, $ = App.$;

  function fatal(msg) {
    document.querySelector('main').innerHTML = '<section class="panel"><div class="err" style="padding:20px"><b>Başlatılamadı:</b> ' + msg + '</div></section>';
  }
  if (!root.LightweightCharts) {
    fatal('Grafik kütüphanesi (cdn.jsdelivr.net/npm/lightweight-charts@4.1.3) yüklenemedi. İnternet bağlantınızı veya içerik engelleyici ayarlarını kontrol edip sayfayı yenileyin.');
    return;
  }

  App.applyTheme();
  $('btnTheme').onclick = function () {
    var cur = document.documentElement.getAttribute('data-theme');
    App.S.theme = cur === 'dark' ? 'light' : 'dark'; App.save(); App.applyTheme();
  };
  $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button[data-v]'); if (b) App.setView(b.dataset.v); });
  root.Data.onStatus(App.renderConn);
  setInterval(function () { App.renderConn(root.Data.status()); }, 3000);

  try {
    App.dashboard.init();
    App.market.init();
    App.backtest.init();
    App.paper.init();
    App.bot.init();
    App.alerts.init();
    App.ai.init();
  } catch (e) { console.error(e); App.toast('Başlatma hatası: ' + e.message, 'bad', 15000); }

  App.loadTickersREST().catch(function (e) { App.toast('Ticker verisi alınamadı: ' + e.message, 'bad'); });
  App.startTicker();
  App.refreshSigs();
  setInterval(App.refreshSigs, 60000);

  // Derin bağlantı: index.html#market, #bt, #paper ... ; "#bt:run" backtest'i varsayılanlarla hemen çalıştırır.
  var h = (location.hash || '').replace('#', '').split(':');
  var v = document.getElementById('v-' + h[0]) ? h[0] : App.store('view');
  if (v && v !== 'dash' && document.getElementById('v-' + v)) App.setView(v);
  if (h[0] === 'bt' && h[1] === 'run') setTimeout(function () { $('btRun').click(); }, 500);
  root.addEventListener('keydown', function (e) { if (e.key === 'Escape') document.getElementById('settings').classList.remove('on'); });
})(typeof self !== 'undefined' ? self : this);
