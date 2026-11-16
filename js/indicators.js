/* =====================================================================
 * indicators.js — Saf (yan etkisiz) teknik gösterge fonksiyonları.
 * Tarayıcıda window.TA olarak, node'da module.exports olarak yüklenir.
 * Kurallar:
 *  - Girdi dizileri değiştirilmez.
 *  - Çıktı dizileri girdiyle AYNI uzunluktadır; hesaplanamayan
 *    (ısınma) noktalar null'dır.
 *  - Her değer yalnızca kendi indeksine kadar olan veriye dayanır
 *    (nedensel / "causal") — backtestte lookahead olmaması için şart.
 *  - Mum nesnesi: {time, open, high, low, close, volume}
 * ===================================================================== */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.TA = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function nulls(n) { var a = new Array(n); for (var i = 0; i < n; i++) a[i] = null; return a; }
  function isNum(x) { return typeof x === 'number' && isFinite(x); }

  /* ---------- Hareketli ortalamalar ---------- */

  /** Basit hareketli ortalama. */
  function sma(values, p) {
    var n = values.length, out = nulls(n), sum = 0, cnt = 0;
    for (var i = 0; i < n; i++) {
      var v = values[i];
      if (!isNum(v)) { sum = 0; cnt = 0; continue; }
      sum += v; cnt++;
      if (cnt > p) { sum -= values[i - p]; cnt = p; }
      if (cnt === p) out[i] = sum / p;
    }
    return out;
  }

  /**
   * Üssel hareketli ortalama. İlk değer, ilk p geçerli değerin SMA'sı ile
   * tohumlanır (standart yöntem). Baştaki null'lar atlanır (MACD sinyali için).
   */
  function ema(values, p) {
    var n = values.length, out = nulls(n), k = 2 / (p + 1);
    var start = -1, run = 0;
    for (var i = 0; i < n; i++) {
      if (isNum(values[i])) { run++; if (run === p) { start = i; break; } } else run = 0;
    }
    if (start < 0) return out;
    var s = 0; for (var j = start - p + 1; j <= start; j++) s += values[j];
    var e = s / p; out[start] = e;
    for (var t = start + 1; t < n; t++) {
      if (!isNum(values[t])) { out[t] = null; continue; }
      e = values[t] * k + e * (1 - k); out[t] = e;
    }
    return out;
  }

  /** Wilder yumuşatması (RMA): ilk değer SMA, sonra (prev*(p-1)+x)/p. */
  function rma(values, p) {
    var n = values.length, out = nulls(n), start = -1, run = 0;
    for (var i = 0; i < n; i++) {
      if (isNum(values[i])) { run++; if (run === p) { start = i; break; } } else run = 0;
    }
    if (start < 0) return out;
    var s = 0; for (var j = start - p + 1; j <= start; j++) s += values[j];
    var a = s / p; out[start] = a;
    for (var t = start + 1; t < n; t++) { if (!isNum(values[t])) continue; a = (a * (p - 1) + values[t]) / p; out[t] = a; }
    return out;
  }

  /* ---------- Osilatörler ---------- */

  /** RSI (Wilder). İlk değer indeks p'de. */
  function rsi(closes, p) {
    p = p || 14;
    var n = closes.length, out = nulls(n);
    if (n <= p) return out;
    var g = 0, l = 0;
    for (var i = 1; i <= p; i++) { var d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
    g /= p; l /= p;
    out[p] = rsiVal(g, l);
    for (var t = p + 1; t < n; t++) {
      var dd = closes[t] - closes[t - 1];
      g = (g * (p - 1) + (dd > 0 ? dd : 0)) / p;
      l = (l * (p - 1) + (dd < 0 ? -dd : 0)) / p;
      out[t] = rsiVal(g, l);
    }
    return out;
  }
  function rsiVal(g, l) { if (l === 0) return g === 0 ? 50 : 100; return 100 - 100 / (1 + g / l); }

  /** MACD(fast, slow, signal) → {macd, signal, hist}. */
  function macd(closes, fast, slow, sig) {
    fast = fast || 12; slow = slow || 26; sig = sig || 9;
    var ef = ema(closes, fast), es = ema(closes, slow), n = closes.length;
    var m = nulls(n);
    for (var i = 0; i < n; i++) if (ef[i] != null && es[i] != null) m[i] = ef[i] - es[i];
    var s = ema(m, sig), h = nulls(n);
    for (var j = 0; j < n; j++) if (m[j] != null && s[j] != null) h[j] = m[j] - s[j];
    return { macd: m, signal: s, hist: h };
  }

  /** Stokastik: %K = SMA(kSmooth) of fast %K(kLen); %D = SMA(dLen) of %K. */
  function stochastic(candles, kLen, kSmooth, dLen) {
    kLen = kLen || 14; kSmooth = kSmooth || 3; dLen = dLen || 3;
    var n = candles.length, fast = nulls(n);
    for (var i = kLen - 1; i < n; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var j = i - kLen + 1; j <= i; j++) { if (candles[j].high > hh) hh = candles[j].high; if (candles[j].low < ll) ll = candles[j].low; }
      fast[i] = hh === ll ? 50 : 100 * (candles[i].close - ll) / (hh - ll);
    }
    var k = kSmooth > 1 ? sma(fast, kSmooth) : fast.slice();
    var d = sma(k, dLen);
    return { k: k, d: d };
  }

  /* ---------- Volatilite ---------- */

  /** Gerçek aralık (True Range). TR[0] = high-low. */
  function trueRange(candles) {
    return candles.map(function (c, i) {
      if (i === 0) return c.high - c.low;
      var pc = candles[i - 1].close;
      return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
    });
  }

  /** ATR (Wilder). İlk değer indeks p-1'de (ilk p TR'nin ortalaması). */
  function atr(candles, p) { return rma(trueRange(candles), p || 14); }

  /** Bollinger bantları (popülasyon std sapması). → [{mid,upper,lower,pctB,width}|null] */
  function bollinger(closes, p, mult) {
    p = p || 20; mult = mult || 2;
    var n = closes.length, mid = sma(closes, p), out = nulls(n);
    for (var i = p - 1; i < n; i++) {
      if (mid[i] == null) continue;
      var s = 0; for (var j = i - p + 1; j <= i; j++) s += (closes[j] - mid[i]) * (closes[j] - mid[i]);
      var sd = Math.sqrt(s / p), up = mid[i] + mult * sd, lo = mid[i] - mult * sd;
      out[i] = { mid: mid[i], upper: up, lower: lo, pctB: up === lo ? 0.5 : (closes[i] - lo) / (up - lo), width: mid[i] ? (up - lo) / mid[i] : 0 };
    }
    return out;
  }

  /**
   * Supertrend(p, mult). Klasik algoritma: hl2 ± mult*ATR "nihai bant"lar.
   * → {value:[], dir:[] (1 yükseliş, -1 düşüş)}
   */
  function supertrend(candles, p, mult) {
    p = p || 10; mult = mult || 3;
    var n = candles.length, a = atr(candles, p), val = nulls(n), dir = nulls(n);
    var fu = null, fl = null, d = 1;
    for (var i = 0; i < n; i++) {
      if (a[i] == null) continue;
      var c = candles[i], hl2 = (c.high + c.low) / 2;
      var bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
      var pc = i > 0 ? candles[i - 1].close : c.close;
      if (fu == null) { fu = bu; fl = bl; d = c.close >= hl2 ? 1 : -1; }
      else {
        fu = (bu < fu || pc > fu) ? bu : fu;
        fl = (bl > fl || pc < fl) ? bl : fl;
        if (d === 1 && c.close < fl) d = -1;
        else if (d === -1 && c.close > fu) d = 1;
      }
      dir[i] = d; val[i] = d === 1 ? fl : fu;
    }
    return { value: val, dir: dir };
  }

  /** ADX(p) Wilder → {adx, pdi, mdi} */
  function adx(candles, p) {
    p = p || 14;
    var n = candles.length, pdm = [], mdm = [], tr = trueRange(candles);
    for (var i = 0; i < n; i++) {
      if (i === 0) { pdm.push(null); mdm.push(null); tr[0] = null; continue; }
      var up = candles[i].high - candles[i - 1].high, dn = candles[i - 1].low - candles[i].low;
      pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0);
    }
    var atr_ = rma(tr, p), sp = rma(pdm, p), sm = rma(mdm, p);
    var pdi = nulls(n), mdi = nulls(n), dx = nulls(n);
    for (var t = 0; t < n; t++) {
      if (atr_[t] == null || sp[t] == null) continue;
      pdi[t] = atr_[t] ? 100 * sp[t] / atr_[t] : 0; mdi[t] = atr_[t] ? 100 * sm[t] / atr_[t] : 0;
      var s = pdi[t] + mdi[t]; dx[t] = s ? 100 * Math.abs(pdi[t] - mdi[t]) / s : 0;
    }
    return { adx: rma(dx, p), pdi: pdi, mdi: mdi };
  }

  /* ---------- Hacim ---------- */

  /** On-Balance Volume, OBV[0] = 0. */
  function obv(candles) {
    var out = [], v = 0;
    for (var i = 0; i < candles.length; i++) {
      if (i > 0) { var d = candles[i].close - candles[i - 1].close; if (d > 0) v += candles[i].volume; else if (d < 0) v -= candles[i].volume; }
      out.push(v);
    }
    return out;
  }

  /** Oturum VWAP'ı: her UTC gününde sıfırlanır, tipik fiyat (H+L+C)/3 ile. time saniye cinsinden. */
  function vwap(candles) {
    var out = [], pv = 0, vv = 0, day = null;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i], d = Math.floor(c.time / 86400);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      var tp = (c.high + c.low + c.close) / 3;
      pv += tp * c.volume; vv += c.volume;
      out.push(vv > 0 ? pv / vv : tp);
    }
    return out;
  }

  /* ---------- Dönüşümler / yardımcılar ---------- */

  function heikinAshi(candles) {
    var out = [], po = null, pc = null;
    for (var i = 0; i < candles.length; i++) {
      var c = candles[i];
      var hc = (c.open + c.high + c.low + c.close) / 4;
      var ho = po == null ? (c.open + c.close) / 2 : (po + pc) / 2;
      out.push({ time: c.time, open: ho, high: Math.max(c.high, ho, hc), low: Math.min(c.low, ho, hc), close: hc, volume: c.volume });
      po = ho; pc = hc;
    }
    return out;
  }

  /** Pearson korelasyonu (eşit uzunlukta iki dizi). */
  function pearson(a, b) {
    var n = Math.min(a.length, b.length); if (n < 2) return null;
    var ma = 0, mb = 0, i; for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; } ma /= n; mb /= n;
    var sab = 0, saa = 0, sbb = 0;
    for (i = 0; i < n; i++) { var x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    if (saa === 0 || sbb === 0) return null;
    return sab / Math.sqrt(saa * sbb);
  }

  /** Logaritmik getiriler. */
  function logReturns(closes) { var o = []; for (var i = 1; i < closes.length; i++) o.push(Math.log(closes[i] / closes[i - 1])); return o; }

  /** Bir değerin dizideki yüzdelik sırası (0..1). */
  function percentileRank(arr, v) {
    var xs = arr.filter(isNum); if (!xs.length) return 0.5;
    var below = 0; for (var i = 0; i < xs.length; i++) if (xs[i] < v) below++;
    return below / xs.length;
  }

  return {
    sma: sma, ema: ema, rma: rma, rsi: rsi, macd: macd, stochastic: stochastic,
    trueRange: trueRange, atr: atr, bollinger: bollinger, supertrend: supertrend, adx: adx,
    obv: obv, vwap: vwap, heikinAshi: heikinAshi, pearson: pearson, logReturns: logReturns,
    percentileRank: percentileRank
  };
});
