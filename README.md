# 📈 QuantGemini AI Trading Terminal (Nasdaq & Binance Testnet)

Google Gemini AI destekli, **Nasdaq (Alpaca Paper Trading)** ve **Binance Spot Testnet** çift borsa mimarisine sahip, Vercel üzerinde tek tıkla çalışabilen profesyonel al-sat terminali.

---

## 🚀 Özellikler

1. **Çift Borsa Sekmesi (Dual-Exchange Tabs):**
   - 🏛️ **Nasdaq (Alpaca Paper Trading):** $100,000 sanal bakiye ile gerçekçi ABD hisse senedi işlemleri (AAPL, NVDA, TSLA, MSFT, QQQ, AMZN).
   - 🪙 **Binance Spot Testnet:** Sanal kripto bakiyesi ile gerçek zamanlı BTC/USDT, ETH/USDT, SOL/USDT spot emirleri.

2. **Gemini AI Karar Motoru:**
   - Seçilen hisse/kriptonun fiyat hareketlerini, 24 saatlik trendini ve oynaklığını analiz eder.
   - Yapılandırılmış JSON çıktısı ile net sinyal üretir: **BUY (Alım)**, **SELL (Satış)** veya **HOLD (Bekle)**.
   - Türkçe gerekçelendirme, hedef fiyat (Target Price), zarar kes (Stop Loss) ve dinamik pozisyon büyüklüğü önerir.
   - **Otomatik Alım (Auto-Pilot):** Yüksek güvenli sinyallerde otomatik olarak testnet emri iletme desteği.

3. **Vercel Uyumlu (Serverless Architecture):**
   - Vercel'in zaman aşımı kısıtlamalarına tam uyumlu Next.js App Router API Routes.
   - `vercel.json` ile cron job zamanlayabilme imkanı.

4. **Sıfır Yapılandırmayla Anında Çalışma:**
   - Henüz API anahtarı eklememiş olsanız bile canlı testnet piyasa verileri ve sanal sandbox motoru sayesinde hemen test edilebilir.
   - Anahtarları hem arayüzdeki **API Ayarları** modalından (LocalStorage) hem de Vercel ortam değişkenlerinden tanımlayabilirsiniz.

---

## 🛠️ Yerel Kurulum & Çalıştırma

```bash
# Proje dizinine geçin
cd C:/Users/safak/OneDrive/Belgeler/ai-trading-dashboard

# Geliştirici sunucusunu başlatın
npm run dev
```

Tarayıcınızda `http://localhost:3000` adresini açın.

---

## 🔑 Gerekli API Anahtarları (Ücretsiz Alım)

### 1. Google Gemini API Key
- [Google AI Studio](https://aistudio.google.com/) sayfasına gidin.
- Google hesabınızla giriş yapıp **Get API Key** butonuna tıklayın.

### 2. Alpaca Paper Trading ($100k Sanal Nasdaq)
- [app.alpaca.markets](https://app.alpaca.markets/) adresinden ücretsiz hesap açın.
- Sol menüden **Paper Trading** moduna geçin.
- Ana ekranda **API Keys** -> **Generate New Key** adımlarını izleyin (`APCA_API_KEY_ID` ve `APCA_API_SECRET_KEY`).

### 3. Binance Spot Testnet (Sanal Kripto)
- [testnet.binance.vision](https://testnet.binance.vision/) sayfasına gidin.
- GitHub hesabınızla tek tıkla giriş yapın.
- Ekranda size verilen **API Key** ve **Secret Key**'i alın.

---

## ☁️ Vercel'e Dağıtım (Deploy)

1. Projeyi GitHub'a push edin:
   ```bash
   git add .
   git commit -m "feat: complete dual-exchange ai trading dashboard"
   git branch -M main
   # Kendi GitHub reponuzu bağlayın:
   # git remote add origin https://github.com/KULLANICI_ADINIZ/ai-trading-dashboard.git
   # git push -u origin main
   ```
2. [vercel.com](https://vercel.com) paneline gidip **New Project** diyerek GitHub reponuzu seçin.
3. **Environment Variables** bölümüne şunları ekleyin:
   - `GEMINI_API_KEY`
   - `ALPACA_API_KEY`
   - `ALPACA_API_SECRET`
   - `BINANCE_API_KEY`
   - `BINANCE_API_SECRET`
4. **Deploy** butonuna basın. Projeniz Vercel üzerinde canlıya geçecektir!
