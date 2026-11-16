/* =====================================================================
 * charts.js — lightweight-charts@4.1.3 üzerine grafik bileşeni.
 *  - Mum / çizgi / Heikin-Ashi
 *  - Üst katman göstergeler: EMA20/50/200, SMA20, Bollinger, VWAP,
 *    Supertrend, hacim, destek/direnç + sinyal seviyeleri, formasyon işaretleri
 *  - Alt paneller (ayrı grafikler, zaman ekseni senkron): RSI, MACD,
 *    Stokastik, ATR, OBV
 *  - Çizim: yatay çizgi, trend çizgisi (sembol bazında localStorage'da)
 * window.ChartView
 * ===================================================================== */
(function (root) {
  'use strict';
  var TA = root.TA, Signals = root.Signals;

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function themeOpts() {
    return {
      layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut'), fontSize: 11 },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } },
      rightPriceScale: { borderColor: cssVar('--line') }, timeScale: { borderColor: cssVar('--line') }
    };
  }
  function precision(p) { p = Math.abs(p || 0); return p >= 1000 ? 2 : p >= 10 ? 3 : p >= 1 ? 4 : p >= 0.01 ? 5 : p >= 0.0001 ? 7 : 9; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || 'null'); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }

  var COLORS = { ema20: '#4f8cff', ema50: '#f5a524', ema200: '#c06bff', sma20: '#2ec4b6', vwap: '#ff6b9a', bb: '#8a94a8' };
  var PANES = { rsi: 'RSI(14)', macd: 'MACD(12,26,9)', stoch: 'Stokastik(14,3,3)', atr: 'ATR(14)', obv: 'OBV' };
  var LINE = { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };

  function ChartView(el, opts) {
    this.el = el;
    this.o = Object.assign({ type: 'candle', ind: { ema20: 1, ema50: 1, vol: 1 }, sym: 'BTCUSDT', tf: '1h', onDrawDone: null }, opts || {});
    el.classList.add('cv');
    el.innerHTML = '<div class="cv-main"><div class="cv-legend"></div><div class="cv-hint"></div></div><div class="cv-panes"></div>';
    this.mainEl = el.querySelector('.cv-main'); this.panesEl = el.querySelector('.cv-panes');
    this.legendEl = el.querySelector('.cv-legend'); this.hintEl = el.querySelector('.cv-hint');
    this.chart = LightweightCharts.createChart(this.mainEl, Object.assign({
      autoSize: true, crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 6 },
      localization: { locale: 'tr-TR' }, rightPriceScale: { minimumWidth: 78 }
    }, themeOpts()));
    this.ov = {}; this.panes = {}; this.lines = []; this.trend = []; this.drawMode = null; this.pending = null;
    this.candles = []; this.analysis = null; this._sync = false;
    this._createMain();
    var self = this;
    this.chart.subscribeClick(function (p) { self._click(p); });
    this.chart.subscribeCrosshairMove(function (p) { self._legend(p); });
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(function (r) { self._syncRange(r, self.chart); });
  }

  ChartView.prototype._createMain = function () {
    if (this.main) { try { this.chart.removeSeries(this.main); } catch (e) {} }
    this.lines = [];
    var up = cssVar('--up'), dn = cssVar('--down');
    this.main = this.o.type === 'line'
      ? this.chart.addLineSeries({ color: cssVar('--acc'), lineWidth: 2 })
      : this.chart.addCandlestickSeries({ upColor: up, downColor: dn, borderVisible: false, wickUpColor: up, wickDownColor: dn });
  };

  ChartView.prototype.setType = function (t) { if (t === this.o.type) return; this.o.type = t; this._createMain(); this.render(true); };
  ChartView.prototype.setInd = function (ind) { this.o.ind = Object.assign({}, ind); this.render(true); };
  ChartView.prototype.setSymbol = function (sym, tf) { this.o.sym = sym; this.o.tf = tf; this.pending = null; };

  ChartView.prototype._mainData = function () {
    var cs = this.candles;
    if (this.o.type === 'line') return cs.map(function (c) { return { time: c.time, value: c.close }; });
    if (this.o.type === 'ha') return TA.heikinAshi(cs);
    return cs.map(function (c) { return { time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }; });
  };

  /** Tüm veriyi ver (sembol / zaman dilimi değişimi). */
  ChartView.prototype.setData = function (candles, analysis) {
    this.candles = candles.slice(); this.analysis = analysis || null;
    this.render(true);
    var n = candles.length;
    this.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 160), to: n + 6 });
  };

  /** Canlı mum güncellemesi (WebSocket). Ağır gösterge hesapları kısıtlanır. */
  ChartView.prototype.update = function (c, analysis) {
    var cs = this.candles, last = cs[cs.length - 1];
    if (!last || c.time < last.time) return;
    if (last.time === c.time) cs[cs.length - 1] = c; else { cs.push(c); if (cs.length > 1500) cs.shift(); }
    if (analysis) this.analysis = analysis;
    if (this.o.type === 'ha') { var ha = TA.heikinAshi(cs.slice(-300)); this.main.update(ha[ha.length - 1]); }
    else if (this.o.type === 'line') this.main.update({ time: c.time, value: c.close });
    else this.main.update({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close });
    if (this.ov.vol) this.ov.vol.update({ time: c.time, value: c.volume, color: c.close >= c.open ? cssVar('--up') + '55' : cssVar('--down') + '55' });
    var now = Date.now();
    if (!this._lastFull || now - this._lastFull > 2500 || last.time !== c.time) { this._lastFull = now; this.render(false); }
  };

  ChartView.prototype.render = function (full) {
    var cs = this.candles; if (!cs.length) return;
    var p = precision(cs[cs.length - 1].close);
    this.main.applyOptions({ priceFormat: { type: 'price', precision: p, minMove: Math.pow(10, -p) } });
    if (full) this.main.setData(this._mainData());
    else if (this.o.type === 'ha') this.main.setData(this._mainData());
    this._overlays(); this._panes(); this._markers(); this._levels(); this._drawings();
  };

  function series(cs, arr) { return cs.map(function (c, i) { return arr[i] == null ? { time: c.time } : { time: c.time, value: arr[i] }; }); }

  ChartView.prototype._ovLine = function (key, color, data, extra) {
    if (!this.ov[key]) this.ov[key] = this.chart.addLineSeries(Object.assign({ color: color }, LINE, extra || {}));
    this.ov[key].setData(data);
  };
  ChartView.prototype._ovDrop = function (key) { if (this.ov[key]) { this.chart.removeSeries(this.ov[key]); delete this.ov[key]; } };

  ChartView.prototype._overlays = function () {
    var cs = this.candles, ind = this.o.ind, cl = cs.map(function (c) { return c.close; }), self = this;
    ['ema20', 'ema50', 'ema200'].forEach(function (k) {
      if (ind[k]) self._ovLine(k, COLORS[k], series(cs, TA.ema(cl, +k.slice(3)))); else self._ovDrop(k);
    });
    if (ind.sma20) this._ovLine('sma20', COLORS.sma20, series(cs, TA.sma(cl, 20)), { lineStyle: 1 }); else this._ovDrop('sma20');
    if (ind.bb) {
      var b = TA.bollinger(cl, 20, 2);
      this._ovLine('bbU', COLORS.bb, series(cs, b.map(function (x) { return x && x.upper; })), { lineStyle: 2 });
      this._ovLine('bbM', COLORS.bb, series(cs, b.map(function (x) { return x && x.mid; })), { lineStyle: 3 });
      this._ovLine('bbL', COLORS.bb, series(cs, b.map(function (x) { return x && x.lower; })), { lineStyle: 2 });
    } else { this._ovDrop('bbU'); this._ovDrop('bbM'); this._ovDrop('bbL'); }
    if (ind.vwap) this._ovLine('vwap', COLORS.vwap, series(cs, TA.vwap(cs)), { lineWidth: 2 }); else this._ovDrop('vwap');
    if (ind.st) {
      var st = TA.supertrend(cs, 10, 3);
      this._ovLine('stU', cssVar('--up'), series(cs, st.value.map(function (v, i) { return st.dir[i] === 1 ? v : null; })), { lineWidth: 2 });
      this._ovLine('stD', cssVar('--down'), series(cs, st.value.map(function (v, i) { return st.dir[i] === -1 ? v : null; })), { lineWidth: 2 });
    } else { this._ovDrop('stU'); this._ovDrop('stD'); }
    if (ind.vol) {
      if (!this.ov.vol) {
        this.ov.vol = this.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol', priceLineVisible: false, lastValueVisible: false });
        this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      }
      var u = cssVar('--up') + '55', d = cssVar('--down') + '55';
      this.ov.vol.setData(cs.map(function (c) { return { time: c.time, value: c.volume, color: c.close >= c.open ? u : d }; }));
    } else this._ovDrop('vol');
  };

  ChartView.prototype._pane = function (key) {
    if (this.panes[key]) return this.panes[key];
    var div = document.createElement('div'); div.className = 'cv-pane';
    div.innerHTML = '<span class="cv-pane-t">' + PANES[key] + '</span>';
    this.panesEl.appendChild(div);
    var ch = LightweightCharts.createChart(div, Object.assign({
      autoSize: true, timeScale: { visible: false }, rightPriceScale: { minimumWidth: 78 },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal }, localization: { locale: 'tr-TR' }
    }, themeOpts()));
    ch.applyOptions({ timeScale: { visible: false } });
    var self = this, pane = { div: div, chart: ch, s: {} };
    ch.timeScale().subscribeVisibleLogicalRangeChange(function (r) { self._syncRange(r, ch); });
    this.panes[key] = pane; return pane;
  };
  ChartView.prototype._paneLine = function (pane, k, color, data, extra) {
    if (!pane.s[k]) pane.s[k] = pane.chart.addLineSeries(Object.assign({ color: color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, extra || {}));
    pane.s[k].setData(data); return pane.s[k];
  };

  ChartView.prototype._panes = function () {
    var cs = this.candles, ind = this.o.ind, self = this, cl = cs.map(function (c) { return c.close; });
    Object.keys(PANES).forEach(function (k) {
      if (!ind[k]) { if (self.panes[k]) { self.panes[k].chart.remove(); self.panes[k].div.remove(); delete self.panes[k]; } return; }
      var p = self._pane(k), fresh = !p.init; p.init = true;
      if (k === 'rsi') {
        var s = self._paneLine(p, 'rsi', '#b48cff', series(cs, TA.rsi(cl, 14)));
        if (fresh) { s.createPriceLine({ price: 70, color: cssVar('--down'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false }); s.createPriceLine({ price: 30, color: cssVar('--up'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false }); }
      } else if (k === 'macd') {
        var m = TA.macd(cl, 12, 26, 9), up = cssVar('--up') + 'aa', dn = cssVar('--down') + 'aa';
        if (!p.s.h) p.s.h = p.chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        p.s.h.setData(cs.map(function (c, i) { var v = m.hist[i]; return v == null ? { time: c.time } : { time: c.time, value: v, color: v >= 0 ? up : dn }; }));
        self._paneLine(p, 'm', '#4f8cff', series(cs, m.macd));
        self._paneLine(p, 's', '#f5a524', series(cs, m.signal));
      } else if (k === 'stoch') {
        var st = TA.stochastic(cs, 14, 3, 3);
        var ks = self._paneLine(p, 'k', '#4f8cff', series(cs, st.k));
        self._paneLine(p, 'd', '#f5a524', series(cs, st.d));
        if (fresh) { ks.createPriceLine({ price: 80, color: cssVar('--down'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false }); ks.createPriceLine({ price: 20, color: cssVar('--up'), lineStyle: 2, lineWidth: 1, axisLabelVisible: false }); }
      } else if (k === 'atr') {
        var pr = precision(cl[cl.length - 1]);
        self._paneLine(p, 'a', '#2ec4b6', series(cs, TA.atr(cs, 14)), { priceFormat: { type: 'price', precision: pr, minMove: Math.pow(10, -pr) } });
      } else if (k === 'obv') {
        self._paneLine(p, 'o', '#ff6b9a', series(cs, TA.obv(cs)), { priceFormat: { type: 'volume' } });
      }
    });
    var r = this.chart.timeScale().getVisibleLogicalRange(); if (r) this._syncRange(r, this.chart);
  };

  ChartView.prototype._syncRange = function (r, src) {
    if (this._sync || !r) return; this._sync = true;
    try {
      var all = [this.chart].concat(Object.keys(this.panes).map(function (k) { return this.panes[k].chart; }, this));
      all.forEach(function (c) { if (c !== src) c.timeScale().setVisibleLogicalRange(r); });
    } catch (e) {}
    this._sync = false;
  };

  ChartView.prototype._markers = function () {
    if (!this.o.ind.pat) { this.main.setMarkers([]); return; }
    // Kalabalığı önlemek için: son 250 kapanmış mum, yalnızca güçlü formasyonlar (w ≥ 0.7),
    // mum başına tek işaret, metin yok (isimler imleç lejantında görünür).
    var cs = this.candles, mk = [], from = Math.max(3, cs.length - 250), up = cssVar('--up'), dn = cssVar('--down');
    for (var i = from; i < cs.length - 1; i++) {   // son (açık) mum hariç
      var ps = Signals.detectPatterns(cs, i).filter(function (p) { return p.dir && p.w >= 0.7; });
      if (!ps.length) continue;
      var p = ps[0];
      mk.push({ time: cs[i].time, position: p.dir > 0 ? 'belowBar' : 'aboveBar', color: p.dir > 0 ? up : dn, shape: p.dir > 0 ? 'arrowUp' : 'arrowDown', size: 0.6 });
    }
    this.main.setMarkers(mk);
  };

  ChartView.prototype._clearLines = function () { var m = this.main; this.lines.forEach(function (l) { try { m.removePriceLine(l); } catch (e) {} }); this.lines = []; };
  ChartView.prototype._levels = function () {
    this._clearLines();
    var a = this.analysis, m = this.main, L = this.lines;
    if (this.o.ind.sr && a) {
      a.supports.forEach(function (s, i) { L.push(m.createPriceLine({ price: s.price, color: cssVar('--up'), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'D' + (i + 1) })); });
      a.resistances.forEach(function (s, i) { L.push(m.createPriceLine({ price: s.price, color: cssVar('--down'), lineWidth: 1, lineStyle: 1, axisLabelVisible: true, title: 'R' + (i + 1) })); });
      if (a.side) {
        L.push(m.createPriceLine({ price: a.stop, color: cssVar('--down'), lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Stop' }));
        L.push(m.createPriceLine({ price: a.target, color: cssVar('--up'), lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: 'Hedef' }));
      }
    }
  };

  /* ---------------- Çizimler ---------------- */
  ChartView.prototype._dkey = function () { return 'atb.draw.' + this.o.sym; };
  ChartView.prototype.drawings = function () { return store(this._dkey()) || []; };
  ChartView.prototype.clearDrawings = function () { store(this._dkey(), []); this._drawings(); };
  ChartView.prototype.setDrawMode = function (m) {
    this.drawMode = m; this.pending = null; this.el.classList.toggle('drawing', !!m);
    this.hintEl.textContent = m === 'h' ? 'Yatay çizgi için grafiğe tıklayın' : m === 't' ? 'Trend çizgisi: başlangıç noktasına tıklayın' : '';
  };
  ChartView.prototype._click = function (p) {
    if (!this.drawMode || !p || !p.point) return;
    var price = this.main.coordinateToPrice(p.point.y);
    var time = p.time != null ? p.time : this.chart.timeScale().coordinateToTime(p.point.x);
    if (price == null) return;
    var d = this.drawings();
    if (this.drawMode === 'h') { d.push({ type: 'h', price: price }); }
    else {
      if (time == null) return;
      if (!this.pending) { this.pending = { time: time, price: price }; this.hintEl.textContent = 'Trend çizgisi: bitiş noktasına tıklayın'; return; }
      if (time === this.pending.time) return;
      d.push({ type: 't', a: this.pending, b: { time: time, price: price } });
    }
    store(this._dkey(), d);
    this.setDrawMode(null); this._drawings();
    if (this.o.onDrawDone) this.o.onDrawDone();
  };
  ChartView.prototype._snap = function (t) {
    var cs = this.candles, lo = 0, hi = cs.length - 1;
    if (!cs.length || t < cs[0].time) return null;
    if (t >= cs[hi].time) return cs[hi].time;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (cs[mid].time <= t) lo = mid; else hi = mid - 1; }
    return cs[lo].time;
  };
  ChartView.prototype._drawings = function () {
    var self = this;
    this.trend.forEach(function (s) { try { self.chart.removeSeries(s); } catch (e) {} }); this.trend = [];
    if (this._dl) this._dl.forEach(function (l) { try { self.main.removePriceLine(l); } catch (e) {} });
    this._dl = [];
    this.drawings().forEach(function (d) {
      if (d.type === 'h') self._dl.push(self.main.createPriceLine({ price: d.price, color: cssVar('--warn'), lineWidth: 1, lineStyle: 0, axisLabelVisible: true, title: '✎' }));
      else {
        var ta = self._snap(d.a.time), tb = self._snap(d.b.time);
        if (ta == null || tb == null || ta === tb) return;
        var pts = [{ time: ta, value: d.a.price }, { time: tb, value: d.b.price }].sort(function (x, y) { return x.time - y.time; });
        var s = self.chart.addLineSeries({ color: cssVar('--warn'), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
        s.setData(pts); self.trend.push(s);
      }
    });
  };

  ChartView.prototype._legend = function (p) {
    var cs = this.candles; if (!cs.length) return;
    var c = null, idx = cs.length - 1;
    if (p && p.time != null) { for (var i = cs.length - 1; i >= 0; i--) if (cs[i].time === p.time) { c = cs[i]; idx = i; break; } }
    if (!c) c = cs[cs.length - 1];
    var pats = this.o.ind.pat ? Signals.detectPatterns(cs, idx).map(function (x) { return '<span class="' + (x.dir > 0 ? 'up' : x.dir < 0 ? 'down' : '') + '">' + x.name + '</span>'; }).join(', ') : '';
    var d = precision(c.close), f = function (x) { return (+x).toFixed(d); };
    var ch = (c.close - c.open) / c.open * 100;
    this.legendEl.innerHTML = 'A <b>' + f(c.open) + '</b> Y <b>' + f(c.high) + '</b> D <b>' + f(c.low) + '</b> K <b>' + f(c.close) + '</b> <span class="' + (ch >= 0 ? 'up' : 'down') + '">' + (ch >= 0 ? '+' : '') + ch.toFixed(2) + '%</span> H <b>' + root.Util.fmtBig(c.volume) + '</b>' + (pats ? ' · ' + pats : '');
  };

  ChartView.prototype.applyTheme = function () {
    var t = themeOpts(); this.chart.applyOptions(t);
    var self = this; Object.keys(this.panes).forEach(function (k) { self.panes[k].chart.applyOptions(t); });
    this._createMain(); this.render(true);
  };
  ChartView.prototype.destroy = function () {
    var self = this; Object.keys(this.panes).forEach(function (k) { self.panes[k].chart.remove(); });
    this.chart.remove(); this.el.innerHTML = '';
  };

  ChartView.PANES = PANES; ChartView.precision = precision;
  root.ChartView = ChartView;
})(typeof self !== 'undefined' ? self : this);
