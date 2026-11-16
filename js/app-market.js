/* =====================================================================
 * app-market.js — Piyasa genel bakışı: ısı haritası, yükselen/düşen,
 * hacim patlaması, RSI tarayıcı, Fear & Greed, CoinGecko global
 * (BTC dominansı), korelasyon matrisi.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Data = root.Data, TA = root.TA;
  var $ = App.$, S = App.S, fmt = U.fmt, esc = U.esc;

  var FNG_TR = { 'Extreme Fear': 'Aşırı korku', 'Fear': 'Korku', 'Neutral': 'Nötr', 'Greed': 'Açgözlülük', 'Extreme Greed': 'Aşırı açgözlülük' };

  function heatColor(ch) {
    var x = Math.max(-1, Math.min(1, (ch || 0) / 6));
    var neutral = [90, 98, 115], up = [22, 163, 74], dn = [220, 38, 38], t = Math.abs(x), to = x >= 0 ? up : dn;
    var c = neutral.map(function (v, i) { return Math.round(v + (to[i] - v) * t); });
    return 'rgb(' + c.join(',') + ')';
  }

  var lastHeat = 0;
  function renderHeat() {
    var el = $('heat'), W = el.clientWidth, H = el.clientHeight;
    if (!W || !H) return;
    var items = App.SYMBOLS.filter(function (s) { return App.tick[s] && App.tick[s].qvol; }).map(function (s) { var t = App.tick[s]; return { value: Math.sqrt(t.qvol), s: s, chg: t.chg, qvol: t.qvol }; });
    var boxes = U.squarify(items, W, H);
    el.innerHTML = boxes.map(function (b) {
      var fs = Math.max(9, Math.min(22, Math.sqrt(b.w * b.h) / 5));
      return '<div data-s="' + b.item.s + '" title="' + App.pretty(b.item.s) + ' · ' + U.pct(b.item.chg) + ' · hacim ' + U.fmtBig(b.item.qvol) + ' USDT" style="left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;background:' + heatColor(b.item.chg) + ';font-size:' + fs + 'px">' +
        (b.w > 34 && b.h > 22 ? App.base(b.item.s) + (b.h > 40 ? '<small>' + U.pct(b.item.chg) + '</small>' : '') : '') + '</div>';
    }).join('');
  }

  function movers() {
    var arr = App.SYMBOLS.filter(function (s) { return App.tick[s]; }).map(function (s) { return { s: s, t: App.tick[s] }; });
    arr.sort(function (a, b) { return b.t.chg - a.t.chg; });
    var row = function (x) { return '<tr class="row" data-s="' + x.s + '"><td><b>' + App.base(x.s) + '</b></td><td>' + fmt(x.t.price) + '</td><td class="' + (x.t.chg >= 0 ? 'up' : 'down') + '">' + U.pct(x.t.chg) + '</td></tr>'; };
    $('gainers').innerHTML = '<table class="t">' + arr.slice(0, 8).map(row).join('') + '</table>';
    $('losers').innerHTML = '<table class="t">' + arr.slice(-8).reverse().map(row).join('') + '</table>';
  }

  function scans() {
    var tf = S.scanTf; $('volTf').textContent = tf + ' · son kapanmış mum';
    var have = App.SYMBOLS.filter(function (s) { return App.sig[s] && App.sig[s].g && App.sig[s].tf === tf; });
    if (!have.length) { $('rsiScan').innerHTML = '<div class="loading">Taranıyor (' + tf + ')…</div>'; return; }
    var v = have.map(function (s) { return { s: s, r: App.sig[s].volRatio, up: App.sig[s].lastClosed.close >= App.sig[s].lastClosed.open }; }).sort(function (a, b) { return b.r - a.r; }).slice(0, 8);
    $('volSpike').innerHTML = '<table class="t"><tr><th>Sembol</th><th>Hacim/ort20</th><th>Mum</th></tr>' + v.map(function (x) {
      return '<tr class="row" data-s="' + x.s + '"><td><b>' + App.base(x.s) + '</b></td><td class="' + (x.r >= 2 ? 'warn' : '') + '">' + x.r.toFixed(2) + '×' + (x.r >= 2 ? ' 🔥' : '') + '</td><td class="' + (x.up ? 'up' : 'down') + '">' + (x.up ? 'alıcılı' : 'satıcılı') + '</td></tr>';
    }).join('') + '</table>';
    var rs = have.map(function (s) { return { s: s, rsi: App.sig[s].g.snap.rsi, g: App.sig[s].g }; }).sort(function (a, b) { return b.rsi - a.rsi; });
    var ob = rs.filter(function (x) { return x.rsi >= 70; }), os = rs.filter(function (x) { return x.rsi <= 30; }).reverse();
    var line = function (x) { return '<tr class="row" data-s="' + x.s + '"><td><b>' + App.base(x.s) + '</b></td><td class="' + (x.rsi >= 70 ? 'down' : x.rsi <= 30 ? 'up' : '') + '">' + x.rsi.toFixed(1) + '</td><td><span class="badge b-' + x.g.label + '">' + x.g.label + '</span></td></tr>'; };
    $('rsiScan').innerHTML = '<table class="t"><tr><th>Aşırı alım (≥70)</th><th>RSI</th><th>AI</th></tr>' + (ob.length ? ob.map(line).join('') : '<tr><td colspan="3" class="mut">yok — en yüksek: ' + rs.slice(0, 2).map(function (x) { return App.base(x.s) + ' ' + x.rsi.toFixed(0); }).join(', ') + '</td></tr>') +
      '<tr><th>Aşırı satım (≤30)</th><th>RSI</th><th>AI</th></tr>' + (os.length ? os.map(line).join('') : '<tr><td colspan="3" class="mut">yok — en düşük: ' + rs.slice(-2).reverse().map(function (x) { return App.base(x.s) + ' ' + x.rsi.toFixed(0); }).join(', ') + '</td></tr>') + '</table>' +
      '<div class="note">' + have.length + '/' + App.SYMBOLS.length + ' sembol tarandı · ' + tf + '</div>';
    corr(have);
  }

  function corr(have) {
    var top = have.filter(function (s) { return App.tick[s]; }).sort(function (a, b) { return App.tick[b].qvol - App.tick[a].qvol; }).slice(0, 12);
    if (top.length < 3) return;
    var N = 150, rets = {};
    top.forEach(function (s) { var c = App.sig[s].closes.slice(-(N + 1)); rets[s] = TA.logReturns(c); });
    var minL = Math.min.apply(null, top.map(function (s) { return rets[s].length; }));
    var cell = function (r) {
      if (r == null) return '<td class="mut">–</td>';
      var a = Math.abs(r), col = r >= 0 ? '34,197,94' : '239,68,68';
      return '<td style="background:rgba(' + col + ',' + (a * 0.85).toFixed(2) + ');color:' + (a > 0.6 ? '#fff' : 'inherit') + '">' + r.toFixed(2) + '</td>';
    };
    $('corr').innerHTML = '<table class="corr"><tr><th></th>' + top.map(function (s) { return '<th>' + App.base(s) + '</th>'; }).join('') + '</tr>' +
      top.map(function (a) { return '<tr><th>' + App.base(a) + '</th>' + top.map(function (b) { return cell(TA.pearson(rets[a].slice(-minL), rets[b].slice(-minL))); }).join('') + '</tr>'; }).join('') + '</table>';
    $('corrInfo').textContent = S.scanTf + ' · son ' + minL + ' getiri';
  }

  async function loadFng() {
    try {
      var j = await Data.external('https://api.alternative.me/fng/?limit=30');
      var d = j.data || []; if (!d.length) throw new Error('boş yanıt');
      var v = +d[0].value, lbl = FNG_TR[d[0].value_classification] || d[0].value_classification;
      App.fng = { value: v, label: lbl };
      var ang = Math.PI * (1 - v / 100), cx = 110, cy = 100, r = 80;
      var nx = cx + r * Math.cos(ang), ny = cy - r * Math.sin(ang);
      var col = v < 25 ? 'var(--down)' : v < 45 ? '#f97316' : v < 55 ? 'var(--warn)' : v < 75 ? '#84cc16' : 'var(--up)';
      var hist = d.slice().reverse().map(function (x) { return +x.value; });
      $('fng').innerHTML = '<svg width="220" height="120" viewBox="0 0 220 120" role="img" aria-label="Fear and Greed ' + v + '">' +
        '<defs><linearGradient id="fg" x1="0" x2="1"><stop offset="0" stop-color="#ef4444"/><stop offset=".5" stop-color="#f5b13d"/><stop offset="1" stop-color="#22c55e"/></linearGradient></defs>' +
        '<path d="M30 100 A80 80 0 0 1 190 100" fill="none" stroke="url(#fg)" stroke-width="14" stroke-linecap="round"/>' +
        '<line x1="' + cx + '" y1="' + cy + '" x2="' + nx.toFixed(1) + '" y2="' + ny.toFixed(1) + '" stroke="var(--text)" stroke-width="3" stroke-linecap="round"/><circle cx="' + cx + '" cy="' + cy + '" r="5" fill="var(--text)"/></svg>' +
        '<div class="big" style="color:' + col + '">' + v + '</div><div><b>' + esc(lbl) + '</b> <span class="mut">· Fear & Greed endeksi</span></div>' +
        '<div style="margin-top:6px" title="Son 30 gün">' + App.sparkSVG(hist, 200, 30) + '</div><div class="mut" style="font-size:11px">Son 30 gün · kaynak: alternative.me</div>';
    } catch (e) { $('fng').innerHTML = '<div class="err">Fear & Greed alınamadı: ' + esc(e.message) + '</div>'; }
  }

  async function loadGlobal() {
    try {
      var g = (await Data.external('https://api.coingecko.com/api/v3/global')).data;
      var c = function (k, v, cls) { return '<div class="card"><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
      App.globalMkt = { btcDom: g.market_cap_percentage.btc, mcap: g.total_market_cap.usd, mcapChg: g.market_cap_change_percentage_24h_usd };
      $('glob').innerHTML = c('BTC dominansı', '%' + g.market_cap_percentage.btc.toFixed(2)) + c('ETH dominansı', '%' + g.market_cap_percentage.eth.toFixed(2)) +
        c('Toplam piyasa değeri', '$' + U.fmtBig(g.total_market_cap.usd)) + c('24s değişim', U.pct(g.market_cap_change_percentage_24h_usd), g.market_cap_change_percentage_24h_usd >= 0 ? 'up' : 'down') +
        c('24s hacim', '$' + U.fmtBig(g.total_volume.usd)) + c('Aktif coin', g.active_cryptocurrencies.toLocaleString('tr-TR'));
    } catch (e) { $('glob').innerHTML = '<div class="mut" style="grid-column:1/-1">CoinGecko global verisi alınamadı (' + esc(e.message) + '). Ücretsiz API dakikalık limit uygulayabilir; 5 dk sonra tekrar denenecek.</div>'; }
  }

  function renderAll() { if (App.view() !== 'market') return; renderHeat(); movers(); scans(); }

  App.market = {
    init: function () {
      $('scanTf').value = S.scanTf;
      $('scanTf').onchange = function () { S.scanTf = this.value; App.save(); scans(); App.refreshSigs(); };
      $('v-market').addEventListener('click', function (e) { var r = e.target.closest('[data-s]'); if (r) { App.setSymbol(r.dataset.s); App.setView('dash'); } });
      App.on('tick', function () { if (App.view() === 'market' && Date.now() - lastHeat > 3000) { lastHeat = Date.now(); renderHeat(); movers(); } });
      App.on('sigs', function () { if (App.view() === 'market') scans(); });
      App.on('view', function (v) { if (v === 'market') setTimeout(renderAll, 30); });
      root.addEventListener('resize', function () { if (App.view() === 'market') renderHeat(); });
      loadFng(); loadGlobal();
      setInterval(loadFng, 30 * 60000); setInterval(loadGlobal, 5 * 60000);
    }
  };
})(typeof self !== 'undefined' ? self : this);
