'use strict';
const test = require('node:test'), assert = require('node:assert');
const Bot = require('../js/bot.js'), R = require('../tools/botreplay.js');
const DAY = 86400, H = 3600e3, T0 = 1.7e12;

/** Günlük mum üretici: segmentlerle (adım sayısı, günlük getiri) */
function candles(segs, start) {
  const out = []; let px = start || 100, t = 1.6e9;
  segs.forEach(([n, r]) => { for (let i = 0; i < n; i++) { const o = px, c = px * (1 + r); out.push({ time: t, open: o, high: Math.max(o, c) * 1.003, low: Math.min(o, c) * 0.997, close: c, volume: 1000 }); px = c; t += DAY; } });
  return out;
}

test('trendWant donchian: yatayda 0; kırılımda 1; 20g dibin altında 0; arada durum korunur', () => {
  const flat = candles([[100, 0]]);
  assert.equal(Bot.trendWant(flat, 'donchian').want, 0, 'yatay: kırılım yok');
  const up = candles([[100, 0], [30, 0.01]]); assert.equal(Bot.trendWant(up, 'donchian').want, 1, 'yükselişte durumda');
  const pull = candles([[100, 0], [30, 0.01], [5, -0.004]]); assert.equal(Bot.trendWant(pull, 'donchian').want, 1, 'küçük geri çekilmede hâlâ durumda (histerezis)');
  const crash = candles([[100, 0], [30, 0.01], [30, -0.02]]); assert.equal(Bot.trendWant(crash, 'donchian').want, 0, '20g dibi kırınca çıkış');
  assert.equal(Bot.trendWant(candles([[30, 0.01]]), 'donchian').want, null, 'veri yetersiz → karar yok');
});
test('trendWant sma / ema', () => {
  const up = candles([[260, 0.004]]), dn = candles([[260, -0.004]]);
  assert.equal(Bot.trendWant(up, 'sma').want, 1); assert.equal(Bot.trendWant(dn, 'sma').want, 0);
  assert.equal(Bot.trendWant(up, 'ema').want, 1); assert.equal(Bot.trendWant(dn, 'ema').want, 0);
  assert.equal(Bot.trendWant(candles([[120, 0.004]]), 'sma').want, null); assert.equal(Bot.trendWant(candles([[120, 0.004]]), 'ema').want, null);
});
test('trendWant nedensel: sonraki mumlar eklenince önceki karar aynı verilerle aynı', () => {
  const cs = candles([[100, 0], [40, 0.01], [40, -0.02]]);
  for (const k of [120, 135, 150, 170]) assert.deepEqual(Bot.trendWant(cs.slice(0, k), 'donchian'), Bot.trendWant(cs.slice(0, k).concat(candles([[30, 0.05]])), 'donchian') && Bot.trendWant(cs.slice(0, k), 'donchian'));
  // asıl nedensellik: fonksiyon yalnızca verilen diziyi okur (gelecek parametresi yok); iki kopya aynı sonucu verir
  assert.deepEqual(Bot.trendWant(cs.slice(0, 150), 'sma'), Bot.trendWant(cs.slice(0, 150).map(c => Object.assign({}, c)), 'sma'));
});

const mk = (o) => Bot.create(Object.assign({ mode: 'trend', maxPos: 4, initialTRY: 1000 }, o));
const ctx = (prices, trend) => ({ prices: prices, fx: 40, sigs: {}, trend: trend });
const tr = (want, t, rank, why) => ({ want: want, why: why || 'test', t: t == null ? T0 : t, rank: rank == null ? 0 : rank });

test('trend adımı: eşit büyüklükte girer, maxPos aşmaz, aynı sembole tekrar girmez, kural çıkışı verir', () => {
  const st = mk(), P = { A: 100, B: 50, C: 20, D: 10, E: 5 };
  let ev = Bot.step(st, ctx(P, { A: tr(1, T0, 0), B: tr(1, T0, 1), C: tr(1, T0, 2), D: tr(1, T0, 3), E: tr(1, T0, 4) }), T0);
  assert.equal(ev.filter(e => e.type === 'buy').length, 4, 'maxPos=4');
  assert.deepEqual(st.positions.map(p => p.sym), ['A', 'B', 'C', 'D'], 'rank sırasıyla');
  const sizes = st.positions.map(p => p.costTRY); assert.ok(sizes.every(x => Math.abs(x - 250) < 1e-6), 'eşit büyüklük: ' + sizes);
  assert.equal(Bot.step(st, ctx(P, { A: tr(1, T0), E: tr(1, T0, 4) }), T0 + 1000).length, 0, 'dolu + tekrar giriş yok');
  ev = Bot.step(st, ctx(P, { A: tr(0, T0 + 1000, 0, '20g dip kırıldı') }), T0 + 1000);
  assert.equal(ev.length, 1); assert.match(ev[0].rec.reason, /Trend bitti/);
  assert.equal(st.positions.length, 3);
});
test('trend adımı: sabit stop/hedef YOK (−%20 düşüşte kural sürerse çıkmaz), felaket stopu −%40\'ta çıkar', () => {
  const st = mk(); Bot.step(st, ctx({ A: 100 }, { A: tr(1) }), T0);
  assert.equal(Bot.step(st, ctx({ A: 80 }, { A: tr(1) }), T0 + 1000).length, 0, '−%20: kural hâlâ 1');
  assert.equal(Bot.step(st, ctx({ A: 130 }, { A: tr(1) }), T0 + 2000).length, 0, '+%30: hedef yok');
  const ev = Bot.step(st, ctx({ A: 59 }, { A: tr(1) }), T0 + 3000);
  assert.equal(ev.length, 1, 'çıkış var, aynı turda geri alış YOK'); assert.equal(ev[0].rec.reason, 'Felaket stopu');
  assert.equal(Bot.step(st, ctx({ A: 60 }, { A: tr(1, T0 + 4000) }), T0 + 4000).length, 0, 'kural hâlâ 1: engelli');
  assert.equal(Bot.step(st, ctx({ A: 60 }, { A: tr(0, T0 + 5000) }), T0 + 5000).length, 0, 'kural 0: engel kalkar, giriş yok');
  assert.equal(Bot.step(st, ctx({ A: 62 }, { A: tr(1, T0 + 6000) }), T0 + 6000)[0].type, 'buy', 'kural yeniden 1: yeniden girer');
});
test('trend adımı: eski veri (>36 sa) ile ne giriş ne çıkış; eksik sembol verisinde pozisyon tutulur', () => {
  const st = mk(); assert.equal(Bot.step(st, ctx({ A: 100 }, { A: tr(1, T0 - 40 * H) }), T0).length, 0, 'eski → giriş yok');
  Bot.step(st, ctx({ A: 100 }, { A: tr(1) }), T0);
  assert.equal(Bot.step(st, ctx({ A: 100 }, { A: tr(0, T0 - 40 * H) }), T0).length, 0, 'eski "0" → çıkış yok');
  assert.equal(Bot.step(st, ctx({ A: 100 }, {}), T0 + 1000).length, 0, 'sembol verisi yok → tut');
  assert.equal(st.positions.length, 1);
});
test('trend adımı: maliyetler uygulanır (değişmeyen fiyatta gidiş-dönüş ≈ 2×maliyet), kur yoksa işlem yok', () => {
  const st = mk({ initialTRY: 1000, maxPos: 1 }); Bot.step(st, ctx({ A: 100 }, { A: tr(1) }), T0);
  Bot.step(st, ctx({ A: 100 }, { A: tr(0, T0 + 1000) }), T0 + 1000);
  const loss = 1000 - st.cash, exp = 1000 * 2 * Bot.costRate(st.s); assert.ok(loss > 0 && Math.abs(loss - exp) / exp < 0.1, `kayıp ${loss.toFixed(3)} ≈ ${exp.toFixed(3)}`);
  assert.equal(Bot.step(mk(), { prices: { A: 100 }, fx: 0, sigs: {}, trend: { A: tr(1) } }, T0).length, 0);
});
test('trend modu ön ayarı: günlük, 8 pozisyon; diğer modların ayarları ve maliyet oranları değişmedi', () => {
  const st = Bot.create(); Bot.applyMode(st, 'trend'); assert.equal(st.s.mode, 'trend'); assert.equal(st.s.tf, '1d'); assert.equal(st.s.maxPos, 8);
  assert.equal(Bot.DEFAULTS.feeRate, 0.001); assert.equal(Bot.DEFAULTS.slipRate, 0.0005);
  assert.equal(Bot.PRESETS.super.minConf, 20); assert.equal(Bot.PRESETS.fast.maxHoldH, 3);
});

test('trend replay: çöküş içeren sentetik piyasada al-tuttan çok daha küçük düşüş; deterministik', () => {
  const data = {}; for (let k = 0; k < 6; k++) data['S' + k + 'USDT'] = candles([[300, 0.008 + k * 0.0005], [80, -0.02], [200, 0.01]], 100);
  const o = { botOpts: { initialTRY: 1e6, maxPos: 6, trendRule: 'donchian' }, topN: 6 };
  const a = R.replayTrend(data, o), b = R.replayTrend(data, o);
  assert.deepEqual(a.eq, b.eq, 'deterministik');
  // al-tut düşüşü: tepe→dip
  const bh = []; const dates = a.dates, idx = (s, d) => data[s].findIndex(c => Math.floor(c.time / 86400) === d);
  dates.forEach(d => { let v = 0; Object.keys(data).forEach(s => { const i = idx(s, d); v += data[s][i].close / data[s][0].close; }); bh.push(v / 6); });
  let pk = -Infinity, bdd = 0; bh.forEach(v => { pk = Math.max(pk, v); bdd = Math.max(bdd, (pk - v) / pk); });
  assert.ok(a.trades >= 6, 'işlem oluştu: ' + a.trades);
  assert.ok(a.mdd < bdd * 100 * 0.6, `trend DD %${a.mdd.toFixed(1)} < al-tut DD %${(bdd * 100).toFixed(1)} × 0.6`);
});
test('trend replay: gelecek mumlar bozulsa geçmiş equity aynı kalır', () => {
  const mkd = (corrupt) => { const d = {}; for (let k = 0; k < 4; k++) { const cs = candles([[400, 0.002], [100, -0.01], [100, 0.006]], 100 + k); d['S' + k + 'USDT'] = corrupt ? cs.map((c, i) => i < 500 ? c : Object.assign({}, c, { open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3 })) : cs; } return d; };
  const o = { botOpts: { initialTRY: 1e6, maxPos: 4 }, topN: 4 }, A = R.replayTrend(mkd(false), o), B = R.replayTrend(mkd(true), o);
  const k = A.dates.findIndex(d => d >= Math.floor(1.6e9 / 86400) + 500) - 1;
  assert.ok(k > 50); assert.deepEqual(A.eq.slice(0, k), B.eq.slice(0, k));
});
