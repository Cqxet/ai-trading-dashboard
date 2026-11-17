/* =====================================================================
 * app-sim.js — "AI Simülasyon" sekmesi (motor: aisim.js).
 * LLM bağlantısı: OpenAI uyumlu uç nokta (varsayılan 9router: http://localhost:20128/v1).
 * Ayarlar (URL/model/anahtar) yalnızca bu tarayıcının localStorage'ında durur ve
 * yalnızca girdiğiniz Base URL'ye gönderilir. Simülasyon GERÇEK EMİR GÖNDERMEZ.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Data = root.Data, BT = root.Backtest, Sim = root.AISim;
  var $ = App.$, fmt = U.fmt, esc = U.esc;
  var chart = null, running = false, ctl = null;
  var FIELDS = ['simTf', 'simN', 'simEvery', 'simGate', 'simMax', 'simConf', 'simFee', 'simSlip', 'simMode'];

  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function cfg() { return { baseUrl: $('llmUrl').value.trim(), apiKey: $('llmKey').value.trim(), model: $('llmModel').value.trim(), maxTokens: 1500 }; }
  function keyState() { var k = $('llmKey').value.trim(); $('llmKeyState').textContent = k ? '✓ kayıtlı (' + k.length + ' karakter)' : '(girilmedi)'; }
  function saveCfg() { keyState(); App.store('llm', { url: $('llmUrl').value.trim(), model: $('llmModel').value.trim(), key: $('llmKey').value.trim() }); }
  function f(x, d) { return x == null || !isFinite(x) ? '–' : (+x).toFixed(d == null ? 2 : d); }
  function netHint(e) {
    var m = String(e && e.message || e);
    return /Failed to fetch|NetworkError|Load failed/i.test(m)
      ? m + ' — Sunucuya ulaşılamadı ya da CORS izin vermiyor. 9router çalışıyor mu? Çalışıyorsa komut satırı koşucusunu kullanın: node tools/run-sim.js'
      : m;
  }

  async function testConn() {
    var st = $('llmStatus'); st.textContent = 'test ediliyor…'; st.className = 'mut'; saveCfg();
    try {
      var ids = await Sim.listModels(cfg());
      $('llmModels').innerHTML = ids.map(function (i) { return '<option value="' + esc(i) + '">'; }).join('');
      st.textContent = '✓ bağlandı · ' + ids.length + ' model'; st.className = 'up';
      if (!$('llmModel').value && ids.length) $('llmModel').value = ids[0];
    } catch (e) { st.textContent = '✗ ' + netHint(e); st.className = 'down'; }
  }

  async function run() {
    if (running) return;
    var mode = $('simMode').value, sym = $('simSym').value, tf = $('simTf').value, n = +$('simN').value, out = $('simOut'), prog = $('simProg');
    var C = cfg();
    if (mode === 'llm' && (!C.baseUrl || !C.model)) { out.innerHTML = '<div class="err">Base URL ve model gerekli (ya da Karar verici olarak "Kural" seçin).</div>'; return; }
    var P = { tf: tf, symbol: sym, decisionEvery: +$('simEvery').value, gateScore: +$('simGate').value, maxDecisions: +$('simMax').value, minConfidence: +$('simConf').value,
      feePct: +$('simFee').value, slippagePct: +$('simSlip').value, anonymize: $('simAnon').checked };
    var saved = { sym: sym, anon: P.anonymize }; FIELDS.forEach(function (k) { saved[k] = $(k).value; }); App.store('sim', saved); saveCfg();
    running = true; ctl = new AbortController(); $('simRun').disabled = true; $('simStop').disabled = false;
    out.innerHTML = ''; prog.innerHTML = '<div class="loading">' + App.pretty(sym) + ' ' + tf + ' için ' + n + ' mum indiriliyor…</div>';
    try {
      var cs = await BT.fetchHistory(Data.get, sym, tf, n + 1); cs = cs.slice(0, -1);
      var decide = mode === 'llm' ? Sim.makeLLMDecider(C) : Sim.ruleDecider(30, -30), feed = [], t0 = Date.now();
      var ai = await Sim.run(cs, P, decide, { signal: ctl.signal, onProgress: function (p) {
        feed.unshift(p.last); feed = feed.slice(0, 6);
        var pc = Math.round(p.done / Math.max(1, p.total) * 100);
        prog.innerHTML = '<div class="note"><b>%' + pc + '</b> · LLM çağrısı ' + p.calls + ' · sanal bakiye ' + fmt(p.equity, 2) + ' $ · geçen ' + Math.round((Date.now() - t0) / 1000) + ' sn</div>' +
          '<div style="height:6px;background:var(--line);border-radius:4px;margin:4px 0 8px"><div style="height:6px;width:' + pc + '%;background:var(--acc);border-radius:4px"></div></div>' +
          '<div class="mut" style="font-size:12px">' + feed.map(function (d) { return d ? esc(new Date(d.time * 1000).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })) + ' · skor ' + d.score + ' → <b>' + esc(d.action) + '</b> ' + esc(d.reason || '') : ''; }).join('<br>') + '</div>';
      } });
      prog.innerHTML = '<div class="loading">Karşılaştırmalar hesaplanıyor (kural motoru, rastgele giriş Monte Carlo)…</div>';
      await new Promise(function (r) { setTimeout(r, 20); });
      var bm = Sim.benchmarks(cs, Object.assign({}, Sim.DEFAULTS, P), ai);
      prog.innerHTML = '';
      render(ai, bm, sym, tf, mode);
    } catch (e) { prog.innerHTML = ''; out.innerHTML = '<div class="err">Simülasyon başarısız: ' + esc(netHint(e)) + '</div>'; }
    running = false; ctl = null; $('simRun').disabled = false; $('simStop').disabled = true;
  }

  function render(ai, bm, sym, tf, mode) {
    var m = ai.metrics, s = ai.stats, rb = bm.random, rule = bm.rule && bm.rule.metrics, ci = m.sharpeCI;
    var d = function (t) { return new Date(t * 1000).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); };
    var c = function (k, v, cls, title) { return '<div class="card"' + (title ? ' title="' + esc(title) + '"' : '') + '><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    var warn = [];
    if (ai.error) warn.push('⚠ ' + esc(ai.error));
    if (ai.aborted) warn.push('Simülasyon kullanıcı tarafından durduruldu; sonuçlar kısmi dönemi kapsar.');
    if (s.capped) warn.push('LLM çağrı üst sınırına ulaşıldı: dönem burada bitirildi (sonuçlar yalnızca karar verilen pencereyi kapsar).');
    if (m.trades < 30) warn.push('Yalnızca ' + m.trades + ' işlem: istatistiksel olarak zayıf örnek — sonuçları kesin kanıt saymayın.');
    if (rb && rb.pValue > 0.1) warn.push('Sonuç rastgele girişlerden istatistiksel olarak ayırt edilemiyor (p=' + f(rb.pValue, 3) + ').');
    if (mode === 'llm') warn.push('Model eğitim verisinden geçmiş piyasayı "hatırlıyor" olabilir (sızıntı). Sembol/tarih gizlendi ama tamamen dışlanamaz: asıl güvenilir test, simülasyonu zaman içinde ileriye doğru (canlı, model eğitiminden sonraki veriyle) tekrarlamaktır.');
    var beat = m.totalReturn - m.buyHold;
    $('simOut').innerHTML =
      '<div class="note">' + App.pretty(sym) + ' · ' + tf + ' · ' + d(m.fromTime) + ' → ' + d(m.toTime) + ' · ' + m.bars + ' mum · karar verici: ' + (mode === 'llm' ? esc(s.model || $('llmModel').value) : 'kural (referans)') + '</div>' +
      (warn.length ? '<div class="note" style="border-left:3px solid var(--warn,#e0a030);padding-left:8px">' + warn.join('<br>') + '</div>' : '') +
      '<div class="cards">' +
      c('AI getirisi', U.pct(m.totalReturn), m.totalReturn >= 0 ? 'up' : 'down') +
      c('Al & tut', U.pct(m.buyHold), m.buyHold >= 0 ? 'up' : 'down') +
      c('Kural motoru', rule ? U.pct(rule.totalReturn) : '–', rule && rule.totalReturn >= 0 ? 'up' : 'down', 'Aynı mumlar ve maliyetlerle klasik skor stratejisi') +
      c('AI − Al&tut', U.pct(beat), beat >= 0 ? 'up' : 'down') +
      c('Yıllıklandırılmış', m.annReturn == null ? '–' : U.pct(m.annReturn), '', 'Kısa dönemde yanıltıcı olabilir') +
      c('Sharpe', f(m.sharpe), m.sharpe >= 1 ? 'up' : m.sharpe < 0 ? 'down' : '', ci ? '95% güven aralığı [' + f(ci.lo) + ', ' + f(ci.hi) + '] (blok bootstrap)' : 'Güven aralığı için veri az') +
      c('Sharpe %95 GA', ci ? '[' + f(ci.lo) + ', ' + f(ci.hi) + ']' : '–', '', 'P(Sharpe>0) = %' + (ci ? f(ci.pPositive * 100, 0) : '–')) +
      c('Sortino', f(m.sortino)) + c('Calmar', f(m.calmar)) +
      c('Maks. düşüş', '-%' + f(m.maxDD), 'down') + c('En uzun su altı', m.maxUnderwaterBars + ' mum') +
      c('İşlem', m.trades) + c('Kazanma oranı', '%' + f(m.winRate, 1)) +
      c('Kâr faktörü', isFinite(m.profitFactor) ? f(m.profitFactor) : '∞', m.profitFactor >= 1 ? 'up' : 'down') + c('Ödeme oranı', f(m.payoff), '', 'Ort. kazanç / ort. kayıp') +
      c('Beklenti/işlem', U.pct(m.expectancyPct), m.expectancyPct >= 0 ? 'up' : 'down') +
      c('Ödenen komisyon', fmt(m.feesPaid, 2) + ' $', '', 'Komisyon (kayma hariç)') + c('Devir', '×' + f(m.turnover)) + c('Piyasada kalma', '%' + f(m.exposure, 0)) +
      c('Rastgele giriş p', rb ? f(rb.pValue, 3) : '–', rb && rb.pValue < 0.05 ? 'up' : '', rb ? 'Aynı sayıda/sürede rastgele işlemlerin ort. getirisi %' + f(rb.mean) + ' (p5 ' + f(rb.p5) + ', p95 ' + f(rb.p95) + '). p küçükse AI şansla açıklanamaz.' : 'İşlem yok') +
      c('LLM çağrısı', s.calls + (s.errors ? ' (' + s.errors + ' hata)' : ''), s.errors ? 'down' : '', 'Geçitle elenen tur: ' + s.gated) +
      c('Token (girdi/çıktı)', s.promptTokens + ' / ' + s.completionTokens) + c('Ort. gecikme', s.calls ? f(s.ms / s.calls / 1000, 1) + ' sn' : '–') +
      '</div>' +
      '<div class="eqchart" id="simChart"></div>' +
      '<div class="note"><span style="color:' + cssVar('--acc') + '">━</span> AI &nbsp; <span style="color:' + cssVar('--mut') + '">━</span> Al & tut &nbsp; <span style="color:' + cssVar('--warn') + '">━</span> Kural motoru. Karar her mumun <b>kapanışında</b> yalnızca o ana kadarki veriyle verilir; işlem <b>sonraki mumun açılışında</b> gerçekleşir. Komisyon %' + ai.params.feePct + ' + kayma %' + ai.params.slippagePct + ' her yönde. Backtest/simülasyon geleceği garanti etmez; yatırım tavsiyesi değildir.</div>' +
      '<h3 style="margin:14px 0 6px;font-size:13px">Karar günlüğü (son 300)</h3><div class="scroll" style="max-height:340px"><table class="t"><thead><tr><th>Zaman</th><th>Fiyat</th><th>Kural skoru</th><th>Pozisyon</th><th>AI kararı</th><th>Güven</th><th>Gerekçe</th></tr></thead><tbody>' +
      ai.decisions.slice(-300).reverse().map(function (x) {
        return '<tr><td>' + d(x.time) + '</td><td>' + fmt(x.price) + '</td><td class="' + (x.score >= 0 ? 'up' : 'down') + '">' + x.score + '</td><td>' + (x.inPos ? 'long' : 'flat') + '</td><td class="' + (x.action === 'buy' ? 'up' : x.action === 'sell' ? 'down' : x.action === 'error' ? 'down' : 'mut') + '">' + esc(x.action) + (x.executed ? ' ✓' : '') + '</td><td>' + x.confidence + '</td><td>' + esc(x.reason || '') + '</td></tr>';
      }).join('') + (ai.decisions.length ? '' : '<tr><td colspan="7" class="mut">Hiç karar turu çalışmadı (geçit çok yüksek olabilir).</td></tr>') + '</tbody></table></div>' +
      '<h3 style="margin:14px 0 6px;font-size:13px">İşlemler</h3><div class="scroll" style="max-height:300px"><table class="t"><thead><tr><th>#</th><th>Giriş</th><th>Giriş $</th><th>Çıkış</th><th>Çıkış $</th><th>Neden</th><th>Mum</th><th>Getiri</th><th>PnL $</th><th>Gerekçe</th></tr></thead><tbody>' +
      ai.trades.slice().reverse().map(function (t, i) {
        return '<tr><td>' + (ai.trades.length - i) + '</td><td>' + d(t.entryTime) + '</td><td>' + fmt(t.entry) + '</td><td>' + d(t.exitTime) + '</td><td>' + fmt(t.exit) + '</td><td>' + esc(t.reason) + '</td><td>' + t.bars + '</td><td class="' + (t.ret >= 0 ? 'up' : 'down') + '">' + U.pct(t.ret) + '</td><td class="' + (t.pnl >= 0 ? 'up' : 'down') + '">' + fmt(t.pnl, 2) + '</td><td>' + esc(t.why || '') + '</td></tr>';
      }).join('') + (ai.trades.length ? '' : '<tr><td colspan="10" class="mut">Hiç işlem açılmadı.</td></tr>') + '</tbody></table></div>';

    if (chart) { try { chart.remove(); } catch (e) {} }
    chart = LightweightCharts.createChart($('simChart'), { autoSize: true, layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut') },
      grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } }, timeScale: { timeVisible: true }, localization: { locale: 'tr-TR' } });
    var s1 = chart.addAreaSeries({ lineColor: cssVar('--acc'), topColor: cssVar('--acc') + '44', bottomColor: cssVar('--acc') + '05', lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
    s1.setData(ai.equity.map(function (e) { return { time: e.time, value: e.value }; }));
    chart.addLineSeries({ color: cssVar('--mut'), lineWidth: 1, priceLineVisible: false }).setData(m.bhEquity);
    if (bm.rule) chart.addLineSeries({ color: cssVar('--warn') || '#e0a030', lineWidth: 1, priceLineVisible: false }).setData(bm.rule.equity.map(function (e) { return { time: e.time, value: e.value }; }));
    s1.setMarkers(ai.trades.slice(-150).map(function (t) { return { time: t.entryTime, position: 'belowBar', color: cssVar('--up'), shape: 'arrowUp', text: '' }; }).sort(function (a, b) { return a.time - b.time; }));
    chart.timeScale().fitContent();
  }

  App.sim = {
    init: function () {
      var saved = App.store('sim') || {}, l = App.store('llm') || {};
      App.fillSymbolSelect($('simSym'), saved.sym || App.S.sym);
      FIELDS.forEach(function (k) { if (saved[k] != null) $(k).value = saved[k]; });
      if (saved.anon != null) $('simAnon').checked = saved.anon;
      if (l.url) $('llmUrl').value = l.url; if (l.model) $('llmModel').value = l.model; if (l.key) $('llmKey').value = l.key;
      $('llmTest').onclick = testConn; $('simRun').onclick = run;
      $('llmEye').onclick = function () { var i = $('llmKey'); i.type = i.type === 'password' ? 'text' : 'password'; };
      $('llmKeyDel').onclick = function () { $('llmKey').value = ''; saveCfg(); $('llmStatus').textContent = 'anahtar silindi'; $('llmStatus').className = 'mut'; };
      $('llmKey').oninput = saveCfg; keyState();
      $('simStop').onclick = function () { if (ctl) ctl.abort(); $('simStop').disabled = true; };
      $('simOut').innerHTML = '<div class="note">Bağlantıyı test edin, ardından "Simülasyonu başlat". İlk deneme için küçük başlayın: 1000 mum, en fazla 60 LLM çağrısı. Karar verici "Kural" seçilirse LLM kullanılmaz (referans çalıştırma).</div>';
    }
  };
})(typeof self !== 'undefined' ? self : this);
