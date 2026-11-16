// Headless Chrome + DevTools Protocol ile uçtan uca (E2E) duman testi. Bağımlılık yok (Node 24 fetch/WebSocket).
// Kullanım: node tests/e2e-chrome.js   (CHROME ortam değişkeniyle tarayıcı yolu verilebilir)
// Çıktı: tests/e2e-out/ altında ekran görüntüleri ve konsol günlüğü. Not: 'sahte anahtar' testi api.anthropic.com'a
// geçersiz bir anahtarla 1 istek atar (401 beklenir) — gerçek anahtar kullanılmaz.
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const INDEX = process.argv[2] || path.join(__dirname, '..', 'index.html');
const OUT = process.argv[3] || path.join(__dirname, 'e2e-out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const PORT = 9337;
const prof = path.join(require('os').tmpdir(), 'atb-e2e-prof-' + Date.now()); // geçici, boş tarayıcı profili
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const logs = [];
function check(name, ok, info) { results.push({ name, ok: !!ok, info }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--window-size=1680,1300', 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch (e) { await sleep(250); } }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG-ERROR: ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr.slice(0, 60) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'e2e-' + name + '.png'), Buffer.from(r.result.data, 'base64')); };
  const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(300); } return false; };

  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const url = 'file:///' + INDEX.replace(/\\/g, '/');
  await send('Page.navigate', { url });

  // 1) Açılış: canlı veri, sinyal, ticker tablosu
  check('lightweight-charts yüklendi', await waitFor('!!window.LightweightCharts'));
  check('Ticker tablosu 40 satır', await waitFor("document.querySelectorAll('#wTable tbody tr.row').length===40"), await ev("document.querySelectorAll('#wTable tbody tr.row').length"));
  check('Ana analiz hesaplandı', await waitFor('!!(App.dashboard.analysis() && App.dashboard.analysis().score!=null)'), await ev('App.dashboard.analysis() && {s:App.dashboard.analysis().score,l:App.dashboard.analysis().label,c:App.dashboard.analysis().confidence,r:App.dashboard.analysis().regime.key}'));
  check('Ana grafikte 1000 mum', await ev('App.dashboard.candles().length') >= 999, await ev('App.dashboard.candles().length'));
  check('MTF 4 zaman dilimi', await waitFor("App.mtf && Object.keys(App.mtf.by).length===4"), await ev('App.mtf && App.mtf.combined'));
  check('İzleme listesi sinyalleri (≥35/40)', await waitFor("Object.keys(App.sig).length>=35", 40000), await ev('Object.keys(App.sig).length'));
  check('WS ticker + main açık', await waitFor("(s=>s.ws.ticker==='open'&&s.ws.main==='open')(Data.status())"), await ev('Data.status().ws'));
  check('Canlı fiyat akıyor (emir defteri dolu)', await waitFor("document.querySelectorAll('#book .r').length>5"));
  check('Sayfa dikey kaydırılmamış (scrollY=0)', (await ev('scrollY')) === 0, await ev('scrollY'));
  await shot('dash');

  // 2) Tema değiştirme
  const th0 = await ev("document.documentElement.getAttribute('data-theme')");
  await ev("document.getElementById('btnTheme').click()");
  const th1 = await ev("document.documentElement.getAttribute('data-theme')");
  check('Tema değişti', th0 !== th1, th0 + ' → ' + th1);
  await sleep(500); await shot('dash-theme');
  await ev("document.getElementById('btnTheme').click()");

  // 3) Grafik ayarları: tip & gösterge & zaman dilimi
  await ev("document.querySelector('#cType [data-t=ha]').click()");
  check('Heikin-Ashi seçildi', await ev("App.S.chartType==='ha'"));
  await ev("(()=>{const c=document.querySelector('#indMenu [data-ind=bb]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));const s=document.querySelector('#indMenu [data-ind=stoch]');s.checked=true;s.dispatchEvent(new Event('change',{bubbles:true}));const o=document.querySelector('#indMenu [data-ind=obv]');o.checked=true;o.dispatchEvent(new Event('change',{bubbles:true}));const v=document.querySelector('#indMenu [data-ind=vwap]');v.checked=true;v.dispatchEvent(new Event('change',{bubbles:true}));const st=document.querySelector('#indMenu [data-ind=st]');st.checked=true;st.dispatchEvent(new Event('change',{bubbles:true}));})()");
  check('Alt paneller (rsi, macd, stoch, obv) oluştu', (await ev("document.querySelectorAll('#mainChart .cv-pane').length")) === 4, await ev("document.querySelectorAll('#mainChart .cv-pane').length"));
  await ev("document.querySelector('#cTf [data-tf=\"4h\"]').click()");
  check('Zaman dilimi 4h yüklendi', await waitFor("App.S.tf==='4h' && App.dashboard.analysis() && App.dashboard.candles().length>900"));
  await sleep(800); await shot('chart-4h-ha');

  // 4) Çizim: yatay çizgi (gerçek fare tıklaması)
  await ev("localStorage.removeItem('atb.draw.BTCUSDT')");
  await ev("document.getElementById('drH').click()");
  const r = await ev("(()=>{const b=document.querySelector('#mainChart .cv-main').getBoundingClientRect();return {x:b.left+b.width*0.5,y:b.top+b.height*0.4}})()");
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
  await sleep(300);
  check('Yatay çizgi kaydedildi', await ev("(JSON.parse(localStorage.getItem('atb.draw.BTCUSDT')||'[]')).filter(d=>d.type==='h').length===1"), await ev("localStorage.getItem('atb.draw.BTCUSDT')"));
  await ev("document.getElementById('drT').click()");
  const box = await ev("(()=>{const b=document.querySelector('#mainChart .cv-main').getBoundingClientRect();return {l:b.left,w:b.width}})()");
  for (const fx of [0.3, 0.7]) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.l + box.w * fx, y: r.y + (fx - 0.5) * 80 });
    await sleep(150);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: box.l + box.w * fx, y: r.y + (fx - 0.5) * 80, button: 'left', clickCount: 1 });
    await sleep(700);
  }
  await sleep(300);
  check('Trend çizgisi kaydedildi', await ev("(JSON.parse(localStorage.getItem('atb.draw.BTCUSDT')||'[]')).filter(d=>d.type==='t').length===1"));
  await shot('drawings');

  // 5) Sembol değiştirme (izleme listesi tıklaması)
  await ev("document.querySelector('#wTable tr.row[data-s=ETHUSDT]').click()");
  check('ETH seçildi ve yüklendi', await waitFor("App.S.sym==='ETHUSDT' && App.dashboard.candles().length>900 && document.getElementById('cSym').textContent==='ETH/USDT'"));
  await ev("document.querySelector('#wTable th[data-k=chg]').click()");
  check('Sıralama 24s % değişti', await ev("App.S.sort.k==='chg'"));
  await ev("App.setSymbol('BTCUSDT','1h')"); await waitFor("App.S.tf==='1h' && App.dashboard.candles().length>900");

  // 6) Sanal portföy: piyasa emri, limit emri, kapatma
  await ev("App.setView('paper')"); await sleep(500);
  await ev("document.getElementById('ppReset').click===undefined");
  await ev("(()=>{App.store('paper',null);})()");
  await ev("document.getElementById('ppSym').value='BTCUSDT';document.getElementById('ppAmt').value='1000';document.getElementById('ppType').value='market';document.getElementById('ppBuy').click()");
  const pst = await ev("({n:App.paper.state().positions.length,cash:App.paper.state().cash})");
  check('Sanal market LONG açıldı', pst.n >= 1, pst);
  await ev("(()=>{const t=document.getElementById('ppType');t.value='limit';t.dispatchEvent(new Event('change'));document.getElementById('ppPrice').value=String(App.price('BTCUSDT')*0.5);document.getElementById('ppAmt').value='500';document.getElementById('ppBuy').click()})()");
  check('Sanal limit emir bekliyor', await ev("App.paper.state().orders.length===1"), await ev("App.paper.state().orders.map(o=>o.price)"));
  await sleep(1500); await shot('paper');
  await ev("document.querySelector('[data-close]').click()");
  check('Pozisyon kapatıldı, geçmişe yazıldı', await ev("App.paper.state().positions.length===0 && App.paper.state().history.length===1"), await ev("App.paper.state().history[0] && App.paper.state().history[0].pnl"));
  await ev("document.querySelector('[data-cancel]').click()");
  check('Limit emir iptal, bakiye ≈ 10000 - komisyonlar', await ev("Math.abs(App.paper.state().cash-10000)<5 && App.paper.state().orders.length===0"), await ev("App.paper.state().cash"));
  check('Portföy localStorage’da kalıcı', await ev("JSON.parse(localStorage.getItem('atb.paper')).history.length===1"));

  // 7) Alarmlar: hemen tetiklenecek fiyat alarmı
  await ev("App.setView('alerts')"); await sleep(300);
  await ev("(()=>{document.getElementById('alSym').value='BTCUSDT';const t=document.getElementById('alType');t.value='price_above';t.dispatchEvent(new Event('change'));document.getElementById('alVal').value=String(Math.floor(App.price('BTCUSDT')*0.5));document.getElementById('alAdd').click()})()");
  check('Fiyat alarmı tetiklendi (geçmişe düştü)', await waitFor("(JSON.parse(localStorage.getItem('atb.alertHist')||'[]')).length>=1", 8000), await ev("localStorage.getItem('atb.alertHist')"));
  await ev("(()=>{const t=document.getElementById('alType');t.value='signal_change';t.dispatchEvent(new Event('change'));document.getElementById('alAdd').click()})()");
  check('Sinyal değişimi alarmı ilk etiketini aldı', await waitFor("(JSON.parse(localStorage.getItem('atb.alerts'))||[]).some(a=>a.type==='signal_change'&&a.lastLabel)", 20000));
  await shot('alerts');

  // 8) Piyasa sekmesi
  await ev("App.setView('market')");
  check('Isı haritası kutuları', await waitFor("document.querySelectorAll('#heat div').length>=35"), await ev("document.querySelectorAll('#heat div').length"));
  check('Fear & Greed gösterildi', await waitFor("!!App.fng"), await ev('App.fng'));
  check('BTC dominansı (CoinGecko)', await waitFor("!!App.globalMkt", 15000), await ev('App.globalMkt'));
  check('Korelasyon matrisi 12×12', await waitFor("document.querySelectorAll('#corr table tr').length===13"));

  // 9) Backtest (gerçek veri, 1000 mum)
  await ev("App.setView('bt')"); await ev("document.getElementById('btN').value='1000'; document.getElementById('btRun').click()");
  check('Backtest tamamlandı', await waitFor("document.querySelectorAll('#btOut .card').length>=10", 40000), await ev("[...document.querySelectorAll('#btOut .card')].slice(0,6).map(c=>c.innerText.replace(/\\n/,': ')).join(' | ')"));
  await shot('backtest');

  // 10) Çoklu grafik
  await ev("App.setView('grid')");
  check('2×2 grafik 4 hücre', await waitFor("document.querySelectorAll('#grid4 .panel').length===4 && document.querySelectorAll('#grid4 canvas').length>8"));
  check('Grid WS açık', await waitFor("Data.status().ws.grid==='open'"));
  await sleep(1000); await shot('grid');
  await ev("App.setView('dash')");
  check('Grid WS sekmeden çıkınca kapandı', await waitFor("!Data.status().ws.grid", 3000));

  // 11) AI Analist: anahtar yokken gizli; sahte anahtarla gerçek API hata yolu
  check('Anahtar yokken Claude düğmesi gizli', await ev("document.getElementById('anRun').classList.contains('hidden')"));
  await ev("App.store('anthropicKey','sk-ant-test-invalid-key'); document.getElementById('btnSettings').click(); document.getElementById('setClose').click();");
  await ev("App.ai.init===undefined"); // no-op
  await ev("(()=>{document.getElementById('setKey').value='sk-ant-test-invalid-key';document.getElementById('setSave').click()})()");
  check('Anahtar varken Claude düğmesi görünür', await ev("!document.getElementById('anRun').classList.contains('hidden')"));
  await ev("document.getElementById('anRun').click()");
  check('Geçersiz anahtar → anlaşılır hata (CORS geçti, API yanıt verdi)', await waitFor("/Claude analizi başarısız/.test(document.getElementById('anOut').innerText)", 30000), await ev("document.getElementById('anOut').innerText.slice(0,200)"));
  await ev("document.getElementById('setDel').click()");
  check('Anahtar silindi', await ev("localStorage.getItem('atb.anthropicKey')===null && document.getElementById('anRun').classList.contains('hidden')"));

  // 12) Düzen kalıcılığı: panel gizle + yeniden yükle
  await ev("document.querySelector('[data-id=stats] .ph [data-a=x]').click()");
  await send('Page.reload'); await sleep(4000);
  check('Gizlenen panel yeniden yüklemeden sonra gizli', await waitFor("document.querySelector('[data-id=stats]').classList.contains('hidden')"));
  check('Sanal portföy yeniden yüklemeden sonra korunuyor', await waitFor("App.paper.state().history.length===1"));
  await ev("document.getElementById('btnResetLayout').click()");

  // 13) Mobil genişlik
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 1600, deviceScaleFactor: 1, mobile: true });
  await sleep(1500);
  check('Mobilde yatay taşma yok (scrollWidth ≤ 390)', (await ev('document.documentElement.scrollWidth')) <= 390, await ev('document.documentElement.scrollWidth'));
  await shot('mobile');
  await send('Emulation.clearDeviceMetricsOverride');

  // Konsol
  const errs = logs.filter(l => /^(error|EXCEPTION|LOG-ERROR)/.test(l) && !/401 \(\) https:\/\/api\.anthropic\.com/.test(l) && !/Ping received after close/.test(l));
  const benign = logs.filter(l => /Ping received after close/.test(l)); if (benign.length) console.log('  Not (zararsız, Chrome ağ günlüğü): ' + benign.length + '× "WebSocket ... Ping received after close" — sembol değişiminde eski soket kapanırken'); // 401: kasıtlı sahte anahtar testi
  check('Konsolda hata/istisna yok', errs.length === 0, errs.slice(0, 10));
  fs.writeFileSync(path.join(OUT, 'e2e-console.txt'), logs.join('\n'));
  const pass = results.filter(r => r.ok).length;
  console.log(`\nSONUÇ: ${pass}/${results.length} geçti`);
  ws.close(); chrome.kill();
  process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS HATASI', e); process.exit(2); });


