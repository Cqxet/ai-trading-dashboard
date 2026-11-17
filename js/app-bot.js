/* =====================================================================
 * app-bot.js — AI botu arayüzü (motor: bot.js). GERÇEK EMİR YOK.
 * Tek ağ çağrısı: USDTTRY kuru (Binance herkese açık fiyat). Durum localStorage'da.
 * Bot yalnızca sayfa açıkken çalışır.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Bot = root.Bot;
  var $ = App.$, fmt = U.fmt, esc = U.esc;
  var st = null, fx = 0, fxAt = 0, chart = null, series = null, lastStep = 0, lastRender = 0;
  // Sağlık / kalp atışı (takılma tespiti ve kendini onarma)
  var H = { hbKind: 'yok', hbAt: 0, beats: 0, scanAt: 0, scanN: 0, scanMs: 0, scans: 0, scanResets: 0, reason: '', fxFails: 0, hiddenBeats: 0 };
  var FX_MAX_AGE = 600000;   // kur 10 dk'ya kadar geçerli (USDT/TRY yavaş değişir); eskiden 2 dk idi ve bot sessizce duruyordu

  function load() {
    st = App.store('bot');
    if (!st || typeof st.cash !== 'number' || !st.s) st = Bot.create();
    st.s = Object.assign({}, Bot.DEFAULTS, st.s);
    if (!st.mem) st.mem = Bot.newMem();
    if (st.s.mode === 'scalp') Bot.applyMode(st, 'fast');   // eski kayıtlı mod adı
  }
  function save() { App.store('bot', st); }
  function prices() { var p = {}; App.SYMBOLS.forEach(function (s) { if (App.tick[s]) p[s] = App.tick[s].price; }); return p; }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function d(t) { return new Date(t).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' }); }
  function tl(v, n) { return fmt(v, n == null ? 2 : n) + ' ₺'; }

  async function loadFx() {
    // Tarama istekleri kuyruğu doldurduğunda kur isteği arkada beklemesin: kuyruğu atlayan doğrudan çağrı
    var hosts = ['https://data-api.binance.vision', 'https://api.binance.com'];
    for (var i = 0; i < hosts.length; i++) {
      try {
        var r = await root.Data.external(hosts[i] + '/api/v3/ticker/price?symbol=USDTTRY', 8000);
        if (+r.price > 0) { fx = +r.price; fxAt = Date.now(); H.fxFails = 0; return; }
      } catch (e) { /* diğer sunucu / sonraki tur */ }
    }
    H.fxFails++;   // eski kur kalır; FX_MAX_AGE'den eskiyse bot işlem yapmaz
  }
  function fxOk() { return fx > 0 && Date.now() - fxAt < FX_MAX_AGE; }

  // Hızlı mod: en hacimli 20 sembolde 15 dk mumlardan düşük eşikli sinyal (30 sn'de bir)
  var scalpSigs = {}, scalping = false, lastScalp = 0, scanStart = 0, scanGen = 0;
  async function scalpScan() {
    if (!st.enabled || st.s.mode === 'normal') return;
    var S = st.s, limitMs = Math.max(20000, (S.scanSec || 30) * 2000);
    // Önceki tarama hâlâ sürüyorsa bekle; ama limitMs'yi aştıysa takılı sayıp bırak (bayrak kendini onarır)
    if (scalping && Date.now() - scanStart < limitMs) return;
    if (scalping) H.scanResets++;
    scalping = true; scanStart = lastScalp = Date.now(); var gen = ++scanGen, ok = 0;
    var top = App.SYMBOLS.filter(function (s) { return App.tick[s]; }).sort(function (a, b) { return App.tick[b].qvol - App.tick[a].qvol; }).slice(0, S.topN || 20);
    var all = Promise.all(top.map(async function (s) {
      try {
        var cs = (await root.Data.klines(s, S.tf || '15m', 200, (S.scanSec || 30) * 800)).slice(0, -1);
        var g = root.Signals.analyze(cs, { buyTh: S.buyTh, sellTh: -S.buyTh, atrStop: S.atrStop, atrTarget: S.atrTarget });
        // Sinyal gelir gelmez yazılır: tarama bitmese bile kısmi sonuçlar kullanılır
        if (g) { scalpSigs[s] = { g: g, t: Date.now() }; ok++; H.scanAt = Date.now(); }
      } catch (e) { /* sonraki turda */ }
    }));
    var timer, timeout = new Promise(function (res) { timer = setTimeout(res, limitMs); });
    await Promise.race([all, timeout]); clearTimeout(timer);
    H.scanN = ok; H.scanMs = Date.now() - scanStart; H.scans++;
    if (gen === scanGen) scalping = false;   // daha yeni bir tarama başlamışsa bayrağa dokunma
  }

  function run() {
    var now = Date.now();
    if (!st.enabled) { H.reason = ''; return; }
    if (!fxOk()) { H.reason = 'USDT/TRY kuru eski (' + (fx ? Math.round((now - fxAt) / 1000) + ' sn' : 'hiç alınamadı') + ')'; return; }
    if (now - lastStep < 3000) return;
    lastStep = now; H.reason = '';
    var P = prices(), sigs = {};
    if (st.s.mode !== 'normal') { sigs = scalpSigs; if (now - lastScalp > (st.s.scanSec || 30) * 1000) scalpScan(); }
    else App.SYMBOLS.forEach(function (s) { if (App.sig[s]) sigs[s] = { g: App.sig[s].g, t: App.sig[s].t }; });
    var ev = Bot.step(st, { prices: P, fx: fx, sigs: sigs }, now);
    Bot.logEquity(st, P, fx, now, 30);
    ev.forEach(function (e) {
      var msg = e.type === 'buy' ? 'AL ' + App.pretty(e.position.sym) + ' — ' + tl(e.position.costTRY)
        : 'SAT ' + App.pretty(e.rec.sym) + ' (' + e.rec.reason + ') net ' + tl(e.rec.pnl);
      App.toast('[AI Bot] ' + msg, e.type === 'sell' && e.rec.pnl < 0 ? 'bad' : 'ok', 7000);
    });
    if (ev.length) save();
  }

  /* ---- Kalp atışı: Web Worker zamanlayıcısı arka plan sekmede kısılmaz (ana iş parçacığı setInterval'leri kısılır) ---- */
  var hbWorker = null, lastSaveAt = 0, lastNormal = 0, lockRelease = null;
  function beat() {
    H.hbAt = Date.now(); H.beats++; if (document.hidden) H.hiddenBeats++;
    if (!st.enabled) return;
    run();
    if (st.s.mode !== 'normal' && Date.now() - lastScalp > (st.s.scanSec || 30) * 1000) scalpScan();   // run() 3 sn kısıtına takılsa da tarama aksamasın
    if (st.s.mode === 'normal' && document.hidden && Date.now() - lastNormal > 60000) { lastNormal = Date.now(); try { App.refreshSigs(); } catch (e) {} }
    if (Date.now() - lastSaveAt > 10000) { lastSaveAt = Date.now(); save(); }
    if (!document.hidden && App.view() === 'bot' && Date.now() - lastRender > 2000) render(false);
  }
  function startHeartbeat() {
    try {
      var url = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},1000)'], { type: 'text/javascript' }));
      hbWorker = new Worker(url); hbWorker.onmessage = beat; hbWorker.onerror = function () { fallbackHeartbeat(); };
      H.hbKind = 'worker';
    } catch (e) { fallbackHeartbeat(); }
  }
  function fallbackHeartbeat() { if (hbWorker) { try { hbWorker.terminate(); } catch (e) {} hbWorker = null; } if (H.hbKind !== 'timer') { H.hbKind = 'timer'; setInterval(beat, 1000); } }
  /** Bot açıkken Web Lock tutulur: Chrome kilit tutan sekmeyi arka planda dondurmaz. */
  function syncLock() {
    try {
      if (st.enabled && !lockRelease && navigator.locks) navigator.locks.request('atb-bot-alive', function () { return new Promise(function (res) { lockRelease = res; }); });
      else if (!st.enabled && lockRelease) { lockRelease(); lockRelease = null; }
    } catch (e) {}
  }
  function memHTML() {
    var m = st.mem || {}, g = m.b && m.b['g:all'], n = g ? g.n : 0, mean = n ? g.sum / n : 0, S = st.s;
    if (!S.adaptive) return '<b>Öğrenen hafıza kapalı.</b> Bot yalnızca sinyal kurallarıyla çalışır (geçmiş testlerde bu, maliyet nedeniyle ağır zarar üretti).';
    var guard = m.guardOn, until = m.pauseUntil > Date.now() ? ' · seri zarar molası ' + Math.ceil((m.pauseUntil - Date.now()) / 60000) + ' dk' : '';
    var best = [], worst = [];
    Object.keys(m.b || {}).forEach(function (k) { var b = m.b[k]; if (k === 'g:all' || b.n < S.memMinN) return; var mu = b.sum / b.n; (mu >= 0 ? best : worst).push([k, mu, b.n]); });
    best.sort(function (a, b) { return b[1] - a[1]; }); worst.sort(function (a, b) { return a[1] - b[1]; });
    var li = function (a) { return a.slice(0, 3).map(function (x) { return esc(x[0]) + ' %' + x[1].toFixed(2) + ' (n=' + Math.round(x[2]) + ')'; }).join(' · ') || '—'; };
    return '<b>Öğrenen hafıza:</b> ' + m.n + ' işlemden öğrendi · genel net beklenti <b class="' + (mean >= 0 ? 'up' : 'down') + '">%' + mean.toFixed(2) + '/işlem</b> (etkin n≈' + Math.round(n) + ') · ' +
      (guard ? '<span class="down">DEVRE KESİCİ AÇIK</span>: yeni işlemler engellendi, yalnızca küçük (×0,3) deneme işlemleri yapılır' : '<span class="up">devre kesici kapalı</span>') + until + ' · engellenen aday: ' + (m.blocked || 0) + '<br>' +
      '<span class="mut">En iyi bölgeler:</span> ' + li(best) + '<br><span class="mut">En kötü bölgeler:</span> ' + li(worst) +
      '<br><span class="mut">Bu bir kâr garantisi değil: geçmiş gerçek verideki testlerde sinyallerin maliyet sonrası kalıcı üstünlüğü bulunamadı; hafıza zararı azaltır, işlem yapmamayı öğrenir.</span>';
  }
  function ago(t) { return t ? Math.round((Date.now() - t) / 1000) + ' sn önce' : 'yok'; }
  function healthHTML() {
    if (!st.enabled) return '';
    var S = st.s, fast = S.mode !== 'normal', now = Date.now(), warn = [];
    if (now - H.hbAt > 5000) warn.push('kalp atışı durdu');
    if (fast && H.scanAt && now - H.scanAt > Math.max(45000, (S.scanSec || 30) * 4000)) warn.push('sinyal taraması ' + ago(H.scanAt));
    if (fast && !H.scanAt && now - lastScalp > 30000) warn.push('henüz sinyal gelmedi');
    if (!fxOk()) warn.push('kur eski');
    var ws = root.Data.status().ws.ticker;
    if (ws !== 'open') warn.push('canlı fiyat akışı ' + ws + ' (REST ile yoklanıyor)');
    var parts = ['kalp atışı ' + H.hbKind + ' · ' + ago(H.hbAt)];
    if (fast) parts.push('son sinyal taraması ' + ago(H.scanAt) + ' (' + H.scanN + ' sembol, ' + (H.scanMs / 1000).toFixed(1) + ' sn)');
    parts.push('kur ' + ago(fxAt));
    if (document.hidden) parts.push('sekme arka planda — bot çalışmaya devam ediyor');
    if (H.scanResets) parts.push('takılan tarama ' + H.scanResets + '× otomatik onarıldı');
    return '<span style="color:var(' + (warn.length ? '--down' : '--up') + ')">' + (warn.length ? '⚠ ' + esc(warn.join(' · ')) : '✓ akış sağlıklı') + '</span> <span class="mut">· ' + esc(parts.join(' · ')) + '</span>';
  }

  function render(full) {
    lastRender = Date.now();
    var P = prices(), eq = Bot.equity(st, P, fx || undefined), real = st.history.reduce(function (a, h) { return a + h.pnl; }, 0);
    var wins = st.history.filter(function (h) { return h.pnl > 0; }).length, T = st.totals;
    var c = function (k, v, cls) { return '<div class="card"><small>' + k + '</small><b class="' + (cls || '') + '">' + v + '</b></div>'; };
    $('botCards').innerHTML = c('Portföy değeri', tl(eq)) + c('Toplam getiri', U.pct((eq / st.initial - 1) * 100), eq >= st.initial ? 'up' : 'down') +
      c('Serbest nakit', tl(st.cash)) + c('Gerçekleşen net PnL', tl(real), real >= 0 ? 'up' : 'down') +
      c('Kapanan işlem', st.history.length + (st.history.length ? ' (%' + (wins / st.history.length * 100).toFixed(0) + ' kazanç)' : '')) +
      c('Ödenen komisyon', tl(T.fee)) + c('Ödenen işlem vergisi', tl(T.tax)) + c('Ödenen kâr vergisi', tl(T.profitTax)) +
      c('USDT/TRY', fx ? fmt(fx, 4) + (fxOk() ? '' : ' (eski!)') : 'yükleniyor…');
    $('botToggle').textContent = st.enabled ? 'Durdur' : 'Başlat';
    $('botToggle').className = 'btn sm ' + (st.enabled ? 'sell' : 'buy');
    $('botNote').innerHTML = (st.enabled ? '● Bot çalışıyor' : '○ Bot durdu') + ' — yalnızca bu sayfa açıkken işlem yapar. Her işlemde komisyon + kayma + işlem vergisi düşülür; ' +
      (st.s.mode !== 'normal' ? 'Hız modu (' + esc(st.s.mode) + '): en hacimli ' + st.s.topN + ' sembolde ' + st.s.tf + ' sinyaller, ' + st.s.scanSec + ' saniyede bir taranır; ' : 'sinyaller izleme listesi taramasından (' + esc(App.S.scanTf) + ') gelir; ') + 'Maliyetleri (yaklaşık %' + (Bot.costRate(st.s) * 200).toFixed(2) + ' gidiş-dönüş) aşamayan fırsatlar atlanır. Gerçek para/emir yok. Yatırım tavsiyesi değildir; geçmiş performans geleceği garanti etmez.';
    if ($('botHealth')) $('botHealth').innerHTML = healthHTML();
    if ($('botMem')) $('botMem').innerHTML = memHTML();
    $('botPos').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Miktar</th><th>Giriş $</th><th>Güncel $</th><th>Maliyet ₺</th><th>Değer ₺</th><th>PnL ₺</th><th>Stop</th><th>Hedef</th><th>Açılış</th><th>Gerekçe</th><th></th></tr></thead><tbody>' +
      (st.positions.map(function (p) {
        var px = P[p.sym] || p.entry, v = p.qty * px * (fx || p.entryFx), u = v - p.costTRY;
        return '<tr><td><b>' + App.pretty(p.sym) + '</b></td><td>' + fmt(p.qty, 6) + '</td><td>' + fmt(p.entry) + '</td><td>' + fmt(px) + '</td><td>' + fmt(p.costTRY, 2) + '</td><td>' + fmt(v, 2) +
          '</td><td class="' + (u >= 0 ? 'up' : 'down') + '">' + fmt(u, 2) + '</td><td>' + fmt(p.stop) + '</td><td>' + fmt(p.target) + '</td><td class="mut">' + d(p.openedAt) + '</td><td class="mut">' + esc(p.why) +
          '</td><td><button class="btn sm" data-bclose="' + p.id + '">Kapat</button></td></tr>';
      }).join('') || '<tr><td colspan="12" class="mut">Açık pozisyon yok</td></tr>') + '</tbody></table>';
    if (!full) return;
    $('botLog').innerHTML = '<table class="t"><tbody>' + (st.log.slice(0, 60).map(function (l) { return '<tr><td class="mut">' + d(l.t) + '</td><td>' + esc(l.text) + '</td></tr>'; }).join('') || '<tr><td class="mut">Henüz karar yok</td></tr>') + '</tbody></table>';
    $('botHist').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Giriş $</th><th>Çıkış $</th><th>Net PnL ₺</th><th>Maliyet ₺</th><th>Neden</th><th>Kapanış</th></tr></thead><tbody>' +
      (st.history.slice(0, 100).map(function (h) { return '<tr><td>' + App.pretty(h.sym) + '</td><td>' + fmt(h.entry) + '</td><td>' + fmt(h.exit) + '</td><td class="' + (h.pnl >= 0 ? 'up' : 'down') + '">' + fmt(h.pnl, 2) + '</td><td>' + fmt(h.fees, 2) + '</td><td>' + esc(h.reason) + '</td><td class="mut">' + d(h.closedAt) + '</td></tr>'; }).join('') || '<tr><td colspan="7" class="mut">Henüz işlem yok</td></tr>') + '</tbody></table>';
    drawChart();
  }

  function drawChart() {
    var el = $('botChart');
    if (!chart) {
      chart = LightweightCharts.createChart(el, { autoSize: true, timeScale: { timeVisible: true }, localization: { locale: 'tr-TR' } });
      series = chart.addAreaSeries({ lineWidth: 2, priceFormat: { type: 'price', precision: 2, minMove: 0.01 } });
    }
    chart.applyOptions({ layout: { background: { type: 'solid', color: cssVar('--panel') }, textColor: cssVar('--mut') }, grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } } });
    series.applyOptions({ lineColor: cssVar('--acc'), topColor: cssVar('--acc') + '44', bottomColor: cssVar('--acc') + '05' });
    var data = st.equityLog.slice(), now = Math.floor(Date.now() / 1000);
    if (!data.length) data.push({ time: now - 60, value: st.initial });
    if (data[data.length - 1].time < now) data.push({ time: now, value: Bot.equity(st, prices(), fx || undefined) });
    series.setData(data);
  }

  function fillForm() {
    var s = st.s;
    $('botFee').value = +(s.feeRate * 100).toFixed(4); $('botSlip').value = +(s.slipRate * 100).toFixed(4);
    $('botTax').value = +(s.taxRate * 100).toFixed(4); $('botPTax').value = +(s.profitTaxRate * 100).toFixed(2);
    $('botAdaptive').checked = !!s.adaptive; $('botMode').value = s.mode || 'normal'; $('botConf').value = s.minConf; $('botMaxPos').value = s.maxPos;
  }

  App.bot = {
    init: function () {
      load(); fillForm(); loadFx(); setInterval(loadFx, 15000); startHeartbeat(); syncLock();
      $('botToggle').onclick = function () {
        st.enabled = !st.enabled; save(); syncLock(); render(true);
        App.toast(st.enabled ? 'AI Bot başlatıldı (sanal, TL)' : 'AI Bot durduruldu', 'ok');
      };
      $('botMemReset').onclick = function () { if (!confirm('Öğrenilen hafıza (kazanç/kayıp istatistikleri ve devre kesici) sıfırlansın mı? Portföy ve işlemler korunur.')) return; st.mem = Bot.newMem(); save(); render(true); App.toast('Hafıza sıfırlandı', 'ok'); };
      $('botReset').onclick = function () {
        if (!confirm('Bot portföyü sıfırlansın mı? Tüm pozisyonlar ve geçmiş silinir; bakiye 100 TL olur.')) return;
        var s = st.s; st = Bot.create(s); st.cash = st.initial = s.initialTRY; save(); syncLock(); render(true); App.toast('Bot portföyü sıfırlandı', 'ok');
      };
      $('botApply').onclick = function () {
        var s = st.s, v = function (id) { return +$(id).value; };
        var fee = v('botFee') / 100, slip = v('botSlip') / 100, tax = v('botTax') / 100, ptax = v('botPTax') / 100, conf = v('botConf'), mp = Math.round(v('botMaxPos'));
        if (![fee, slip, tax, ptax].every(function (x) { return x >= 0 && x < 0.5; }) || !(conf >= 0 && conf <= 100) || !(mp >= 1 && mp <= 10)) { App.toast('Geçersiz ayar değeri', 'bad'); return; }
        var mode = $('botMode').value; if (mode !== s.mode) { Bot.applyMode(st, mode); conf = s.minConf; mp = s.maxPos; $('botConf').value = conf; $('botMaxPos').value = mp; }
        s.adaptive = $('botAdaptive').checked; s.mktFilter = s.adaptive;
        s.feeRate = fee; s.slipRate = slip; s.taxRate = tax; s.profitTaxRate = ptax; s.minConf = conf; s.maxPos = mp;
        save(); App.toast('Ayarlar uygulandı', 'ok');
      };
      $('v-bot').addEventListener('click', function (e) {
        var c = e.target.dataset.bclose;
        if (!c) return;
        var p = st.positions.find(function (q) { return q.id === +c; }), px = p && App.price(p.sym);
        if (!px || !fxOk()) return App.toast('Fiyat/kur yok', 'bad');
        var rec = Bot.sell(st, +c, px, fx, Date.now(), 'Manuel'); App.toast('Kapatıldı, net ' + tl(rec.pnl), rec.pnl >= 0 ? 'ok' : 'bad'); save(); render(true);
      });
      App.on('tick', function () {
        run();
        if (App.view() === 'bot' && Date.now() - lastRender > 1000) render(false);
      });
      App.on('sigs', function () { run(); });
      App.on('view', function (v) { if (v === 'bot') setTimeout(function () { render(true); }, 30); });
      App.on('theme', function () { if (chart) drawChart(); });
      setInterval(function () { if (st.enabled && Date.now() - lastStep > 10000) run(); if (App.view() === 'bot') render(true); }, 15000);
      setInterval(save, 30000);
      root.addEventListener('beforeunload', save);
    },
    state: function () { return st; },
    health: function () { return Object.assign({}, H, { fx: fx, fxAt: fxAt, fxOk: fxOk(), scalping: scalping, lastScalp: lastScalp, locked: !!lockRelease, sigs: Object.keys(scalpSigs).length }); },
    _test: { setFx: function (v, at) { fx = v; fxAt = at; }, scan: scalpScan, scalpSigs: scalpSigs }
  };
})(typeof self !== 'undefined' ? self : this);
