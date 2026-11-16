// Canlı uç nokta + gerçek veri üzerinde motor kontrolü (internet gerekir).
// Kullanım: node tests/live-check.js
'use strict';
const S = require('../js/signals.js');
const BT = require('../js/backtest.js');

const REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
async function get(path) {
  let err;
  for (const b of REST) { try { const r = await fetch(b + path); if (!r.ok) throw new Error(b + ' HTTP ' + r.status); return await r.json(); } catch (e) { err = e; } }
  throw err;
}
let fails = 0;
const ok = (name, cond, info) => { console.log((cond ? 'PASS ' : 'FAIL ') + name + (info ? '  → ' + info : '')); if (!cond) fails++; };

(async () => {
  const t = await get('/api/v3/ticker/24hr?symbol=BTCUSDT');
  ok('Binance 24s ticker', +t.lastPrice > 0, 'BTC ' + t.lastPrice);
  for (const b of REST) { try { const r = await fetch(b + '/api/v3/ping'); ok('REST ' + b, r.ok, 'CORS ' + r.headers.get('access-control-allow-origin')); } catch (e) { ok('REST ' + b, false, e.message); } }

  const ws = await new Promise(res => {
    const w = new WebSocket('wss://data-stream.binance.vision/stream?streams=btcusdt@kline_1m/btcusdt@depth20');
    const seen = new Set(); const to = setTimeout(() => { w.close(); res([...seen]); }, 8000);
    w.onmessage = e => { seen.add(JSON.parse(e.data).stream); if (seen.size === 2) { clearTimeout(to); w.close(); res([...seen]); } };
    w.onerror = () => { clearTimeout(to); res([...seen]); };
  });
  ok('WebSocket kline + depth', ws.length === 2, ws.join(', '));

  const cs = await BT.fetchHistory(get, 'BTCUSDT', '1h', 2500);
  ok('Sayfalama ile 2500 mum', cs.length === 2500, cs.length + ' mum, ' + new Date(cs[0].time * 1000).toISOString() + ' →');
  let gaps = 0; for (let i = 1; i < cs.length; i++) if (cs[i].time - cs[i - 1].time !== 3600) gaps++;
  ok('Mumlar ardışık (1h aralık)', gaps === 0, gaps + ' boşluk');

  const g = S.analyze(cs.slice(0, -1));
  ok('Analiz (son kapanmış mum)', g && g.score >= -100 && g.score <= 100, `${g.display} skor ${g.score} güven %${g.confidence} rejim ${g.regime.name}`);

  const r = BT.run(cs.slice(0, -1), {});
  const m = r.metrics;
  ok('Backtest gerçek veri', isFinite(m.totalReturn), `getiri ${m.totalReturn.toFixed(2)}% | al&tut ${m.buyHold.toFixed(2)}% | işlem ${m.trades} | kazanma %${m.winRate.toFixed(1)} | maxDD %${m.maxDD.toFixed(2)} | Sharpe ${m.sharpe.toFixed(2)}`);
  ok('Backtest: her giriş sinyal mumundan sonraki açılışta', r.trades.every(t => t.entryIdx === t.sigIdx + 1 && Math.abs(t.entry - cs[t.entryIdx].open * (1 + 0.0002)) < 1e-6));

  try { const f = await (await fetch('https://api.alternative.me/fng/?limit=1')).json(); ok('Fear & Greed', !!f.data[0], f.data[0].value + ' ' + f.data[0].value_classification); } catch (e) { ok('Fear & Greed', false, e.message); }
  try { const c = await (await fetch('https://api.coingecko.com/api/v3/global')).json(); ok('CoinGecko global', !!c.data, 'BTC dom %' + c.data.market_cap_percentage.btc.toFixed(2)); } catch (e) { ok('CoinGecko global', false, e.message); }

  console.log(fails ? `\n${fails} kontrol başarısız` : '\nTüm canlı kontroller geçti');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
