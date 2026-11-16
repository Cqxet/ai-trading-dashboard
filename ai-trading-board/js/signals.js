/* =====================================================================
 * signals.js — AI sinyal motoru v2 (kural tabanlı, saf fonksiyonlar).
 *  - computeIndicators(candles): tüm göstergeleri BİR KEZ hesaplar (nedensel).
 *  - scoreAt(candles, ind, i, opts): yalnızca 0..i verisini kullanarak
 *    i. mumun KAPANIŞINDAKİ sinyali üretir (backtest bunu kullanır).
 *  - analyze(candles, opts): son mum için scoreAt.
 *  - detectPatterns, supportResistance, detectRegime, combineMTF, ruleCommentary
 * Tarayıcıda window.Signals, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var TA = (typeof module === 'object' && module.exports) ? require('./indicators.js') : root.TA;
  var m = factory(TA);
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Signals = m;
})(typeof self !== 'undefined' ? self : this, function (TA) {
  'use strict';

  var DEFAULTS = {
    buyTh: 30, sellTh: -30,        // skor eşikleri
    atrStop: 1.5, atrTarget: 3,    // stop / hedef ATR çarpanları
    minBars: 60
  };

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function f(x, d) { if (x == null || !isFinite(x)) return '–'; return (+x).toFixed(d == null ? 2 : d); }

  /* ---------------- Göstergeler ---------------- */
  function computeIndicators(candles) {
    var c = candles.map(function (x) { return x.close; });
    var v = candles.map(function (x) { return x.volume; });
    return {
      close: c,
      ema20: TA.ema(c, 20), ema50: TA.ema(c, 50), ema200: TA.ema(c, 200),
      rsi: TA.rsi(c, 14), macd: TA.macd(c, 12, 26, 9), bb: TA.bollinger(c, 20, 2),
      atr: TA.atr(candles, 14), st: TA.supertrend(candles, 10, 3), stoch: TA.stochastic(candles, 14, 3, 3),
      adx: TA.adx(candles, 14), obv: TA.obv(candles), volSma: TA.sma(v, 20)
    };
  }

  /* ---------------- Mum formasyonları (i. muma kadar) ---------------- */
  function detectPatterns(candles, i) {
    var out = [];
    if (i < 2) return out;
    var c = candles[i], p = candles[i - 1], pp = candles[i - 2];
    var body = Math.abs(c.close - c.open), range = c.high - c.low || 1e-12;
    var upper = c.high - Math.max(c.open, c.close), lower = Math.min(c.open, c.close) - c.low;
    var pBody = Math.abs(p.close - p.open);
    var bull = c.close > c.open, pBull = p.close > p.open;
    // Kısa vadeli eğilim (son 5 mum) — çekiç/kayan yıldız bağlamı
    var j0 = Math.max(0, i - 5), trendDown = candles[i - 1].close < candles[j0].close, trendUp = !trendDown;

    if (bull && !pBull && c.close >= p.open && c.open <= p.close && body > pBody)
      out.push({ key: 'bull_engulf', name: 'Yutan boğa', dir: 1, w: 0.8, text: 'Yutan boğa formasyonu: alıcılar önceki satış mumunu tamamen yuttu' });
    if (!bull && pBull && c.open >= p.close && c.close <= p.open && body > pBody)
      out.push({ key: 'bear_engulf', name: 'Yutan ayı', dir: -1, w: 0.8, text: 'Yutan ayı formasyonu: satıcılar önceki alış mumunu tamamen yuttu' });
    if (body / range < 0.1)
      out.push({ key: 'doji', name: 'Doji', dir: 0, w: 0.3, text: 'Doji: kararsızlık, olası dönüş/duraksama' });
    else if (lower >= 2 * body && upper <= body * 0.6 && trendDown)
      out.push({ key: 'hammer', name: 'Çekiç', dir: 1, w: 0.6, text: 'Çekiç: düşüş sonrası uzun alt fitil, dipten alım tepkisi' });
    else if (upper >= 2 * body && lower <= body * 0.6 && trendUp)
      out.push({ key: 'shooting_star', name: 'Kayan yıldız', dir: -1, w: 0.6, text: 'Kayan yıldız: yükseliş sonrası uzun üst fitil, tepeden satış baskısı' });
    else if (lower >= 2 * body && upper <= body * 0.6 && trendUp)
      out.push({ key: 'hanging_man', name: 'Asılı adam', dir: -1, w: 0.4, text: 'Asılı adam: yükseliş sonrası uzun alt fitil, zayıflama işareti' });
    else if (upper >= 2 * body && lower <= body * 0.6 && trendDown)
      out.push({ key: 'inv_hammer', name: 'Ters çekiç', dir: 1, w: 0.4, text: 'Ters çekiç: düşüş sonrası alıcıların denemesi' });

    var ppBody = Math.abs(pp.close - pp.open), ppMid = (pp.open + pp.close) / 2;
    if (pp.close < pp.open && pBody < ppBody * 0.4 && bull && c.close > ppMid && ppBody > 0)
      out.push({ key: 'morning_star', name: 'Sabah yıldızı', dir: 1, w: 0.9, text: 'Sabah yıldızı: üç mumlu dipten dönüş formasyonu' });
    if (pp.close > pp.open && pBody < ppBody * 0.4 && !bull && c.close < ppMid && ppBody > 0)
      out.push({ key: 'evening_star', name: 'Akşam yıldızı', dir: -1, w: 0.9, text: 'Akşam yıldızı: üç mumlu tepeden dönüş formasyonu' });
    if (bull && pBull && pp.close > pp.open && c.close > p.close && p.close > pp.close && c.open > p.open && p.open > pp.open)
      out.push({ key: 'three_soldiers', name: 'Üç beyaz asker', dir: 1, w: 0.7, text: 'Üç beyaz asker: art arda güçlü alış mumları' });
    if (!bull && !pBull && pp.close < pp.open && c.close < p.close && p.close < pp.close && c.open < p.open && p.open < pp.open)
      out.push({ key: 'three_crows', name: 'Üç kara karga', dir: -1, w: 0.7, text: 'Üç kara karga: art arda güçlü satış mumları' });
    return out;
  }

  /* ---------------- Destek / Direnç ----------------
   * Fraktal pivotlar (her iki yanda `w` mum) — sağ taraf onayı i'yi geçmez.
   * Yakın seviyeler 0.5×ATR içinde kümelenir; dokunma sayısına göre güç. */
  function supportResistance(candles, i, atrVal, opts) {
    opts = opts || {};
    var w = opts.window || 3, look = opts.lookback || 300;
    var from = Math.max(w, i - look), levels = [];
    for (var k = from; k <= i - w; k++) {
      var isH = true, isL = true;
      for (var j = k - w; j <= k + w; j++) {
        if (j === k) continue;
        if (candles[j].high >= candles[k].high) isH = false;
        if (candles[j].low <= candles[k].low) isL = false;
      }
      if (isH) levels.push({ price: candles[k].high, t: candles[k].time });
      if (isL) levels.push({ price: candles[k].low, t: candles[k].time });
    }
    var tol = (atrVal || candles[i].close * 0.005) * 0.5;
    levels.sort(function (a, b) { return a.price - b.price; });
    var clusters = [];
    levels.forEach(function (l) {
      var last = clusters[clusters.length - 1];
      if (last && l.price - last.max <= tol) { last.sum += l.price; last.n++; last.max = l.price; last.price = last.sum / last.n; }
      else clusters.push({ price: l.price, sum: l.price, n: 1, max: l.price });
    });
    var px = candles[i].close;
    var sup = clusters.filter(function (c) { return c.price < px; }).sort(function (a, b) { return b.price - a.price; }).slice(0, 3);
    var res = clusters.filter(function (c) { return c.price > px; }).sort(function (a, b) { return a.price - b.price; }).slice(0, 3);
    var mapL = function (c) { return { price: c.price, touches: c.n }; };
    return { supports: sup.map(mapL), resistances: res.map(mapL) };
  }

  /* ---------------- Rejim ---------------- */
  function detectRegime(ind, i) {
    var a = ind.adx.adx[i], atrPct = [], j;
    for (j = Math.max(0, i - 150); j <= i; j++) if (ind.atr[j] != null) atrPct.push(ind.atr[j] / ind.close[j]);
    var cur = ind.atr[i] != null ? ind.atr[i] / ind.close[i] : null;
    var volRank = cur == null ? 0.5 : TA.percentileRank(atrPct, cur);
    var pdi = ind.adx.pdi[i], mdi = ind.adx.mdi[i];
    if (volRank >= 0.9) return { key: 'highvol', name: 'Yüksek volatilite', adx: a, volRank: volRank, text: 'ATR/fiyat oranı son 150 mumun %' + Math.round(volRank * 100) + ' diliminde — sinyaller daha az güvenilir, pozisyon küçültülmeli' };
    if (a != null && a >= 25) {
      var up = pdi >= mdi;
      return { key: up ? 'trend_up' : 'trend_down', name: up ? 'Yükseliş trendi' : 'Düşüş trendi', adx: a, volRank: volRank, text: 'ADX ' + f(a, 0) + ' (≥25): belirgin ' + (up ? 'yükseliş' : 'düşüş') + ' trendi; trend takip sinyalleri ağırlıklı' };
    }
    return { key: 'range', name: 'Yatay / bant', adx: a, volRank: volRank, text: 'ADX ' + f(a, 0) + ' (<25): yönsüz piyasa; ortalamaya dönüş sinyalleri ağırlıklı' };
  }

  /* ---------------- Skor ---------------- */
  /** i. mumun kapanışında sinyal. Sadece candles[0..i] ve ind[..i] kullanılır. */
  function scoreAt(candles, ind, i, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (i < opts.minBars || ind.atr[i] == null || ind.ema50[i] == null || ind.macd.hist[i] == null || ind.rsi[i] == null) return null;
    var px = ind.close[i], comps = [];
    var regime = detectRegime(ind, i);
    var trendW = regime.key.indexOf('trend') === 0 ? 1.4 : regime.key === 'range' ? 0.7 : 1;
    var revW = regime.key === 'range' ? 1.4 : regime.key.indexOf('trend') === 0 ? 0.6 : 1;
    function add(name, w, v, text) { comps.push({ name: name, w: w, v: clamp(v, -1, 1), text: text }); }

    // 1) Trend: EMA dizilimi
    var e20 = ind.ema20[i], e50 = ind.ema50[i], e200 = ind.ema200[i];
    var tv = (e20 > e50 ? 0.5 : -0.5) + (px > e50 ? 0.25 : -0.25) + (e200 != null ? (px > e200 ? 0.25 : -0.25) : 0);
    add('Trend (EMA)', 0.22 * trendW, tv,
      'EMA20 ' + (e20 > e50 ? '>' : '<') + ' EMA50, fiyat EMA50 ' + (px > e50 ? 'üstünde' : 'altında') +
      (e200 != null ? ', EMA200 ' + (px > e200 ? 'üstünde' : 'altında') : ''));

    // 2) Supertrend
    var sd = ind.st.dir[i], sdp = ind.st.dir[i - 1];
    if (sd != null) add('Supertrend', 0.12 * trendW, sd === 1 ? (sdp === -1 ? 1 : 0.7) : (sdp === 1 ? -1 : -0.7),
      'Supertrend ' + (sd === 1 ? 'yükseliş' : 'düşüş') + ' modunda' + (sdp != null && sdp !== sd ? ' (TAZE DÖNÜŞ)' : ''));

    // 3) MACD
    var h = ind.macd.hist[i], hp = ind.macd.hist[i - 1];
    var mv = h > 0 ? (h > hp ? 0.8 : 0.4) : (h < hp ? -0.8 : -0.4);
    var cross = hp != null && ((hp <= 0 && h > 0) ? 1 : (hp >= 0 && h < 0) ? -1 : 0);
    if (cross) mv = cross;
    add('MACD', 0.15, mv, 'MACD histogramı ' + (h > 0 ? 'pozitif' : 'negatif') + ' ve ' + (Math.abs(h) > Math.abs(hp) ? 'güçleniyor' : 'zayıflıyor') + (cross ? (cross > 0 ? ' — yukarı kesişim' : ' — aşağı kesişim') : ''));

    // 4) RSI (ortalamaya dönüş + momentum)
    var r = ind.rsi[i], rv;
    if (r < 30) rv = 0.6 + (30 - r) / 50; else if (r > 70) rv = -0.6 - (r - 70) / 50;
    else rv = (r - 50) / 50;   // 30..70 arası momentum
    add('RSI(14)', 0.15 * (r < 30 || r > 70 ? revW : 1), rv,
      'RSI ' + f(r, 1) + (r < 30 ? ' — aşırı satım, tepki alımı olası' : r > 70 ? ' — aşırı alım, düzeltme riski' : r >= 50 ? ' — pozitif momentum' : ' — negatif momentum'));

    // 5) Stokastik
    var k = ind.stoch.k[i], d = ind.stoch.d[i];
    if (k != null && d != null) {
      var sv = k < 20 ? (k > d ? 0.9 : 0.4) : k > 80 ? (k < d ? -0.9 : -0.4) : (k > d ? 0.25 : -0.25);
      add('Stokastik', 0.08 * revW, sv, '%K ' + f(k, 0) + ' / %D ' + f(d, 0) + (k < 20 ? ' — aşırı satım bölgesi' : k > 80 ? ' — aşırı alım bölgesi' : ''));
    }

    // 6) Bollinger %B
    var b = ind.bb[i];
    if (b) {
      var bv = b.pctB < 0 ? 0.9 : b.pctB > 1 ? -0.9 : (0.5 - b.pctB) * 0.8;
      add('Bollinger %B', 0.10 * revW, bv, '%B ' + f(b.pctB, 2) + (b.pctB < 0 ? ' — alt bandın altında' : b.pctB > 1 ? ' — üst bandın üstünde' : '') + ', bant genişliği %' + f(b.width * 100, 1));
    }

    // 7) Hacim + OBV teyidi
    var vs = ind.volSma[i - 1], vol = candles[i].volume, up = candles[i].close >= candles[i].open;
    var obvSlope = ind.obv[i] - ind.obv[Math.max(0, i - 10)];
    var vv = (obvSlope > 0 ? 0.4 : obvSlope < 0 ? -0.4 : 0);
    var vtxt = 'OBV son 10 mumda ' + (obvSlope > 0 ? 'artıyor (birikim)' : obvSlope < 0 ? 'azalıyor (dağıtım)' : 'yatay');
    if (vs && vol > vs * 1.8) { vv += up ? 0.6 : -0.6; vtxt += '; hacim ortalamanın ' + f(vol / vs, 1) + '× katı, ' + (up ? 'alıcılı' : 'satıcılı') + ' mum'; }
    add('Hacim/OBV', 0.08, vv, vtxt);

    // 8) Formasyonlar
    var pats = detectPatterns(candles, i), pv = 0;
    pats.forEach(function (p) { pv += p.dir * p.w; });
    if (pats.length) add('Formasyon', 0.10, pv, pats.map(function (p) { return p.name; }).join(', '));

    // Ağırlıklı skor
    var sw = 0, s = 0;
    comps.forEach(function (c) { sw += c.w; s += c.w * c.v; });
    var score = Math.round(clamp(100 * s / (sw || 1), -100, 100));

    // Güven: bileşen uyumu + skor büyüklüğü, yüksek volatilitede ceza
    var agreeW = 0;
    comps.forEach(function (c) { if (Math.sign(c.v) === Math.sign(score) && c.v !== 0) agreeW += c.w; });
    var agreement = sw ? agreeW / sw : 0;
    var conf = 100 * (0.55 * agreement + 0.45 * Math.min(1, Math.abs(score) / 60));
    if (regime.key === 'highvol') conf *= 0.75;
    conf = Math.round(clamp(conf, 0, 100));

    var label = score >= opts.buyTh ? 'AL' : score <= opts.sellTh ? 'SAT' : 'BEKLE';
    var strength = Math.abs(score) >= 60 ? 'GÜÇLÜ ' : '';

    // ATR tabanlı stop/hedef, S/R ile sınırlandırma
    var A = ind.atr[i], sr = supportResistance(candles, i, A);
    var dir = label === 'SAT' ? -1 : 1;
    var stop = px - dir * opts.atrStop * A, target = px + dir * opts.atrTarget * A;
    var rr = Math.abs(target - px) / Math.abs(px - stop);

    return {
      i: i, time: candles[i].time, price: px, score: score, label: label, display: (label === 'BEKLE' ? '' : strength) + label,
      confidence: conf, agreement: agreement, regime: regime, components: comps, patterns: pats,
      supports: sr.supports, resistances: sr.resistances,
      stop: stop, target: target, rr: rr, side: label === 'BEKLE' ? null : (dir === 1 ? 'long' : 'short'),
      snap: { rsi: r, macdHist: h, macd: ind.macd.macd[i], macdSig: ind.macd.signal[i], ema20: e20, ema50: e50, ema200: e200,
        atr: A, atrPct: A / px * 100, adx: ind.adx.adx[i], stochK: k, stochD: d, pctB: b ? b.pctB : null, bbWidth: b ? b.width : null,
        stDir: sd, volRatio: vs ? vol / vs : null }
    };
  }

  function analyze(candles, opts) {
    if (!candles || candles.length < DEFAULTS.minBars + 2) return null;
    return scoreAt(candles, computeIndicators(candles), candles.length - 1, opts);
  }

  /* ---------------- Çoklu zaman dilimi uyumu ---------------- */
  var MTF_W = { '15m': 0.15, '1h': 0.25, '4h': 0.3, '1d': 0.3 };
  function combineMTF(byTf) {
    var tfs = Object.keys(byTf).filter(function (t) { return byTf[t]; });
    if (!tfs.length) return null;
    var sw = 0, s = 0, bull = 0, bear = 0;
    tfs.forEach(function (t) { var w = MTF_W[t] || 0.2, sc = byTf[t].score; sw += w; s += w * sc; if (sc >= 15) bull++; else if (sc <= -15) bear++; });
    var score = Math.round(s / sw), n = tfs.length;
    var aligned = Math.max(bull, bear);
    var text;
    if (bull === n) text = 'Tüm zaman dilimleri yükselişte hizalı — güçlü uyum';
    else if (bear === n) text = 'Tüm zaman dilimleri düşüşte hizalı — güçlü uyum';
    else if (bull > bear) text = n + ' zaman diliminin ' + bull + 'i pozitif; kısmi uyum';
    else if (bear > bull) text = n + ' zaman diliminin ' + bear + 'i negatif; kısmi uyum';
    else text = 'Zaman dilimleri çelişkili — net yön yok';
    return { score: score, aligned: aligned, total: n, bull: bull, bear: bear, alignment: aligned / n, text: text,
      label: score >= 25 ? 'AL' : score <= -25 ? 'SAT' : 'BEKLE' };
  }

  /* ---------------- Kural tabanlı Türkçe yorum ---------------- */
  function ruleCommentary(sym, tf, g, mtf, extra) {
    if (!g) return 'Yeterli veri yok.';
    extra = extra || {};
    var parts = [];
    parts.push(sym + ' ' + tf + ' grafiğinde motorun skoru ' + (g.score > 0 ? '+' : '') + g.score + ' (' + g.display + ', güven %' + g.confidence + ').');
    parts.push('Piyasa rejimi: ' + g.regime.name + '. ' + g.regime.text + '.');
    var pos = g.components.filter(function (c) { return c.v > 0.2; }).sort(function (a, b) { return b.w * b.v - a.w * a.v; });
    var neg = g.components.filter(function (c) { return c.v < -0.2; }).sort(function (a, b) { return a.w * a.v - b.w * b.v; });
    if (pos.length) parts.push('Olumlu taraf: ' + pos.slice(0, 3).map(function (c) { return c.text; }).join('; ') + '.');
    if (neg.length) parts.push('Olumsuz taraf: ' + neg.slice(0, 3).map(function (c) { return c.text; }).join('; ') + '.');
    if (g.supports.length) parts.push('En yakın destek ' + f(g.supports[0].price, 4) + (g.supports[0].touches > 1 ? ' (' + g.supports[0].touches + ' temas)' : '') + '.');
    if (g.resistances.length) parts.push('En yakın direnç ' + f(g.resistances[0].price, 4) + (g.resistances[0].touches > 1 ? ' (' + g.resistances[0].touches + ' temas)' : '') + '.');
    if (mtf) parts.push('Çoklu zaman dilimi: ' + mtf.text + ' (birleşik skor ' + (mtf.score > 0 ? '+' : '') + mtf.score + ').');
    if (g.side) parts.push('Örnek senaryo (' + (g.side === 'long' ? 'uzun' : 'kısa') + '): giriş ~' + f(g.price, 4) + ', stop ' + f(g.stop, 4) + ', hedef ' + f(g.target, 4) + ', risk/ödül 1:' + f(g.rr, 1) + '.');
    else parts.push('Skor eşiklerin içinde; bekle-gör tavrı öne çıkıyor. Kırılım için en yakın destek/direnç seviyeleri izlenebilir.');
    if (extra.fng) parts.push('Genel duyarlılık (Fear & Greed): ' + extra.fng.value + ' — ' + extra.fng.label + '.');
    if (g.regime.key === 'highvol') parts.push('Dikkat: volatilite yüksek, stop mesafeleri genişler; pozisyon boyutu küçültülmeli.');
    parts.push('Bu yorum kural tabanlıdır ve yatırım tavsiyesi değildir.');
    return parts.join(' ');
  }

  return {
    DEFAULTS: DEFAULTS, computeIndicators: computeIndicators, scoreAt: scoreAt, analyze: analyze,
    detectPatterns: detectPatterns, supportResistance: supportResistance, detectRegime: detectRegime,
    combineMTF: combineMTF, ruleCommentary: ruleCommentary
  };
});
