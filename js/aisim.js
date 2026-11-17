/* =====================================================================
 * aisim.js — LLM destekli walk-forward SİMÜLASYON motoru (gerçek geçmiş mumlar).
 *
 *  - LLM istemcisi: OpenAI uyumlu `/chat/completions` (9router, OpenRouter, LM Studio, vb.)
 *  - Karar her mumun KAPANIŞINDA yalnızca 0..i verisiyle (nedensel) istenir;
 *    emir i+1. mumun AÇILIŞINDA (+kayma +komisyon) gerçekleşir. Stop/hedef sonraki
 *    mumlarda high/low ile kontrol edilir (aynı mumda ikisi de değerse önce STOP).
 *  - Sembol ve tarih varsayılan olarak LLM'den GİZLENİR (anonymize): modelin eğitim
 *    verisinden "geleceği hatırlaması" (veri sızıntısı) riskini azaltmak için.
 *  - Ölçütler: getiri, yıllık getiri, Sharpe (+ blok-bootstrap güven aralığı), Sortino,
 *    Calmar, maks. düşüş (+süre), kazanma oranı, kâr faktörü, beklenti, ödeme oranı,
 *    toplam komisyon, devir, piyasada kalma; karşılaştırma: al-tut, kural motoru,
 *    rastgele giriş Monte Carlo (p-değeri).
 *  GERÇEK EMİR GÖNDERMEZ. Tarayıcıda window.AISim, node'da module.exports.
 * ===================================================================== */
(function (root, factory) {
  var node = typeof module === 'object' && module.exports;
  var m = factory(node ? require('./signals.js') : root.Signals, node ? require('./backtest.js') : root.Backtest);
  if (node) module.exports = m; else root.AISim = m;
})(typeof self !== 'undefined' ? self : this, function (Signals, Backtest) {
  'use strict';

  var DEFAULTS = {
    initial: 10000, feePct: 0.1, slippagePct: 0.02, warmup: 200,
    decisionEvery: 4,      // her kaç mumda bir karar turu
    gateScore: 15,         // pozisyonsuzken LLM'e yalnızca |kural skoru| >= bu ise sor (0 = hep sor)
    maxDecisions: 400,     // LLM çağrısı üst sınırı (maliyet/süre koruması)
    maxPosPct: 100, minConfidence: 50, maxHoldBars: 96,
    anonymize: true, mcRuns: 300, bootRuns: 400, seed: 42, maxConsecErrors: 5
  };

  /* ---------------- yardımcılar ---------------- */
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function num(x, d) { x = +x; return isFinite(x) ? x : d; }
  function r2(x, d) { return x == null || !isFinite(x) ? null : +(+x).toFixed(d == null ? 2 : d); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* ---------------- LLM istemcisi (OpenAI uyumlu) ---------------- */
  function trimUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }

  /** cfg: {baseUrl, apiKey, model, temperature, maxTokens, timeoutMs, retries, fetchFn} */
  async function chat(cfg, messages) {
    var f = cfg.fetchFn || fetch, retries = cfg.retries == null ? 3 : cfg.retries, lastErr;
    var body = { model: cfg.model, messages: messages, temperature: cfg.temperature == null ? 0.2 : cfg.temperature, max_tokens: cfg.maxTokens || 1500, stream: false };
    for (var a = 0; a <= retries; a++) {
      var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, timer = null;
      try {
        var headers = { 'content-type': 'application/json' };
        if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
        if (ctl) timer = setTimeout(function () { ctl.abort(); }, cfg.timeoutMs || 90000);
        var t0 = Date.now();
        var res = await f(trimUrl(cfg.baseUrl) + '/chat/completions', { method: 'POST', headers: headers, body: JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
        var raw = await res.text(), j = null; try { j = JSON.parse(raw); } catch (e) {}
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          var em = (j && (j.error && (j.error.message || j.error) || j.message)) || raw.slice(0, 200) || ('HTTP ' + res.status);
          var err = new Error('HTTP ' + res.status + ': ' + (typeof em === 'string' ? em : JSON.stringify(em)));
          err.status = res.status;
          err.retryAfter = +(res.headers && res.headers.get && res.headers.get('retry-after')) || 0;
          throw err;
        }
        var ch = j && j.choices && j.choices[0], text = ch && ch.message && ch.message.content;
        if (Array.isArray(text)) text = text.map(function (p) { return p.text || ''; }).join('');
        if (typeof text !== 'string' || !text.trim()) { var e2 = new Error('Boş yanıt (finish_reason: ' + (ch && ch.finish_reason) + ')'); e2.status = 0; e2.noRetry = false; throw e2; }
        var u = j.usage || {};
        return { text: text, ms: Date.now() - t0, model: j.model || cfg.model, promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0, finish: ch.finish_reason };
      } catch (e) {
        if (timer) clearTimeout(timer);
        lastErr = e.name === 'AbortError' ? new Error('Zaman aşımı (' + ((cfg.timeoutMs || 90000) / 1000) + ' sn)') : e;
        var st = lastErr.status;
        var retryable = st === undefined || st === 0 || st === 429 || st >= 500;
        if (!retryable || a === retries) break;
        await sleep(Math.max((lastErr.retryAfter || 0) * 1000, Math.min(8000, 400 * Math.pow(2, a))));
      }
    }
    throw lastErr;
  }

  async function listModels(cfg) {
    var f = cfg.fetchFn || fetch, headers = {};
    if (cfg.apiKey) headers.authorization = 'Bearer ' + cfg.apiKey;
    var res = await f(trimUrl(cfg.baseUrl) + '/models', { headers: headers });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var j = await res.json();
    return (j.data || j.models || []).map(function (m) { return typeof m === 'string' ? m : (m.id || m.name); }).filter(Boolean);
  }

  /* ---------------- karar ayrıştırma ---------------- */
  function extractJSON(text) {
    var t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
    for (var s = t.indexOf('{'); s >= 0; s = t.indexOf('{', s + 1)) {
      var depth = 0, inStr = false, esc = false;
      for (var k = s; k < t.length; k++) {
        var c = t[k];
        if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
        if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}' && --depth === 0) {
          try { return JSON.parse(t.slice(s, k + 1)); } catch (e) { break; }
        }
      }
    }
    return null;
  }
  var ACTIONS = { buy: 'buy', long: 'buy', al: 'buy', sell: 'sell', exit: 'sell', close: 'sell', sat: 'sell', hold: 'hold', wait: 'hold', bekle: 'hold', none: 'hold' };
  function parseDecision(text) {
    var j = extractJSON(text);
    if (!j) throw new Error('Yanıttan JSON karar ayrıştırılamadı: ' + String(text).slice(0, 120));
    var a = ACTIONS[String(j.action || j.decision || '').toLowerCase().trim()];
    if (!a) throw new Error('Geçersiz action: ' + JSON.stringify(j.action));
    return { action: a, confidence: clamp(num(j.confidence, 0), 0, 100), sizePct: num(j.size_pct, 50), stopAtr: num(j.stop_atr, 1.5), targetAtr: num(j.target_atr, 3), reason: String(j.reason || '').slice(0, 300) };
  }

  /* ---------------- bağlam + istem ---------------- */
  var SYSTEM = [
    'You are a disciplined quantitative trading analyst deciding on ONE instrument, long-only spot, with a round-trip trading cost given in the input.',
    'You only see the numeric snapshot provided. Do not assume news, fundamentals or the identity of the asset. Never invent data.',
    'Rules: if position is "flat" you may answer "buy" or "hold". If you hold a position you may answer "sell" or "hold".',
    'Be selective: trade only when the expected move clearly exceeds costs; prefer "hold" when evidence is mixed. Respect the market regime.',
    'Reply with ONE JSON object and nothing else:',
    '{"action":"buy|sell|hold","confidence":0-100,"size_pct":5-100,"stop_atr":0.5-4,"target_atr":0.5-8,"reason":"max 25 words, Turkish"}',
    'size_pct/stop_atr/target_atr matter only for "buy" (stop and target as multiples of ATR from entry).'
  ].join('\n');

  function pctChg(a, b) { return b ? (a / b - 1) * 100 : null; }

  /** i. mumda, yalnızca 0..i verisinden karar bağlamı. */
  function buildContext(candles, ind, g, i, pos, P) {
    var c = ind.close, px = c[i], A = g.snap;
    var recent = [];
    for (var k = Math.max(1, i - 19); k <= i; k++) recent.push(r2(pctChg(c[k], c[k - 1]), 2));
    var sup = (g.supports || []).filter(function (s) { return s.price < px; }).sort(function (a, b) { return b.price - a.price; })[0];
    var res = (g.resistances || []).filter(function (s) { return s.price > px; }).sort(function (a, b) { return a.price - b.price; })[0];
    var ctx = {
      timeframe: P.tf || null,
      returns_pct: { b1: r2(pctChg(c[i], c[i - 1])), b6: r2(pctChg(c[i], c[i - 6])), b24: r2(pctChg(c[i], c[i - 24])), b72: r2(pctChg(c[i], c[Math.max(0, i - 72)])) },
      last_20_bar_returns_pct: recent,
      indicators: { rsi14: r2(A.rsi, 1), macd_hist_pct_of_price: r2(A.macdHist / px * 100, 4), dist_ema20_pct: r2(pctChg(px, A.ema20)), dist_ema50_pct: r2(pctChg(px, A.ema50)),
        dist_ema200_pct: A.ema200 != null ? r2(pctChg(px, A.ema200)) : null, adx14: r2(A.adx, 1), atr_pct: r2(A.atrPct, 2), stoch_k: r2(A.stochK, 0), bollinger_pctB: r2(A.pctB, 2),
        bollinger_width_pct: A.bbWidth != null ? r2(A.bbWidth * 100, 2) : null, supertrend: A.stDir === 1 ? 'up' : 'down', volume_vs_avg: r2(A.volRatio, 2) },
      regime: g.regime.name,
      rule_engine: { score: g.score, label: g.label, confidence: g.confidence, components: g.components.map(function (x) { return { name: x.name, value: r2(x.v, 2) }; }) },
      candle_patterns: g.patterns.map(function (p) { return p.name; }),
      nearest_support_dist_pct: sup ? r2(pctChg(sup.price, px)) : null, nearest_resistance_dist_pct: res ? r2(pctChg(res.price, px)) : null,
      round_trip_cost_pct: r2((P.feePct + P.slippagePct) * 2, 3),
      position: pos ? { state: 'long', unrealized_pct: r2(pctChg(px, pos.entry)), bars_held: i - pos.entryIdx + 1, stop_dist_pct: r2(pctChg(pos.stop, px)), target_dist_pct: r2(pctChg(pos.target, px)) } : 'flat'
    };
    if (!P.anonymize) { ctx.symbol = P.symbol || null; ctx.time_utc = new Date(candles[i].time * 1000).toISOString(); ctx.price = px; }
    return ctx;
  }

  /** LLM karar verici üretir: decide(ctx) → {action,...,meta}. */
  function makeLLMDecider(cfg) {
    return async function (ctx) {
      var r = await chat(cfg, [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Snapshot (JSON):\n' + JSON.stringify(ctx) }]);
      var d = parseDecision(r.text);
      d.meta = { ms: r.ms, promptTokens: r.promptTokens, completionTokens: r.completionTokens, model: r.model };
      return d;
    };
  }

  /** Referans / test için deterministik karar verici (LLM yok). */
  function ruleDecider(buyTh, sellTh) {
    buyTh = buyTh == null ? 30 : buyTh; sellTh = sellTh == null ? -30 : sellTh;
    return function (ctx) {
      var s = ctx.rule_engine.score;
      if (ctx.position === 'flat') return s >= buyTh ? { action: 'buy', confidence: ctx.rule_engine.confidence, sizePct: 100, stopAtr: 1.5, targetAtr: 3, reason: 'kural skoru' } : { action: 'hold', confidence: 0, reason: '' };
      return s <= sellTh ? { action: 'sell', confidence: 80, reason: 'kural SAT' } : { action: 'hold', confidence: 0, reason: '' };
    };
  }

  /* ---------------- simülasyon motoru ---------------- */
  /**
   * @param candles [{time,open,high,low,close,volume}]
   * @param params  DEFAULTS üzerine yazılır (+ tf, symbol bilgi amaçlı)
   * @param decide  async (ctx) → {action, confidence, sizePct, stopAtr, targetAtr, reason, meta?}
   * @param hooks   {signal, onProgress({done,total,calls,equity,last})}
   */
  async function run(candles, params, decide, hooks) {
    hooks = hooks || {};
    var P = Object.assign({}, DEFAULTS, params || {}), n = candles.length;
    if (n < P.warmup + 30) throw new Error('Simülasyon için en az ' + (P.warmup + 30) + ' mum gerekli (mevcut: ' + n + ')');
    var ind = Signals.computeIndicators(candles);
    var fee = P.feePct / 100, slip = P.slippagePct / 100;
    var cash = P.initial, pos = null, pending = null;
    var trades = [], equity = [], decisions = [];
    var stats = { calls: 0, errors: 0, promptTokens: 0, completionTokens: 0, ms: 0, gated: 0, capped: false, model: null };
    var consec = 0, aborted = false, fatal = null;

    function openPos(i, pd) {
      var px = candles[i].open * (1 + slip), alloc = cash * clamp(pd.sizePct, 1, P.maxPosPct) / 100;
      var qty = alloc / (px * (1 + fee)), cost = qty * px, f = cost * fee;
      cash -= cost + f;
      pos = { qty: qty, entry: px, entryIdx: i, entryTime: candles[i].time, fees: f, margin: cost, sizePct: pd.sizePct, decisionIdx: pd.di, why: pd.reason,
        stop: px - pd.stopAtr * pd.atr, target: px + pd.targetAtr * pd.atr };
    }
    function closePos(i, raw, reason) {
      var px = raw * (1 - slip), gross = (px - pos.entry) * pos.qty, f = px * pos.qty * fee;
      cash += pos.margin + gross - f;
      var pnl = gross - f - pos.fees;
      trades.push({ side: 'long', entryTime: pos.entryTime, exitTime: candles[i].time, entryIdx: pos.entryIdx, exitIdx: i, decisionIdx: pos.decisionIdx, entry: pos.entry, exit: px, qty: pos.qty,
        pnl: pnl, ret: pnl / (pos.margin + pos.fees) * 100, reason: reason, bars: i - pos.entryIdx + 1, fees: pos.fees + f, notional: pos.margin + px * pos.qty, sizePct: pos.sizePct, why: pos.why });
      pos = null;
    }
    function mark(i) { var v = cash; if (pos) v += pos.margin + (candles[i].close - pos.entry) * pos.qty; equity.push({ time: candles[i].time, value: v }); }

    for (var i = P.warmup; i < n; i++) {
      if (hooks.signal && hooks.signal.aborted) { aborted = true; break; }
      var bar = candles[i];
      // 1) önceki kapanışta verilen emir bu mumun AÇILIŞINDA
      if (pending) {
        if (pending.type === 'exit' && pos) closePos(i, bar.open, pending.reason);
        else if (pending.type === 'enter' && !pos) openPos(i, pending);
        pending = null;
      }
      // 2) mum içi stop / hedef
      if (pos) {
        var hitStop = bar.low <= pos.stop, hitTgt = bar.high >= pos.target;
        if (hitStop) closePos(i, pos.entryIdx === i ? pos.stop : Math.min(bar.open, pos.stop), 'Stop');
        else if (hitTgt) closePos(i, pos.entryIdx === i ? pos.target : Math.max(bar.open, pos.target), 'Hedef');
      }
      // 3) azami tutma süresi (kapanışta karar, sonraki açılışta çıkış)
      if (pos && !pending && i - pos.entryIdx + 1 >= P.maxHoldBars && i < n - 1) pending = { type: 'exit', reason: 'Süre doldu' };
      // 4) kapanışta karar (yalnızca 0..i)
      if (i < n - 1 && !pending && (i - P.warmup) % P.decisionEvery === 0) {
        var g = Signals.scoreAt(candles, ind, i, {});
        if (g) {
          if (!pos && Math.abs(g.score) < P.gateScore) stats.gated++;
          else if (stats.calls >= P.maxDecisions) { stats.capped = true; mark(i); break; } // üst sınır: dönem burada biter (ölçütler yalnızca karar verilen pencereyi kapsar)
          else {
            var ctx = buildContext(candles, ind, g, i, pos, P), d, err = null;
            stats.calls++;
            try { d = await decide(ctx); consec = 0; }
            catch (e) { err = e; stats.errors++; consec++; d = { action: 'hold', confidence: 0, reason: '' }; }
            if (d.meta) { stats.promptTokens += d.meta.promptTokens || 0; stats.completionTokens += d.meta.completionTokens || 0; stats.ms += d.meta.ms || 0; if (d.meta.model) stats.model = d.meta.model; }
            var act = d.action, conf = clamp(num(d.confidence, 0), 0, 100), executed = false;
            if (!err) {
              if (!pos && act === 'buy' && conf >= P.minConfidence) {
                pending = { type: 'enter', di: i, atr: g.snap.atr, sizePct: clamp(num(d.sizePct, 50), 5, P.maxPosPct), stopAtr: clamp(num(d.stopAtr, 1.5), 0.5, 4), targetAtr: clamp(num(d.targetAtr, 3), 0.5, 8), reason: d.reason }; executed = true;
              } else if (pos && act === 'sell') { pending = { type: 'exit', reason: 'AI SAT' }; executed = true; }
            }
            decisions.push({ i: i, time: bar.time, price: bar.close, score: g.score, rule: g.label, action: err ? 'error' : act, confidence: conf, reason: err ? String(err.message || err).slice(0, 160) : d.reason, executed: executed, inPos: !!pos });
            if (hooks.onProgress) hooks.onProgress({ done: i - P.warmup, total: n - 1 - P.warmup, calls: stats.calls, equity: equity.length ? equity[equity.length - 1].value : P.initial, last: decisions[decisions.length - 1] });
            if (consec >= P.maxConsecErrors) { fatal = 'LLM art arda ' + consec + ' kez hata verdi: ' + String(err && err.message || err).slice(0, 200); mark(i); break; }
          }
        }
      }
      mark(i);
    }
    var lastIdx = P.warmup + equity.length - 1;
    if (pos) { closePos(lastIdx, candles[lastIdx].close, aborted || fatal || stats.capped ? 'Simülasyon durdu' : 'Dönem sonu'); equity[equity.length - 1].value = cash; }
    var used = candles.slice(0, lastIdx + 1);
    return { params: P, trades: trades, equity: equity, decisions: decisions, stats: stats, aborted: aborted, error: fatal,
      metrics: extendedMetrics(used, equity, trades, P), candles: used };
  }

  /* ---------------- ölçütler ---------------- */
  function barsPerYear(candles) { var s = candles.length > 1 ? candles[1].time - candles[0].time : 3600; return 365 * 86400 / s; }
  function sharpeOf(rets, perYear) {
    var m = 0, k; for (k = 0; k < rets.length; k++) m += rets[k]; m /= (rets.length || 1);
    var v = 0; for (k = 0; k < rets.length; k++) v += (rets[k] - m) * (rets[k] - m); var sd = Math.sqrt(v / Math.max(1, rets.length - 1));
    return sd > 0 ? m / sd * Math.sqrt(perYear) : 0;
  }
  function bootstrapSharpe(rets, perYear, runs, seed) {
    var n = rets.length; if (n < 30) return null;
    var rng = mulberry32(seed), block = Math.max(5, Math.round(Math.sqrt(n))), out = [];
    for (var r = 0; r < runs; r++) {
      var s = [];
      while (s.length < n) { var st = Math.floor(rng() * (n - block + 1)); for (var k = 0; k < block && s.length < n; k++) s.push(rets[st + k]); }
      out.push(sharpeOf(s, perYear));
    }
    out.sort(function (a, b) { return a - b; });
    return { lo: out[Math.floor(0.025 * (runs - 1))], hi: out[Math.ceil(0.975 * (runs - 1))], pPositive: out.filter(function (x) { return x > 0; }).length / runs, block: block };
  }
  function extendedMetrics(candles, equity, trades, P) {
    var base = Backtest.metrics(candles, equity, trades, P), perYear = barsPerYear(candles);
    var rets = []; for (var i = 1; i < equity.length; i++) rets.push(equity[i].value / equity[i - 1].value - 1);
    var m = rets.reduce(function (a, b) { return a + b; }, 0) / (rets.length || 1);
    var dd2 = rets.reduce(function (a, r) { return a + Math.min(r, 0) * Math.min(r, 0); }, 0) / (rets.length || 1), dsd = Math.sqrt(dd2);
    var years = equity.length / perYear, endv = base.end / base.start;
    var ann = years > 0 && endv > 0 ? (Math.pow(endv, 1 / years) - 1) * 100 : null;
    var wins = trades.filter(function (t) { return t.pnl > 0; }), loss = trades.filter(function (t) { return t.pnl <= 0; });
    var avgW = wins.length ? wins.reduce(function (a, t) { return a + t.ret; }, 0) / wins.length : 0, avgL = loss.length ? loss.reduce(function (a, t) { return a + t.ret; }, 0) / loss.length : 0;
    var peak = -Infinity, uw = 0, maxUw = 0;
    equity.forEach(function (e) { if (e.value >= peak) { peak = e.value; uw = 0; } else { uw++; if (uw > maxUw) maxUw = uw; } });
    var avgEq = equity.reduce(function (a, e) { return a + e.value; }, 0) / (equity.length || 1);
    var notional = trades.reduce(function (a, t) { return a + (t.notional || 0); }, 0);
    return Object.assign(base, {
      annReturn: ann, sortino: dsd > 0 ? m / dsd * Math.sqrt(perYear) : 0, calmar: base.maxDD > 0 && ann != null ? ann / base.maxDD : null,
      sharpeCI: bootstrapSharpe(rets, perYear, P.bootRuns, P.seed),
      avgWin: avgW, avgLoss: avgL, payoff: avgL < 0 ? avgW / -avgL : null,
      expectancyPct: trades.length ? trades.reduce(function (a, t) { return a + t.ret; }, 0) / trades.length : 0,
      expectancyUSD: trades.length ? trades.reduce(function (a, t) { return a + t.pnl; }, 0) / trades.length : 0,
      feesPaid: trades.reduce(function (a, t) { return a + (t.fees || 0); }, 0), turnover: avgEq ? notional / avgEq : 0, maxUnderwaterBars: maxUw,
      best: trades.length ? Math.max.apply(null, trades.map(function (t) { return t.ret; })) : 0, worst: trades.length ? Math.min.apply(null, trades.map(function (t) { return t.ret; })) : 0,
      avgBars: trades.length ? trades.reduce(function (a, t) { return a + t.bars; }, 0) / trades.length : 0, years: years
    });
  }

  /* ---------------- karşılaştırmalar ---------------- */
  /**
   * Rastgele-giriş Monte Carlo: AI ile AYNI işlem sayısı ve tutma süreleri, girişler rastgele
   * (çakışmasız), aynı komisyon/kayma, aynı ortalama pozisyon büyüklüğü. Stop/hedef modellenmez.
   * p = rastgele stratejinin AI'dan >= getiri elde etme olasılığı (küçükse AI şansla açıklanamaz).
   */
  function randomBaseline(candles, P, aiTrades, aiReturnPct, runs, seed) {
    var k = aiTrades.length; if (!k) return null;
    var holds = aiTrades.map(function (t) { return Math.max(1, t.exitIdx - t.entryIdx); });
    var H = holds.reduce(function (a, b) { return a + b; }, 0), first = P.warmup + 1, last = candles.length - 1;
    var free = (last - first + 1) - H; if (free < 0) return null;
    var size = aiTrades.reduce(function (a, t) { return a + (t.sizePct || 100); }, 0) / k / 100;
    var fee = P.feePct / 100, slip = P.slippagePct / 100, rng = mulberry32(seed + 7), outs = [];
    for (var r = 0; r < runs; r++) {
      var cuts = []; for (var j = 0; j < k; j++) cuts.push(Math.floor(rng() * (free + 1))); cuts.sort(function (a, b) { return a - b; });
      var order = holds.slice(); for (j = order.length - 1; j > 0; j--) { var q = Math.floor(rng() * (j + 1)), tmp = order[j]; order[j] = order[q]; order[q] = tmp; }
      var cash = P.initial, cursor = first, used = 0;
      for (j = 0; j < k; j++) {
        var s = first + cuts[j] + used, e = Math.min(last, s + order[j]); used += order[j];
        var ent = candles[s].open * (1 + slip), ex = candles[e].open * (1 - slip), alloc = cash * size;
        var qty = alloc / (ent * (1 + fee)); cash += qty * (ex - ent) - qty * ent * fee - qty * ex * fee;
      }
      outs.push((cash / P.initial - 1) * 100);
    }
    outs.sort(function (a, b) { return a - b; });
    var ge = outs.filter(function (x) { return x >= aiReturnPct; }).length;
    return { runs: runs, mean: outs.reduce(function (a, b) { return a + b; }, 0) / runs, p5: outs[Math.floor(0.05 * (runs - 1))], p50: outs[Math.floor(0.5 * (runs - 1))], p95: outs[Math.ceil(0.95 * (runs - 1))], pValue: (ge + 1) / (runs + 1), trades: k };
  }

  /** Aynı mumlarda kural motoru backtest'i (aynı maliyetler) + rastgele taban çizgisi. */
  function benchmarks(candles, P, ai) {
    P = Object.assign({}, DEFAULTS, P || {});
    var rule = null;
    try { rule = Backtest.run(candles.slice(0, ai.candles.length), { initial: P.initial, feePct: P.feePct, slippagePct: P.slippagePct, warmup: P.warmup }); } catch (e) {}
    return { rule: rule, random: randomBaseline(ai.candles, P, ai.trades, ai.metrics.totalReturn, P.mcRuns, P.seed) };
  }

  return { DEFAULTS: DEFAULTS, SYSTEM: SYSTEM, chat: chat, listModels: listModels, extractJSON: extractJSON, parseDecision: parseDecision, buildContext: buildContext,
    makeLLMDecider: makeLLMDecider, ruleDecider: ruleDecider, run: run, extendedMetrics: extendedMetrics, randomBaseline: randomBaseline, benchmarks: benchmarks,
    sharpeOf: sharpeOf, bootstrapSharpe: bootstrapSharpe, mulberry32: mulberry32 };
});
