# AI Trading Board

Türkçe arayüzlü, gerçek canlı kripto verisi kullanan teknik analiz panosu. Kurulum gerektirmez; tarayıcıda çift tıklayarak açılır.

> ⚠ **Yatırım tavsiyesi değildir.** Sinyaller kural tabanlı teknik analizdir; backtest sonuçları geleceği garanti etmez. Pano **hiçbir zaman gerçek emir göndermez**; "Sanal portföy" tamamen tarayıcınızda tutulan bir simülasyondur.

## Nasıl açılır

1. `ai-trading-board` klasöründeki **`index.html`** dosyasına çift tıklayın (Chrome, Edge, Firefox veya Safari'nin güncel sürümü).
2. İnternet bağlantısı gerekir (canlı veri ve grafik kütüphanesi için).

Hiçbir paket kurulumu, sunucu veya API anahtarı gerekmez. Dosyalar klasik `<script>` etiketleriyle yüklenir (ES module kullanılmadı, çünkü `file://` altında engellenir).

Derin bağlantılar: `index.html#market`, `#bt`, `#paper`, `#alerts`, `#grid`; `#bt:run` backtest'i varsayılanlarla hemen çalıştırır.

## Özellikler

| Bölüm | İçerik |
|---|---|
| **Pano** | Sürükle-bırak ile yer değiştiren, genişliği (⇔) ve yüksekliği (alt kenar) ayarlanabilen, gizlenebilen/daraltılabilen paneller; düzen localStorage'da saklanır. Koyu/açık tema (◐). |
| **İzleme listesi** | 40 USDT çifti, arama, ★ favoriler (üstte), fiyat / 24s % / hacim / AI skoruna göre sıralama, son 30 mumun mini grafiği, canlı fiyat yanıp sönmesi. |
| **Grafik** | Mum / Heikin-Ashi / çizgi; 1m–1d; EMA20/50/200, SMA20, Bollinger, VWAP (günlük), Supertrend, hacim, destek/direnç + AI stop/hedef çizgileri, formasyon işaretleri; alt paneller RSI, MACD, Stokastik, ATR, OBV (zaman ekseni senkron). Çizim: yatay çizgi ve trend çizgisi (sembol bazında kalıcı). |
| **Çoklu grafik** | 2×2 görünüm, her hücrede sembol + zaman dilimi seçimi, canlı. |
| **AI sinyal motoru v2** | Ağırlıklı 8 bileşen (EMA trendi, Supertrend, MACD, RSI, Stokastik, Bollinger %B, hacim/OBV, mum formasyonları), rejime göre ağırlık uyarlama (trend / yatay / yüksek volatilite, ADX + ATR yüzdeliği), güven skoru (bileşen uyumu + skor büyüklüğü), fraktal pivotlardan kümelenmiş destek/direnç, formasyon tespiti (yutan boğa/ayı, çekiç, ters çekiç, asılı adam, kayan yıldız, doji, sabah/akşam yıldızı, üç beyaz asker/üç kara karga), her bileşen için Türkçe gerekçe, ATR tabanlı stop/hedef ve risk/ödül. Sinyal son **kapanmış** mumdan hesaplanır. |
| **Çoklu zaman dilimi** | 15m / 1h / 4h / 1d analizleri ve ağırlıklı birleşik skor (%15/%25/%30/%30) + uyum sayısı. |
| **AI Analist** | Varsayılan: kural tabanlı Türkçe yorum. Ayarlar'dan (⚙) Anthropic API anahtarı girilirse "Claude ile analiz et" düğmesi görünür ve güncel gösterge özeti `claude-sonnet-5-5` modeline gönderilip Türkçe yorum alınır. |
| **Backtest** | 1000–5000 mum (Binance sayfalama), eşikler / stop-hedef çarpanları / komisyon / kayma / short / ters sinyalde çıkış ayarları; equity eğrisi + al-tut karşılaştırması, toplam getiri, kazanma oranı, kâr faktörü, maks. düşüş, Sharpe, işlem listesi. |
| **Sanal portföy** | 10.000 USDT ile başlar; piyasa/limit emir, long/short, stop-loss/kâr al, canlı PnL, bekleyen emirler, işlem geçmişi, portföy değeri grafiği, sıfırlama. localStorage'da kalıcı. %0,1 komisyon. |
| **Piyasa** | Isı haritası (renk = 24s %, alan ∝ √hacim), en çok yükselen/düşen, hacim patlaması taraması, RSI aşırı alım/satım tarayıcısı (seçilebilir zaman dilimi), Fear & Greed (30 günlük geçmiş), CoinGecko global (BTC/ETH dominansı, toplam piyasa değeri), 12×12 korelasyon matrisi. |
| **Alarmlar** | Fiyat üstü/altı (canlı), RSI ≥/≤ ve AI sinyal değişimi (60 sn'de bir); sayfa içi bildirim + sesli uyarı + (izin verilirse) tarayıcı bildirimi; alarm geçmişi; kalıcı. |
| **Risk hesaplayıcı** | Bakiye, risk %, giriş, stop (+ ops. hedef) → pozisyon miktarı, değeri, efektif kaldıraç, R:R. "AI seviyelerini al" ile otomatik doldurma. |
| **Sağlamlık** | REST yedeği (data-api.binance.vision → api.binance.com), istek kuyruğu (en fazla 4 eşzamanlı), yerel ağırlık sayacı ve yumuşak limit (4000/6000), 429/418'de Retry-After kadar bekleme, WebSocket üstel geri çekilmeli yeniden bağlanma + uç nokta rotasyonu + 30 sn sessizlik bekçisi, WS kapalıyken REST ile ticker yoklama, bağlantı durum göstergesi (üst sağ), yükleniyor/hata durumları, mobil tek sütun düzen. |

## Veri kaynakları (hepsi anahtarsız, CORS `*` doğrulandı)

- Binance spot: `https://data-api.binance.vision` (yedek `https://api.binance.com`), WebSocket `wss://data-stream.binance.vision` (yedek `wss://stream.binance.com:9443`)
- Fear & Greed: `https://api.alternative.me/fng/`
- Global piyasa: `https://api.coingecko.com/api/v3/global` (ücretsiz katman dakikalık limit uygulayabilir; panel 5 dk'da bir yeniler)
- Grafik kütüphanesi: `lightweight-charts@4.1.3` (jsDelivr, sabit sürüm)

## AI Analist ve API anahtarı

- Anahtar yalnızca bu tarayıcının `localStorage`'ında (`atb.anthropicKey`) tutulur ve **yalnızca** "Claude ile analiz et"e bastığınızda doğrudan `https://api.anthropic.com/v1/messages` adresine `x-api-key` başlığıyla gönderilir. Başka hiçbir yere gönderilmez; otomatik/arka plan çağrısı yoktur.
- Tarayıcıdan doğrudan çağrı için `anthropic-dangerous-direct-browser-access: true` başlığı kullanılır. Bu, anahtarın sayfa içinde erişilebilir olması demektir: **paylaşılan bilgisayarda kullanmayın**, mümkünse harcama limiti olan ayrı bir anahtar kullanın.
- İstek: model `claude-sonnet-5-5`, `output_config.effort: "low"`, sunucu tarafı yedek model (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`; reddedilirse yedeksiz tekrar denenir). `stop_reason: "refusal"` ve hata kodları (401/429/529) anlaşılır mesajla gösterilir.
- Her analiz API hesabınızdan ücretlendirilir. LLM çıktısı hatalı olabilir.

## AI Simülasyon (9router / OpenAI uyumlu LLM)

`AI Simülasyon` sekmesi, bir LLM'i **gerçek geçmiş Binance mumları üzerinde adım adım karar verici** olarak çalıştırır ve sonucu gerçek performans ölçütleriyle raporlar. Gerçek emir göndermez.

**Kurulum (9router):** `npm install -g 9router` → `9router` → panel `http://localhost:20128/dashboard` → sağlayıcı/combo ekleyip API anahtarını kopyalayın. Sekmede Base URL `http://localhost:20128/v1` (varsayılan), anahtar ve model/combo adını girip **Bağlantıyı test et** deyin. OpenAI uyumlu herhangi bir uç nokta (`/v1/chat/completions`, `/v1/models`) çalışır.

**Nasıl çalışır (lookahead yok):** her `decisionEvery` mumun kapanışında yalnızca o ana kadarki veriden hesaplanan gösterge anlık görüntüsü modele gönderilir (JSON karar: al / sat / bekle + güven + stop/hedef çarpanı + gerekçe). İşlem **sonraki mumun açılışında** komisyon + kayma ile gerçekleşir; stop/hedef mum içi high/low ile kontrol edilir, aynı mumda ikisi de değerse önce stop. Pozisyonsuzken yalnızca kural skoru |skor| ≥ geçit ise model çağrılır. Çağrı üst sınırına ulaşılırsa dönem orada biter (ölçütler yalnızca karar verilen pencereyi kapsar). Sembol ve tarih varsayılan olarak modelden **gizlenir**.

**Ölçütler:** getiri, yıllıklandırılmış getiri, Sharpe (+ %95 blok-bootstrap güven aralığı, P(Sharpe>0)), Sortino, Calmar, maks. düşüş ve en uzun su altı süresi, kazanma oranı, kâr faktörü, ödeme oranı, beklenti/işlem, ödenen komisyon, devir, piyasada kalma; LLM çağrı/token/gecikme. **Karşılaştırmalar:** al-tut, kural motoru (aynı mumlar ve maliyetler) ve **rastgele-giriş Monte Carlo** (aynı işlem sayısı ve tutma süreleriyle; p-değeri "AI şansla bu kadar iyi olabilir mi?" sorusunu cevaplar).

**Komut satırı (CORS sorunu olmadan):**

```bash
export LLM_API_KEY=...        # 9router anahtarı (PowerShell: $env:LLM_API_KEY='...')
node tools/run-sim.js --list-models
node tools/run-sim.js --symbol BTCUSDT --tf 1h --bars 1500 --model <model-veya-combo> --max-decisions 150
node tools/run-sim.js --dry-run          # LLM'siz kural karar vericisiyle deneme
```

**Dürüstlük notları:**
1. Birkaç düzine işlem istatistiksel olarak zayıf örnektir; arayüz uyarır.
2. LLM'ler eğitim verisinden geçmiş piyasayı hatırlıyor olabilir; anonimleştirme riski azaltır, dışlamaz. Asıl güvenilir sınama, simülasyonu modelin eğitiminden sonraki (canlıya yakın) veriyle ve ileriye doğru tekrarlamaktır.
3. Gerçek 9router/LLM yanıtlarıyla başarılı bir uçtan uca çalıştırma bu depoda henüz doğrulanmadı; testler OpenAI uyumlu **sahte** bir sunucuyla yapıldı (istemci, CORS ön kontrolü, ayrıştırma, hata/iptal yolları).

## AI Bot: kesintisiz çalışma

Bot, tarayıcı sekmesi arka plana alınsa da takılmadan sürmesi için şunları yapar:

- **Kalp atışı:** Bot döngüsü bir Web Worker zamanlayıcısıyla (1 sn) tetiklenir; ana iş parçacığındaki `setInterval`'ler arka plan sekmelerde kısılırken Worker zamanlayıcıları kısılmaz. Worker açılamazsa `setInterval`'e düşer.
- **Web Lock:** Bot açıkken bir Web Lock tutulur; Chrome kilit tutan sekmeyi arka planda dondurmaz.
- **Kendini onaran tarama:** Sinyal taraması zaman aşımı korumalıdır (en az 20 sn); asılı istek bayrağı sonsuza dek kilitlemez. Sinyaller geldikçe yazılır, tarama bitmese de kısmi sonuçlar kullanılır.
- **Kur dayanıklılığı:** USDT/TRY kuru hız sınırı kuyruğunu atlayan doğrudan istekle (iki sunucu) 15 sn'de bir yenilenir ve 10 dk'ya kadar geçerli sayılır (eskiden 2 dk'da bot sessizce duruyordu).
- **Sağlık satırı:** Bot sekmesinde kalp atışı, son tarama, kur yaşı ve fiyat akışı durumu görünür; sorun varsa kırmızı uyarı ve sebebi yazar.

Sınırlar: bilgisayar uyursa veya tarayıcı kapanırsa bot durur (yalnızca bu sayfa açıkken çalışır). "Arka planda aksamaz" iddiası 20 sn'lik küçültülmüş-pencere testiyle doğrulandı; Chrome'un 5 dk sonra devreye giren yoğun kısıtlaması ise bu testte yeniden üretilmedi, Worker'ın bundan etkilenmediği Chrome'un belgelenmiş davranışına dayanır.

## AI Bot: öğrenen hafıza ve devre kesici (dürüst sonuçlar)

**Önemli:** Sinyal motoru (RSI/MACD/EMA/Bollinger skoru) gerçek geçmiş verilerde, bot maliyetleri (komisyon %0,1 + kayma %0,05, her yönde) düşüldükten sonra **kalıcı bir üstünlük göstermedi**. 20 sembol, 5 hız modu, 1 dk ile 1 sa arası ve ~5-250 günlük gerçek Binance verisinde (`tools/botreplay.js`) eski bot, işlemlerinin tamamında ortalama negatif net getiri üretti; kovalara ayırdığımızda (rejim, güven, RSI, piyasa durumu) pozitif ortalamalı kararlı bir bölge bulunamadı. Son 100 günde "çalışıyor" görünen iki ek strateji (aşırı satım dönüşü, Donchian kırılımı) önceki 150 günde (piyasa −%17,6) çöktü: o başarı yükselen piyasanın etkisiydi (`tools/research-edge.js`).

Bu yüzden bota kâr vaat eden bir şey değil, **zararı sınırlayan** bir katman eklendi (maliyet/ayar oranlarına dokunulmadan, "Öğrenen hafıza" onay kutusuyla kapatılabilir):

- **Öğrenen hafıza:** Her kapanan işlemin maliyet sonrası net getirisi (rejim, güven, RSI, oynaklık, sembol, piyasa durumu kovalarına) yazılır; eski kanıt üssel olarak unutulur (`memDecay`). Ortalaması negatif olan bölgelere yeni giriş açılmaz, pozitif kanıtlı bölgelerde pozisyon ×1,25 olur.
- **Devre kesici:** Tüm işlemlerin birleşik beklentisi negatifse bot yeni giriş açmaz ve yalnızca küçük (×0,3) deneme işlemleri yapar; kaybeden her deneme sonraki deneme aralığını ikiye katlar (en çok 32×), kazanan sıfırlar. Piyasa lehine dönerse beklenti toparlanır ve bot yavaşça geri açılır.
- **Piyasa genişliği filtresi:** Sinyal verisi olan sembollerin %40'ından azı yükseliş eğilimindeyse giriş yok.
- **Seri zarar molası:** 4 üst üste zarardan sonra 15 dk × fazla zarar kadar mola.
- Bot sekmesindeki panel, hafızanın ne öğrendiğini, devre kesicinin durumunu ve en iyi/en kötü bölgeleri gösterir. Hafıza `localStorage`'da saklanır; "Hafızayı sıfırla" ile silinir.

**Gerçek geçmiş veride etki** (20 sembol, başlangıç sermayesi büyük tutulup 10 TL asgari emir tabanı etkisi kaldırıldı; getiri %):

| Veri | Eski bot | Akıllı katman | Piyasa (al-tut) |
|---|---|---|---|
| 1 sa, ~100 gün | −68,1 | +6,0 | +8,5 |
| 1 sa, ~250 gün | −94,6 | −8,6 | – |
| 15 dk, ~62 gün | −97,6 | −1,3 | −20,7 |
| 5 dk, ~28 gün | −76,5 | −2,7 | −28,2 |
| 3 dk, ~12 gün | −29,7 | −0,8 | −21,1 |
| 1 dk, ~5 gün | −4,2 | −0,1 | −8,8 |

Ayar seçiminde hiç kullanılmayan 10 sembolde (`tools/oos-bot.js`): eski bot −%60…−%96, akıllı katman −%1,4…−%12,8.

**Bu ne demek, ne demek değil:** Zarar çok büyük ölçüde azalıyor; ama bunun büyük kısmı bota *işlem yapmamayı* öğretmekten geliyor (işlem sayısı ~10-30 kat düşüyor). Hiçbir veri kümesinde istikrarlı kâr çıkmadı; +%6 sonuç, piyasanın yükseldiği döneme denk geliyor ve tek başına kanıt sayılmaz. Gerçek parayla kullanmayın. Replay mum içi sırayı muhafazakâr (önce düşük, sonra yüksek, sonra kapanış) varsayar, canlı tick akışından farklı olabilir; kayma/likidite küçük hacimli sembollerde daha kötü olabilir.

Araçlar: `tools/botreplay.js` (canlıyla aynı `Bot.step` mantığıyla gerçek geçmiş mumlar üzerinde tekrar oynatma), `tools/tune-bot.js`, `tools/grid-bot.js`, `tools/oos-bot.js`, `tools/analyze-trades.js`, `tools/research-edge.js`. Önbellek `tools/.cache/` altında tutulur (git'e girmez).

## Araştırma: günlük trend/momentum (çok yıllık gerçek veri)

`node tools/research-daily.js [sembol sayısı] [mum sayısı]` — klasik, **önceden sabit** kuralları (SMA200, EMA50/200 kesişimi, Donchian 55/20, 90g momentum, haftalık kesitsel momentum) günlük veride, 6,8–8,2 yıl boyunca, bot ile aynı maliyetle (yön başına %0,15) sınar. Karar günün kapanışında, işlem ertesi açılışta; al-tut karşılaştırması maliyetsizdir.

Bulgular (30 sembol / ilk 8 / BTC+ETH):

- **Trend kuralları getiriyi belirgin biçimde artırmıyor; düşüşü azaltıyor.** Maks. düşüş: al-tut %77–81 → trend kuralları %39–67. 2022'de al-tut −%64…−%74 iken trend kuralları −%8…−%25. Yıllık getiri al-tut ile aynı bölgede (BTC+ETH: %37–42 vs %37–41; 30 sembol: %35–43 vs %32).
- **Sharpe** çoğunlukla biraz yüksek (örn. 1,0–1,4 vs 0,75–1,0) ama %95 güven aralıkları al-tut ile büyük ölçüde örtüşüyor: istatistiksel olarak ayırt edilemiyor.
- **Kâr garantisi yok:** 2025 ve 2026'da (boğa sonrası) tüm trend kuralları da zarar etti (−%2…−%39). Kural, piyasanın yükselmesine bağlı; bozuk piyasada yalnızca daha az kaybettiriyor.
- Parametre komşuluğunda sonuçlar kabaca kararlı (SMA 100–250, Donchian 40–100): bıçak sırası değil. Ama "en iyi kural" örnekleme göre değişiyor (30 ve 8 sembolde Donchian, BTC+ETH'de SMA200); tek bir kuralı şampiyon ilan etmek doğru olmaz.
- Haftalık kesitsel momentum riski azaltmadı (maks. düşüş %84).
- Bu kuralların işlem sıklığı yılda sembol başına ~1–7 işlem; maliyet baskısı kısa vadeli botun aksine ihmal edilebilir düzeyde.

**Sınırlar:** Semboller bugünün büyük listesinden seçildi (hayatta kalma yanlılığı: ölen coinler yok; 2021 sonuçları DOGE gibi aykırı yükselişlerden güçlü etkileniyor). Küçük coinlerde %0,05 kayma iyimser olabilir. Vergi, çekim kısıtı ve piyasa etkisi yok. Geçmiş performans geleceği garanti etmez; yatırım tavsiyesi değildir.

## Mimari

```
ai-trading-board/
├── index.html            # Yerleşim + klasik script sırası
├── css/style.css         # Token tabanlı tema (koyu/açık), ızgara, mobil
├── js/
│   ├── indicators.js     # SAF: SMA, EMA, RMA, RSI, MACD, Stokastik, TR/ATR, Bollinger, Supertrend, ADX, OBV, VWAP, Heikin-Ashi, Pearson
│   ├── signals.js        # SAF: sinyal motoru v2 (computeIndicators, scoreAt, analyze, formasyon, D/D, rejim, MTF, kural yorumu)
│   ├── backtest.js       # SAF: backtest motoru + Binance sayfalama (fetchHistory)
│   ├── paper.js          # SAF: sanal portföy durum geçişleri (ağ yok)
│   ├── aisim.js          # SAF: LLM istemcisi (OpenAI uyumlu) + walk-forward simülasyon + ölçütler + Monte Carlo
│   ├── app-sim.js        # AI Simülasyon sekmesi arayüzü
│   ├── util.js           # SAF: biçimlendirme, squarified treemap, risk hesabı, alarm değerlendirme
│   ├── data.js           # Ağ: REST kuyruğu/yedek/rate-limit, WebSocket yöneticisi
│   ├── charts.js         # lightweight-charts sarmalayıcısı (ChartView): göstergeler, alt paneller, çizimler
│   ├── app.js            # Çekirdek: durum, localStorage, olay yolu, tema, ticker akışı, liste taraması
│   ├── app-dashboard.js  # Pano: panel düzeni, liste, ana grafik, sinyal, MTF, defter, risk, 2×2
│   ├── app-market.js     # Piyasa sekmesi
│   ├── app-backtest.js   # Backtest sekmesi
│   ├── app-paper.js      # Sanal portföy sekmesi
│   ├── app-alerts.js     # Alarmlar
│   ├── app-ai.js         # AI Analist + Ayarlar
│   └── boot.js           # Başlatma
└── tests/
    ├── indicators.test.js  # Gösterge birim testleri (bilinen değerler)
    ├── engine.test.js      # Sinyal, backtest (lookahead), paper, util testleri
    ├── live-check.js       # Canlı uç nokta + gerçek veride motor kontrolü
    ├── e2e-chrome.js       # Headless Chrome (DevTools Protocol) uçtan uca duman testi
    └── e2e-out/            # Son E2E çalıştırmasının ekran görüntüleri
```

Saf modüller UMD kalıbındadır: tarayıcıda `window.TA / Signals / Backtest / Paper / Util`, Node'da `require()` ile yüklenir; bu sayede aynı kod hem panoda hem testlerde çalışır.

**Lookahead önlemi:** tüm göstergeler nedenseldir (i. değer yalnızca 0..i verisini kullanır — testle doğrulanır). Backtest, sinyali i. mumun kapanışında hesaplar ve işlemi i+1. mumun açılışında yapar; stop/hedef sonraki mumların yüksek/düşüğüyle kontrol edilir, aynı mumda ikisi de değerse önce stop varsayılır; açılış stop'un ötesine gap yaparsa çıkış açılış fiyatındandır. Pano ve tarayıcılar da sinyali son **kapanmış** mumdan hesaplar.

## Testler (Node 18+; ek paket gerekmez)

```bash
cd ai-trading-board
node --test tests/*.test.js                                  # birim testleri (gösterge, motor, bot, aisim)
node tests/e2e-bot.js                                        # AI Bot kesintisizlik E2E (kalp atışı, arka plan, takılma onarımı)
node tests/e2e-bot.js                                        # AI Bot kesintisizlik E2E (kalp atışı, arka plan, takılma onarımı)
node tests/e2e-bot.js                                        # AI Bot kesintisizlik E2E (kalp atışı, arka plan, takılma onarımı)
node tests/e2e-sim.js                                        # AI Simülasyon sekmesi E2E (sahte OpenAI sunucusuyla)
node tests/live-check.js                                     # canlı API + gerçek veride backtest (internet)
node tests/e2e-chrome.js                                     # headless Chrome ile uçtan uca (Chrome/Edge kurulu olmalı)
```

## Sınırlamalar

- Sinyaller basit kural tabanlı teknik analizdir; "AI" adı skor motorunu ifade eder, makine öğrenmesi modeli değildir. Gerçek veride yapılan örnek backtestlerde strateji bazı dönemlerde al-tut'un altında kalmıştır.
- Backtest: tek pozisyon, sermayenin tamamı, sabit komisyon/kayma; fonlama, likidite, emir defteri derinliği ve kısmi dolum modellenmez. Mum içi sıra bilinmediği için stop/hedef çakışmasında muhafazakâr varsayım yapılır.
- Sanal portföy limit emirleri yalnızca ~1 sn'lik ticker fiyatlarıyla kontrol edilir (mum içi fitiller kaçabilir); verildiği anda tetik bölgesindeki limit emir piyasa fiyatından hemen dolar, sonradan tetiklenen limit emir limit fiyatından dolar; short pozisyonlar teminat = nominal değer ile basitleştirilmiştir; kaldıraç/tasfiye yoktur.
- Alarmlar ve canlı akış yalnızca sayfa açıkken çalışır. Bazı tarayıcılar `file://` sayfalarına bildirim izni vermez; bu durumda sayfa içi uyarı + ses kullanılır. Ses, sayfayla ilk etkileşimden sonra çalabilir (tarayıcı otomatik oynatma kuralı).
- Binance ağırlık başlıkları CORS ile açılmadığından tarayıcıda okunamaz; ağırlık yerelde tahmin edilir. Binance'in erişilemediği bölgelerde (ör. bazı ülkeler/ağlar) veri gelmeyebilir.
- CoinGecko ücretsiz API'si zaman zaman 429 döndürebilir; panel bunu gösterir ve sonra tekrar dener.
- Tüm durum `localStorage`'dadır: gizli pencerede veya tarayıcı verisi silinince kaybolur; farklı tarayıcılar arasında paylaşılmaz.
- Grafik kütüphanesi CDN'den yüklenir; çevrimdışı açılmaz.
