#!/usr/bin/env node
'use strict';
/* =====================================================================
 * run-sim.js — AI simülasyonunu komut satırından çalıştırır (CORS sorunu yok).
 *
 *   node tools/run-sim.js --symbol BTCUSDT --tf 1h --bars 1500 --model <model-id>
 *
 * Bağlantı (9router varsayılanı): --base-url http://localhost:20128/v1
 * Anahtar: ORTAM DEĞİŞKENİ  LLM_API_KEY  (komut satırına yazmayın, geçmişte kalır)
 * Diğer: --every 4  --gate 15  --max-decisions 150  --fee 0.1  --slip 0.02
 *        --no-anonymize  --out rapor.json  --list-models  --dry-run (LLM yok, kural karar vericisi)
 * Yalnızca simülasyon: GERÇEK EMİR GÖNDERMEZ.
 * ===================================================================== */
const fs = require('fs');
const Sim = require('../js/aisim.js');
const Backtest = require('../js/backtest.js');

const argv = process.argv.slice(2), A = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const k = argv[i].slice(2), nx = argv[i + 1];
  if (nx === undefined || nx.startsWith('--')) A[k] = true; else { A[k] = nx; i++; }
}
const cfg = { baseUrl: A['base-url'] || process.env.LLM_BASE_URL || 'http://localhost:20128/v1', apiKey: process.env.LLM_API_KEY || '', model: A.model || process.env.LLM_MODEL || '', maxTokens: +A['max-tokens'] || 1500 };
const sym = A.symbol || 'BTCUSDT', tf = A.tf || '1h', bars = +A.bars || 1500;
const f = (x, d = 2) => x == null || !isFinite(x) ? '–' : (+x).toFixed(d);
const REST = ['https://data-api.binance.vision', 'https://api.binance.com'];
async function getJSON(path) { let e; for (const b of REST) { try { const r = await fetch(b + path); if (r.ok) return await r.json(); e = new Error('HTTP ' + r.status); } catch (x) { e = x; } } throw e; }

(async () => {
  if (A['list-models']) { console.log((await Sim.listModels(cfg)).join('\n')); return; }
  const dry = !!A['dry-run'];
  if (!dry && !cfg.model) { console.error('--model gerekli (ör. 9router panelindeki bir model/combo adı). Listelemek için: --list-models'); process.exit(2); }

  console.log(`Veri indiriliyor: ${sym} ${tf} ×${bars} (Binance)…`);
  let cs = await Backtest.fetchHistory(getJSON, sym, tf, bars + 1); cs = cs.slice(0, -1);
  const P = { tf, symbol: sym, feePct: A.fee != null ? +A.fee : 0.1, slippagePct: A.slip != null ? +A.slip : 0.02, decisionEvery: +A.every || 4, gateScore: A.gate != null ? +A.gate : 15,
    maxDecisions: +A['max-decisions'] || 150, anonymize: !A['no-anonymize'], minConfidence: A['min-conf'] != null ? +A['min-conf'] : 50, initial: 10000 };
  console.log(`${cs.length} mum · ${new Date(cs[P.warmup || 200].time * 1000).toISOString().slice(0, 10)} → ${new Date(cs[cs.length - 1].time * 1000).toISOString().slice(0, 10)} · ${dry ? 'KURAL karar vericisi (dry-run)' : 'LLM: ' + cfg.model + ' @ ' + cfg.baseUrl} · anonim: ${P.anonymize}`);

  const decide = dry ? Sim.ruleDecider(30, -30) : Sim.makeLLMDecider(cfg);
  const t0 = Date.now(); let lastPrint = 0;
  const ai = await Sim.run(cs, P, decide, { onProgress: p => { if (Date.now() - lastPrint > 1500) { lastPrint = Date.now(); process.stdout.write(`\r  ilerleme %${(p.done / p.total * 100).toFixed(0)} · çağrı ${p.calls} · bakiye ${f(p.equity)}   `); } } });
  process.stdout.write('\n');
  const bm = Sim.benchmarks(cs, Object.assign({}, Sim.DEFAULTS, P), ai), m = ai.metrics, s = ai.stats;
  if (ai.error) console.log('⚠ ' + ai.error);

  const rb = bm.random, rule = bm.rule && bm.rule.metrics, ci = m.sharpeCI;
  console.log(`
════════════ SONUÇ (${((Date.now() - t0) / 1000).toFixed(0)} sn) ════════════
                       AI            Al&tut        Kural motoru
Getiri %           ${f(m.totalReturn).padStart(8)}      ${f(m.buyHold).padStart(8)}      ${rule ? f(rule.totalReturn).padStart(8) : '       –'}
Maks. düşüş %      ${f(m.maxDD).padStart(8)}
Sharpe (yıllık)    ${f(m.sharpe).padStart(8)}      ${ci ? '95% GA [' + f(ci.lo) + ', ' + f(ci.hi) + '], P(Sharpe>0)=' + f(ci.pPositive * 100, 0) + '%' : '(GA için yeterli veri yok)'}
Sortino / Calmar   ${f(m.sortino).padStart(8)} / ${f(m.calmar)}
Yıllıklandırılmış %${f(m.annReturn).padStart(8)}   (dönem ${f(m.years * 365, 0)} gün)
İşlem sayısı       ${String(m.trades).padStart(8)}      kazanma %${f(m.winRate, 1)} · kâr faktörü ${f(m.profitFactor)} · ödeme oranı ${f(m.payoff)}
Beklenti/işlem %   ${f(m.expectancyPct).padStart(8)}      ort. kazanç %${f(m.avgWin)} · ort. kayıp %${f(m.avgLoss)}
Ödenen komisyon $  ${f(m.feesPaid).padStart(8)}      devir ×${f(m.turnover)} · piyasada kalma %${f(m.exposure, 0)}
Rastgele giriş MC  ${rb ? `ort %${f(rb.mean)} (p5 ${f(rb.p5)} / p95 ${f(rb.p95)}) → AI'ın şansla bu kadar iyi olma olasılığı p=${f(rb.pValue, 3)}` : '(işlem yok)'}
LLM                çağrı ${s.calls} · hata ${s.errors} · elenen(geçit) ${s.gated} · token ${s.promptTokens}/${s.completionTokens} · ort. ${s.calls ? f(s.ms / s.calls / 1000, 1) : '–'} sn/çağrı${s.capped ? ' · ÜST SINIRA ULAŞILDI' : ''}
`);
  if (m.trades < 30) console.log(`⚠ Yalnızca ${m.trades} işlem: istatistiksel olarak zayıf örnek; sonuçları kesin kanıt saymayın.`);
  if (rb && rb.pValue > 0.1) console.log('⚠ AI sonucu rastgele girişlerden istatistiksel olarak ayırt edilemiyor (p>0.10).');
  console.log('Yatırım tavsiyesi değildir. Geçmiş performans geleceği garanti etmez; model eğitim verisi sızıntısı tamamen dışlanamaz.');

  const out = A.out || `sim-report-${sym}-${tf}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const slim = Object.assign({}, ai, { candles: undefined, metrics: Object.assign({}, m, { bhEquity: undefined }) });
  fs.writeFileSync(out, JSON.stringify({ meta: { sym, tf, model: dry ? 'rule' : cfg.model, baseUrl: dry ? null : cfg.baseUrl, params: P, created: new Date().toISOString() }, ai: slim, benchmarks: { random: rb, rule: rule ? Object.assign({}, rule, { bhEquity: undefined }) : null } }, null, 1));
  console.log('Rapor: ' + out);
})().catch(e => { console.error('\nHata: ' + (e && e.message || e)); process.exit(1); });
