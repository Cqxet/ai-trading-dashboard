'use strict';
const test = require('node:test'), assert = require('node:assert');
const Bot = require('../js/bot.js'), Signals = require('../js/signals.js');
const R = require('../tools/botreplay.js');
const T0 = 1e12, MIN = 60e3;
const sig = (o) => Object.assign({ side: 'long', label: 'AL', confidence: 70, rr: 2, score: 50, price: 100, stop: 97, target: 106, regime: { key: 'trend_up' },
  snap: { rsi: 55, atrPct: 0.5, ema20: 101, ema50: 100 } }, o);
const feat = (o) => Object.assign(Bot.featOf(sig(), 'AAA', { state: 'ok' }), o);
const learnN = (st, f, ret, n, t0) => { for (let i = 0; i < n; i++) Bot.memLearn(st, f, ret, (t0 || T0) + i * MIN); };

test('hafıza: yeterli veri yokken geçirir (keşif), yeterli kayıpta kovayı bloklar', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false, streakPause: 99 }), f = feat();
  assert.equal(Bot.memCheck(st, f, 'AAA', T0).ok, true, 'veri yok → geçer');
  learnN(st, f, -0.8, 5); assert.equal(Bot.memCheck(st, f, 'AAA', T0 + 1e6).ok, true, 'n<memMinN → geçer');
  learnN(st, f, -0.8, 10);
  const p = Bot.memCheck(st, f, 'AAA', T0 + 2e6); assert.ok(p.ok && p.probe && p.mult === 0.3, 'bloklu kovada ilk istek deneme bütçesinden geçer');
  const d = Bot.memCheck(st, f, 'AAA', T0 + 2e6 + MIN);
  assert.equal(d.ok, false); assert.match(d.why, /hafıza/);
});
test('hafıza: pozitif kanıtlı kova büyüklüğü artırır, negatif olmayan başka kova etkilenmez', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false, streakPause: 99 }), good = feat({ sym: 'GOOD' });
  learnN(st, good, 1.2, 14);
  const d = Bot.memCheck(st, good, 'GOOD', T0 + 1e7); assert.equal(d.ok, true); assert.equal(d.mult, 1.25);
  const other = feat({ sym: 'OTHER', reg: 'range', conf: 0, rsi: 0, vol: 0, mkt: 'bear' });
  assert.equal(Bot.memCheck(st, other, 'OTHER', T0 + 1e7).ok, true, 'ilgisiz kova bloklanmaz');
  const st2 = Bot.create({ adaptive: true, globalGuard: false, streakPause: 99 }); assert.equal(Bot.memCheck(st2, other, 'OTHER', T0).mult, 1, 'kanıt yoksa çarpan 1');
});
test('unutma: eski kayıplar yeni kazançlarla silinir, kova yeniden açılır', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false, streakPause: 99 }), f = feat();
  learnN(st, f, -1, 20); st.mem.lastProbe = T0 + 1e7 - 1; assert.equal(Bot.memCheck(st, f, 'AAA', T0 + 1e7).ok, false);
  learnN(st, f, 1.5, 80, T0 + 2e7); const dd = Bot.memCheck(st, f, 'AAA', T0 + 3e8); assert.ok(dd.ok && !dd.probe, 'kova gerçekten açıldı (deneme değil)');
});
test('unutma (ayırt edici): 40 eski kayıp + 25 yeni kazanç → kova açılır (unutmasız ortalama hâlâ negatif olurdu)', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false, streakPause: 99 }), f = feat();
  learnN(st, f, -1, 40); learnN(st, f, 1, 25, T0 + 5e7);
  const g = st.mem.b['r:' + f.reg + '|c:' + f.conf]; assert.ok(g.sum / g.n > 0, 'decay ile ortalama pozitif: ' + (g.sum / g.n).toFixed(3));
  const d = Bot.memCheck(st, f, 'AAA', T0 + 9e7); assert.ok(d.ok && !d.probe, 'bölge açıldı');
});
test('genel devre kesici: toplam beklenti negatifken YENİ kova da bloklanır; deneme bütçesi + üstel geri çekilme', () => {
  const st = Bot.create({ adaptive: true, probeMin: 240 }), f = feat({ sym: 'S1' });
  learnN(st, f, -0.7, 15);
  const fresh = feat({ sym: 'NEW', reg: 'range', conf: 3, rsi: 2, vol: 1, mkt: 'bull' });   // hiç görülmemiş kova
  let t = T0 + 1e8;
  const d1 = Bot.memCheck(st, fresh, 'NEW', t); assert.equal(d1.ok, true, 'ilk deneme izinli'); assert.equal(d1.mult, 0.3); assert.ok(d1.probe);
  assert.equal(Bot.memCheck(st, fresh, 'NEW', t + 60 * MIN).ok, false, 'deneme aralığı dolmadan yok');
  assert.equal(Bot.memCheck(st, fresh, 'NEW', t + 241 * MIN).ok, true, 'aralık dolunca bir deneme daha');
  // kaybeden deneme aralığı ikiye katlar
  Bot.memLearn(st, Object.assign({}, fresh, { probe: true }), -0.9, t + 250 * MIN); assert.equal(st.mem.probeK, 2);
  Bot.memLearn(st, Object.assign({}, fresh, { probe: true }), -0.9, t + 251 * MIN); assert.equal(st.mem.probeK, 4);
  assert.equal(Bot.memCheck(st, fresh, 'NEW', st.mem.lastProbe + 300 * MIN).ok, false, '4x aralık: 300 dk yetmez');
  Bot.memLearn(st, Object.assign({}, fresh, { probe: true }), +2, t + 252 * MIN); assert.equal(st.mem.probeK, 1, 'kazanç sıfırlar');
});
test('genel koruma kapalıyken (globalGuard:false) yeni kova geçer', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false }), f = feat({ sym: 'S1' }); learnN(st, f, -0.7, 15);
  assert.equal(Bot.memCheck(st, feat({ sym: 'NEW', reg: 'range', conf: 3, rsi: 2, vol: 1, mkt: 'bull' }), 'NEW', T0 + 1e8).ok, true);
});
test('seri zarar molası: streakPause kadar üst üste zarardan sonra giriş yok', () => {
  const st = Bot.create({ adaptive: true, globalGuard: false }), f = feat({ sym: 'S2' });
  for (let i = 0; i < 4; i++) Bot.memLearn(st, f, -0.5, T0 + i * MIN);
  assert.ok(st.mem.pauseUntil > T0 + 3 * MIN);
  assert.equal(Bot.memCheck(st, feat({ sym: 'Z' }), 'Z', T0 + 5 * MIN).ok, false);
  assert.equal(Bot.memCheck(st, feat({ sym: 'Z' }), 'Z', st.mem.pauseUntil + 1).ok, true);
  Bot.memLearn(st, f, +1, T0 + 99 * MIN); assert.equal(st.mem.streak, 0);
});
test('piyasa genişliği: marketState eşikleri ve mktFilter girişi engeller', () => {
  const mk = (n, upN) => { const o = {}; for (let i = 0; i < n; i++) o['S' + i] = { g: sig({ price: i < upN ? 101 : 99, snap: { ema20: i < upN ? 101 : 99, ema50: 100, rsi: 55, atrPct: 0.5 } }), t: T0 }; return o; };
  assert.equal(Bot.marketState(mk(10, 1)).state, 'bear'); assert.equal(Bot.marketState(mk(10, 4)).state, 'weak');
  assert.equal(Bot.marketState(mk(10, 6)).state, 'ok'); assert.equal(Bot.marketState(mk(10, 9)).state, 'bull');
  assert.equal(Bot.marketState(mk(3, 3)).breadth, null, '5 sembolden azsa bilinmez');
  const ctx = (sigs) => ({ prices: { S0: 100, S9: 100 }, fx: 40, sigs: sigs });
  const bear = mk(10, 1); bear.S9 = { g: sig({ price: 100, snap: { ema20: 101, ema50: 100, rsi: 55, atrPct: 0.5 } }), t: T0 };
  assert.equal(Bot.step(Bot.create({ mktFilter: true, adaptive: false }), ctx(bear), T0).length, 0, 'zayıf piyasada giriş yok');
  assert.ok(Bot.step(Bot.create({ mktFilter: false, adaptive: false }), ctx(bear), T0).length >= 1, 'filtre kapalıyken girer');
});
test('step: adaptif açıkken kapanan işlem hafızaya yazılır; eski kayıtta (mem yok) çökmez', () => {
  const st = Bot.create({ adaptive: true }); delete st.mem;
  const c = (px) => ({ prices: { AAA: px }, fx: 40, sigs: { AAA: { g: sig(), t: T0 } } });
  assert.equal(Bot.step(st, c(100), T0)[0].type, 'buy'); assert.ok(st.mem && st.positions[0].feat);
  const ev = Bot.step(st, c(96), T0 + 1000); assert.equal(ev[0].type, 'sell');
  assert.equal(st.mem.n, 1); assert.ok(st.mem.b['g:all'].n > 0 && st.mem.b['g:all'].sum < 0, 'zarar genel kovaya yazıldı');
});
test('maliyet oranları değiştirilmedi', () => {
  assert.equal(Bot.DEFAULTS.feeRate, 0.001); assert.equal(Bot.DEFAULTS.slipRate, 0.0005); assert.equal(Bot.DEFAULTS.taxRate, 0);
  assert.equal(Bot.PRESETS.super.minConf, 20); assert.equal(Bot.PRESETS.normal.minConf, 55);
});

/* ---- replay: gelecek sızıntısı yok, deterministik ---- */
function synth(n, seed, drift) {
  let a = seed; const rng = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  let px = 100; const cs = [];
  for (let i = 0; i < n; i++) { const o = px * (1 + (rng() - .5) * .002), c = o * (1 + drift + (rng() - .5) * .02); cs.push({ time: 1.7e9 + i * 3600, open: o, high: Math.max(o, c) * 1.002, low: Math.min(o, c) * .998, close: c, volume: 100 + rng() * 50 }); px = c; }
  return cs;
}
test('replay: deterministik ve gelecek mumlar bozulsa geçmiş equity aynı kalır', () => {
  const build = (corruptFrom) => { const data = {}; for (let k = 0; k < 8; k++) { const cs = synth(900, 10 + k, -0.0003); data['S' + k + 'USDT'] = corruptFrom ? cs.map((c, i) => i < corruptFrom ? c : synth(900, 500 + k, 0.002)[i]) : cs; } return R.prepare(data, '1h'); };
  const o = { botOpts: { initialTRY: 100000 }, topN: 8 };
  const A = R.replay(build(0), 'normal', o), A2 = R.replay(build(0), 'normal', o), B = R.replay(build(700), 'normal', o);
  assert.deepEqual(A.eq, A2.eq, 'aynı girdi → aynı sonuç');
  const cut = 700 - 210 - 1;
  assert.deepEqual(A.eq.slice(0, cut), B.eq.slice(0, cut), 'bozulan gelecek geçmiş equity\'yi değiştirmedi');
  assert.ok(A.trades > 5, 'sentetik veride işlem oluştu: ' + A.trades);
});
test('replay: hafıza açıkken kayıplı sentetik piyasada, kapalıya göre daha az işlem ve daha az zarar', () => {
  const data = {}; for (let k = 0; k < 10; k++) data['S' + k + 'USDT'] = synth(1500, 70 + k, -0.0004);
  const P = R.prepare(data, '1h'), base = { initialTRY: 100000 };
  const off = R.replay(P, 'normal', { botOpts: Object.assign({}, base, { adaptive: false, mktFilter: false }), topN: 10 });
  const on = R.replay(P, 'normal', { botOpts: Object.assign({}, base), topN: 10 });
  assert.ok(off.ret < -1, 'kapalıyken zarar: ' + off.ret);
  assert.ok(on.trades < off.trades && on.ret > off.ret, `açık ${on.ret.toFixed(1)}% (${on.trades}) > kapalı ${off.ret.toFixed(1)}% (${off.trades})`);
});
