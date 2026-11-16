/* =====================================================================
 * app-ai.js — "AI Analist" paneli + Ayarlar penceresi.
 *  - Anahtar YOKSA: kural tabanlı Türkçe yorum (Signals.ruleCommentary).
 *  - Anahtar VARSA: güncel gösterge özeti Anthropic Messages API'ye
 *    (claude-sonnet-5-5) doğrudan tarayıcıdan gönderilir.
 *    Anahtar yalnızca localStorage'da durur ve yalnızca api.anthropic.com'a
 *    x-api-key başlığında gider. Otomatik çağrı YOK: sadece düğmeyle.
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Signals = root.Signals;
  var $ = App.$, esc = U.esc;
  var MODEL = 'claude-sonnet-5-5';
  var API = 'https://api.anthropic.com/v1/messages';
  var busy = false, aiShownFor = null;

  function key() { return App.store('anthropicKey') || ''; }

  var SYSTEM = 'Sen deneyimli bir kripto para teknik analistisin. Kullanıcıya Türkçe, net ve kısa bir piyasa yorumu yaz. ' +
    'Yalnızca sana verilen göstergelere ve verilere dayan; veri uydurma, verilmeyen haber/olaylardan söz etme. ' +
    'Kesinlik bildiren dil yerine olasılık dili kullan. Yatırım tavsiyesi verme, "al/sat" emri verme; senaryolar ve izlenecek seviyeler sun. ' +
    'Biçim: "## Özet" (2-3 cümle), "## Teknik görünüm" (madde işaretli, en fazla 6 madde), "## Senaryolar" (yükseliş ve düşüş senaryosu, tetik seviyeleriyle), ' +
    '"## Riskler" (en fazla 3 madde). Toplam 250 kelimeyi geçme. Sonuna tek satır "Yatırım tavsiyesi değildir." ekle.';

  function payload() {
    var g = App.dashboard.analysis(), t = App.tick[App.S.sym] || {}, m = App.mtf && App.mtf.sym === App.S.sym ? App.mtf : null;
    var r = function (x, d) { return x == null || !isFinite(x) ? null : +(+x).toFixed(d == null ? 4 : d); };
    return {
      sembol: App.pretty(App.S.sym), zaman_dilimi: App.S.tf, zaman: new Date().toISOString(),
      fiyat: r(t.price, 8), degisim_24s_yuzde: r(t.chg, 2), hacim_24s_usdt: r(t.qvol, 0), yuksek_24s: r(t.high, 8), dusuk_24s: r(t.low, 8),
      kural_motoru: g ? {
        skor: g.score, etiket: g.label, guven: g.confidence, rejim: g.regime.name, rejim_aciklama: g.regime.text,
        gostergeler: { rsi14: r(g.snap.rsi, 1), macd: r(g.snap.macd, 6), macd_sinyal: r(g.snap.macdSig, 6), macd_hist: r(g.snap.macdHist, 6), ema20: r(g.snap.ema20, 8), ema50: r(g.snap.ema50, 8), ema200: r(g.snap.ema200, 8),
          adx14: r(g.snap.adx, 1), atr14: r(g.snap.atr, 8), atr_yuzde: r(g.snap.atrPct, 2), stoch_k: r(g.snap.stochK, 1), stoch_d: r(g.snap.stochD, 1), bollinger_pctB: r(g.snap.pctB, 2), bollinger_genislik: r(g.snap.bbWidth, 4),
          supertrend_yon: g.snap.stDir === 1 ? 'yukari' : 'asagi', hacim_orani: r(g.snap.volRatio, 2) },
        bilesenler: g.components.map(function (c) { return { ad: c.name, katki: r(c.v, 2), agirlik: r(c.w, 2), aciklama: c.text }; }),
        formasyonlar: g.patterns.map(function (p) { return p.name; }),
        destekler: g.supports.map(function (s) { return r(s.price, 8); }), direncler: g.resistances.map(function (s) { return r(s.price, 8); }),
        ornek_senaryo: g.side ? { yon: g.side, giris: r(g.price, 8), stop: r(g.stop, 8), hedef: r(g.target, 8), risk_odul: r(g.rr, 2) } : null
      } : null,
      coklu_zaman_dilimi: m ? Object.keys(m.by).reduce(function (o, tf) { var x = m.by[tf]; o[tf] = x ? { skor: x.score, etiket: x.label, rsi: r(x.snap.rsi, 1), rejim: x.regime.name } : null; return o; }, { birlesik: m.combined }) : null,
      fear_greed: App.fng || null, btc_dominansi: App.globalMkt ? r(App.globalMkt.btcDom, 2) : null
    };
  }

  async function post(body, withFallback) {
    var headers = { 'content-type': 'application/json', 'x-api-key': key(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    if (withFallback) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; body = Object.assign({ fallbacks: 'default' }, body); }
    var res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    var j = null; try { j = await res.json(); } catch (e) {}
    return { res: res, j: j };
  }

  async function runClaude() {
    if (busy || !key()) return; busy = true;
    var btn = $('anRun'); btn.disabled = true; btn.textContent = 'Analiz ediliyor…';
    $('anOut').innerHTML = '<div class="loading">Claude (' + MODEL + ') güncel göstergeleri yorumluyor…</div>';
    var body = { model: MODEL, max_tokens: 8000, output_config: { effort: 'low' }, system: SYSTEM,
      messages: [{ role: 'user', content: 'Aşağıdaki canlı piyasa verisini yorumla (JSON):\n\n' + JSON.stringify(payload(), null, 1) }] };
    try {
      var r = await post(body, true);
      // Sunucu tarafı yedek model (fallbacks) beta'sı reddedilirse sade istekle tekrar dene
      if (r.res.status === 400 && r.j && r.j.error && /fallback|beta/i.test(r.j.error.message || '')) r = await post(body, false);
      if (!r.res.ok) {
        var msg = r.j && r.j.error ? r.j.error.message : 'HTTP ' + r.res.status;
        var hint = r.res.status === 401 ? ' — API anahtarı geçersiz.' : r.res.status === 429 ? ' — hız limiti, biraz sonra tekrar deneyin.' : r.res.status === 529 ? ' — servis yoğun.' : '';
        throw new Error(msg + hint);
      }
      var m = r.j;
      if (m.stop_reason === 'refusal') throw new Error('Model bu isteği yanıtlamadı (refusal).');
      var text = (m.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('\n').trim();
      if (!text) throw new Error('Boş yanıt (stop_reason: ' + m.stop_reason + ')');
      aiShownFor = App.S.sym + App.S.tf;
      $('anOut').innerHTML = md(text) + '<div class="note">Model: ' + esc(m.model || MODEL) + ' · ' + new Date().toLocaleTimeString('tr-TR') + ' · girdi ' + (m.usage ? m.usage.input_tokens : '?') + ' / çıktı ' + (m.usage ? m.usage.output_tokens : '?') + ' token' + (m.stop_reason === 'max_tokens' ? ' · yanıt kesildi' : '') + '. LLM çıktısı hatalı olabilir; yatırım tavsiyesi değildir.</div>';
    } catch (e) {
      $('anOut').innerHTML = '<div class="err">Claude analizi başarısız: ' + esc(e.message || e) + '</div>' + '<div class="mut" style="padding:0 14px">Kural tabanlı yorum:</div><div class="ai-out">' + esc(rule()) + '</div>';
    }
    btn.disabled = false; btn.textContent = 'Claude ile analiz et'; busy = false;
  }

  /** Çok küçük, güvenli markdown: önce kaçış, sonra başlık / kalın / madde. */
  function md(t) {
    return esc(t).split('\n').map(function (l) {
      if (/^#{1,4}\s/.test(l)) return '<h4>' + l.replace(/^#+\s/, '') + '</h4>';
      return l.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^[-*]\s/, '• ');
    }).join('\n').replace(/\n(<h4>)/g, '$1').replace(/(<\/h4>)\n/g, '$1');
  }

  function rule() {
    var m = App.mtf && App.mtf.sym === App.S.sym ? App.mtf.combined : null;
    return Signals.ruleCommentary(App.pretty(App.S.sym), App.S.tf, App.dashboard.analysis(), m, { fng: App.fng });
  }
  function renderRule() {
    if (busy) return;
    if (aiShownFor === App.S.sym + App.S.tf) return; // Claude yorumu ekrandaysa üzerine yazma
    $('anOut').textContent = rule();
  }

  function syncKeyUI() {
    var has = !!key();
    $('anRun').classList.toggle('hidden', !has);
    $('anMode').textContent = has ? 'Kural tabanlı yorum · Claude hazır' : 'Kural tabanlı yorum (Claude için Ayarlar ⚙)';
  }

  App.ai = {
    init: function () {
      $('anRun').onclick = runClaude;
      App.on('analysis', function () { renderRule(); });
      App.on('mtf', function () { renderRule(); });
      App.on('symbol', function () { aiShownFor = null; });
      // Ayarlar
      $('btnSettings').onclick = function () { $('setKey').value = key() ? '••••••••' + key().slice(-4) : ''; $('settings').classList.add('on'); };
      $('setClose').onclick = function () { $('settings').classList.remove('on'); };
      $('settings').addEventListener('click', function (e) { if (e.target.id === 'settings') $('settings').classList.remove('on'); });
      $('setSave').onclick = function () {
        var v = $('setKey').value.trim();
        if (v.indexOf('••') === 0) { $('settings').classList.remove('on'); return; }
        if (v && !/^sk-ant-/.test(v)) { App.toast('Anahtar "sk-ant-" ile başlamalı', 'bad'); return; }
        App.store('anthropicKey', v || null); syncKeyUI(); $('settings').classList.remove('on');
        App.toast(v ? 'API anahtarı bu tarayıcıya kaydedildi' : 'API anahtarı silindi', 'ok');
      };
      $('setDel').onclick = function () { App.store('anthropicKey', null); $('setKey').value = ''; syncKeyUI(); App.toast('API anahtarı silindi', 'ok'); };
      $('setWipe').onclick = function () {
        if (!confirm('Tüm yerel veriler (ayarlar, düzen, alarmlar, sanal portföy, çizimler, API anahtarı) silinsin mi?')) return;
        try { Object.keys(localStorage).filter(function (k) { return k.indexOf('atb.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
        location.reload();
      };
      syncKeyUI();
    }
  };
})(typeof self !== 'undefined' ? self : this);
