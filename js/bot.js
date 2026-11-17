/* =====================================================================
 * bot.js — AI otomatik sanal alım-satım botu (SAF durum geçişleri, ağ yok).
 * GERÇEK EMİR GÖNDERMEZ. Defter TL cinsindendir (100 TL ile başlar);
 * işlemler Binance USDT fiyatı x USDTTRY kuru ile TL'ye çevrilir.
 * Yalnızca spot LONG (alış -> satış); short/kaldıraç yok.
 * Maliyet modeli (her işlem yönü için): komisyon + kayma + işlem vergisi.
 * Kâr vergisi (opsiyonel) yalnızca pozitif kapanış kârı üzerinden alınır.
 * Varsayılan oranlar tahminidir; kendi borsanıza/vergi mevzuatınıza göre ayarlayın.
 * Tarayıcıda window.Bot, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else root.Bot = m;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DEFAULTS = {
    initialTRY: 100,
    feeRate: 0.001,        // Binance spot komisyonu %0,1 / işlem
    slipRate: 0.0005,      // kayma/spread tahmini %0,05 / işlem
    taxRate: 0,            // işlem vergisi: 2026 itibarıyla yürürlükte kripto işlem vergisi yok (teklif geri çekildi); gerekirse ayarlardan açın
    profitTaxRate: 0,      // kâr vergisi (varsayılan 0)
    minConf: 55,           // sinyal güveni alt sınırı
    minRR: 1.5,            // risk/ödül alt sınırı
    minNetGain: 0.01,      // maliyet sonrası beklenen min. kazanç (oran)
    maxPos: 3,             // eşzamanlı pozisyon
    minOrderTRY: 10,       // min emir tutarı
    cooldownMin: 60,       // aynı sembolde çıkış sonrası bekleme
    maxHoldH: 48,          // azami tutma süresi
    maxTradesPerHour: 6,
    sigMaxAgeMin: 15,      // sinyal verisi azami yaşı
    mode: 'normal',
    // ---- Akıllı katman (maliyet ve strateji oranlarından bağımsız; kapatılabilir) ----
    adaptive: true,        // öğrenen hafıza: geçmiş kazanç/kayıplara bakarak giriş filtreler ve büyüklüğü ayarlar
    mktFilter: true,       // piyasa genişliği filtresi: genel piyasa düşüşteyken long açma
    minBreadth: 0.4,       // yükseliş eğiliminde olan sembol oranı bu değerin altındaysa giriş yok
    memMinN: 8,            // bir kovanın hükmü için asgari işlem sayısı
    memZ: 0,               // bloklama güveni: ortalama + z*hata < 0 ise kova bloklanır (0: ortalama negatifse engelle)
    memDecay: 0.97,        // eski kanıtın her yeni işlemde ağırlık çarpanı (yakın geçmişe öncelik)
    globalGuard: true,     // tüm işlemlerin birleşik (unutmalı) ortalaması < 0 ise hiçbir kova girişi açamaz; yalnızca deneme işlemi
    memRequire: false,     // true: pozitif kanıt olmayan bölgede işlem açma (nakitte kal); yalnızca küçük deneme işlemleriyle öğren
    probeMin: 240,         // bloklu durumdayken en fazla bu kadar dakikada bir küçük (×0,3) deneme işlemi: rejim değişimini fark etmek için
    streakPause: 4         // üst üste bu kadar zarardan sonra giriş molası (dk = 15 x fazla zarar)
  };

  // Hız kademeleri: her seviyede sinyal zaman dilimi küçülür, tarama sıklaşır, eşikler gevşer,
  // tutma süresi kısalır. Maliyet filtresi (minNetGain: gidiş-dönüş maliyet sonrası beklenen kazanç) HER kademede korunur.
  // tf/scanSec/topN/buyTh/atrStop/atrTarget tarama ayarlarıdır (app-bot.js okur).
  var PRESETS = {
    normal:   { mode: 'normal',   minConf: 55, minRR: 1.5, minNetGain: 0.01,   maxPos: 3, cooldownMin: 60, maxHoldH: 48,   maxTradesPerHour: 6,   sigMaxAgeMin: 15 },
    fast:     { mode: 'fast',     minConf: 35, minRR: 1.2, minNetGain: 0.004,  maxPos: 4, cooldownMin: 10, maxHoldH: 3,    maxTradesPerHour: 24,  sigMaxAgeMin: 3,   tf: '15m', scanSec: 30, topN: 20, buyTh: 20, atrStop: 1.2, atrTarget: 2.0 },
    veryfast: { mode: 'veryfast', minConf: 30, minRR: 1.1, minNetGain: 0.003,  maxPos: 5, cooldownMin: 5,  maxHoldH: 1.5,  maxTradesPerHour: 40,  sigMaxAgeMin: 2,   tf: '5m',  scanSec: 20, topN: 25, buyTh: 15, atrStop: 1.0, atrTarget: 1.6 },
    extreme:  { mode: 'extreme',  minConf: 25, minRR: 1.0, minNetGain: 0.002,  maxPos: 6, cooldownMin: 2,  maxHoldH: 0.75, maxTradesPerHour: 80,  sigMaxAgeMin: 1.5, tf: '3m',  scanSec: 12, topN: 30, buyTh: 10, atrStop: 0.9, atrTarget: 1.3 },
    super:    { mode: 'super',    minConf: 20, minRR: 1.0, minNetGain: 0.0015, maxPos: 8, cooldownMin: 1,  maxHoldH: 0.33, maxTradesPerHour: 150, sigMaxAgeMin: 1,   tf: '1m',  scanSec: 8,  topN: 30, buyTh: 8,  atrStop: 0.8, atrTarget: 1.1 }
  };
  /* =================== ÖĞRENEN HAFIZA ===================
   * Her kapanan işlemin net getirisi (%, maliyet sonrası) özellik kovalarına yazılır; eski kanıt üssel olarak unutulur.
   * Giriş anında aday, kovaların istatistiğine göre geçirilir/bloklanır ve büyüklüğü ölçeklenir.
   * Az veriyle karar verilmez (memMinN); bloklu kovalar belirli olasılıkla yeniden denenir (keşif). */
  function bucket(x, cuts) { for (var i = 0; i < cuts.length; i++) if (x < cuts[i]) return i; return cuts.length; }
  function featOf(g, sym, mk) {
    var sn = g.snap || {};
    return { reg: g.regime ? g.regime.key : 'na', conf: bucket(g.confidence, [35, 50, 65, 80]), rsi: sn.rsi == null ? 'na' : bucket(sn.rsi, [35, 50, 65]),
      vol: sn.atrPct == null ? 'na' : bucket(sn.atrPct, [0.15, 0.4, 1]), sym: sym, mkt: mk ? mk.state : 'na' };
  }
  function keysOf(f) { return ['g:all', 'r:' + f.reg + '|c:' + f.conf, 's:' + f.sym, 'r:' + f.reg + '|rsi:' + f.rsi, 'm:' + f.mkt + '|r:' + f.reg, 'v:' + f.vol + '|c:' + f.conf]; }
  function newMem() { return { v: 1, n: 0, b: {}, streak: 0, pauseUntil: 0, blocked: 0, passed: 0 }; }
  function stat(b) { var n = b.n, m = n ? b.sum / n : 0, v = n > 1 ? Math.max(0, b.sq / n - m * m) : 0.25; return { n: n, mean: m, se: Math.sqrt(v / Math.max(1, n)) }; }
  function hash01(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return ((h >>> 0) % 100000) / 100000; }
  /** Aday işlem için karar: {ok, mult, why}. */
  function memCheck(st, f, sym, now) {
    var s = st.s, m = st.mem || (st.mem = newMem());
    if (m.pauseUntil > now) return { ok: false, mult: 1, why: 'mola' };
    var worst = null, best = null, gl = null;
    if (s.globalGuard) { var gb = m.b['g:all']; if (gb && gb.n >= s.memMinN) { var gt = stat(gb); if (gt.mean + s.memZ * gt.se < 0) gl = { mean: gt.mean, n: gt.n }; } }
    if (gl) {
      if (now - (m.lastProbe || 0) >= s.probeMin * 60e3 * (m.probeK || 1)) { m.lastProbe = now; return { ok: true, mult: 0.3, probe: true, why: 'deneme (genel beklenti %' + gl.mean.toFixed(2) + ')' }; }
      return { ok: false, mult: 1, why: 'hafıza: genel beklenti %' + gl.mean.toFixed(2) + ' (n=' + Math.round(gl.n) + ')' };
    }
    keysOf(f).forEach(function (k) {
      var b = m.b[k]; if (!b || b.n < s.memMinN) return; var t = stat(b);
      var hi = t.mean + s.memZ * t.se, lo = t.mean - 0.5 * t.se;
      if (hi < 0 && (!worst || hi < worst.hi)) worst = { k: k, hi: hi, mean: t.mean, n: t.n };
      if (lo > 0 && (!best || lo > best.lo)) best = { k: k, lo: lo, mean: t.mean, n: t.n };
    });
    if (worst) {
      if (now - (m.lastProbe || 0) >= s.probeMin * 60e3 * (m.probeK || 1)) { m.lastProbe = now; return { ok: true, mult: 0.3, probe: true, why: 'deneme ' + worst.k }; }
      return { ok: false, mult: 1, why: 'hafıza: ' + worst.k + ' ort %' + worst.mean.toFixed(2) + ' (n=' + worst.n + ')' };
    }
    if (!best && s.memRequire) {
      if (now - (m.lastProbe || 0) >= s.probeMin * 60e3 * (m.probeK || 1)) { m.lastProbe = now; return { ok: true, mult: 0.3, probe: true, why: 'deneme (kanıt yok)' }; }
      return { ok: false, mult: 1, why: 'hafıza: pozitif kanıt yok' };
    }
    return { ok: true, mult: best ? 1.25 : 1, why: best ? 'hafıza+ ' + best.k : '' };
  }
  /** Kapanan işlemden öğren. retPct: maliyet sonrası net getiri (%). */
  function memLearn(st, f, retPct, now) {
    var s = st.s, m = st.mem || (st.mem = newMem()); if (!f) return;
    keysOf(f).forEach(function (k) {
      var b = m.b[k] || (m.b[k] = { n: 0, sum: 0, sq: 0 });
      b.n = b.n * s.memDecay + 1; b.sum = b.sum * s.memDecay + retPct; b.sq = b.sq * s.memDecay + retPct * retPct;
    });
    m.n++;
    if (f.probe) m.probeK = retPct < 0 ? Math.min(32, (m.probeK || 1) * 2) : 1;   // kaybeden deneme aralığı büyütür, kazanan sıfırlar
    if (retPct < 0) { m.streak++; if (m.streak >= s.streakPause) m.pauseUntil = now + (m.streak - s.streakPause + 1) * 15 * 60e3; } else m.streak = 0;
  }
  /** Piyasa genişliği: sinyal verisi olan sembollerden yükseliş eğiliminde (EMA20>EMA50, fiyat>EMA50) olanların oranı. */
  function marketState(sigs) {
    var n = 0, up = 0;
    Object.keys(sigs || {}).forEach(function (k) { var g = sigs[k] && sigs[k].g, sn = g && g.snap; if (!sn || sn.ema20 == null || sn.ema50 == null) return; n++; if (sn.ema20 > sn.ema50 && g.price > sn.ema50) up++; });
    var b = n >= 5 ? up / n : null;
    return { breadth: b, n: n, state: b == null ? 'na' : b < 0.25 ? 'bear' : b < 0.5 ? 'weak' : b < 0.75 ? 'ok' : 'bull' };
  }

  function applyMode(st, mode) { Object.assign(st.s, PRESETS[mode] || PRESETS.normal); }

  function create(opts) {
    var s = Object.assign({}, DEFAULTS, opts || {});
    return { s: s, enabled: false, initial: s.initialTRY, cash: s.initialTRY, positions: [], history: [], equityLog: [], log: [],
      lastExit: {}, tradeTimes: [], seq: 1, totals: { fee: 0, tax: 0, profitTax: 0 }, mem: newMem() };
  }
  function costRate(s) { return s.feeRate + s.slipRate + s.taxRate; }

  function note(st, now, text) { st.log.unshift({ t: now, text: text }); if (st.log.length > 200) st.log.pop(); }

  /** Alış: invest TL harcar (maliyetler dahil). */
  function buy(st, sym, px, fx, invest, stop, target, now, why, feat) {
    var s = st.s;
    if (!(px > 0 && fx > 0 && invest > 0) || invest > st.cash + 1e-9) return null;
    var notional = invest / (1 + s.feeRate + s.taxRate);
    var fillPx = px * (1 + s.slipRate);
    var qty = notional / (fillPx * fx);
    var fee = notional * s.feeRate, tax = notional * s.taxRate;
    st.cash -= invest; st.totals.fee += fee; st.totals.tax += tax;
    var p = { id: st.seq++, sym: sym, qty: qty, entry: fillPx, entryFx: fx, costTRY: invest, stop: stop, target: target, peak: fillPx, openedAt: now, why: why || '', feat: feat || null };
    st.positions.push(p); st.tradeTimes.push(now);
    return p;
  }

  /** Satış: pozisyonu kapatır; net PnL (TL) döner. */
  function sell(st, id, px, fx, now, reason) {
    var s = st.s, k = st.positions.findIndex(function (p) { return p.id === id; });
    if (k < 0 || !(px > 0 && fx > 0)) return null;
    var p = st.positions[k];
    var gross = p.qty * px * (1 - s.slipRate) * fx;
    var fee = gross * s.feeRate, tax = gross * s.taxRate;
    var proceeds = gross - fee - tax, profit = proceeds - p.costTRY;
    var ptax = profit > 0 ? profit * s.profitTaxRate : 0;
    st.cash += proceeds - ptax;
    st.totals.fee += fee; st.totals.tax += tax; st.totals.profitTax += ptax;
    var rec = { id: p.id, sym: p.sym, qty: p.qty, entry: p.entry, exit: px * (1 - s.slipRate), costTRY: p.costTRY, proceedsTRY: proceeds - ptax,
      pnl: proceeds - ptax - p.costTRY, fees: fee + tax + ptax, openedAt: p.openedAt, closedAt: now, reason: reason, feat: p.feat || null, mfe: (p.peak / p.entry - 1) * 100 };
    st.history.unshift(rec); if (st.history.length > (s.histCap || 500)) st.history.pop();
    if (p.feat) memLearn(st, p.feat, rec.pnl / p.costTRY * 100, now);
    st.positions.splice(k, 1); st.lastExit[p.sym] = now; st.tradeTimes.push(now);
    return rec;
  }

  function equity(st, prices, fx) {
    var v = st.cash;
    st.positions.forEach(function (p) { v += p.qty * (prices[p.sym] || p.entry) * (fx || p.entryFx); });
    return v;
  }
  function logEquity(st, prices, fx, now, gapSec) {
    var v = equity(st, prices, fx), t = Math.floor(now / 1000), last = st.equityLog[st.equityLog.length - 1];
    if (last && t - last.time < (gapSec || 30)) { last.value = v; return; }
    st.equityLog.push({ time: t, value: v });
    if (st.equityLog.length > 5000) st.equityLog.shift();
  }

  /** Bir karar turu. ctx = {prices:{sym:USDT}, fx:USDTTRY, sigs:{sym:{g,t}}}. Dönen: olay listesi. */
  function step(st, ctx, now) {
    var s = st.s, ev = [], fx = ctx.fx, cr = costRate(s); if (!st.mem) st.mem = newMem();
    if (!(fx > 0)) return ev;
    st.tradeTimes = st.tradeTimes.filter(function (t) { return now - t < 3600e3; });

    // 1) Çıkışlar
    st.positions.slice().forEach(function (p) {
      var px = ctx.prices[p.sym]; if (!(px > 0)) return;
      if (px > p.peak) p.peak = px;
      var dist = p.target - p.entry, reason = null;
      // Kâr koruma: hedefin yarısında stop başa baş (maliyet dahil) seviyesine, %80'inde kârın %50'sine çekilir
      if (dist > 0) {
        var be = p.entry * (1 + 2 * cr + 0.001);
        if (p.peak >= p.entry + 0.5 * dist) p.stop = Math.max(p.stop, be);
        if (p.peak >= p.entry + 0.8 * dist) p.stop = Math.max(p.stop, p.entry + 0.5 * dist);
      }
      var sg = ctx.sigs && ctx.sigs[p.sym], g = sg && sg.g;
      if (px <= p.stop) reason = p.stop > p.entry ? 'Kâr koruma stopu' : 'Stop-loss';
      else if (px >= p.target) reason = 'Hedef';
      else if (g && g.label === 'SAT' && g.confidence >= s.minConf) reason = 'Sinyal SAT';
      else if (now - p.openedAt > s.maxHoldH * 3600e3) reason = 'Süre doldu';
      if (reason) {
        var rec = sell(st, p.id, px, fx, now, reason);
        if (rec) { ev.push({ type: 'sell', rec: rec }); note(st, now, 'SAT ' + p.sym + ' (' + reason + ') net ' + rec.pnl.toFixed(2) + ' TL'); }
      }
    });

    // 2) Girişler
    if (st.positions.length >= s.maxPos || st.tradeTimes.length >= s.maxTradesPerHour) return ev;
    var eq = equity(st, ctx.prices, fx), cands = [], mk = marketState(ctx.sigs);
    if (s.mktFilter && mk.breadth != null && mk.breadth < s.minBreadth) { st.mem.blocked++; return ev; }
    Object.keys(ctx.sigs || {}).forEach(function (sym) {
      var sg = ctx.sigs[sym], g = sg && sg.g, px = ctx.prices[sym];
      if (!g || !(px > 0) || g.side !== 'long') return;
      if (now - sg.t > s.sigMaxAgeMin * 60e3) return;
      if (g.confidence < s.minConf || g.rr < s.minRR || (g.regime && g.regime.key === 'highvol')) return;
      if (st.positions.some(function (p) { return p.sym === sym; })) return;
      if (st.lastExit[sym] && now - st.lastExit[sym] < s.cooldownMin * 60e3) return;
      if (px > g.price * 1.01) return;                       // sinyal fiyatından fazla kaçmış
      var stop = px - (g.price - g.stop), target = px + (g.target - g.price);
      if (!(stop > 0 && stop < px)) return;
      var net = target / px - 1 - 2 * cr;                    // gidiş-dönüş maliyet sonrası beklenen kazanç
      if (net < s.minNetGain) return;
      var feat = featOf(g, sym, mk), mult = 1;
      if (s.adaptive) { var dec = memCheck(st, feat, sym, now); var gOn = /genel beklenti/.test(dec.why || ''); if (gOn !== !!st.mem.guardOn) { st.mem.guardOn = gOn; note(st, now, gOn ? 'DEVRE KESİCİ AÇIK: ' + dec.why + ' — yalnızca küçük deneme işlemleri' : 'Devre kesici kapandı: genel beklenti toparlandı'); } if (!dec.ok) { st.mem.blocked++; return; } mult = dec.mult; st.mem.passed++; if (dec.probe) feat.probe = true; }
      cands.push({ sym: sym, px: px, g: g, stop: stop, target: target, net: net, rank: g.confidence * Math.abs(g.score), feat: feat, mult: mult });
    });
    cands.sort(function (a, b) { return b.rank - a.rank; });
    for (var i = 0; i < cands.length && st.positions.length < s.maxPos && st.tradeTimes.length < s.maxTradesPerHour; i++) {
      var c = cands[i], invest = Math.min(st.cash, eq / s.maxPos * c.mult);
      if (invest < s.minOrderTRY) break;
      var p = buy(st, c.sym, c.px, fx, invest, c.stop, c.target, now, 'skor ' + c.g.score + ', güven %' + c.g.confidence + ', R/R ' + c.g.rr.toFixed(1) + (c.mult !== 1 ? ', ×' + c.mult : ''), c.feat);
      if (p) { ev.push({ type: 'buy', position: p }); note(st, now, 'AL ' + c.sym + ' ' + invest.toFixed(2) + ' TL (' + p.why + ')'); }
    }
    return ev;
  }

  return { newMem: newMem, memCheck: memCheck, memLearn: memLearn, marketState: marketState, featOf: featOf, DEFAULTS: DEFAULTS, PRESETS: PRESETS, applyMode: applyMode, create: create, costRate: costRate, buy: buy, sell: sell, step: step, equity: equity, logEquity: logEquity };
});
