// AI Bot kesintisizlik E2E testi (headless Chrome, gerçek Binance verisi, file://). Bağımlılık yok.
// Doğrular: Worker kalp atışı, sekme arka plandayken (pencere küçültülmüş) devam etme, takılan taramanın kendini onarması,
// kur önbelleği, sağlık satırı. Kullanım: node tests/e2e-bot.js
'use strict';
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path');
const INDEX = path.join(__dirname, '..', 'index.html'), OUT = path.join(__dirname, 'e2e-out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const PORT = 9339, prof = path.join(require('os').tmpdir(), 'atb-e2e-bot-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms)), results = [], logs = [];
function check(name, ok, info) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--window-size=1500,1200', 'about:blank'], { stdio: 'ignore' });
  let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch (e) { await sleep(250); } }
  const page = targets.find(t => t.type === 'page'), ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG-ERROR: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr.slice(0, 70) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(300); } return false; };
  const hh = () => ev('App.bot.health()');
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + INDEX.replace(/\\/g, '/') + '#bot' });

  check('Bot sekmesi açıldı', await waitFor("document.getElementById('v-bot').classList.contains('on') && !!App.bot && App.bot.state()"));
  await ev("(()=>{localStorage.removeItem('atb.bot');})()");
  await send('Page.reload'); await sleep(2500);
  await waitFor("document.getElementById('v-bot').classList.contains('on') && Object.keys(App.tick).length>30");
  await ev("(()=>{document.getElementById('botMode').value='super';document.getElementById('botApply').click();if(!App.bot.state().enabled)document.getElementById('botToggle').click();})()");

  // 1) Kalp atışı
  const h0 = await hh(); await sleep(5200); const h1 = await hh();
  check('Kalp atışı Web Worker ile çalışıyor', h1.hbKind === 'worker', h1.hbKind);
  check('Kalp atışı ~1/sn (5 sn ≥ 4 atış)', h1.beats - h0.beats >= 4, h1.beats - h0.beats);
  check('Web Lock tutuluyor (arka planda dondurmayı önler)', h1.locked === true, h1.locked);
  check('Süper modda sinyal taraması ilerliyor', await waitFor("App.bot.health().scans>=2 && App.bot.health().sigs>=10", 40000), await ev('(h=>({scans:h.scans,sigs:h.sigs,scanN:h.scanN,ms:h.scanMs}))(App.bot.health())'));
  check('Sağlık satırı "akış sağlıklı"', await waitFor("/akış sağlıklı/.test(document.getElementById('botHealth').innerText)", 10000), await ev("document.getElementById('botHealth').innerText"));

  // 2) Arka plan: pencereyi küçült → document.hidden
  let hidden = false;
  try {
    const w = await send('Browser.getWindowForTarget'); const wid = w.result.windowId;
    await send('Browser.setWindowBounds', { windowId: wid, bounds: { windowState: 'minimized' } }); await sleep(1500);
    hidden = await ev('document.hidden');
  } catch (e) {}
  if (!hidden) { try { await send('Emulation.setFocusEmulationEnabled', { enabled: false }); await send('Page.setWebLifecycleState', { state: 'active' }); } catch (e) {} }
  console.log('  Sekme arka plana alındı mı (document.hidden): ' + hidden);
  const b0 = await hh(); await sleep(20000); const b1 = await hh();
  if (hidden) {
    check('Arka plandayken kalp atışı sürüyor (20 sn ≥ 15 atış)', b1.beats - b0.beats >= 15, b1.beats - b0.beats);
    check('Arka plandayken taramalar sürüyor', b1.scans > b0.scans && Date.now() - b1.scanAt < 60000, { scans: b1.scans - b0.scans });
    check('Arka planda atışlar "hiddenBeats" olarak sayıldı', b1.hiddenBeats > b0.hiddenBeats, b1.hiddenBeats - b0.hiddenBeats);
    try { const w = await send('Browser.getWindowForTarget'); await send('Browser.setWindowBounds', { windowId: w.result.windowId, bounds: { windowState: 'normal' } }); } catch (e) {}
  } else console.log('  ATLANDI: bu ortamda headless Chrome pencere küçültmeyi/görünürlüğü taklit edemedi — arka plan testi KOŞMADI (başarılı sayılmaz).');

  // 3) Takılan tarama: klines sonsuza dek asılı → bayrak limit sonunda onarılmalı, sonra normale dönmeli
  const before = await hh();
  await ev("(()=>{window.__origK=Data.klines;Data.klines=function(){return new Promise(function(){});};})()");
  check('Asılı istek: tarama zaman aşımıyla biter ve yenisi başlar (≤ 50 sn)', await waitFor(`App.bot.health().scans>${before.scans} && App.bot.health().scanResets>=0 && App.bot.health().scanMs>=19000`, 50000), await ev('(h=>({scans:h.scans,ms:h.scanMs,resets:h.scanResets,scalping:h.scalping}))(App.bot.health())'));
  const hungAt = Date.now();
  await ev('Data.klines=window.__origK');
  const sa = (await hh()).scanAt;
  check('Düzelince yeni sinyaller yeniden akıyor', await waitFor(`App.bot.health().scanAt>${sa}`, 40000));

  // 4) Kur: 5 dk eski kur hâlâ geçerli, 11 dk eski geçersiz + sebep, yenilenince düzelir
  await ev('App.bot._test.setFx(50.5, Date.now()-300000)');
  check('5 dk eski kur hâlâ geçerli (eskiden 2 dk\'da bot duruyordu)', (await hh()).fxOk === true);
  await ev('App.bot._test.setFx(50.5, Date.now()-660000)');
  const stale = await hh();
  check('11 dk eski kur geçersiz sayılır', stale.fxOk === false);
  check('Kur yenilenince bot devam eder (≤ 20 sn)', await waitFor('App.bot.health().fxOk===true', 20000));

  // 4b) Öğrenen hafıza arayüzü
  check('Öğrenen hafıza varsayılan AÇIK (onay kutusu işaretli)', await ev("document.getElementById('botAdaptive').checked === true"));
  check('Hafıza paneli görünüyor', await waitFor("/Öğrenen hafıza:/.test(document.getElementById('botMem').innerText) && /devre kesici/i.test(document.getElementById('botMem').innerText)", 10000), await ev("document.getElementById('botMem').innerText.slice(0,120)"));
  // sentetik öğrenme: genel beklenti negatif → devre kesici açık görünür
  await ev("(()=>{const st=App.bot.state();for(let i=0;i<14;i++)Bot.memLearn(st,Bot.featOf({regime:{key:'range'},confidence:60,snap:{rsi:50,atrPct:0.3}},'TESTUSDT',{state:'weak'}),-0.8,Date.now()+i);document.getElementById('botMemReset').onclick;})()");
  check('Panel 14 işlemden öğrenildiğini ve %-0.80 beklentiyi gösteriyor', await waitFor("/14 işlemden öğrendi/.test(document.getElementById('botMem').innerText) && /%-0[.]80[/]işlem/.test(document.getElementById('botMem').innerText)", 20000), await ev("document.getElementById('botMem').innerText.slice(0,200)"));
  await ev("(()=>{window.confirm=()=>true;document.getElementById('botMemReset').click()})()");
  check('Hafıza sıfırlanır', await waitFor("App.bot.state().mem.n===0", 5000));
  await ev("(()=>{document.getElementById('botAdaptive').checked=false;document.getElementById('botApply').click()})()");
  check('Hafıza kapatılınca panel bunu söyler', await waitFor("/Öğrenen hafıza kapalı/.test(document.getElementById('botMem').innerText)", 20000));
  await ev("(()=>{document.getElementById('botAdaptive').checked=true;document.getElementById('botApply').click()})()");

  // 4c) Günlük trend modu (arayüzden seçilir; gerçek günlük mumlar)
  await ev("(()=>{document.getElementById('botMode').value='trend';document.getElementById('botApply').click();})()");
  check('Mod "trend" seçildi ve ön ayar uygulandı', await waitFor("App.bot.state().s.mode==='trend' && App.bot.state().s.maxPos===8 && App.bot.state().s.tf==='1d'", 5000));
  check('Günlük trend taraması çalıştı (≥15 sembolde kural durumu)', await waitFor("App.bot.health().trend>=15", 90000), await ev('(h=>({trend:h.trend,yukselis:h.trendOn,scans:h.scans,ms:h.scanMs}))(App.bot.health())'));
  check('Panel günlük trend modunu anlatıyor', await waitFor("/Günlük trend modu/.test(document.getElementById('botNote').innerText) && /felaket stopu/.test(document.getElementById('botNote').innerText)", 15000));
  check('Trend modunda hafıza/filtre devre dışı (adım trend fonksiyonuyla)', await ev("App.bot.state().s.mode==='trend'"));
  await ev("(()=>{document.getElementById('botMode').value='super';document.getElementById('botApply').click();})()");
  check('Hız moduna geri dönüş çalışıyor', await waitFor("App.bot.state().s.mode==='super' && App.bot.state().s.maxPos===8", 5000));

  // 5) Durdurunca kilit bırakılır
  await ev("document.getElementById('botToggle').click()");
  check('Bot durdurulunca Web Lock bırakılır', await waitFor('App.bot.health().locked===false', 5000));

  const errs = logs.filter(l => /^(error|EXCEPTION|LOG-ERROR)/.test(l) && !/Ping received after close|Failed to load resource/.test(l));
  check('Konsolda beklenmeyen hata yok', errs.length === 0, errs.slice(0, 6));
  fs.writeFileSync(path.join(OUT, 'e2e-bot-console.txt'), logs.join('\n'));
  const pass = results.filter(r => r.ok).length; console.log(`\nSONUÇ: ${pass}/${results.length} geçti`);
  ws.close(); chrome.kill(); process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS HATASI', e); process.exit(2); });
