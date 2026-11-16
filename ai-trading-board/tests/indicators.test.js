// node --test tests/   (bağımlılık yok)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const TA = require('../js/indicators.js');

const close = (a, b, eps = 1e-9, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg || ''} beklenen ${b}, bulunan ${a}`);
const mk = (o, h, l, c, v = 1, t = 0) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

test('SMA: elle hesaplanan değerler', () => {
  const r = TA.sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(r, [null, null, 2, 3, 4]);
});

test('EMA: SMA tohumu + k=2/(p+1) (p=3, k=0.5)', () => {
  // seed=(1+2+3)/3=2 ; e4=4*.5+2*.5=3 ; e5=4 ...  → EMA = x-1
  const r = TA.ema([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  for (let i = 2; i < 10; i++) close(r[i], i + 1 - 1);
});

test('EMA: doğrusal seride kesin gecikme (p-1)/2', () => {
  const x = Array.from({ length: 100 }, (_, i) => i * 2 + 5);
  const e = TA.ema(x, 10);
  for (let i = 9; i < 100; i++) close(e[i], x[i] - 2 * (10 - 1) / 2, 1e-9);
});

test('EMA: sabit seri sabit kalır, baştaki null atlanır', () => {
  const e = TA.ema([null, null, 5, 5, 5, 5, 5], 3);
  assert.deepEqual(e, [null, null, null, null, 5, 5, 5]);
});

test('RSI: StockCharts referans verisi (14) → 70.53, 66.32, 66.55', () => {
  const c = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282, 46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122];
  const r = TA.rsi(c, 14);
  assert.equal(r[13], null);
  close(r[14], 70.53, 0.01, 'RSI[14]');
  close(r[15], 66.32, 0.01, 'RSI[15]');
  close(r[16], 66.55, 0.01, 'RSI[16]');
});

test('RSI: sürekli artış=100, sürekli düşüş=0, eşit salınım=50', () => {
  const up = Array.from({ length: 30 }, (_, i) => i);
  const dn = up.map(x => 100 - x);
  const zig = Array.from({ length: 30 }, (_, i) => (i % 2 ? 11 : 10));
  close(TA.rsi(up, 14)[29], 100);
  close(TA.rsi(dn, 14)[29], 0);
  close(TA.rsi(zig, 14)[14], 50, 1e-9);
});

test('MACD: doğrusal seride macd = 7, sinyal = 7, histogram = 0', () => {
  const x = Array.from({ length: 120 }, (_, i) => i + 1);
  const m = TA.macd(x, 12, 26, 9);
  assert.equal(m.macd[24], null);
  close(m.macd[25], 7, 1e-9);
  assert.equal(m.signal[32], null);
  close(m.signal[33], 7, 1e-9);
  close(m.hist[119], 0, 1e-9);
});

test('MACD: sinyal = macd serisinin EMA(9)\'u', () => {
  const x = Array.from({ length: 200 }, (_, i) => 100 + 10 * Math.sin(i / 7) + i * 0.1);
  const m = TA.macd(x);
  const s = TA.ema(m.macd, 9);
  for (let i = 0; i < 200; i++) assert.equal(m.signal[i], s[i]);
});

test('Bollinger: [2,4,4,4,5,5,7,9] p=8 → orta 5, σ=2 → üst 9, alt 1', () => {
  const b = TA.bollinger([2, 4, 4, 4, 5, 5, 7, 9], 8, 2);
  close(b[7].mid, 5); close(b[7].upper, 9); close(b[7].lower, 1);
  close(b[7].pctB, (9 - 1) / 8);
});

test('True Range ve ATR (Wilder) elle hesap', () => {
  const cs = [mk(10, 12, 9, 11), mk(11, 14, 10, 13), mk(13, 13, 8, 9), mk(9, 10, 7, 8)];
  // TR: 3, max(4,3,1)=4, max(5,0,5)=5, max(3,1,2)=3
  assert.deepEqual(TA.trueRange(cs), [3, 4, 5, 3]);
  const a = TA.atr(cs, 3);
  assert.deepEqual(a.slice(0, 2), [null, null]);
  close(a[2], 4);                 // (3+4+5)/3
  close(a[3], (4 * 2 + 3) / 3);   // Wilder
});

test('Stokastik: elle hesap (%K=14, yumuşatma 1)', () => {
  const cs = Array.from({ length: 5 }, (_, i) => mk(0, 10 + i, i, 5 + i));
  const s = TA.stochastic(cs, 3, 1, 2);
  // i=2: HH=12, LL=0, C=7 → 58.333 ; i=3: HH=13 LL=1 C=8 → 58.333; i=4: HH=14 LL=2 C=9 → 58.333
  close(s.k[2], 700 / 12, 1e-9);
  close(s.d[3], 700 / 12, 1e-9);
  assert.equal(s.k[1], null);
});

test('OBV: elle hesap', () => {
  const cs = [mk(0, 0, 0, 10, 100), mk(0, 0, 0, 11, 50), mk(0, 0, 0, 10, 30), mk(0, 0, 0, 10, 99), mk(0, 0, 0, 12, 20)];
  assert.deepEqual(TA.obv(cs), [0, 50, 20, 20, 40]);
});

test('VWAP: tipik fiyat ağırlıklı, UTC gün başında sıfırlanır', () => {
  const d0 = 86400 * 100;
  const cs = [
    { time: d0, open: 0, high: 12, low: 6, close: 9, volume: 1 },          // tp 9
    { time: d0 + 3600, open: 0, high: 15, low: 9, close: 12, volume: 3 },   // tp 12
    { time: d0 + 86400, open: 0, high: 3, low: 1, close: 2, volume: 5 }     // yeni gün tp 2
  ];
  const v = TA.vwap(cs);
  close(v[0], 9); close(v[1], (9 + 36) / 4); close(v[2], 2);
});

test('Supertrend: yükselişte fiyatın altında (dir=1), düşüşte üstünde (dir=-1), dönüş yakalanır', () => {
  const cs = [];
  for (let i = 0; i < 60; i++) { const p = 100 + i; cs.push(mk(p - 0.5, p + 1, p - 1, p + 0.5)); }
  for (let i = 0; i < 60; i++) { const p = 160 - i * 2; cs.push(mk(p + 0.5, p + 1, p - 1, p - 0.5)); }
  const st = TA.supertrend(cs, 10, 3);
  assert.equal(st.dir[55], 1); assert.ok(st.value[55] < cs[55].close);
  assert.equal(st.dir[119], -1); assert.ok(st.value[119] > cs[119].close);
  const flip = st.dir.findIndex((d, i) => i > 60 && d === -1);
  assert.ok(flip > 60 && flip < 75, 'dönüş indeksi ' + flip);
  // Yükselişte alt bant hiç düşmez (nihai bant kuralı)
  for (let i = 12; i < 58; i++) assert.ok(st.value[i] >= st.value[i - 1] - 1e-9);
});

test('ADX: güçlü trendde yüksek, testere piyasada düşük', () => {
  const tr = Array.from({ length: 120 }, (_, i) => mk(100 + i, 101 + i, 99.5 + i, 100.8 + i));
  const zz = Array.from({ length: 120 }, (_, i) => { const p = 100 + (i % 2 ? 1 : -1); return mk(p, p + 1, p - 1, p); });
  const a1 = TA.adx(tr, 14).adx[119], a2 = TA.adx(zz, 14).adx[119];
  assert.ok(a1 > 50, 'trend ADX ' + a1);
  assert.ok(a2 < 20, 'yatay ADX ' + a2);
});

test('Heikin-Ashi: elle hesap', () => {
  const ha = TA.heikinAshi([mk(10, 14, 8, 12), mk(12, 15, 11, 14)]);
  close(ha[0].close, 11); close(ha[0].open, 11);
  close(ha[1].close, 13); close(ha[1].open, 11); close(ha[1].high, 15); close(ha[1].low, 11);
});

test('Pearson: tam pozitif/negatif ve sabit seri', () => {
  close(TA.pearson([1, 2, 3, 4], [2, 4, 6, 8]), 1);
  close(TA.pearson([1, 2, 3, 4], [8, 6, 4, 2]), -1);
  assert.equal(TA.pearson([1, 1, 1], [1, 2, 3]), null);
});

test('Nedensellik: her gösterge i. değerde gelecek veriyi kullanmaz', () => {
  const cs = Array.from({ length: 300 }, (_, i) => { const p = 100 + 20 * Math.sin(i / 9) + i * 0.05; return mk(p, p + 1 + (i % 3), p - 1 - (i % 2), p + Math.cos(i), 10 + (i % 7), i * 3600); });
  const cut = 200, part = cs.slice(0, cut + 1);
  const cl = cs.map(c => c.close), clp = part.map(c => c.close);
  const pairs = [
    [TA.ema(cl, 20), TA.ema(clp, 20)], [TA.rsi(cl), TA.rsi(clp)], [TA.macd(cl).hist, TA.macd(clp).hist],
    [TA.atr(cs), TA.atr(part)], [TA.supertrend(cs).value, TA.supertrend(part).value], [TA.obv(cs), TA.obv(part)],
    [TA.vwap(cs), TA.vwap(part)], [TA.stochastic(cs).d, TA.stochastic(part).d], [TA.adx(cs).adx, TA.adx(part).adx],
    [TA.bollinger(cl).map(b => b && b.upper), TA.bollinger(clp).map(b => b && b.upper)]
  ];
  pairs.forEach(([full, p], k) => { for (let i = 0; i <= cut; i++) assert.equal(full[i], p[i], `gösterge #${k} indeks ${i}`); });
});
