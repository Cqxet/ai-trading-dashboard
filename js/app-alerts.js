/* =====================================================================
 * app-alerts.js — Fiyat / RSI / sinyal değişimi alarmları.
 * Kalıcı (localStorage), tarayıcı bildirimi + WebAudio sesli uyarı,
 * alarm geçmişi. Değerlendirme mantığı Util.evalAlert'te (test edilir).
 * ===================================================================== */
(function (root) {
  'use strict';
  var App = root.App, U = root.Util, Data = root.Data, Signals = root.Signals;
  var $ = App.$, esc = U.esc, fmt = U.fmt;
  var alerts = App.store('alerts') || [], hist = App.store('alertHist') || [];
  var TYPE_TR = { price_above: 'Fiyat ≥', price_below: 'Fiyat ≤', rsi_above: 'RSI ≥', rsi_below: 'RSI ≤', signal_change: 'Sinyal değişimi' };

  function save() { App.store('alerts', alerts); App.store('alertHist', hist.slice(0, 300)); }

  function fire(a, msg) {
    hist.unshift({ t: Date.now(), msg: msg, sym: a.sym });
    App.toast('🔔 ' + msg, 'warn', 10000); App.beep(); App.notify('AI Trading Board alarmı', msg);
    save(); render();
  }

  function onTick(syms) {
    var dirty = false;
    alerts.forEach(function (a) {
      if (!a.active || (a.type !== 'price_above' && a.type !== 'price_below') || syms.indexOf(a.sym) < 0) return;
      var r = U.evalAlert(a, { price: App.price(a.sym) });
      if (r.fire) { a.active = false; dirty = true; fire(a, r.msg); }
    });
    if (dirty) save();
  }

  var checking = false;
  async function checkIndicators() {
    if (checking) return; checking = true;
    var todo = alerts.filter(function (a) { return a.active && a.type !== 'price_above' && a.type !== 'price_below'; });
    for (var i = 0; i < todo.length; i++) {
      var a = todo[i];
      try {
        var g;
        var cached = App.sig[a.sym];
        if (cached && cached.tf === a.tf && Date.now() - cached.t < 90000) g = cached.g;
        else g = Signals.analyze((await Data.klines(a.sym, a.tf, 300, 50000)).slice(0, -1));
        if (!g) continue;
        var r = U.evalAlert(a, { rsi: g.snap.rsi, label: g.label });
        if (r.newLabel) a.lastLabel = r.newLabel;
        if (r.fire) { if (a.type !== 'signal_change') a.active = false; fire(a, r.msg); }
      } catch (e) { /* bir sonraki turda tekrar */ }
    }
    save(); checking = false;
  }

  function render() {
    var act = alerts.filter(function (a) { return a.active; }).length;
    $('alertCount').textContent = act ? '(' + act + ')' : '';
    $('alList').innerHTML = '<table class="t"><thead><tr><th>Sembol</th><th>Koşul</th><th>Değer</th><th>TF</th><th>Durum</th><th></th></tr></thead><tbody>' +
      (alerts.map(function (a) {
        return '<tr><td><b>' + App.pretty(a.sym) + '</b></td><td>' + TYPE_TR[a.type] + '</td><td>' + (a.type === 'signal_change' ? (a.lastLabel || '…') : fmt(a.value)) + '</td><td>' + (a.type.indexOf('price') === 0 ? 'canlı' : a.tf) +
          '</td><td>' + (a.active ? '<span class="up">aktif</span>' : '<span class="mut">tetiklendi</span>') + '</td><td><button class="btn sm" data-tog="' + a.id + '">' + (a.active ? 'Durdur' : 'Etkinleştir') + '</button> <button class="btn sm" data-del="' + a.id + '">Sil</button></td></tr>';
      }).join('') || '<tr><td colspan="6" class="mut">Alarm yok</td></tr>') + '</tbody></table>';
    $('alHist').innerHTML = '<table class="t">' + (hist.slice(0, 100).map(function (h) { return '<tr><td class="mut">' + new Date(h.t).toLocaleString('tr-TR') + '</td><td style="text-align:left;white-space:normal">' + esc(h.msg) + '</td></tr>'; }).join('') || '<tr><td class="mut">Henüz tetiklenen alarm yok</td></tr>') + '</table>';
  }

  function syncForm() {
    var t = $('alType').value, isPrice = t.indexOf('price') === 0;
    $('alTf').disabled = isPrice; $('alVal').disabled = t === 'signal_change';
    if (isPrice && !$('alVal').value) $('alVal').value = App.price($('alSym').value) || '';
    if (t.indexOf('rsi') === 0) $('alVal').value = t === 'rsi_above' ? 70 : 30;
  }

  App.alerts = {
    init: function () {
      App.fillSymbolSelect($('alSym'), App.S.sym);
      $('alType').onchange = function () { $('alVal').value = ''; syncForm(); };
      $('alSym').onchange = function () { if ($('alType').value.indexOf('price') === 0) { $('alVal').value = ''; syncForm(); } };
      $('alSound').checked = App.S.sound !== false;
      $('alSound').onchange = function () { App.S.sound = this.checked; App.save(); };
      $('alAdd').onclick = function () {
        var a = { id: Date.now(), sym: $('alSym').value, type: $('alType').value, value: +$('alVal').value, tf: $('alTf').value, active: true, lastLabel: null, created: Date.now() };
        if (a.type !== 'signal_change' && !(a.value > 0)) { App.toast('Geçerli bir değer girin', 'bad'); return; }
        if (a.type === 'price_above' && App.price(a.sym) >= a.value) App.toast('Not: fiyat zaten bu seviyenin üstünde, alarm hemen tetiklenecek', 'warn');
        if (a.type === 'price_below' && App.price(a.sym) <= a.value) App.toast('Not: fiyat zaten bu seviyenin altında, alarm hemen tetiklenecek', 'warn');
        alerts.push(a); save(); render(); App.toast('Alarm eklendi', 'ok');
        if (a.type !== 'price_above' && a.type !== 'price_below') checkIndicators();
      };
      $('alPerm').onclick = async function () {
        if (!root.Notification) return App.toast('Bu tarayıcı bildirimleri desteklemiyor', 'bad');
        try { var p = await Notification.requestPermission(); App.toast(p === 'granted' ? 'Bildirim izni verildi' : 'Bildirim izni verilmedi (' + p + '). Sayfa içi uyarı + ses kullanılacak. Not: bazı tarayıcılar file:// sayfalarına bildirim izni vermez.', p === 'granted' ? 'ok' : 'warn', 9000); }
        catch (e) { App.toast('Bildirim izni istenemedi: ' + e.message, 'bad'); }
      };
      $('alTest').onclick = function () { App.beep(); App.notify('AI Trading Board', 'Test bildirimi'); App.toast('🔔 Test uyarısı', 'warn'); };
      $('alClear').onclick = function () { hist = []; save(); render(); };
      $('v-alerts').addEventListener('click', function (e) {
        var d = e.target.dataset.del, t = e.target.dataset.tog;
        if (d) { alerts = alerts.filter(function (a) { return a.id !== +d; }); save(); render(); }
        if (t) { var a = alerts.find(function (x) { return x.id === +t; }); if (a) { a.active = !a.active; save(); render(); } }
      });
      App.on('tick', onTick);
      App.on('view', function (v) { if (v === 'alerts') { $('alSym').value = App.S.sym; syncForm(); } });
      syncForm(); render();
      setInterval(checkIndicators, 60000); setTimeout(checkIndicators, 8000);
    }
  };
})(typeof self !== 'undefined' ? self : this);
