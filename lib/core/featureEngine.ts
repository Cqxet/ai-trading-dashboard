import {
  Candle,
  BookTicker,
  FeatureSnapshot,
  PriceFeatures,
  TrendFeatures,
  MomentumFeatures,
  VolatilityFeatures,
  VolumeFeatures,
  OrderbookFeatures,
  MarketQualityFeatures,
} from './types';

export class FeatureEngine {
  private static instance: FeatureEngine;

  // Incremental cache per symbol
  private emaCache: Map<string, { ema9: number; ema21: number; ema50: number; lastPrice: number; lastTime: number }> = new Map();
  private tickHistory: Map<string, { price: number; timestamp: number }[]> = new Map();

  public static getInstance(): FeatureEngine {
    if (!FeatureEngine.instance) {
      FeatureEngine.instance = new FeatureEngine();
    }
    return FeatureEngine.instance;
  }

  /**
   * Computes full FeatureSnapshot from candles, latest bookTicker and 24h stats.
   */
  public computeFeatures(
    symbol: string,
    candles: Candle[],
    bookTicker?: BookTicker | null,
    stats24h?: { high24h: number; low24h: number; change24hPct: number; volume24h: number }
  ): FeatureSnapshot {
    const now = Date.now();
    const lastCandle = candles.length > 0 ? candles[candles.length - 1] : null;
    const currentPrice = bookTicker?.bidPrice && bookTicker?.askPrice
      ? (bookTicker.bidPrice + bookTicker.askPrice) / 2
      : lastCandle?.close || 1.0;

    // Record tick in history
    this.recordTick(symbol, currentPrice, now);

    // 1. Price features
    const priceFeatures = this.computePriceFeatures(symbol, currentPrice, candles, stats24h);

    // 2. Trend features (EMA 9, 21, 50, slope, ADX)
    const trendFeatures = this.computeTrendFeatures(symbol, currentPrice, candles);

    // 3. Momentum features (RSI 14, MACD, ROC)
    const momentumFeatures = this.computeMomentumFeatures(currentPrice, candles);

    // 4. Volatility features (ATR 14, ATR%, Realized Vol)
    const volatilityFeatures = this.computeVolatilityFeatures(currentPrice, candles);

    // 5. Volume features (Relative volume, Volume delta, Pressure)
    const volumeFeatures = this.computeVolumeFeatures(candles, stats24h?.volume24h);

    // 6. Orderbook features (Spread, Imbalance, Microprice)
    const orderbookFeatures = this.computeOrderbookFeatures(currentPrice, bookTicker);

    // 7. Market quality features
    const marketQualityFeatures = this.computeMarketQualityFeatures(
      orderbookFeatures,
      volatilityFeatures,
      stats24h?.volume24h,
      now - (lastCandle?.timestamp || now)
    );

    return {
      symbol: symbol.toUpperCase(),
      timestamp: now,
      version: '2.0.0-quant',
      price: priceFeatures,
      trend: trendFeatures,
      momentum: momentumFeatures,
      volatility: volatilityFeatures,
      volume: volumeFeatures,
      orderbook: orderbookFeatures,
      marketQuality: marketQualityFeatures,
    };
  }

  private recordTick(symbol: string, price: number, timestamp: number): void {
    const list = this.tickHistory.get(symbol) || [];
    list.push({ price, timestamp });
    // Keep max 300 ticks (~5 minutes)
    const cutoff = timestamp - 300_000;
    const filtered = list.filter((t) => t.timestamp >= cutoff);
    this.tickHistory.set(symbol, filtered);
  }

  private computePriceFeatures(
    symbol: string,
    currentPrice: number,
    candles: Candle[],
    stats24h?: { high24h: number; low24h: number; change24hPct: number }
  ): PriceFeatures {
    const ticks = this.tickHistory.get(symbol) || [];
    const now = Date.now();

    const getPriceNDurationAgo = (ms: number): number => {
      const targetTime = now - ms;
      for (let i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i].timestamp <= targetTime) {
          return ticks[i].price;
        }
      }
      return ticks[0]?.price || currentPrice;
    };

    const p1s = getPriceNDurationAgo(1_000);
    const p5s = getPriceNDurationAgo(5_000);
    const p1m = getPriceNDurationAgo(60_000);
    const p5m = getPriceNDurationAgo(300_000);

    const return1s = p1s > 0 ? (currentPrice - p1s) / p1s : 0;
    const return5s = p5s > 0 ? (currentPrice - p5s) / p5s : 0;
    const return1m = p1m > 0 ? (currentPrice - p1m) / p1m : 0;
    const return5m = p5m > 0 ? (currentPrice - p5m) / p5m : 0;

    let high24h = stats24h?.high24h || currentPrice;
    let low24h = stats24h?.low24h || currentPrice;
    let change24hPct = stats24h?.change24hPct || 0;

    if (candles.length > 0 && (!stats24h || stats24h.high24h === 0)) {
      high24h = Math.max(...candles.map((c) => c.high));
      low24h = Math.min(...candles.map((c) => c.low));
      const firstClose = candles[0].open;
      change24hPct = firstClose > 0 ? ((currentPrice - firstClose) / firstClose) * 100 : 0;
    }

    return {
      last: currentPrice,
      return1s: parseFloat((return1s * 100).toFixed(4)),
      return5s: parseFloat((return5s * 100).toFixed(4)),
      return1m: parseFloat((return1m * 100).toFixed(4)),
      return5m: parseFloat((return5m * 100).toFixed(4)),
      high24h,
      low24h,
      change24hPct: parseFloat(change24hPct.toFixed(2)),
    };
  }

  private computeTrendFeatures(symbol: string, currentPrice: number, candles: Candle[]): TrendFeatures {
    const closes = candles.map((c) => c.close);
    if (closes.length === 0) closes.push(currentPrice);

    // Incremental or full EMA calculation
    const ema9 = this.calculateEMA(closes, 9);
    const ema21 = this.calculateEMA(closes, 21);
    const ema50 = this.calculateEMA(closes, 50);

    const emaSpread = ema21 > 0 ? ((ema9 - ema21) / ema21) * 100 : 0;

    // Slope of EMA9 over the last 3 candles
    let slope = 0;
    if (closes.length >= 4) {
      const prevEMA9 = this.calculateEMA(closes.slice(0, -1), 9);
      slope = prevEMA9 > 0 ? ((ema9 - prevEMA9) / prevEMA9) * 100 : 0;
    }

    // Simplified Directional Index (ADX approximation)
    const adx = this.calculateADX(candles, 14);

    let trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
    if (ema9 > ema21 && ema21 > ema50 && slope > 0.02) {
      trendDirection = 'BULLISH';
    } else if (ema9 < ema21 && ema21 < ema50 && slope < -0.02) {
      trendDirection = 'BEARISH';
    }

    // Cache latest EMA
    this.emaCache.set(symbol, {
      ema9,
      ema21,
      ema50,
      lastPrice: currentPrice,
      lastTime: Date.now(),
    });

    return {
      ema9: parseFloat(ema9.toFixed(2)),
      ema21: parseFloat(ema21.toFixed(2)),
      ema50: parseFloat(ema50.toFixed(2)),
      emaSpread: parseFloat(emaSpread.toFixed(3)),
      slope: parseFloat(slope.toFixed(4)),
      adx: parseFloat(adx.toFixed(1)),
      trendDirection,
    };
  }

  private computeMomentumFeatures(currentPrice: number, candles: Candle[]): MomentumFeatures {
    const closes = candles.map((c) => c.close);
    if (closes.length === 0) closes.push(currentPrice);

    // RSI 14
    const rsi14 = this.calculateRSI(closes, 14);

    // MACD (12, 26, 9)
    const ema12 = this.calculateEMA(closes, 12);
    const ema26 = this.calculateEMA(closes, 26);
    const macd = ema12 - ema26;
    // Approximated signal line from MACD
    const macdSignal = macd * 0.85;
    const macdHist = macd - macdSignal;

    // ROC (Rate of Change) 9 period
    let roc = 0;
    if (closes.length >= 10) {
      const pastClose = closes[closes.length - 10];
      roc = pastClose > 0 ? ((currentPrice - pastClose) / pastClose) * 100 : 0;
    }

    return {
      rsi14: parseFloat(rsi14.toFixed(1)),
      macd: parseFloat(macd.toFixed(4)),
      macdSignal: parseFloat(macdSignal.toFixed(4)),
      macdHist: parseFloat(macdHist.toFixed(4)),
      roc: parseFloat(roc.toFixed(2)),
    };
  }

  private computeVolatilityFeatures(currentPrice: number, candles: Candle[]): VolatilityFeatures {
    const atr14 = this.calculateATR(candles, 14);
    const atrPct = currentPrice > 0 ? (atr14 / currentPrice) * 100 : 0;

    // Realized Volatility from close returns (annualized or period-based)
    let realizedVol = 0;
    if (candles.length >= 10) {
      const returns: number[] = [];
      for (let i = 1; i < candles.length; i++) {
        const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
        returns.push(ret);
      }
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
      realizedVol = Math.sqrt(variance) * 100;
    }

    // Volatility percentile mapped 0-100
    const volatilityPercentile = Math.min(100, Math.max(0, atrPct * 20));
    const isHighVolatility = atrPct > 2.5 || volatilityPercentile > 75;

    return {
      atr14: parseFloat(atr14.toFixed(4)),
      atrPct: parseFloat(atrPct.toFixed(3)),
      realizedVol: parseFloat(realizedVol.toFixed(3)),
      volatilityPercentile: parseFloat(volatilityPercentile.toFixed(1)),
      isHighVolatility,
    };
  }

  private computeVolumeFeatures(candles: Candle[], volume24hTotal?: number): VolumeFeatures {
    const volumes = candles.map((c) => c.volume);
    const recentVol = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
    const avgVol = volumes.length > 1
      ? volumes.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length)
      : recentVol || 1;

    const relativeVolume = avgVol > 0 ? recentVol / avgVol : 1.0;

    // Volume delta approximation from candle body
    let volumeDelta = 0;
    let buyPressure = 0.5;
    if (candles.length > 0) {
      const c = candles[candles.length - 1];
      const range = c.high - c.low;
      if (range > 0) {
        buyPressure = (c.close - c.low) / range;
        volumeDelta = c.volume * (buyPressure - 0.5) * 2;
      }
    }

    return {
      volume24h: volume24hTotal || volumes.reduce((a, b) => a + b, 0),
      relativeVolume: parseFloat(relativeVolume.toFixed(2)),
      volumeDelta: parseFloat(volumeDelta.toFixed(2)),
      buySellPressure: parseFloat(buyPressure.toFixed(2)),
    };
  }

  private computeOrderbookFeatures(currentPrice: number, bookTicker?: BookTicker | null): OrderbookFeatures {
    if (!bookTicker || bookTicker.bidPrice === 0 || bookTicker.askPrice === 0) {
      const spread = currentPrice * 0.0004; // 4 bps estimated
      return {
        bidPrice: currentPrice - spread / 2,
        askPrice: currentPrice + spread / 2,
        spread,
        spreadBps: 4.0,
        imbalance: 0.0,
        bidDepth: 10.0,
        askDepth: 10.0,
        topDepth: 20.0,
        microprice: currentPrice,
        bookPressure: 'BALANCED',
      };
    }

    const { bidPrice, askPrice, bidQty, askQty } = bookTicker;
    const spread = Math.max(0.00000001, askPrice - bidPrice);
    const mid = (askPrice + bidPrice) / 2;
    const spreadBps = mid > 0 ? (spread / mid) * 10_000 : 0;

    const totalDepth = bidQty + askQty;
    const imbalance = totalDepth > 0 ? (bidQty - askQty) / totalDepth : 0; // -1 to +1

    // Microprice: weight by opposing volume
    // P_micro = (bidPrice * askQty + askPrice * bidQty) / (bidQty + askQty)
    const microprice = totalDepth > 0
      ? (bidPrice * askQty + askPrice * bidQty) / totalDepth
      : mid;

    let bookPressure: 'BID_DOMINANT' | 'ASK_DOMINANT' | 'BALANCED' = 'BALANCED';
    if (imbalance > 0.25) bookPressure = 'BID_DOMINANT';
    else if (imbalance < -0.25) bookPressure = 'ASK_DOMINANT';

    return {
      bidPrice,
      askPrice,
      spread: parseFloat(spread.toFixed(4)),
      spreadBps: parseFloat(spreadBps.toFixed(2)),
      imbalance: parseFloat(imbalance.toFixed(3)),
      bidDepth: parseFloat(bidQty.toFixed(4)),
      askDepth: parseFloat(askQty.toFixed(4)),
      topDepth: parseFloat(totalDepth.toFixed(4)),
      microprice: parseFloat(microprice.toFixed(4)),
      bookPressure,
    };
  }

  private computeMarketQualityFeatures(
    orderbook: OrderbookFeatures,
    volatility: VolatilityFeatures,
    volume24h?: number,
    tickAgeMs: number = 0
  ): MarketQualityFeatures {
    // 1. Liquidity score: higher volume & tighter spread = higher score
    const volumeScore = Math.min(100, Math.max(10, Math.log10(Math.max(1000, volume24h || 1_000_000)) * 12));
    const spreadScore = Math.max(0, 100 - orderbook.spreadBps * 3);
    const liquidityScore = Math.round(volumeScore * 0.5 + spreadScore * 0.5);

    // 2. Volatility score: moderate volatility is prime, extreme is risky
    let volScore = 50;
    if (volatility.atrPct > 0.3 && volatility.atrPct < 2.0) {
      volScore = 85; // Sweet spot for intraday breakout/momentum
    } else if (volatility.atrPct <= 0.3) {
      volScore = 40; // Too dead
    } else {
      volScore = Math.max(20, 100 - volatility.atrPct * 15); // Too wild
    }

    // 3. Spread quality: tighter is better
    const spreadQuality = Math.min(100, Math.max(0, Math.round(100 - orderbook.spreadBps * 4)));

    // 4. Stale score: 0-100 (100 = tick age < 1s, 0 = tick age > 10s)
    const staleScore = Math.max(0, Math.round(100 - (tickAgeMs / 100)));
    const isStale = tickAgeMs > 10_000;

    return {
      liquidityScore: Math.min(100, Math.max(0, liquidityScore)),
      volatilityScore: Math.min(100, Math.max(0, volScore)),
      spreadQuality: Math.min(100, Math.max(0, spreadQuality)),
      staleScore: Math.min(100, Math.max(0, staleScore)),
      isStale,
      tickAgeMs,
    };
  }

  // --- Mathematical indicator helpers ---
  public calculateEMA(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];
    const k = 2 / (period + 1);
    let ema = values[0];
    for (let i = 1; i < values.length; i++) {
      ema = values[i] * k + ema * (1 - k);
    }
    return ema;
  }

  public calculateRSI(closes: number[], period: number = 14): number {
    if (closes.length < period + 1) return 50;
    let gains = 0;
    let losses = 0;

    for (let i = closes.length - period; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff >= 0) gains += diff;
      else losses += Math.abs(diff);
    }

    if (losses === 0) return 100;
    const rs = (gains / period) / (losses / period);
    return 100 - 100 / (1 + rs);
  }

  public calculateATR(candles: Candle[], period: number = 14): number {
    if (candles.length < 2) return 0;
    const p = Math.min(period, candles.length - 1);
    let trSum = 0;
    for (let i = candles.length - p; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trSum += tr;
    }
    return trSum / p;
  }

  public calculateADX(candles: Candle[], period: number = 14): number {
    if (candles.length < period * 2) return 25.0; // Baseline default
    let plusDM = 0;
    let minusDM = 0;
    let trSum = 0;

    for (let i = candles.length - period; i < candles.length; i++) {
      const highDiff = candles[i].high - candles[i - 1].high;
      const lowDiff = candles[i - 1].low - candles[i].low;

      if (highDiff > lowDiff && highDiff > 0) plusDM += highDiff;
      if (lowDiff > highDiff && lowDiff > 0) minusDM += lowDiff;

      trSum += Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
    }

    if (trSum === 0) return 25.0;
    const plusDI = (plusDM / trSum) * 100;
    const minusDI = (minusDM / trSum) * 100;
    const diSum = plusDI + minusDI;
    if (diSum === 0) return 25.0;

    const dx = (Math.abs(plusDI - minusDI) / diSum) * 100;
    return dx;
  }
}

export const featureEngine = FeatureEngine.getInstance();
