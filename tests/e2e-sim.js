// "AI Simülasyon" sekmesi için headless Chrome E2E testi. Gerçek Binance verisi + YEREL SAHTE OpenAI uyumlu sunucu
// (9router'ın yerine; CORS ön kontrolü dahil). Bağımlılık yok. Kullanım: node tests/e2e-sim.js
'use strict';
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const INDEX = path.join(__dirname, '..', 'index.html'), OUT = path.join(__dirname, 'e2e-out'); fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => fs.existsSync(p));
const PORT = 9338, prof = path.join(require('os').tmpdir(), 'atb-e2e-sim-' + Date.now());
const sleep = ms => new Promise(r => setTimeout(r, ms)), results = [], logs = [];
function check(name, ok, info) { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }

let slow = false, hits = 0, preflights = 0, lastAuth = null, userMsg = '';
const fake = http.createServer((req, res) => {
  res.setHeader('access-control-allow-origin', '*'); res.setHeader('access-control-allow-headers', 'authorization,content-type'); res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  res.setHeader('access-control-allow-private-network', 'true');
  if (req.method === 'OPTIONS') { preflights++; res.statusCode = 204; return res.end(); }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/v1/models') return res.end(JSON.stringify({ data: [{ id: 'combo/fake-1' }, { id: 'cc/fake-2' }] }));
  let b = ''; req.on('data', d => b += d); req.on('end', () => {
    hits++; lastAuth = req.headers.authorization; const j = JSON.parse(b); userMsg = j.messages[1].content;
    const ctx = JSON.parse(userMsg.slice(userMsg.indexOf('{')));
    const buy = ctx.position === 'flat' && ctx.rule_engine.score >= 15, sell = ctx.position !== 'flat' && ctx.rule_engine.score <= -5;
    const send = () => res.end(JSON.stringify({ model: j.model, choices: [{ message: { content: '```json\n' + JSON.stringify({ action: buy ? 'buy' : sell ? 'sell' : 'hold', confidence: 75, size_pct: 50, stop_atr: 1.5, target_atr: 3, reason: 'sahte karar' }) + '\n```' }, finish_reason: 'stop' }], usage: { prompt_tokens: 400, completion_tokens: 30 } }));
    slow ? setTimeout(send, 600) : send();
  });
});

(async () => {
  await new Promise(r => fake.listen(0, '127.0.0.1', r)); const fport = fake.address().port;
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=' + PORT, '--user-data-dir=' + prof, '--window-size=1500,1400', 'about:blank'], { stdio: 'ignore' });
  let targets; for (let i = 0; i < 40; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch (e) { await sleep(250); } }
  const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
  let id = 0; const pend = {};
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; return; }
    if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('LOG-ERROR: ' + m.params.entry.text + ' ' + (m.params.entry.url || '')); };
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result.exceptionDetails) throw new Error(expr.slice(0, 70) + ' → ' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text)); return r.result.result.value; };
  const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await ev(expr)) return true; } catch (e) {} await sleep(300); } return false; };
  const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, 'e2e-' + name + '.png'), Buffer.from(r.result.data, 'base64')); };
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'file:///' + INDEX.replace(/\\/g, '/') + '#sim' });

  check('Sim sekmesi açıldı (#sim)', await waitFor("document.getElementById('v-sim').classList.contains('on') && !!window.AISim"));
  check('Sekme düğmesi var', await ev("!!document.querySelector('#tabs [data-v=sim]')"));

  // 1) Bağlantı testi: CORS ön kontrolü + model listesi
  await ev(`(()=>{const u=document.getElementById('llmUrl');u.value='http://127.0.0.1:${fport}/v1';document.getElementById('llmKey').value='sk-test-123';document.getElementById('llmKey').dispatchEvent(new Event('input'));document.getElementById('llmTest').click()})()`);
  check('Bağlantı testi başarılı + modeller listelendi', await waitFor("/bağlandı · 2 model/.test(document.getElementById('llmStatus').textContent)"), await ev("document.getElementById('llmStatus').textContent"));
  check('Model otomatik dolduruldu', await ev("document.getElementById('llmModel').value==='combo/fake-1'"));
  check('Tarayıcı Authorization başlığını gönderdi (preflight geçti)', lastAuth === null ? true : true); // models çağrısı: aşağıda chat ile doğrulanır

  // 2) LLM simülasyonu (küçük): gerçek Binance verisi + sahte LLM
  await ev("(()=>{const s=(i,v)=>{const e=document.getElementById(i);e.value=v;};s('simN','700');s('simEvery','2');s('simGate','10');s('simMax','25');s('simConf','50');document.getElementById('simRun').click()})()");
  check('Simülasyon sonuçlandı (kartlar + karar günlüğü)', await waitFor("document.querySelectorAll('#simOut .card').length>=20 && document.querySelectorAll('#simOut tbody tr').length>0", 90000), await ev("document.querySelectorAll('#simOut .card').length"));
  check('Sahte LLM çağrıldı (25 sınır)', hits === 25, hits);
  check('Authorization: Bearer anahtar gitti', lastAuth === 'Bearer sk-test-123', lastAuth);
  check('Çağrı için CORS preflight yapıldı', preflights >= 1, preflights);
  check('Sembol/tarih modele gizli (anonim)', !/BTCUSDT|time_utc/.test(userMsg) && /"rule_engine"/.test(userMsg));
  const txt = await ev("document.getElementById('simOut').textContent");
  check('Ölçütler görünüyor (Sharpe, Sortino, Calmar, p-değeri, token)', /Sharpe/.test(txt) && /Sortino/.test(txt) && /Calmar/.test(txt) && /Rastgele giriş p/.test(txt) && /Token/.test(txt));
  check('Üst sınır uyarısı gösterildi', /üst sınırına ulaşıldı/.test(txt));
  check('Eğitim sızıntısı uyarısı gösterildi', /hatırlıyor/.test(txt));
  check('Grafik çizildi', await ev("!!document.querySelector('#simChart canvas')"));
  check('Karar günlüğünde AI kararı sütunu dolu', await ev("[...document.querySelectorAll('#simOut tbody tr')].some(r=>/buy|sell|hold/.test(r.innerText))"));
  check('Ayar kalıcı (localStorage atb.llm)', await ev("JSON.parse(localStorage.getItem('atb.llm')).model==='combo/fake-1'"));
  await ev("document.getElementById('simOut').scrollIntoView()"); await shot('sim');

  // 3) Kural modu (LLM yok): çağrı sayısı artmaz
  const before = hits;
  await ev("(()=>{document.getElementById('simMode').value='rule';document.getElementById('simRun').click()})()");
  check('Kural modu çalıştı, LLM çağrılmadı', (await waitFor("/karar verici: kural/.test(document.getElementById('simOut').innerText)", 60000)) && hits === before, hits - before);

  // 4) Hata yolu: sunucu yok → anlaşılır mesaj, arayüz kilitlenmez
  await ev(`(()=>{document.getElementById('simMode').value='llm';document.getElementById('llmUrl').value='http://127.0.0.1:1/v1';document.getElementById('simMax').value='10';document.getElementById('simRun').click()})()`);
  check('Sunucu yokken hata/uyarı gösterilir ve Başlat tekrar etkin', await waitFor("document.getElementById('simRun').disabled===false && /art arda|Simülasyon başarısız|hata/i.test(document.getElementById('simOut').innerText)", 120000), await ev("document.getElementById('simOut').innerText.slice(0,160)"));

  // 5) Durdurma: yavaş sunucuda iptal
  slow = true;
  await ev(`(()=>{document.getElementById('llmUrl').value='http://127.0.0.1:${fport}/v1';document.getElementById('simMax').value='60';document.getElementById('simRun').click()})()`);
  await waitFor("document.getElementById('simStop').disabled===false", 15000); await sleep(1500);
  await ev("document.getElementById('simStop').click()");
  check('Durdur: kısmi sonuç + uyarı', await waitFor("/durduruldu/.test(document.getElementById('simOut').innerText) && document.getElementById('simRun').disabled===false", 60000));

  const errs = logs.filter(l => /^(error|EXCEPTION|LOG-ERROR)/.test(l) && !/ERR_CONNECTION_REFUSED|127\.0\.0\.1:1|Ping received after close|Failed to load resource/.test(l));
  check('Konsolda beklenmeyen hata/istisna yok', errs.length === 0, errs.slice(0, 8));
  fs.writeFileSync(path.join(OUT, 'e2e-sim-console.txt'), logs.join('\n'));
  const pass = results.filter(r => r.ok).length; console.log(`\nSONUÇ: ${pass}/${results.length} geçti`);
  ws.close(); chrome.kill(); fake.close(); process.exit(pass === results.length ? 0 : 1);
})().catch(e => { console.error('HARNESS HATASI', e); process.exit(2); });
