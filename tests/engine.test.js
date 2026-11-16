// Sinyal motoru, backtest, paper trading ve yardımcılar için testler.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/signals.js');
const BT = require('../js/backtest.js');
const Paper = require('../js/paper.js');
const U = require('../js/util.js');

const mk = (o, h, l, c, v = 1, t = 0) => ({ time: t, open: o, high: h, low: l, close: c, volume: v });

// Deterministik sözde rastgele (LCG) — tekrarlanabilir sentetik veri
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function synth(n, seed = 7, drift = 0) {
  const r = rng(seed), out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const o = p, ch = (r() - 0.5) * 2 + drift + 1.5 * Math.sin(i / 25);
    const c = Math.max(1, o + ch), h = Math.max(o, c) + r() * 1.2, l = Math.min(o, c) - r() * 1.2;
    out.push({ time: 1700000000 + i * 3600, open: o, high: h, low: Math.max(0.5, l), close: c, volume: 50 + r() * 100 });
    p = c;
  }
  return out;
}

/* ---------------- Formasyonlar ---------------- */
test('Formasyon: yutan boğa / yutan ayı', () => {
  const base = [mk(10, 10.5, 9.5, 10), mk(10, 10.5, 9.5, 10)];
  const bull = base.concat([mk(10, 10.2, 9.4, 9.5), mk(9.4, 10.6, 9.3, 10.4)]);
  assert.ok(S.detectPatterns(bull, 3).some(p => p.key === 'bull_engulf'));
  const bear = base.concat([mk(9.5, 10.1, 9.4, 10), mk(10.1, 10.2, 9.2, 9.3)]);
  assert.ok(S.detectPatterns(bear, 3).some(p => p.key === 'bear_engulf'));
});
test('Formasyon: doji ve düşüş sonrası çekiç', () => {
  const down = [mk(15, 15, 14, 14), mk(14, 14, 13, 13), mk(13, 13, 12, 12), mk(12, 12, 11, 11), mk(11, 11, 10, 10.2)];
  const doji = down.concat([mk(10, 10.5, 9.5, 10.01)]);
  assert.ok(S.detectPatterns(doji, 5).some(p => p.key === 'doji'));
  const ham = down.concat([mk(10, 10.35, 8.5, 10.3)]); // gövde .3, alt fitil 1.5, üst .05
  assert.ok(S.detectPatterns(ham, 5).some(p => p.key === 'hammer'), JSON.stringify(S.detectPatterns(ham, 5)));
});
test('Formasyon: sabah yıldızı ve üç beyaz asker', () => {
  const ms = [mk(12, 12, 11, 11.5), mk(12, 12.1, 9.9, 10), mk(10, 10.1, 9.7, 9.9), mk(9.9, 11.6, 9.8, 11.5)];
  assert.ok(S.detectPatterns(ms, 3).some(p => p.key === 'morning_star'));
  const ws = [mk(9, 9, 9, 9), mk(10, 11.1, 9.9, 11), mk(10.5, 12.1, 10.4, 12), mk(11.5, 13.1, 11.4, 13)];
  assert.ok(S.detectPatterns(ws, 3).some(p => p.key === 'three_soldiers'));
});

/* ---------------- Destek/direnç ---------------- */
test('Destek/Direnç: tekrarlanan tepe ve dipler kümelenir', () => {
  const cs = [];
  for (let i = 0; i < 120; i++) { const p = 100 + 10 * Math.sin(i / 4); cs.push(mk(p, p + 0.5, p - 0.5, p, 1, i)); }
  cs.push(mk(100, 100.2, 99.8, 100, 1, 999));
  const sr = S.supportResistance(cs, cs.length - 1, 1);
  assert.ok(sr.resistances.length && sr.supports.length);
  assert.ok(Math.abs(sr.resistances[0].price - 110.5) < 1, 'direnç ' + sr.resistances[0].price);
  assert.ok(Math.abs(sr.supports[0].price - 89.5) < 1, 'destek ' + sr.supports[0].price);
  assert.ok(sr.resistances[0].touches >= 3);
});

/* ---------------- Skor ---------------- */
test('Skor: güçlü yükseliş → pozitif / AL, güçlü düşüş → negatif / SAT, aralık ve alanlar', () => {
  const up = synth(400, 3, 0.6), dn = synth(400, 3, -0.6);
  const a = S.analyze(up), b = S.analyze(dn);
  assert.ok(a.score > 0 && b.score < 0, `up ${a.score} dn ${b.score}`);
  [a, b].forEach(g => {
    assert.ok(g.score >= -100 && g.score <= 100);
    assert.ok(g.confidence >= 0 && g.confidence <= 100);
    assert.ok(['AL', 'SAT', 'BEKLE'].includes(g.label));
    assert.ok(g.components.length >= 6);
    g.components.forEach(c => assert.ok(typeof c.text === 'string' && c.text.length > 3));
    assert.ok(g.regime && g.regime.name);
  });
  assert.ok(a.stop < a.price && a.target > a.price, 'long stop/hedef yönü');
  if (b.label === 'SAT') assert.ok(b.stop > b.price && b.target < b.price, 'short stop/hedef yönü');
  assert.ok(Math.abs(a.rr - 2) < 1e-9, 'varsayılan R:R = 3/1.5 = 2');
});
test('Skor: scoreAt nedensel — gelecek mumları değiştirmek geçmiş sinyali değiştirmez', () => {
  const cs = synth(500, 11);
  const ind = S.computeIndicators(cs);
  const cut = 350;
  const mutated = cs.slice(0, cut + 1).concat(cs.slice(cut + 1).map(c => ({ ...c, open: c.open * 3, high: c.high * 3, low: c.low * 3, close: c.close * 3, volume: c.volume * 9 })));
  const ind2 = S.computeIndicators(mutated);
  for (let i = 100; i <= cut; i += 7) {
    const g1 = S.scoreAt(cs, ind, i), g2 = S.scoreAt(mutated, ind2, i);
    assert.equal(g1.score, g2.score, 'i=' + i);
    assert.equal(g1.confidence, g2.confidence);
    assert.deepEqual(g1.supports, g2.supports);
  }
});
test('Rejim: güçlü trend → trend_up, testere → range', () => {
  const tr = Array.from({ length: 250 }, (_, i) => mk(100 + i, 101 + i, 99.5 + i, 100.8 + i, 1, i));
  const ind = S.computeIndicators(tr);
  assert.equal(S.detectRegime(ind, 249).key, 'trend_up');
  const zz = Array.from({ length: 250 }, (_, i) => { const p = 100 + (i % 2 ? 1 : -1); return mk(p, p + 1, p - 1, p, 1, i); });
  assert.equal(S.detectRegime(S.computeIndicators(zz), 249).key, 'range');
});
test('MTF birleşimi: hepsi pozitif → tam uyum, karışık → kısmi', () => {
  const all = S.combineMTF({ '15m': { score: 40 }, '1h': { score: 50 }, '4h': { score: 30 }, '1d': { score: 20 } });
  assert.equal(all.aligned, 4); assert.equal(all.label, 'AL');
  close(all.score, Math.round((0.15 * 40 + 0.25 * 50 + 0.3 * 30 + 0.3 * 20) / 1));
  const mix = S.combineMTF({ '15m': { score: 40 }, '1h': { score: -50 }, '4h': { score: 30 }, '1d': { score: -20 } });
  assert.equal(mix.bull, 2); assert.equal(mix.bear, 2);
});
function close(a, b, e = 1e-9) { assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`); }
test('Kural tabanlı yorum Türkçe metin üretir', () => {
  const g = S.analyze(synth(400, 5, 0.4));
  const t = S.ruleCommentary('BTC/USDT', '1h', g, null, { fng: { value: 10, label: 'Aşırı korku' } });
  assert.match(t, /rejimi/); assert.match(t, /yatırım tavsiyesi değildir/);
});

/* ---------------- Backtest ---------------- */
test('Backtest: lookahead yok — giriş = sinyal mumundan SONRAKİ mumun açılışı', () => {
  const cs = synth(1200, 21);
  const r = BT.run(cs, { slippagePct: 0, feePct: 0.1, warmup: 200 });
  assert.ok(r.trades.length > 3, 'işlem sayısı ' + r.trades.length);
  r.trades.forEach(t => {
    assert.equal(t.entryIdx, t.sigIdx + 1, 'giriş sinyalden bir mum sonra');
    close(t.entry, cs[t.entryIdx].open, 1e-9);
    assert.ok(t.exitIdx >= t.entryIdx);
    if (t.reason === 'Ters sinyal') close(t.exit, cs[t.exitIdx].open, 1e-9);
  });
});
test('Backtest: gelecek verisini bozmak, kesimden önce kapanan işlemleri değiştirmez', () => {
  const cs = synth(1200, 33);
  const cut = 900;
  const mut = cs.slice(0, cut + 1).concat(cs.slice(cut + 1).map(c => ({ ...c, open: c.open * 0.5, high: c.high * 0.5, low: c.low * 0.5, close: c.close * 0.5 })));
  const a = BT.run(cs, {}), b = BT.run(mut, {});
  const before = t => t.exitIdx < cut;
  assert.deepEqual(a.trades.filter(before), b.trades.filter(before));
  for (let k = 0; k < cut - 200; k++) close(a.equity[k].value, b.equity[k].value, 1e-6);
});
test('Backtest: kontrollü sinyal — bilinen PnL (komisyon/kayma 0)', () => {
  // Fiyat 100'de düz, i=250 kapanışta AL sinyali → 251 açılışta 100'den giriş, 300'de SAT → 301 açılış 110'dan çıkış
  const cs = Array.from({ length: 400 }, (_, i) => { const p = i <= 300 ? 100 : 110; return { time: i * 3600, open: p, high: p + 0.1, low: p - 0.1, close: i === 300 ? 100 : p, volume: 1 }; });
  const sig = (c, ind, i) => ({ label: i === 250 ? 'AL' : i === 300 ? 'SAT' : 'BEKLE', atr: 50, score: 0 });
  const r = BT.run(cs, { feePct: 0, slippagePct: 0, warmup: 200, atrStop: 1, atrTarget: 10 }, sig);
  assert.equal(r.trades.length, 1);
  const t = r.trades[0];
  assert.equal(t.entryIdx, 251); assert.equal(t.exitIdx, 301);
  close(t.entry, 100); close(t.exit, 110); close(t.pnl, 1000, 1e-6);
  close(r.metrics.totalReturn, 10, 1e-6);
  close(r.metrics.maxDD, 0, 1e-9);
  close(r.metrics.winRate, 100);
});
test('Backtest: stop aynı mumda hedeften önce varsayılır (muhafazakâr) ve komisyon düşülür', () => {
  const cs = Array.from({ length: 300 }, (_, i) => ({ time: i * 60, open: 100, high: i === 252 ? 120 : 100.1, low: i === 252 ? 80 : 99.9, close: 100, volume: 1 }));
  const sig = (c, ind, i) => ({ label: i === 250 ? 'AL' : 'BEKLE', atr: 10, score: 0 });
  const r = BT.run(cs, { feePct: 0.1, slippagePct: 0, warmup: 200, atrStop: 1, atrTarget: 1 }, sig);
  assert.equal(r.trades[0].reason, 'Stop'); close(r.trades[0].exit, 90);
  assert.ok(r.trades[0].pnl < -1000 * 0.999, 'zarar + komisyon');
});
test('Backtest: short + ters sinyalde yön değiştirme (flip) — bilinen PnL', () => {
  // i=250 SAT → 251 açılışta 100'den short; i=300 AL → 301 açılışta 90'dan kapat + long aç
  const cs = Array.from({ length: 400 }, (_, i) => { const p = i <= 300 ? 100 : 90; return { time: i * 3600, open: p, high: p + 0.1, low: p - 0.1, close: p, volume: 1 }; });
  const sig = (c, ind, i) => ({ label: i === 250 ? 'SAT' : i === 300 ? 'AL' : 'BEKLE', atr: 50, score: 0 });
  const r = BT.run(cs, { feePct: 0, slippagePct: 0, warmup: 200, atrStop: 1, atrTarget: 10, allowShort: true }, sig);
  assert.equal(r.trades.length, 2);
  const [s, l] = r.trades;
  assert.equal(s.side, 'short'); assert.equal(s.entryIdx, 251); assert.equal(s.exitIdx, 301); assert.equal(s.reason, 'Ters sinyal');
  close(s.entry, 100); close(s.exit, 90); close(s.pnl, 1000, 1e-6);
  assert.equal(l.side, 'long'); assert.equal(l.entryIdx, 301); close(l.entry, 90);
  close(r.metrics.totalReturn, 10, 1e-6);
});
test('Backtest metrikleri: buy&hold ve Sharpe tanımlı', () => {
  const r = BT.run(synth(1100, 9, 0.05), {});
  assert.ok(isFinite(r.metrics.buyHold) && isFinite(r.metrics.sharpe) && r.metrics.maxDD >= 0);
  assert.equal(r.metrics.bhEquity.length, r.equity.length);
});
test('fetchHistory: endTime ile geriye sayfalama, tekrar yok, sıralı', async () => {
  const all = Array.from({ length: 2500 }, (_, i) => [i * 60000, '1', '2', '0.5', '1.5', '10']);
  const calls = [];
  const fake = async (q) => {
    calls.push(q);
    const u = new URLSearchParams(q.split('?')[1]); const lim = +u.get('limit'); const end = u.get('endTime');
    const upto = end ? all.filter(k => k[0] <= +end) : all;
    return upto.slice(-lim);
  };
  const cs = await BT.fetchHistory(fake, 'BTCUSDT', '1m', 2200);
  assert.equal(cs.length, 2200);
  for (let i = 1; i < cs.length; i++) assert.ok(cs[i].time > cs[i - 1].time);
  assert.equal(cs[cs.length - 1].time, (2499 * 60000) / 1000);
  assert.equal(calls.length, 3);
});

/* ---------------- Paper trading ---------------- */
test('Paper: market long al-sat PnL ve komisyon', () => {
  const st = Paper.create(10000);
  const r = Paper.placeOrder(st, { sym: 'BTCUSDT', side: 'long', type: 'market', qty: 0.1 }, 50000, 1);
  assert.ok(r.ok);
  close(st.cash, 10000 - 5000 - 5);
  close(Paper.equity(st, { BTCUSDT: 51000 }), 10000 - 5 + 100);
  const rec = Paper.closePosition(st, r.position.id, 51000, 2);
  close(rec.pnl, 100 - 5 - 5.1, 1e-9);
  close(st.cash, 10000 + rec.pnl, 1e-9);
});
test('Paper: short PnL, SL/TP tetikleme', () => {
  const st = Paper.create(10000);
  Paper.placeOrder(st, { sym: 'ETHUSDT', side: 'short', qty: 1, sl: 2100, tp: 1800 }, 2000, 1);
  close(Paper.equity(st, { ETHUSDT: 1900 }), 10000 - 2 + 100);
  const ev = Paper.onPrice(st, 'ETHUSDT', 1795, 2);
  assert.equal(ev[0].type, 'tp'); assert.equal(st.positions.length, 0);
  close(st.history[0].pnl, 205 - 2 - 1.795, 1e-9);
});
test('Paper: limit emir rezervi, dolum ve iptal', () => {
  const st = Paper.create(1000);
  const r = Paper.placeOrder(st, { sym: 'SOLUSDT', side: 'long', type: 'limit', price: 90, qty: 5 }, 100, 1);
  assert.ok(r.ok); assert.equal(st.orders.length, 1); close(st.cash, 1000 - 450.45);
  assert.equal(Paper.onPrice(st, 'SOLUSDT', 95, 2).length, 0);
  const ev = Paper.onPrice(st, 'SOLUSDT', 89.5, 3);
  assert.equal(ev[0].type, 'fill'); assert.equal(st.positions[0].entry, 90); close(st.cash, 1000 - 450.45);
  const r2 = Paper.placeOrder(st, { sym: 'SOLUSDT', side: 'long', type: 'limit', price: 80, qty: 1 }, 89, 4);
  assert.ok(Paper.cancelOrder(st, r2.order.id)); close(st.cash, 1000 - 450.45);
});
test('Paper: tetik bölgesindeki limit emir piyasa fiyatından anında dolar (long ve short)', () => {
  const st = Paper.create(10000);
  // Piyasa 100, alış limiti 110 → gerçek borsada olduğu gibi 100'den dolmalı (110'dan değil)
  const r = Paper.placeOrder(st, { sym: 'SOLUSDT', side: 'long', type: 'limit', price: 110, qty: 10 }, 100, 1);
  assert.ok(r.ok && r.position && r.marketable, JSON.stringify(r));
  assert.equal(st.orders.length, 0); close(r.position.entry, 100);
  close(st.cash, 10000 - 1000 - 1, 1e-9);
  // Piyasa 100, satış limiti 90 → 100'den short
  const r2 = Paper.placeOrder(st, { sym: 'ETHUSDT', side: 'short', type: 'limit', price: 90, qty: 1 }, 100, 2);
  assert.ok(r2.ok && r2.position && r2.marketable); close(r2.position.entry, 100);
  // Tetik bölgesinde olmayan limit normal şekilde bekler
  const r3 = Paper.placeOrder(st, { sym: 'ETHUSDT', side: 'short', type: 'limit', price: 120, qty: 1 }, 100, 3);
  assert.ok(r3.ok && r3.order && !r3.position);
  assert.equal(Paper.marketable({ type: 'limit', side: 'long', price: 99 }, 100), false);
  assert.equal(Paper.marketable({ type: 'market', side: 'long' }, 100), false);
});
test('Paper: tetik bölgesindeki limit emrin stop/hedefi gerçek dolum fiyatına göre doğrulanır', () => {
  const st = Paper.create(10000);
  // Limit 110 ama dolum 100'den olur → 105'teki "stop" girişin üstünde kalır, reddedilmeli
  const r = Paper.placeOrder(st, { sym: 'SOLUSDT', side: 'long', type: 'limit', price: 110, qty: 1, sl: 105 }, 100, 1);
  assert.ok(!r.ok); assert.match(r.error, /stop/);
  close(st.cash, 10000); assert.equal(st.positions.length + st.orders.length, 0);
});
test('Paper: emir vermek aynı semboldeki diğer pozisyonların SL/TP olaylarını yutmaz', () => {
  const st = Paper.create(10000);
  const p = Paper.placeOrder(st, { sym: 'BTCUSDT', side: 'long', qty: 0.01, tp: 105 }, 100, 1).position;
  // Fiyat 106'ya çıktı ama henüz ticker işlenmedi; bu sırada yeni bir limit emir veriliyor
  const r = Paper.placeOrder(st, { sym: 'BTCUSDT', side: 'long', type: 'limit', price: 90, qty: 0.01 }, 106, 2);
  assert.ok(r.ok && r.order);
  assert.ok(st.positions.some(x => x.id === p.id), 'pozisyon sessizce kapatılmamalı');
  const ev = Paper.onPrice(st, 'BTCUSDT', 106, 3);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'tp'); // olay arayüze ulaşır (bildirim/ses)
});
test('Paper: doğrulama hataları (bakiye, stop yönü)', () => {
  const st = Paper.create(100);
  assert.match(Paper.placeOrder(st, { sym: 'X', side: 'long', qty: 1 }, 1000, 1).error, /Yetersiz/);
  assert.match(Paper.placeOrder(st, { sym: 'X', side: 'long', qty: 0.01, sl: 1100 }, 1000, 1).error, /stop/);
});

/* ---------------- Yardımcılar ---------------- */
test('Treemap: alanlar değerlerle orantılı, toplam alan korunur, sınırlar içinde', () => {
  const items = [6, 6, 4, 3, 2, 2, 1].map((v, i) => ({ value: v, id: i }));
  const r = U.squarify(items, 600, 400);
  assert.equal(r.length, 7);
  let total = 0;
  r.forEach(b => { total += b.w * b.h; close(b.w * b.h, b.item.value / 24 * 240000, 1e-6); assert.ok(b.x >= -1e-9 && b.y >= -1e-9 && b.x + b.w <= 600 + 1e-6 && b.y + b.h <= 400 + 1e-6); });
  close(total, 240000, 1e-6);
});
test('Risk hesaplayıcı: 10.000 bakiye, %1 risk, giriş 100 stop 95 → 20 adet', () => {
  const r = U.positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 95, target: 110 });
  close(r.qty, 20); close(r.notional, 2000); close(r.riskAmt, 100); close(r.rr, 2); assert.equal(r.side, 'long');
  assert.ok(U.positionSize({ balance: 0, riskPct: 1, entry: 1, stop: 1 }).error);
});
test('Alarm değerlendirme: fiyat, RSI, sinyal değişimi', () => {
  assert.ok(U.evalAlert({ type: 'price_above', sym: 'BTCUSDT', value: 100 }, { price: 101 }).fire);
  assert.ok(!U.evalAlert({ type: 'price_below', sym: 'BTCUSDT', value: 100 }, { price: 101 }).fire);
  assert.ok(U.evalAlert({ type: 'rsi_below', sym: 'BTCUSDT', value: 30, tf: '1h' }, { rsi: 25 }).fire);
  const a = { type: 'signal_change', sym: 'BTCUSDT', tf: '1h', lastLabel: null };
  let r = U.evalAlert(a, { label: 'BEKLE' }); assert.ok(!r.fire); a.lastLabel = r.newLabel;
  r = U.evalAlert(a, { label: 'AL' }); assert.ok(r.fire); assert.match(r.msg, /BEKLE → AL/);
});
test('Alarm: durdurulup yeniden etkinleştirilen sinyal alarmı eski etiketle yanlış tetiklenmez', () => {
  const a = { type: 'signal_change', sym: 'BTCUSDT', tf: '1h', active: true, lastLabel: 'BEKLE' };
  U.toggleAlert(a); assert.equal(a.active, false); assert.equal(a.lastLabel, 'BEKLE');
  U.toggleAlert(a); assert.equal(a.active, true); assert.equal(a.lastLabel, null);
  // Duraklama sırasında AL'a dönmüş olsa da ilk kontrol yalnızca taban etiketi öğrenir
  let r = U.evalAlert(a, { label: 'AL' }); assert.ok(!r.fire); a.lastLabel = r.newLabel;
  r = U.evalAlert(a, { label: 'SAT' }); assert.ok(r.fire);
  // Fiyat alarmının değeri/durumu dışında bir şey değişmez
  const p = { type: 'price_above', sym: 'BTCUSDT', value: 100, active: false };
  U.toggleAlert(p); assert.equal(p.active, true); assert.equal(p.value, 100);
});
