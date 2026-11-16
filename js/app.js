/* =====================================================================
 * app.js — Uygulama çekirdeği: durum, kalıcılık, olay yolu, sekmeler,
 * tema, bildirim/ses, bağlantı göstergesi, canlı ticker akışı ve
 * izleme listesi sinyal taraması. Diğer app-*.js dosyaları bunu kullanır.
 * window.App
 * ===================================================================== */
(function (root) {
  'use strict';
  var U = root.Util, Data = root.Data, Signals = root.Signals;

  var SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT', 'TRXUSDT', 'LINKUSDT',
    'DOTUSDT', 'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT', 'ETCUSDT', 'APTUSDT', 'ARBUSDT',
    'OPUSDT', 'FILUSDT', 'INJUSDT', 'SUIUSDT', 'SEIUSDT', 'TIAUSDT', 'AAVEUSDT', 'HBARUSDT', 'ICPUSDT', 'RENDERUSDT',
    'PEPEUSDT', 'SHIBUSDT', 'TONUSDT', 'WIFUSDT', 'FETUSDT', 'ALGOUSDT', 'VETUSDT', 'TAOUSDT', 'ENAUSDT', 'PENDLEUSDT'];
  var TFS = ['1m', '5m', '15m', '1h', '4h', '1d'];

  /* ---------- Kalıcılık (localStorage, her erişim try/catch) ---------- */
  var PFX = 'atb.';
  function store(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem(PFX + k); return s == null ? null : JSON.parse(s); }
      if (v === null) localStorage.removeItem(PFX + k); else localStorage.setItem(PFX + k, JSON.stringify(v));
    } catch (e) { return null; }
  }

  var DEF = { sym: 'BTCUSDT', tf: '1h', chartType: 'candle', scanTf: '1h', favs: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'], sort: { k: 'qvol', d: -1 },
    ind: { ema20: 1, ema50: 1, vol: 1, sr: 1, pat: 1, rsi: 1, macd: 1 }, theme: null, sound: true };
  var S = Object.assign({}, DEF, store('settings') || {});
  function save() { store('settings', S); }

  /* ---------- Olay yolu ---------- */
  var subs = {};
  function on(e, f) { (subs[e] = subs[e] || []).push(f); }
  function emit(e, d) { (subs[e] || []).forEach(function (f) { try { f(d); } catch (err) { console.error('[' + e + ']', err); } }); }

  var $ = function (id) { return document.getElementById(id); };
  var pretty = function (s) { return s.replace(/USDT$/, '') + '/USDT'; };
  var base = function (s) { return s.replace(/USDT$/, ''); };

  /* ---------- Toast / ses / bildirim ---------- */
  function toast(msg, kind, ms) {
    var d = document.createElement('div'); d.className = 'toast ' + (kind || ''); d.textContent = msg;
    $('toasts').appendChild(d); setTimeout(function () { d.remove(); }, ms || 5000);
  }
  var actx = null;
  function unlockAudio() { try { if (!actx) actx = new (root.AudioContext || root.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (e) {} }
  document.addEventListener('pointerdown', unlockAudio, { once: false, passive: true });
  function beep() {
    if (!S.sound) return;
    try {
      unlockAudio(); if (!actx) return;
      [0, 0.18].forEach(function (t, i) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = i ? 1046 : 784;
        g.gain.setValueAtTime(0.0001, actx.currentTime + t); g.gain.exponentialRampToValueAtTime(0.25, actx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + 0.16);
        o.connect(g); g.connect(actx.destination); o.start(actx.currentTime + t); o.stop(actx.currentTime + t + 0.18);
      });
    } catch (e) {}
  }
  function notify(title, body) {
    try { if (root.Notification && Notification.permission === 'granted') new Notification(title, { body: body }); } catch (e) {}
  }

  /* ---------- Tema ---------- */
  function applyTheme() {
    var t = S.theme || (root.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.setAttribute('data-theme', t);
    emit('theme', t);
  }

  /* ---------- Sekmeler ---------- */
  var view = 'dash';
  function setView(v) {
    view = v;
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
    document.querySelectorAll('main>.view').forEach(function (s) { s.classList.toggle('on', s.id === 'v-' + v); });
    store('view', v); emit('view', v);
  }

  /* ---------- Bağlantı göstergesi ---------- */
  function renderConn(s) {
    var dr = $('dRest'); dr.className = 'dot ' + (s.rest === true ? (s.throttled ? 'wait' : 'ok') : s.rest === false ? 'bad' : 'wait');
    $('tRest').textContent = s.rest === false ? 'hata' : s.throttled ? 'yavaşlatıldı' : '';
    $('dRest').parentNode.title = 'REST: ' + s.restHost + (s.lastErr ? ' — ' + s.lastErr : '') + (s.queue ? ' · kuyruk ' + s.queue : '');
    var states = Object.keys(s.ws).map(function (k) { return s.ws[k]; });
    var allOpen = states.length && states.every(function (x) { return x === 'open'; });
    var anyBad = states.some(function (x) { return x === 'reconnecting'; });
    $('dWs').className = 'dot ' + (allOpen ? 'ok' : anyBad ? 'bad' : 'wait');
    $('dWs').parentNode.title = 'WebSocket: ' + Object.keys(s.ws).map(function (k) { return k + '=' + s.ws[k]; }).join(', ');
    $('tWeight').textContent = 'ağırlık ' + s.weight + '/' + s.limit;
  }

  /* ---------- Canlı ticker ---------- */
  var tick = {};          // sym → {price, open, high, low, vol, qvol, chg}
  var pendingTick = {};
  function applyTick(s, o) {
    if (SYMBOLS.indexOf(s) < 0) return;
    var prev = tick[s];
    tick[s] = o; o.dir = prev ? (o.price > prev.price ? 1 : o.price < prev.price ? -1 : 0) : 0;
    pendingTick[s] = 1;
  }
  async function loadTickersREST() {
    var arr = await Data.get('/api/v3/ticker/24hr?symbols=' + encodeURIComponent(JSON.stringify(SYMBOLS)));
    arr.forEach(function (t) { applyTick(t.symbol, { price: +t.lastPrice, open: +t.openPrice, high: +t.highPrice, low: +t.lowPrice, vol: +t.volume, qvol: +t.quoteVolume, chg: +t.priceChangePercent }); });
    flushTick();
  }
  function flushTick() { var k = Object.keys(pendingTick); if (!k.length) return; pendingTick = {}; emit('tick', k); }
  function startTicker() {
    Data.stream('ticker', ['!miniTicker@arr'], function (arr) {
      if (!Array.isArray(arr)) return;
      arr.forEach(function (t) { var c = +t.c, o = +t.o; applyTick(t.s, { price: c, open: o, high: +t.h, low: +t.l, vol: +t.v, qvol: +t.q, chg: o ? (c - o) / o * 100 : 0 }); });
    });
    setInterval(flushTick, 500);
    // WS kapalıysa REST ile yokla (yedek)
    setInterval(function () { var s = Data.status(); if (s.ws.ticker !== 'open') loadTickersREST().catch(function () {}); }, 15000);
  }

  /* ---------- İzleme listesi sinyal taraması ---------- */
  var sig = {};           // sym → {g, closes, volRatio, spark, tf, t}
  var scanning = false;
  async function refreshSigs() {
    if (scanning) return; scanning = true;
    var tf = S.scanTf, done = 0;
    await Promise.all(SYMBOLS.map(async function (s) {
      try {
        var cs = await Data.klines(s, tf, 300, 45000);
        var closed = cs.slice(0, -1);   // tarayıcı: sadece KAPANMIŞ mumlar
        var g = Signals.analyze(closed);
        var last = closed[closed.length - 1], vsum = 0;
        for (var i = closed.length - 21; i < closed.length - 1; i++) vsum += closed[i].volume;
        sig[s] = { g: g, tf: tf, closes: closed.map(function (c) { return c.close; }), volRatio: last.volume / (vsum / 20), lastClosed: last,
          spark: cs.slice(-30).map(function (c) { return c.close; }), t: Date.now() };
      } catch (e) { /* sembol atlanır, sonraki turda tekrar */ }
      if (++done % 10 === 0) emit('sigs', tf);
    }));
    scanning = false; emit('sigs', tf);
  }

  /* ---------- Yardımcı: dropdown menüler ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-dd]');
    document.querySelectorAll('.dd.open').forEach(function (d) { if (!d.contains(e.target) || (t && d !== t.parentNode)) d.classList.remove('open'); });
    if (t) t.parentNode.classList.toggle('open');
  });

  function fillSymbolSelect(sel, value) {
    sel.innerHTML = SYMBOLS.map(function (s) { return '<option value="' + s + '">' + pretty(s) + '</option>'; }).join('');
    sel.value = value || S.sym;
  }

  function sparkSVG(vals, w, h) {
    if (!vals || vals.length < 2) return '';
    w = w || 80; h = h || 22;
    var mn = Math.min.apply(null, vals), mx = Math.max.apply(null, vals), r = mx - mn || 1;
    var pts = vals.map(function (v, i) { return (i / (vals.length - 1) * w).toFixed(1) + ',' + (h - 2 - (v - mn) / r * (h - 4)).toFixed(1); }).join(' ');
    var col = vals[vals.length - 1] >= vals[0] ? 'var(--up)' : 'var(--down)';
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline fill="none" stroke="' + col + '" stroke-width="1.4" points="' + pts + '"/></svg>';
  }

  function setSymbol(s, tf) {
    if (SYMBOLS.indexOf(s) < 0) return;
    var changed = s !== S.sym || (tf && tf !== S.tf);
    S.sym = s; if (tf) S.tf = tf; save();
    if (changed) emit('symbol', { sym: S.sym, tf: S.tf });
  }

  root.App = {
    SYMBOLS: SYMBOLS, TFS: TFS, S: S, save: save, store: store, on: on, emit: emit, $: $, pretty: pretty, base: base,
    toast: toast, beep: beep, notify: notify, applyTheme: applyTheme, setView: setView, view: function () { return view; },
    tick: tick, sig: sig, refreshSigs: refreshSigs, startTicker: startTicker, loadTickersREST: loadTickersREST,
    renderConn: renderConn, fillSymbolSelect: fillSymbolSelect, sparkSVG: sparkSVG, setSymbol: setSymbol,
    price: function (s) { return tick[s] ? tick[s].price : null; }
  };
})(typeof self !== 'undefined' ? self : this);
