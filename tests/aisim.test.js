'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Sim = require('../js/aisim.js');

/* sentetik, tohumlu mum üretici (rastgele yürüyüş + hafif döngü) */
function gen(n, seed, startPx) {
  const rng = Sim.mulberry32(seed || 1); let px = startPx || 100; const out = [];
  for (let i = 0; i < n; i++) {
    const drift = 0.0006 * Math.sin(i / 40), r = drift + (rng() - 0.5) * 0.02;
    const o = px * (1 + (rng() - 0.5) * 0.004), c = o * (1 + r), hi = Math.max(o, c) * (1 + rng() * 0.004), lo = Math.min(o, c) * (1 - rng() * 0.004);
    out.push({ time: 1700000000 + i * 3600, open: o, high: hi, low: lo, close: c, volume: 1000 + rng() * 500 }); px = c;
  }
  return out;
}
const P0 = { warmup: 200, decisionEvery: 3, gateScore: 0, bootRuns: 50, mcRuns: 50 };

test('parseDecision: çit, <think>, fazladan metin, Türkçe action', () => {
  const d = Sim.parseDecision('<think>hmm {"x":1}</think>\nİşte:\n```json\n{"action":"AL","confidence":72,"size_pct":40,"stop_atr":1.2,"target_atr":2.5,"reason":"trend {güçlü}"}\n```\nbitti');
  assert.equal(d.action, 'buy'); assert.equal(d.confidence, 72); assert.equal(d.sizePct, 40); assert.equal(d.reason, 'trend {güçlü}');
  assert.equal(Sim.parseDecision('{"action":"hold"}').action, 'hold');
  assert.equal(Sim.parseDecision('{"decision":"sell"}').action, 'sell');
  assert.throws(() => Sim.parseDecision('karar yok'), /ayrıştırılamadı/);
  assert.throws(() => Sim.parseDecision('{"action":"yolo"}'), /Geçersiz action/);
});

test('buildContext: anonymize=true iken sembol/zaman/mutlak fiyat YOK; false iken var', async () => {
  const cs = gen(400, 3), seen = [];
  await Sim.run(cs, Object.assign({}, P0, { symbol: 'BTCUSDT', maxDecisions: 3 }), c => { seen.push(c); return { action: 'hold' }; });
  assert.ok(seen.length);
  const s = JSON.stringify(seen[0]); assert.ok(!/BTCUSDT|time_utc|"price"/.test(s));
  const seen2 = [];
  await Sim.run(cs, Object.assign({}, P0, { symbol: 'BTCUSDT', anonymize: false, maxDecisions: 2 }), c => { seen2.push(c); return { action: 'hold' }; });
  assert.equal(seen2[0].symbol, 'BTCUSDT'); assert.ok(seen2[0].time_utc && seen2[0].price > 0);
});

test('NEDENSELLİK: gelecek mumlar bozulsa geçmiş kararlar/bağlam/equity aynı kalır', async () => {
  const a = gen(520, 11), cut = 400, b = a.map((c, i) => i < cut ? c : Object.assign({}, gen(520, 999)[i]));
  const rec = () => { const log = []; return { log, fn: c => { log.push(JSON.stringify(c)); return Sim.ruleDecider(20, -20)(c); } }; };
  const ra = rec(), rb = rec();
  const PL = Object.assign({}, P0, { decisionEvery: 1 });
  const A = await Sim.run(a, PL, ra.fn), B = await Sim.run(b, PL, rb.fn);
  const pa = A.decisions.filter(d => d.i < cut), pb = B.decisions.filter(d => d.i < cut);
  assert.ok(pa.length > 20);
  assert.deepEqual(pa, pb);
  assert.deepEqual(ra.log.slice(0, pa.length), rb.log.slice(0, pb.length));
  assert.deepEqual(A.equity.slice(0, cut - 200), B.equity.slice(0, cut - 200));
});

test('ZAMANLAMA: AL kararı i kapanışında, giriş i+1 AÇILIŞINDA (+kayma)', async () => {
  const cs = gen(420, 5); let called = false;
  const r = await Sim.run(cs, Object.assign({}, P0, { maxDecisions: 50 }), () => { if (!called) { called = true; return { action: 'buy', confidence: 90, sizePct: 100, stopAtr: 4, targetAtr: 8, reason: 't' }; } return { action: 'hold' }; });
  assert.equal(r.trades.length, 1);
  const t = r.trades[0], di = r.decisions.find(d => d.executed).i;
  assert.equal(t.entryIdx, di + 1);
  assert.ok(Math.abs(t.entry - cs[di + 1].open * (1 + 0.0002)) < 1e-9);
  // bağımsız muhasebe: miktar, komisyon (iki yön) ve PnL elle hesaplanır
  const qty = 10000 / (t.entry * 1.001);
  assert.ok(Math.abs(t.qty - qty) < 1e-9, 'qty');
  assert.ok(Math.abs(t.fees - 0.001 * (t.entry * t.qty + t.exit * t.qty)) < 1e-6, 'fees');
  assert.ok(Math.abs(t.pnl - ((t.exit - t.entry) * t.qty - t.fees)) < 1e-6, 'pnl');
});

test('MUHASEBE: bitiş equity = başlangıç + Σ işlem PnL; komisyon/kayma maliyeti negatif etki', async () => {
  const cs = gen(700, 21);
  const r = await Sim.run(cs, Object.assign({}, P0, { gateScore: 10 }), Sim.ruleDecider(25, -25));
  assert.ok(r.trades.length >= 2, 'en az 2 işlem beklenir: ' + r.trades.length);
  const sum = r.trades.reduce((a, t) => a + t.pnl, 0);
  assert.ok(Math.abs(r.metrics.end - (10000 + sum)) < 1e-6, `${r.metrics.end} vs ${10000 + sum}`);
  assert.ok(r.metrics.feesPaid > 0);
  const free = await Sim.run(cs, Object.assign({}, P0, { gateScore: 10, feePct: 0, slippagePct: 0 }), Sim.ruleDecider(25, -25));
  assert.ok(free.metrics.end >= r.metrics.end - 1e-6, 'maliyetsiz sonuç daha iyi/eşit olmalı');
});

test('STOP: giriş sonrası düşen mum stop seviyesinde (veya gap ise açılışta) kapatır', async () => {
  const cs = gen(420, 8); let done = false, di = -1;
  const decide = c => { if (!done) { done = true; return { action: 'buy', confidence: 99, sizePct: 100, stopAtr: 0.5, targetAtr: 8 }; } return { action: 'hold' }; };
  const r0 = await Sim.run(cs, Object.assign({}, P0), decide); di = r0.decisions.find(d => d.executed).i;
  // giriş mumundan 2 sonrakini sert düşür
  const cs2 = cs.map(c => Object.assign({}, c)); const k = di + 3; cs2[k].low = cs2[k].open * 0.8; cs2[k].high = Math.max(cs2[k].high, cs2[k].open);
  done = false; const r = await Sim.run(cs2, P0, decide);
  const t = r.trades[0];
  assert.equal(t.reason, 'Stop'); assert.ok(t.exitIdx <= k);
  assert.ok(t.exit <= cs2[t.exitIdx].open * 1.0001);
});

test('maxHoldBars: süre dolunca sonraki açılışta çıkış', async () => {
  const cs = gen(500, 4); let done = false;
  const r = await Sim.run(cs, Object.assign({}, P0, { maxHoldBars: 10 }), () => { if (!done) { done = true; return { action: 'buy', confidence: 99, sizePct: 50, stopAtr: 4, targetAtr: 8 }; } return { action: 'hold' }; });
  const t = r.trades[0]; assert.ok(t.reason === 'Süre doldu' || t.reason === 'Stop' || t.reason === 'Hedef');
  if (t.reason === 'Süre doldu') assert.ok(t.bars >= 10 && t.bars <= 12, 'bars=' + t.bars);
});

test('minConfidence ve geçit (gate): düşük güvenli AL uygulanmaz; gate LLM çağrısını azaltır', async () => {
  const cs = gen(600, 17);
  const low = await Sim.run(cs, Object.assign({}, P0, { minConfidence: 60 }), () => ({ action: 'buy', confidence: 30, sizePct: 100 }));
  assert.equal(low.trades.length, 0);
  const all = await Sim.run(cs, Object.assign({}, P0, { gateScore: 0 }), () => ({ action: 'hold' }));
  const gated = await Sim.run(cs, Object.assign({}, P0, { gateScore: 40 }), () => ({ action: 'hold' }));
  assert.ok(gated.stats.calls < all.stats.calls && gated.stats.gated > 0);
  const capped = await Sim.run(cs, Object.assign({}, P0, { maxDecisions: 5 }), () => ({ action: 'hold' }));
  assert.equal(capped.stats.calls, 5); assert.ok(capped.stats.capped);
  assert.ok(capped.equity.length < all.equity.length, 'üst sınırda dönem kısalır'); assert.equal(capped.candles.length, 200 + capped.equity.length);
});

test('hatalar: art arda hata → durur ve error alanı; tek hata → hold olarak kaydedilir', async () => {
  const cs = gen(500, 2);
  const r = await Sim.run(cs, Object.assign({}, P0), () => { throw new Error('ağ yok'); });
  assert.match(r.error, /art arda 5/); assert.ok(r.equity.length > 0);
  let k = 0; const r2 = await Sim.run(cs, Object.assign({}, P0), () => { if (k++ === 2) throw new Error('tek'); return { action: 'hold' }; });
  assert.equal(r2.error, null); assert.equal(r2.stats.errors, 1); assert.ok(r2.decisions.some(d => d.action === 'error'));
});

test('iptal sinyali: AbortController ile kısmi sonuç döner', async () => {
  const ctl = new AbortController(), cs = gen(600, 6); let n = 0;
  const r = await Sim.run(cs, P0, () => { if (++n === 5) ctl.abort(); return { action: 'hold' }; }, { signal: ctl.signal });
  assert.ok(r.aborted); assert.ok(r.equity.length < 600 - 200);
});

test('ölçütler: bilinen equity serisiyle Sortino/Calmar/yıllık/uzun düşüş süresi', () => {
  const cs = gen(300, 1), start = 200;
  const vals = [100, 110, 99, 99, 105, 120]; // tam 1 yıl değil; sadece formül tutarlılığı
  const equity = vals.map((v, i) => ({ time: cs[start + i].time, value: v }));
  const m = Sim.extendedMetrics(cs.slice(0, start + vals.length), equity, [], { initial: 100, warmup: start, feePct: 0, bootRuns: 10, seed: 1 });
  assert.ok(Math.abs(m.totalReturn - 20) < 1e-9);
  assert.ok(Math.abs(m.maxDD - 10) < 1e-9);          // 110 → 99
  assert.equal(m.maxUnderwaterBars, 3);               // 99, 99, 105 (< 110)
  const rets = [0.1, 99 / 110 - 1, 0, 105 / 99 - 1, 120 / 105 - 1];
  const mean = rets.reduce((a, b) => a + b) / 5, dsd = Math.sqrt(rets.reduce((a, r) => a + Math.min(r, 0) ** 2, 0) / 5), py = 365 * 24;
  assert.ok(Math.abs(m.sortino - mean / dsd * Math.sqrt(py)) < 1e-9);
  assert.ok(Math.abs(m.sharpe - Sim.sharpeOf(rets, py)) < 1e-9);
});

test('rastgele taban çizgisi: tekrarlanabilir, p∈(0,1], aşırı iyi getiride p küçük', async () => {
  const cs = gen(700, 33), r = await Sim.run(cs, Object.assign({}, P0, { gateScore: 10 }), Sim.ruleDecider(25, -25));
  assert.ok(r.trades.length >= 2);
  const P = r.params, a = Sim.randomBaseline(r.candles, P, r.trades, r.metrics.totalReturn, 200, 42), b = Sim.randomBaseline(r.candles, P, r.trades, r.metrics.totalReturn, 200, 42);
  assert.deepEqual(a, b); assert.ok(a.pValue > 0 && a.pValue <= 1); assert.ok(a.p5 <= a.p50 && a.p50 <= a.p95);
  const huge = Sim.randomBaseline(r.candles, P, r.trades, 1e6, 200, 42); assert.equal(huge.pValue, 1 / 201);
  const bm = Sim.benchmarks(cs, P, r); assert.ok(bm.rule && bm.random);
});

test('bootstrap Sharpe: kısa seri → null; uzun seri → lo<=hi', () => {
  assert.equal(Sim.bootstrapSharpe([0.01, -0.01], 8760, 50, 1), null);
  const rng = Sim.mulberry32(5), rets = Array.from({ length: 300 }, () => (rng() - 0.45) * 0.02);
  const ci = Sim.bootstrapSharpe(rets, 8760, 200, 1); assert.ok(ci.lo <= ci.hi && ci.pPositive >= 0 && ci.pPositive <= 1);
});

/* ---- LLM istemcisi: sahte fetch ---- */
function resp(status, body, headers) { return { ok: status >= 200 && status < 300, status, headers: { get: k => (headers || {})[k.toLowerCase()] }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; }
const OKBODY = { model: 'm1', choices: [{ message: { content: '{"action":"hold","confidence":10,"reason":"x"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 120, completion_tokens: 15 } };

test('chat: 429 → yeniden dener, Authorization başlığı + token sayımı', async () => {
  const calls = []; const seq = [resp(429, { error: { message: 'slow' } }, { 'retry-after': '0' }), resp(200, OKBODY)];
  const r = await Sim.chat({ baseUrl: 'http://x/v1/', apiKey: 'K', model: 'm', fetchFn: async (u, o) => { calls.push([u, o]); return seq.shift(); } }, [{ role: 'user', content: 'hi' }]);
  assert.equal(calls.length, 2); assert.equal(calls[0][0], 'http://x/v1/chat/completions');
  assert.equal(calls[0][1].headers.authorization, 'Bearer K'); assert.equal(JSON.parse(calls[0][1].body).model, 'm');
  assert.equal(r.promptTokens, 120); assert.equal(r.completionTokens, 15);
});
test('chat: 401 yeniden denenmez; 500 retries sonunda hata; boş yanıt hata', async () => {
  let n = 0; await assert.rejects(Sim.chat({ baseUrl: 'http://x', model: 'm', fetchFn: async () => { n++; return resp(401, { error: { message: 'bad key' } }); } }, []), /401.*bad key/); assert.equal(n, 1);
  n = 0; await assert.rejects(Sim.chat({ baseUrl: 'http://x', model: 'm', retries: 2, fetchFn: async () => { n++; return resp(500, 'boom'); } }, []), /500/); assert.equal(n, 3);
  await assert.rejects(Sim.chat({ baseUrl: 'http://x', model: 'm', retries: 0, fetchFn: async () => resp(200, { choices: [{ message: { content: '' } }] }) }, []), /Boş yanıt/);
});

/* ---- sahte 9router benzeri OpenAI uyumlu sunucu, gerçek HTTP ---- */
test('uçtan uca: yerel OpenAI uyumlu sunucu ile LLM kararlarıyla tam simülasyon', async () => {
  let hits = 0, lastAuth = null, sawUser = null;
  const srv = http.createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*'); res.setHeader('content-type', 'application/json');
    if (req.method === 'GET' && req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'combo/test' }, { id: 'cc/opus' }] }));
    let b = ''; req.on('data', d => b += d); req.on('end', () => {
      hits++; lastAuth = req.headers.authorization; const j = JSON.parse(b); sawUser = j.messages[1].content;
      const ctx = JSON.parse(sawUser.slice(sawUser.indexOf('{')));
      const buy = ctx.position === 'flat' && ctx.rule_engine.score >= 20, sell = ctx.position !== 'flat' && ctx.rule_engine.score <= -10;
      const content = '<think>düşünüyorum</think>```json\n' + JSON.stringify({ action: buy ? 'buy' : sell ? 'sell' : 'hold', confidence: 80, size_pct: 60, stop_atr: 1.5, target_atr: 3, reason: 'sahte' }) + '\n```';
      res.end(JSON.stringify({ model: 'combo/test', choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 500, completion_tokens: 40 } }));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/v1`;
  try {
    assert.deepEqual(await Sim.listModels({ baseUrl: base, apiKey: 'sk-test' }), ['combo/test', 'cc/opus']);
    const cfg = { baseUrl: base, apiKey: 'sk-test', model: 'combo/test' };
    const r = await Sim.run(gen(700, 33), Object.assign({}, P0, { gateScore: 10, maxDecisions: 80 }), Sim.makeLLMDecider(cfg));
    assert.equal(r.error, null); assert.equal(lastAuth, 'Bearer sk-test'); assert.equal(r.stats.calls, hits);
    assert.equal(r.stats.promptTokens, 500 * hits); assert.equal(r.stats.model, 'combo/test');
    assert.ok(r.trades.length >= 1, 'LLM kararlarıyla en az 1 işlem'); assert.ok(r.decisions.every(d => d.action !== 'error'));
    assert.ok(!/BTC|time_utc/.test(sawUser));
  } finally { srv.close(); }
});

test('AYNI MUMDA stop ve hedef değerse ÖNCE STOP (muhafazakâr)', async () => {
  const cs = gen(420, 8); let done = false;
  const decide = () => { if (!done) { done = true; return { action: 'buy', confidence: 99, sizePct: 100, stopAtr: 1, targetAtr: 1 }; } return { action: 'hold' }; };
  const r0 = await Sim.run(cs, P0, decide), di = r0.decisions.find(d => d.executed).i;
  const cs2 = cs.map(c => Object.assign({}, c)), k = di + 2;
  cs2[k].low = cs2[k].open * 0.5; cs2[k].high = cs2[k].open * 1.5;
  done = false; const r = await Sim.run(cs2, P0, decide);
  assert.equal(r.trades[0].reason, 'Stop'); assert.ok(r.trades[0].exit < r.trades[0].entry);
});
