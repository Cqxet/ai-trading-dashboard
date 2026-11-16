/* =====================================================================
 * data.js — Ağ katmanı (yalnızca HERKESE AÇIK, anahtarsız uç noktalar).
 *  - REST: data-api.binance.vision → api.binance.com yedeği
 *  - Eşzamanlılık sınırı + yerel ağırlık (weight) tahmini ile rate-limit
 *    farkındalığı (Binance weight başlıkları CORS ile açılmadığı için
 *    tarayıcı okuyamaz; bu yüzden istek ağırlıkları yerelde sayılır).
 *  - 429/418 → Retry-After kadar geri çekilme.
 *  - WebSocket: otomatik yeniden bağlanma (üstel bekleme), uç nokta
 *    rotasyonu, 30 sn sessizlikte bağlantı yenileme.
 * window.Data
 * ===================================================================== */
(function (root) {
  'use strict';
  var REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
  var WS = ['wss://data-stream.binance.vision', 'wss://stream.binance.com:9443'];
  var WEIGHT_LIMIT = 6000, SOFT_LIMIT = 4000, MAX_CONC = 4;

  var st = { restIdx: 0, inflight: 0, queue: [], log: [], backoffUntil: 0, restOk: null, lastErr: null, listeners: [], sockets: {} };

  function emit() { var s = status(); st.listeners.forEach(function (f) { try { f(s); } catch (e) {} }); }
  function onStatus(f) { st.listeners.push(f); f(status()); }
  function usedWeight() { var now = Date.now(); st.log = st.log.filter(function (x) { return now - x.t < 60000; }); return st.log.reduce(function (a, x) { return a + x.w; }, 0); }
  function status() {
    var ws = {}; Object.keys(st.sockets).forEach(function (k) { ws[k] = st.sockets[k].state; });
    return { rest: st.restOk, restHost: REST[st.restIdx].replace('https://', ''), weight: usedWeight(), limit: WEIGHT_LIMIT,
      throttled: Date.now() < st.backoffUntil || usedWeight() > SOFT_LIMIT, ws: ws, lastErr: st.lastErr, queue: st.queue.length };
  }

  /** Binance REST ağırlık tahmini (resmi tabloya göre yaklaşık). */
  function weightOf(path) {
    if (path.indexOf('/klines') >= 0) { var m = /limit=(\d+)/.exec(path), l = m ? +m[1] : 500; return l < 100 ? 1 : l < 500 ? 2 : l < 1000 ? 5 : 10; }
    if (path.indexOf('/ticker/24hr') >= 0) { if (path.indexOf('symbols=') >= 0) { var n = (decodeURIComponent(path).match(/USDT/g) || []).length; return n <= 20 ? 2 : n <= 100 ? 40 : 80; } return path.indexOf('symbol=') >= 0 ? 2 : 80; }
    if (path.indexOf('/depth') >= 0) return 5;
    return 2;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function pump() {
    while (st.inflight < MAX_CONC && st.queue.length) {
      var job = st.queue.shift(); st.inflight++;
      run(job).then(job.res, job.rej).then(function () { st.inflight--; pump(); emit(); });
    }
  }

  async function fetchT(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var to = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    try { return await fetch(url, ctl ? { signal: ctl.signal } : {}); } finally { clearTimeout(to); }
  }

  async function run(job) {
    var w = weightOf(job.path);
    // rate limit bekleme
    for (var g = 0; g < 120; g++) {
      var wait = st.backoffUntil - Date.now();
      if (wait > 0) { await sleep(Math.min(wait, 5000)); continue; }
      if (usedWeight() + w > SOFT_LIMIT) { emit(); await sleep(1000); continue; }
      break;
    }
    st.log.push({ t: Date.now(), w: w });
    var err;
    for (var k = 0; k < REST.length; k++) {
      var idx = (st.restIdx + k) % REST.length;
      try {
        var r = await fetchT(REST[idx] + job.path, 12000);
        if (r.status === 429 || r.status === 418) {
          var ra = +(r.headers.get('Retry-After') || 60);
          st.backoffUntil = Date.now() + ra * 1000; st.lastErr = 'Rate limit (' + r.status + '), ' + ra + ' sn bekleniyor'; emit();
          throw new Error(st.lastErr);
        }
        if (!r.ok) { var body = ''; try { body = (await r.json()).msg || ''; } catch (e) {} throw new Error('HTTP ' + r.status + (body ? ': ' + body : '')); }
        var j = await r.json();
        st.restIdx = idx; st.restOk = true; st.lastErr = null;
        return j;
      } catch (e) {
        err = e;
        if (/HTTP 4\d\d/.test(e.message) && !/HTTP 403|HTTP 451/.test(e.message)) break; // istemci hatası → yedeğe geçmenin anlamı yok
      }
    }
    st.restOk = false; st.lastErr = (err && err.message) || 'Ağ hatası'; emit();
    throw err || new Error('Ağ hatası');
  }

  /** Kuyruklu, yedekli Binance GET. path: '/api/v3/...' */
  function get(path) { return new Promise(function (res, rej) { st.queue.push({ path: path, res: res, rej: rej }); pump(); emit(); }); }

  var kcache = {};
  function parseK(k) { return { time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], qvol: +k[7] }; }
  /** Mum verisi (kısa süreli önbellek). */
  async function klines(sym, tf, limit, ttlMs) {
    var key = sym + '|' + tf + '|' + limit, c = kcache[key];
    if (c && Date.now() - c.t < (ttlMs == null ? 20000 : ttlMs)) return c.v;
    var v = (await get('/api/v3/klines?symbol=' + sym + '&interval=' + tf + '&limit=' + limit)).map(parseK);
    kcache[key] = { t: Date.now(), v: v };
    return v;
  }

  /** Harici (Binance dışı) JSON — CoinGecko / alternative.me. */
  async function external(url, ms) {
    var r = await fetchT(url, ms || 12000);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  /* ---------------- WebSocket yöneticisi ---------------- */
  /**
   * stream(name, streams[], onMsg) → {close(), set(streams)}
   * Aynı isimle yeniden çağrılırsa eski bağlantı kapatılır.
   */
  function stream(name, streams, onMsg) {
    if (st.sockets[name]) st.sockets[name].close();
    var h = { state: 'connecting', streams: streams.slice(), ws: null, tries: 0, closed: false, lastMsg: 0, wsIdx: st.restIdx % WS.length, timer: null, watchdog: null };
    function url() {
      var base = WS[h.wsIdx];
      return h.streams.length === 1 && h.streams[0].charAt(0) === '!' ? base + '/ws/' + h.streams[0] : base + '/stream?streams=' + h.streams.join('/');
    }
    function connect() {
      if (h.closed || !h.streams.length) return;
      h.state = 'connecting'; emit();
      var ws;
      try { ws = new WebSocket(url()); } catch (e) { schedule(); return; }
      h.ws = ws;
      ws.onopen = function () { h.state = 'open'; h.tries = 0; h.lastMsg = Date.now(); emit(); };
      ws.onmessage = function (ev) {
        h.lastMsg = Date.now();
        var d; try { d = JSON.parse(ev.data); } catch (e) { return; }
        if (d && d.stream && d.data) onMsg(d.data, d.stream); else onMsg(d, h.streams[0]);
      };
      ws.onerror = function () { /* onclose ardından gelir */ };
      ws.onclose = function () { if (h.ws !== ws) return; h.state = h.closed ? 'closed' : 'reconnecting'; emit(); schedule(); };
    }
    function schedule() {
      if (h.closed) return;
      h.tries++;
      if (h.tries % 2 === 0) h.wsIdx = (h.wsIdx + 1) % WS.length; // iki başarısız denemede bir uç nokta değiştir
      var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(h.tries, 5))) + Math.random() * 500;
      clearTimeout(h.timer); h.timer = setTimeout(connect, delay);
    }
    h.watchdog = setInterval(function () {
      if (h.state === 'open' && Date.now() - h.lastMsg > 30000) { try { h.ws.close(); } catch (e) {} }
    }, 10000);
    h.close = function () { h.closed = true; h.state = 'closed'; clearTimeout(h.timer); clearInterval(h.watchdog); if (h.ws) { var w = h.ws; h.ws = null; try { w.close(); } catch (e) {} } delete st.sockets[name]; emit(); };
    h.set = function (s) { h.streams = s.slice(); h.tries = 0; if (h.ws) { var w = h.ws; h.ws = null; try { w.close(); } catch (e) {} } clearTimeout(h.timer); connect(); };
    st.sockets[name] = h;
    connect();
    return h;
  }

  function closeStream(name) { if (st.sockets[name]) st.sockets[name].close(); }

  root.Data = { get: get, klines: klines, external: external, stream: stream, closeStream: closeStream, onStatus: onStatus, status: status, parseK: parseK, REST: REST, WS: WS };
})(typeof self !== 'undefined' ? self : this);
