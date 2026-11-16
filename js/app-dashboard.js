/* =====================================================================
 * app-dashboard.js — Pano sekmesi: panel düzeni (sürükle/bırak, genişlik,
 * yükseklik, gizle; localStorage), izleme listesi, ana grafik + araç
 * çubuğu, AI sinyal paneli, MTF, emir defteri, son işlemler, 24s özet,
 * risk hesaplayıcı; ayrıca 2×2 çoklu grafik sekmesi.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Data = root.Data, Signals = root.Signals, ChartView = root.ChartView;
  var $ = App.$, S = App.S, fmt = U.fmt, esc = U.esc;

  /* ================= Panel düzeni ================= */
  var DEF_SPAN = { watch: 3, chart: 6, signal: 3, mtf: 4, analyst: 5, risk: 3, book: 4, trades: 4, stats: 4 };
  var SPANS = [3, 4, 5, 6, 8, 9, 12];
  var L = Object.assign({ order: [], span: {}, h: {}, hidden: {}, collapsed: {} }, App.store('layout') || {});
  function saveL() { App.store('layout', L); }

  function initLayout() {
    var dash = $('dash'), panels = Array.prototype.slice.call(dash.children);
    panels.forEach(function (p) {
      var id = p.dataset.id, pb = p.querySelector('.pb');
      p.dataset.defH = pb.style.height;
      var ph = document.createElement('div'); ph.className = 'ph'; ph.draggable = true;
      ph.innerHTML = '<h2>' + esc(p.dataset.title) + '</h2><span class="sp"></span>' +
        '<button class="icon" data-a="w" title="Genişliği değiştir">⇔</button>' +
        '<button class="icon" data-a="c" title="Daralt / genişlet">▁</button>' +
        '<button class="icon" data-a="x" title="Paneli gizle">✕</button>';
      p.insertBefore(ph, pb);
      ph.addEventListener('click', function (e) {
        var a = e.target.dataset.a; if (!a) return;
        if (a === 'w') { var cur = L.span[id] || DEF_SPAN[id]; L.span[id] = SPANS[(SPANS.indexOf(cur) + 1) % SPANS.length]; }
        if (a === 'c') L.collapsed[id] = !L.collapsed[id];
        if (a === 'x') L.hidden[id] = 1;
        saveL(); applyLayout();
      });
      ph.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', id); e.dataTransfer.effectAllowed = 'move'; p.classList.add('dragging'); });
      ph.addEventListener('dragend', function () { p.classList.remove('dragging'); });
      p.addEventListener('dragover', function (e) { e.preventDefault(); p.classList.add('dropT'); });
      p.addEventListener('dragleave', function () { p.classList.remove('dropT'); });
      p.addEventListener('drop', function (e) {
        e.preventDefault(); p.classList.remove('dropT');
        var src = e.dataTransfer.getData('text/plain'); if (!src || src === id) return;
        var srcEl = dash.querySelector('[data-id="' + src + '"]'), r = p.getBoundingClientRect();
        var after = (e.clientX - r.left) > r.width / 2;
        dash.insertBefore(srcEl, after ? p.nextSibling : p);
        L.order = Array.prototype.map.call(dash.children, function (x) { return x.dataset.id; }); saveL();
      });
      if (root.ResizeObserver) {
        var t = null;
        new ResizeObserver(function () {
          clearTimeout(t); t = setTimeout(function () { if (pb.offsetHeight > 0 && pb.style.height) { L.h[id] = pb.style.height; saveL(); } }, 400);
        }).observe(pb);
      }
    });
    $('btnResetLayout').onclick = function () { L = { order: [], span: {}, h: {}, hidden: {}, collapsed: {} }; saveL(); applyLayout(true); App.toast('Düzen varsayılana döndü', 'ok'); };
    $('hiddenPanels').addEventListener('click', function (e) { var id = e.target.dataset.show; if (id) { delete L.hidden[id]; saveL(); applyLayout(); } });
    applyLayout();
  }
  function applyLayout(reset) {
    var dash = $('dash');
    if (L.order.length) L.order.forEach(function (id) { var el = dash.querySelector('[data-id="' + id + '"]'); if (el) dash.appendChild(el); });
    else if (reset) Object.keys(DEF_SPAN).forEach(function (id) { var el = dash.querySelector('[data-id="' + id + '"]'); if (el) dash.appendChild(el); });
    var hid = [];
    Array.prototype.forEach.call(dash.children, function (p) {
      var id = p.dataset.id, pb = p.querySelector('.pb');
      p.style.gridColumn = 'span ' + (L.span[id] || DEF_SPAN[id] || 4);
      p.classList.toggle('hidden', !!L.hidden[id]);
      p.classList.toggle('collapsed', !!L.collapsed[id]);
      pb.style.height = L.h[id] || p.dataset.defH;
      if (L.hidden[id]) hid.push('<label><button class="btn sm" data-show="' + id + '">Göster</button> ' + esc(p.dataset.title) + '</label>');
    });
    $('hiddenPanels').innerHTML = hid.length ? hid.join('') : '<span class="mut">Gizli panel yok</span>';
  }

  /* ================= İzleme listesi ================= */
  var lastWatch = 0, watchTimer = null;
  function renderWatch(force) {
    var now = Date.now();
    if (!force && now - lastWatch < 900) { if (!watchTimer) watchTimer = setTimeout(function () { watchTimer = null; renderWatch(true); }, 900); return; }
    lastWatch = now;
    var q = ($('wSearch').value || '').trim().toUpperCase(), favOnly = $('wFav').checked;
    var rows = App.SYMBOLS.filter(function (s) { return (!q || s.indexOf(q) >= 0) && (!favOnly || S.favs.indexOf(s) >= 0); }).map(function (s) {
      var t = App.tick[s] || {}, g = App.sig[s] && App.sig[s].g;
      return { s: s, price: t.price, chg: t.chg, qvol: t.qvol, score: g ? g.score : null, g: g, dir: t.dir, spark: App.sig[s] && App.sig[s].spark };
    });
    var k = S.sort.k, d = S.sort.d;
    rows.sort(function (a, b) {
      var fa = S.favs.indexOf(a.s) >= 0, fb = S.favs.indexOf(b.s) >= 0;
      if (fa !== fb) return fa ? -1 : 1;
      if (k === 'sym') return a.s < b.s ? -d : d;
      var x = a[k] == null ? -Infinity : a[k], y = b[k] == null ? -Infinity : b[k];
      return (x - y) * d;
    });
    $('wTable').querySelector('tbody').innerHTML = rows.map(function (r) {
      var fav = S.favs.indexOf(r.s) >= 0;
      return '<tr class="row' + (r.s === S.sym ? ' sel' : '') + '" data-s="' + r.s + '">' +
        '<td><span class="star' + (fav ? ' on' : '') + '" data-fav="' + r.s + '">' + (fav ? '★' : '☆') + '</span><b>' + App.base(r.s) + '</b></td>' +
        '<td class="' + (r.dir > 0 ? 'flash-up' : r.dir < 0 ? 'flash-down' : '') + '">' + fmt(r.price) + '</td>' +
        '<td class="' + (r.chg >= 0 ? 'up' : 'down') + '">' + U.pct(r.chg) + '</td>' +
        '<td>' + U.fmtBig(r.qvol) + '</td>' +
        '<td>' + (r.g ? '<span class="badge b-' + r.g.label + '" title="Güven %' + r.g.confidence + ' · ' + esc(r.g.regime.name) + '">' + r.g.label + ' ' + (r.g.score > 0 ? '+' : '') + r.g.score + '</span>' : '<span class="mut">…</span>') + '</td>' +
        '<td>' + App.sparkSVG(r.spark, 46, 18) + '</td></tr>';
    }).join('') || '<tr><td colspan="6" class="mut">Eşleşen sembol yok</td></tr>';
    rows.forEach(function (r) { if (App.tick[r.s]) App.tick[r.s].dir = 0; }); // yanıp sönme yalnızca yeni fiyat değişiminde
    Array.prototype.forEach.call($('wTable').querySelectorAll('th.s'), function (th) {
      th.textContent = th.textContent.replace(/ [▲▼]$/, '') + (th.dataset.k === k ? (d > 0 ? ' ▲' : ' ▼') : '');
    });
  }
  function initWatch() {
    $('wTable').addEventListener('click', function (e) {
      var f = e.target.dataset.fav;
      if (f) { var i = S.favs.indexOf(f); if (i >= 0) S.favs.splice(i, 1); else S.favs.push(f); App.save(); renderWatch(true); return; }
      var th = e.target.closest('th.s');
      if (th) { var k = th.dataset.k; S.sort = { k: k, d: S.sort.k === k ? -S.sort.d : (k === 'sym' ? 1 : -1) }; App.save(); renderWatch(true); return; }
      var tr = e.target.closest('tr.row'); if (tr) App.setSymbol(tr.dataset.s);
    });
    $('wSearch').addEventListener('input', function () { renderWatch(true); });
    $('wFav').addEventListener('change', function () { renderWatch(true); });
    App.on('tick', function () { renderWatch(); });
    App.on('sigs', function () { renderWatch(true); });
    App.on('symbol', function () { renderWatch(true); });
  }

  /* ================= Ana grafik ================= */
  var cv = null, candles = [], analysis = null, loadSeq = 0;
  var IND_MENU = [['Üst katman', [['ema20', 'EMA 20'], ['ema50', 'EMA 50'], ['ema200', 'EMA 200'], ['sma20', 'SMA 20'], ['bb', 'Bollinger (20,2)'], ['vwap', 'VWAP (günlük)'], ['st', 'Supertrend (10,3)'], ['vol', 'Hacim'], ['sr', 'Destek/Direnç + Stop/Hedef'], ['pat', 'Formasyon işaretleri']]],
    ['Alt panel', [['rsi', 'RSI'], ['macd', 'MACD'], ['stoch', 'Stokastik'], ['atr', 'ATR'], ['obv', 'OBV']]]];

  function initChart() {
    cv = new ChartView($('mainChart'), { type: S.chartType, ind: S.ind, sym: S.sym, tf: S.tf, onDrawDone: function () { $('drH').classList.remove('on'); $('drT').classList.remove('on'); } });
    $('cTf').innerHTML = App.TFS.map(function (t) { return '<button data-tf="' + t + '">' + t + '</button>'; }).join('');
    $('cTf').onclick = function (e) { var t = e.target.dataset.tf; if (t) App.setSymbol(S.sym, t); };
    $('cType').onclick = function (e) { var t = e.target.dataset.t; if (!t) return; S.chartType = t; App.save(); cv.setType(t); paintToolbar(); };
    $('indMenu').innerHTML = IND_MENU.map(function (g) { return '<b>' + g[0] + '</b>' + g[1].map(function (x) { return '<label><input type="checkbox" data-ind="' + x[0] + '"' + (S.ind[x[0]] ? ' checked' : '') + '> ' + x[1] + '</label>'; }).join(''); }).join('');
    $('indMenu').addEventListener('change', function (e) { var k = e.target.dataset.ind; if (!k) return; if (e.target.checked) S.ind[k] = 1; else delete S.ind[k]; App.save(); cv.setInd(S.ind); });
    $('drH').onclick = function () { var on = cv.drawMode !== 'h'; cv.setDrawMode(on ? 'h' : null); $('drH').classList.toggle('on', on); $('drT').classList.remove('on'); };
    $('drT').onclick = function () { var on = cv.drawMode !== 't'; cv.setDrawMode(on ? 't' : null); $('drT').classList.toggle('on', on); $('drH').classList.remove('on'); };
    $('drC').onclick = function () { cv.clearDrawings(); App.toast(App.pretty(S.sym) + ' çizimleri silindi'); };
    App.on('symbol', loadMain);
    App.on('theme', function () { if (cv) cv.applyTheme(); });
    App.on('tick', function (syms) { if (syms.indexOf(S.sym) >= 0) paintTop(); });
    paintToolbar();
  }
  function paintToolbar() {
    Array.prototype.forEach.call($('cTf').children, function (b) { b.classList.toggle('on', b.dataset.tf === S.tf); });
    Array.prototype.forEach.call($('cType').children, function (b) { b.classList.toggle('on', b.dataset.t === S.chartType); });
    $('cSym').textContent = App.pretty(S.sym);
  }
  function paintTop() {
    var t = App.tick[S.sym] || {};
    $('cPx').textContent = fmt(t.price);
    $('cChg').innerHTML = t.chg == null ? '' : '<span class="' + (t.chg >= 0 ? 'up' : 'down') + '">' + U.pct(t.chg) + '</span>';
    document.title = (t.price ? fmt(t.price) + ' ' : '') + App.pretty(S.sym) + ' · AI Trading Board';
    renderStats();
  }

  async function loadMain() {
    var seq = ++loadSeq, sym = S.sym, tf = S.tf;
    paintToolbar(); paintTop(); cv.setSymbol(sym, tf);
    $('sigBody').innerHTML = '<div class="loading">' + App.pretty(sym) + ' ' + tf + ' yükleniyor…</div>';
    try {
      var cs = await Data.klines(sym, tf, 1000, 0);
      if (seq !== loadSeq) return;
      candles = cs; analysis = Signals.analyze(cs.slice(0, -1));
      cv.setData(cs, analysis);
      renderSignal(); App.emit('analysis', analysis);
      if (analysis && !$('rkEntry').value) $('rkFill').onclick();
      connectMain(sym, tf);
      loadMTF(sym);
    } catch (e) {
      if (seq !== loadSeq) return;
      $('sigBody').innerHTML = '<div class="err">Veri alınamadı: ' + esc(e.message || e) + '<br><span class="mut">İnternet / VPN / güvenlik duvarı ayarlarını kontrol edin. 20 sn sonra tekrar denenecek.</span></div>';
      setTimeout(function () { if (seq === loadSeq) loadMain(); }, 20000);
    }
  }

  function connectMain(sym, tf) {
    var s = sym.toLowerCase();
    Data.stream('main', [s + '@kline_' + tf, s + '@depth20', s + '@aggTrade'], function (d, stream) {
      if (sym !== S.sym || tf !== S.tf) return;
      if (stream.indexOf('@kline') > 0) {
        var k = d.k, c = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
        var last = candles[candles.length - 1];
        if (last && last.time === c.time) candles[candles.length - 1] = c; else if (!last || c.time > last.time) candles.push(c);
        if (k.x) { // mum kapandı → sinyali yeniden hesapla
          analysis = Signals.analyze(candles.slice());
          renderSignal(); App.emit('analysis', analysis);
        }
        cv.update(c, analysis);
      } else if (stream.indexOf('@depth') > 0) renderBook(d);
      else if (stream.indexOf('@aggTrade') > 0) pushTrade(d);
    });
  }

  /* ================= Sinyal paneli ================= */
  function renderSignal() {
    var g = analysis, el = $('sigBody');
    if (!g) { el.innerHTML = '<div class="err mut">Yeterli veri yok (en az 62 kapanmış mum gerekli).</div>'; return; }
    var col = g.label === 'AL' ? 'var(--up)' : g.label === 'SAT' ? 'var(--down)' : 'var(--warn)';
    var sn = g.snap;
    var comps = g.components.slice().sort(function (a, b) { return Math.abs(b.w * b.v) - Math.abs(a.w * a.v); }).map(function (c) {
      var w = Math.abs(c.v) * 50, left = c.v >= 0 ? 50 : 50 - w;
      return '<div class="comp"><span>' + esc(c.name) + '</span><div class="bar2"><i style="left:' + left + '%;width:' + w + '%;background:' + (c.v >= 0 ? 'var(--up)' : 'var(--down)') + '"></i></div>' +
        '<span class="num ' + (c.v >= 0 ? 'up' : 'down') + '" title="ağırlık ' + c.w.toFixed(2) + '">' + (c.v >= 0 ? '+' : '') + (c.v * 100).toFixed(0) + '</span><span class="txt">' + esc(c.text) + '</span></div>';
    }).join('');
    var lv = function (arr, cls) { return arr.length ? arr.map(function (x) { return '<span class="pill ' + cls + '">' + fmt(x.price) + (x.touches > 1 ? ' ×' + x.touches : '') + '</span>'; }).join('') : '<span class="mut">—</span>'; };
    el.innerHTML =
      '<div class="sig-head"><span class="v" style="color:' + col + '">' + g.display + '</span><span class="mut num">Skor ' + (g.score > 0 ? '+' : '') + g.score + ' · Güven %' + g.confidence + ' · ' + S.tf + '</span></div>' +
      '<div class="gbar"><i style="left:' + (g.score + 100) / 2 + '%"></i></div><div class="gscale"><span>Güçlü sat</span><span>Nötr</span><span>Güçlü al</span></div>' +
      '<div class="sec"><span class="pill">Rejim: <b>' + esc(g.regime.name) + '</b></span>' + g.patterns.map(function (p) { return '<span class="pill ' + (p.dir > 0 ? 'up' : p.dir < 0 ? 'down' : '') + '" title="' + esc(p.text) + '">' + esc(p.name) + '</span>'; }).join('') +
      '<div class="mut" style="font-size:11.5px;margin-top:4px">' + esc(g.regime.text) + '</div></div>' +
      '<div class="kv">' +
      '<div><small>RSI(14)</small><span>' + fmt(sn.rsi, 1) + '</span></div>' +
      '<div><small>MACD hist.</small><span class="' + (sn.macdHist >= 0 ? 'up' : 'down') + '">' + (+sn.macdHist).toPrecision(3) + '</span></div>' +
      '<div><small>ADX(14)</small><span>' + fmt(sn.adx, 1) + '</span></div>' +
      '<div><small>Stoch %K/%D</small><span>' + fmt(sn.stochK, 0) + ' / ' + fmt(sn.stochD, 0) + '</span></div>' +
      '<div><small>Bollinger %B</small><span>' + fmt(sn.pctB, 2) + '</span></div>' +
      '<div><small>ATR / fiyat</small><span>%' + fmt(sn.atrPct, 2) + '</span></div>' +
      '<div><small>EMA20/50</small><span>' + fmt(sn.ema20) + ' / ' + fmt(sn.ema50) + '</span></div>' +
      '<div><small>Hacim / ort.</small><span>' + (sn.volRatio ? sn.volRatio.toFixed(2) + '×' : '–') + '</span></div>' +
      '</div>' +
      (g.side ? '<div class="kv">' +
        '<div><small>Senaryo</small><span class="' + (g.side === 'long' ? 'up' : 'down') + '">' + (g.side === 'long' ? 'Uzun (long)' : 'Kısa (short)') + '</span></div>' +
        '<div><small>Giriş (son kapanış)</small><span>' + fmt(g.price) + '</span></div>' +
        '<div><small>Stop (1.5×ATR)</small><span class="down">' + fmt(g.stop) + '</span></div>' +
        '<div><small>Hedef (3×ATR)</small><span class="up">' + fmt(g.target) + '</span></div>' +
        '<div><small>Risk/Ödül</small><span>1 : ' + g.rr.toFixed(1) + '</span></div></div>'
        : '<div class="note">Skor AL/SAT eşiklerinin (±30) içinde: işlem senaryosu üretilmedi.</div>') +
      '<div class="sec"><h3>Destek</h3>' + lv(g.supports, 'up') + '<h3 style="margin-top:6px">Direnç</h3>' + lv(g.resistances, 'down') + '</div>' +
      '<div class="sec"><h3>Gerekçe (ağırlıklı katkı sırasıyla)</h3></div>' + comps +
      '<div class="note">Sinyal son <b>kapanmış</b> mum üzerinden hesaplanır (' + new Date(g.time * 1000).toLocaleString('tr-TR') + ' açılışlı mum). Kural tabanlı teknik analizdir; yatırım tavsiyesi değildir.</div>';
  }

  /* ================= MTF ================= */
  var MTF_TFS = ['15m', '1h', '4h', '1d'], mtfSeq = 0;
  async function loadMTF(sym) {
    var seq = ++mtfSeq, by = {};
    await Promise.all(MTF_TFS.map(async function (tf) {
      try { var cs = await Data.klines(sym, tf, 300, 50000); by[tf] = Signals.analyze(cs.slice(0, -1)); } catch (e) { by[tf] = null; }
    }));
    if (seq !== mtfSeq || sym !== S.sym) return;
    var m = Signals.combineMTF(by);
    App.mtf = { sym: sym, by: by, combined: m };
    $('mtfBody').innerHTML = '<table class="t"><thead><tr><th>Zaman</th><th>Sinyal</th><th>Skor</th><th>Güven</th><th>RSI</th><th>Trend</th><th>Rejim</th></tr></thead><tbody>' +
      MTF_TFS.map(function (tf) {
        var g = by[tf]; if (!g) return '<tr><td>' + tf + '</td><td colspan="6" class="mut">veri yok</td></tr>';
        return '<tr><td><b>' + tf + '</b></td><td><span class="badge b-' + g.label + '">' + g.label + '</span></td><td class="' + (g.score >= 0 ? 'up' : 'down') + '">' + (g.score > 0 ? '+' : '') + g.score +
          '</td><td>%' + g.confidence + '</td><td>' + fmt(g.snap.rsi, 0) + '</td><td>' + (g.snap.ema20 > g.snap.ema50 ? '<span class="up">▲</span>' : '<span class="down">▼</span>') + '</td><td>' + esc(g.regime.name) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      (m ? '<div class="sig-head"><span class="v" style="font-size:20px;color:' + (m.label === 'AL' ? 'var(--up)' : m.label === 'SAT' ? 'var(--down)' : 'var(--warn)') + '">' + m.label + '</span><span class="mut">Birleşik skor ' + (m.score > 0 ? '+' : '') + m.score + ' · uyum ' + m.aligned + '/' + m.total + '</span></div><div class="note">' + esc(m.text) + '. Ağırlıklar: 15m %15, 1h %25, 4h %30, 1d %30.</div>' : '');
    App.emit('mtf', App.mtf);
  }

  /* ================= Emir defteri / işlemler / özet ================= */
  var bookMid = null;
  function renderBook(d) {
    var asks = (d.asks || []).slice(0, 10).map(function (x) { return [+x[0], +x[1]]; }).reverse(), bids = (d.bids || []).slice(0, 10).map(function (x) { return [+x[0], +x[1]]; });
    if (!asks.length || !bids.length) return;
    var mx = Math.max.apply(null, asks.concat(bids).map(function (x) { return x[1]; }));
    var row = function (p, q, side) { return '<div class="r"><div class="fill" style="background:var(--' + side + ');width:' + (q / mx * 100) + '%"></div><span class="' + side + '">' + fmt(p) + '</span><span>' + fmt(q, 4) + '</span><span>' + U.fmtBig(p * q) + '</span></div>'; };
    var bestA = asks[asks.length - 1][0], bestB = bids[0][0]; bookMid = { a: bestA, b: bestB };
    var bv = bids.reduce(function (s, x) { return s + x[1]; }, 0), av = asks.reduce(function (s, x) { return s + x[1]; }, 0);
    $('book').innerHTML = '<div class="r mut"><span>Fiyat</span><span>Miktar</span><span>USDT</span></div>' + asks.map(function (a) { return row(a[0], a[1], 'down'); }).join('') +
      '<div class="mid num">' + fmt((bestA + bestB) / 2) + ' <span class="mut" style="font-weight:400">· spread ' + fmt(bestA - bestB) + ' (%' + ((bestA - bestB) / bestB * 100).toFixed(3) + ') · alış/satış hacmi ' + (bv / (av + bv) * 100).toFixed(0) + '/' + (av / (av + bv) * 100).toFixed(0) + '</span></div>' +
      bids.map(function (b) { return row(b[0], b[1], 'up'); }).join('');
  }
  var tbuf = [], tlast = 0;
  function pushTrade(t) {
    tbuf.unshift({ p: +t.p, q: +t.q, buy: !t.m, time: t.T }); if (tbuf.length > 60) tbuf.pop();
    if (Date.now() - tlast < 300) return; tlast = Date.now();
    $('trades').innerHTML = '<div class="r mut"><span>Fiyat</span><span>Miktar</span><span>Saat</span></div>' + tbuf.map(function (x) {
      return '<div class="r"><span class="' + (x.buy ? 'up' : 'down') + '">' + fmt(x.p) + '</span><span>' + fmt(x.q, 5) + '</span><span class="mut">' + new Date(x.time).toLocaleTimeString('tr-TR') + '</span></div>';
    }).join('');
  }
  function renderStats() {
    var t = App.tick[S.sym]; if (!t) return;
    var rows = [['Son fiyat', fmt(t.price)], ['24s değişim', '<span class="' + (t.chg >= 0 ? 'up' : 'down') + '">' + U.pct(t.chg) + '</span>'], ['24s yüksek', fmt(t.high)], ['24s düşük', fmt(t.low)],
      ['24s aralık', '%' + ((t.high - t.low) / t.low * 100).toFixed(2)], ['24s hacim (USDT)', U.fmtBig(t.qvol)], ['24s hacim (' + App.base(S.sym) + ')', U.fmtBig(t.vol)], ['24s açılış', fmt(t.open)]];
    if (bookMid) rows.push(['Spread', fmt(bookMid.a - bookMid.b)]);
    $('stats').innerHTML = '<table class="t">' + rows.map(function (r) { return '<tr><td class="mut">' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</table>';
  }

  /* ================= Risk hesaplayıcı ================= */
  function initRisk() {
    var ids = ['rkBal', 'rkPct', 'rkEntry', 'rkStop', 'rkTgt'], saved = App.store('risk') || {};
    ids.forEach(function (id) { if (saved[id] != null) $(id).value = saved[id]; $(id).addEventListener('input', calcRisk); });
    $('rkFill').onclick = function () {
      if (!analysis) return;
      var a = analysis, dir = a.side === 'short' ? -1 : 1, px = App.price(S.sym) || a.price;
      $('rkEntry').value = +px.toPrecision(6);
      $('rkStop').value = +(px - dir * 1.5 * a.snap.atr).toPrecision(6);
      $('rkTgt').value = +(px + dir * 3 * a.snap.atr).toPrecision(6);
      calcRisk();
    };
    calcRisk();
  }
  function calcRisk() {
    var o = {}; ['rkBal', 'rkPct', 'rkEntry', 'rkStop', 'rkTgt'].forEach(function (id) { o[id] = $(id).value; });
    App.store('risk', o);
    var r = U.positionSize({ balance: o.rkBal, riskPct: o.rkPct, entry: o.rkEntry, stop: o.rkStop, target: o.rkTgt });
    if (r.error) { $('rkOut').innerHTML = '<div class="mut" style="grid-column:1/-1">' + esc(r.error) + '</div>'; return; }
    var c = function (k, v, cls) { return '<div class="card"><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    $('rkOut').innerHTML = c('Yön', r.side === 'long' ? 'Long' : 'Short', r.side === 'long' ? 'up' : 'down') + c('Risk tutarı', fmt(r.riskAmt, 2) + ' $') + c('Pozisyon miktarı', fmt(r.qty, 6)) +
      c('Pozisyon değeri', fmt(r.notional, 2) + ' $') + c('Stop mesafesi', '%' + r.stopPct.toFixed(2)) + c('Efektif kaldıraç', r.leverage.toFixed(2) + '×', r.leverage > 3 ? 'warn' : '') +
      (r.rr != null ? c('Risk/Ödül', '1 : ' + r.rr.toFixed(2), r.rr >= 2 ? 'up' : r.rr < 1 ? 'down' : '') + c('Potansiyel kazanç', fmt(r.reward, 2) + ' $', 'up') : '');
  }

  /* ================= 2×2 çoklu grafik ================= */
  var grid = null;
  function initGrid() {
    if (grid) return;
    var cfg = App.store('grid') || [{ s: 'BTCUSDT', tf: '1h' }, { s: 'ETHUSDT', tf: '1h' }, { s: 'SOLUSDT', tf: '15m' }, { s: 'BNBUSDT', tf: '4h' }];
    grid = cfg.map(function (c, i) {
      var p = document.createElement('section'); p.className = 'panel';
      p.innerHTML = '<div class="ph" style="cursor:default"><select class="inp gs" style="padding:1px 4px"></select><select class="inp gt" style="padding:1px 4px">' +
        App.TFS.map(function (t) { return '<option>' + t + '</option>'; }).join('') + '</select><span class="sp"></span><span class="num gp"></span><span class="num gc"></span></div><div class="cell-body"></div>';
      $('grid4').appendChild(p);
      var cell = { cfg: c, el: p, cs: [], cv: new ChartView(p.querySelector('.cell-body'), { ind: { ema20: 1, ema50: 1, vol: 1 }, sym: c.s, tf: c.tf }) };
      App.fillSymbolSelect(p.querySelector('.gs'), c.s); p.querySelector('.gt').value = c.tf;
      p.querySelector('.gs').onchange = function () { c.s = this.value; App.store('grid', cfg); loadCell(cell); connectGrid(); };
      p.querySelector('.gt').onchange = function () { c.tf = this.value; App.store('grid', cfg); loadCell(cell); connectGrid(); };
      loadCell(cell);
      return cell;
    });
    App.on('theme', function () { grid.forEach(function (c) { c.cv.applyTheme(); }); });
    App.on('tick', function () { grid.forEach(paintCell); });
  }
  function paintCell(cell) {
    var t = App.tick[cell.cfg.s]; if (!t) return;
    cell.el.querySelector('.gp').textContent = fmt(t.price);
    var gc = cell.el.querySelector('.gc'); gc.textContent = ' ' + U.pct(t.chg); gc.className = 'num gc ' + (t.chg >= 0 ? 'up' : 'down');
  }
  async function loadCell(cell) {
    var c = cell.cfg, key = c.s + c.tf; cell.key = key; cell.cv.setSymbol(c.s, c.tf);
    try { var cs = await Data.klines(c.s, c.tf, 500, 0); if (cell.key !== key) return; cell.cs = cs; cell.cv.setData(cs, null); paintCell(cell); }
    catch (e) { App.toast('Grafik yüklenemedi: ' + App.pretty(c.s) + ' — ' + e.message, 'bad'); }
  }
  function connectGrid() {
    if (!grid) return;
    var streams = grid.map(function (c) { return c.cfg.s.toLowerCase() + '@kline_' + c.cfg.tf; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    Data.stream('grid', streams, function (d, stream) {
      var k = d.k; if (!k) return;
      var c = { time: Math.floor(k.t / 1000), open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v };
      grid.forEach(function (cell) { if (cell.cfg.s === d.s && cell.cfg.tf === k.i && cell.cs.length) cell.cv.update(c); });
    });
  }
  App.on('view', function (v) {
    if (v === 'grid') { initGrid(); connectGrid(); }
    else Data.closeStream('grid');
  });

  App.dashboard = {
    init: function () { initLayout(); initWatch(); initChart(); initRisk(); renderWatch(true); loadMain(); setInterval(function () { loadMTF(S.sym); }, 60000); },
    analysis: function () { return analysis; }, candles: function () { return candles; }, renderWatch: renderWatch,
    chart: function () { return cv; }
  };
})(typeof self !== 'undefined' ? self : this);
