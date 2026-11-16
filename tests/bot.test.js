'use strict';
const test = require('node:test'), assert = require('node:assert');
const Bot = require('../js/bot.js');
const T0 = 1e12;
const sig = (o) => Object.assign({ side: 'long', label: 'AL', confidence: 70, rr: 2, score: 50, price: 100, stop: 97, target: 106, regime: { key: 'trend_up' } }, o);
const ctx = (px, g, t) => ({ prices: { AAA: px }, fx: 40, sigs: { AAA: { g: g, t: t == null ? T0 : t } } });

test('alış-satış: değişmeyen fiyatta kayıp ~ 2 x maliyet', () => {
  const st = Bot.create(), s = st.s;
  const p = Bot.buy(st, 'AAA', 100, 40, 100, 90, 120, T0);
  assert.ok(p && Math.abs(st.cash) < 1e-9);
  const r = Bot.sell(st, p.id, 100, 40, T0 + 1, 'x');
  const loss = 100 - st.cash, exp = 100 * 2 * Bot.costRate(s);
  assert.ok(loss > 0 && Math.abs(loss - exp) / exp < 0.1, 'kayıp ' + loss + ' beklenen ~' + exp);
  assert.ok(r.pnl < 0 && r.fees > 0);
});
test('kâr vergisi yalnızca kârda uygulanır', () => {
  const st = Bot.create({ profitTaxRate: 0.1 });
  const p = Bot.buy(st, 'AAA', 100, 40, 100, 90, 130, T0);
  const r = Bot.sell(st, p.id, 120, 40, T0 + 1, 'x');
  assert.ok(st.totals.profitTax > 0 && r.pnl > 0);
  const st2 = Bot.create({ profitTaxRate: 0.1 }), p2 = Bot.buy(st2, 'AAA', 100, 40, 100, 90, 130, T0);
  Bot.sell(st2, p2.id, 95, 40, T0 + 1, 'x'); assert.equal(st2.totals.profitTax, 0);
});
test('bakiyeden fazla alış reddedilir', () => {
  const st = Bot.create(); assert.equal(Bot.buy(st, 'AAA', 100, 40, 500, 90, 120, T0), null);
});
test('iyi sinyalde girer, aynı sembole tekrar girmez', () => {
  const st = Bot.create(), ev = Bot.step(st, ctx(100, sig()), T0);
  assert.equal(ev.length, 1); assert.equal(ev[0].type, 'buy');
  assert.ok(st.cash >= 0 && st.cash < 100);
  assert.equal(Bot.step(st, ctx(100, sig()), T0 + 1000).length, 0);
});
test('zayıf sinyaller reddedilir', () => {
  const bad = [sig({ confidence: 40 }), sig({ rr: 1 }), sig({ regime: { key: 'highvol' } }), sig({ target: 100.5 }), sig({ side: null, label: 'BEKLE' })];
  bad.forEach((g) => assert.equal(Bot.step(Bot.create(), ctx(100, g), T0).length, 0));
  assert.equal(Bot.step(Bot.create(), ctx(100, sig(), T0 - 20 * 60e3), T0).length, 0, 'eski sinyal');
  assert.equal(Bot.step(Bot.create(), ctx(102, sig()), T0).length, 0, 'fiyat sinyalden %1+ kaçmış');
});
test('stop-loss, hedef, sinyal SAT; cooldown yeniden girişi engeller', () => {
  let st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  let ev = Bot.step(st, ctx(96, sig({ side: null, label: 'BEKLE' })), T0 + 1000);
  assert.equal(ev[0].rec.reason, 'Stop-loss'); assert.ok(ev[0].rec.pnl < 0);
  assert.equal(Bot.step(st, ctx(100, sig()), T0 + 2000).length, 0, 'cooldown');
  assert.equal(Bot.step(st, ctx(100, sig(), T0 + 3700e3), T0 + 3700e3).length, 1, 'cooldown sonrası girer');
  st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  ev = Bot.step(st, ctx(107, sig()), T0 + 1000); assert.equal(ev[0].rec.reason, 'Hedef'); assert.ok(ev[0].rec.pnl > 0);
  st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  ev = Bot.step(st, ctx(100.5, sig({ label: 'SAT', side: 'short' })), T0 + 1000); assert.equal(ev[0].rec.reason, 'Sinyal SAT');
});
test('kâr koruma: hedefin yarısından sonra geri dönüş büyük zararla bitmez', () => {
  const st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  Bot.step(st, ctx(103.5, sig()), T0 + 1000);
  const ev = Bot.step(st, ctx(100.3, sig()), T0 + 2000);
  assert.equal(ev.length, 1); assert.equal(ev[0].rec.reason, 'Kâr koruma stopu'); assert.ok(ev[0].rec.pnl > -0.5);
});
test('kur yoksa işlem yapmaz; süre dolunca çıkar', () => {
  const st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  assert.equal(Bot.step(st, { prices: { AAA: 101 }, fx: 0, sigs: {} }, T0 + 1).length, 0);
  const ev = Bot.step(st, { prices: { AAA: 101 }, fx: 40, sigs: {} }, T0 + 49 * 3600e3);
  assert.equal(ev[0].rec.reason, 'Süre doldu');
});
test('equity: nakit + pozisyon değeri', () => {
  const st = Bot.create(); Bot.step(st, ctx(100, sig()), T0);
  const e = Bot.equity(st, { AAA: 100 }, 40); assert.ok(e < 100 && e > 99);
});
test('hız kademeleri: her seviye bir öncekinden hızlı ve maliyet filtresi korunur', () => {
  const order = ['normal', 'fast', 'veryfast', 'extreme', 'super'], P = Bot.PRESETS;
  for (let i = 1; i < order.length; i++) {
    const a = P[order[i - 1]], b = P[order[i]];
    assert.ok(b.cooldownMin < a.cooldownMin && b.maxHoldH < a.maxHoldH && b.maxTradesPerHour > a.maxTradesPerHour && b.maxPos >= a.maxPos, order[i]);
    assert.ok(b.minConf < a.minConf && b.minNetGain < a.minNetGain, order[i]);
    if (i > 1) assert.ok(b.scanSec < a.scanSec);
  }
  order.forEach((m) => assert.ok(P[m].minNetGain > 0, m + ' maliyet filtresi açık kalmalı'));
  const st = Bot.create(); Bot.applyMode(st, 'super'); assert.equal(st.s.mode, 'super'); assert.equal(st.s.tf, '1m');
});
