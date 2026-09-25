import { MarketTick, FastIndicators, FastSignalResult, StrategySupervisorState } from '@/types/fastEngine';

interface SymbolBuffer {
  ticks: number[];
  timestamps: number[];
  lastPrice: number;
  bid: number;
  ask: number;
  volume24h: number;
  change24h: number;
  ema9: number;
  ema20: number;
  ema50: number;
}

const symbolBuffers: Map<string, SymbolBuffer> = new Map();

// Calculate EMA update
function updateEMA(prevEMA: number, currentPrice: number, period: number): number {
  if (!prevEMA || prevEMA <= 0) return currentPrice;
  const k = 2 / (period + 1);
  return currentPrice * k + prevEMA * (1 - k);
}

// Calculate RSI from rolling tick prices
function calculateFastRSI(prices: number[], period: number = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  const startIdx = prices.length - period;
  for (let i = startIdx; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  if (losses === 0) return 100;
  const rs = (gains / period) / (losses / period);
  return Math.round(100 - (100 / (1 + rs)));
}

export function registerMarketTick(tick: MarketTick): void {
  let buf = symbolBuffers.get(tick.symbol);
  if (!buf) {
    buf = {
      ticks: [],
      timestamps: [],
      lastPrice: tick.price,
      bid: tick.bid || tick.price,
      ask: tick.ask || tick.price,
      volume24h: tick.volume24h || 0,
      change24h: tick.change24h || 0,
      ema9: tick.price,
      ema20: tick.price,
      ema50: tick.price,
    };
    symbolBuffers.set(tick.symbol, buf);
  }

  buf.lastPrice = tick.price;
  if (tick.bid) buf.bid = tick.bid;
  if (tick.ask) buf.ask = tick.ask;
  if (tick.volume24h) buf.volume24h = tick.volume24h;
  if (tick.change24h !== undefined) buf.change24h = tick.change24h;

  buf.ticks.push(tick.price);
  buf.timestamps.push(tick.timestamp);

  // Keep rolling buffer of last 100 ticks
  if (buf.ticks.length > 100) {
    buf.ticks.shift();
    buf.timestamps.shift();
  }

  // Update rolling EMAs
  buf.ema9 = updateEMA(buf.ema9, tick.price, 9);
  buf.ema20 = updateEMA(buf.ema20, tick.price, 20);
  buf.ema50 = updateEMA(buf.ema50, tick.price, 50);
}

export function getSymbolBuffer(symbol: string): SymbolBuffer | undefined {
  return symbolBuffers.get(symbol);
}

export function evaluateFastSignal(
  symbol: string,
  supervisor?: StrategySupervisorState | null
): FastSignalResult | null {
  const buf = symbolBuffers.get(symbol);
  if (!buf || buf.ticks.length < 5) {
    return null;
  }

  const p = buf.lastPrice;
  const rsi = calculateFastRSI(buf.ticks, 14);
  const spread = Math.max(0, buf.ask - buf.bid);

  // Short term momentum (last 10 vs 20 ticks)
  const len = buf.ticks.length;
  const recent10 = buf.ticks.slice(Math.max(0, len - 10));
  const p10Ago = recent10[0] || p;
  const rateOfChange = p10Ago > 0 ? ((p - p10Ago) / p10Ago) * 100 : 0;

  // Volatility estimate over last ticks
  let variance = 0;
  for (const t of recent10) {
    variance += Math.pow(t - p, 2);
  }
  const volatility = Math.sqrt(variance / recent10.length);

  const indicators: FastIndicators = {
    rsi,
    ema9: parseFloat(buf.ema9.toFixed(4)),
    ema20: parseFloat(buf.ema20.toFixed(4)),
    ema50: parseFloat(buf.ema50.toFixed(4)),
    momentum: parseFloat(rateOfChange.toFixed(3)),
    rateOfChange: parseFloat(rateOfChange.toFixed(3)),
    volatility: parseFloat(volatility.toFixed(4)),
    spread: parseFloat(spread.toFixed(4)),
  };

  // Signal state evaluation based on indicators & supervisor strategy
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  let confidence = 65;
  let reason = 'Dengeli piyasa yapısı (HOLD)';

  const allowLong = supervisor ? supervisor.allowLong : true;
  const allowShort = supervisor ? supervisor.allowShort : true;

  // Bullish Conditions:
  // 1. Oversold dip recovery (RSI < 35 with momentum turning positive)
  // 2. Trend breakout (Price >= EMA9 >= EMA20, 24h change positive and momentum > 0.05%)
  if (allowLong && (rsi < 35 && rateOfChange >= 0)) {
    action = 'BUY';
    confidence = 84;
    reason = `Hızlı Aşırı Satım Dönüşü: RSI (${rsi}) dipte, mikro momentum (+${rateOfChange.toFixed(2)}%) pozitif.`;
  } else if (allowLong && (p >= buf.ema9 && buf.ema9 >= buf.ema20 && buf.change24h > 0.5 && rateOfChange > 0.04)) {
    action = 'BUY';
    confidence = 80;
    reason = `Mikro Momentum Kırılımı: Fiyat > EMA9 > EMA20, 10-tick momentum: +${rateOfChange.toFixed(2)}%.`;
  }
  // Bearish Conditions:
  // 1. Overbought rejection (RSI > 68 and rate of change negative)
  // 2. Trend breakdown (Price < EMA9 < EMA20, momentum < -0.05%)
  else if (rsi > 68 && rateOfChange <= 0) {
    action = 'SELL';
    confidence = 82;
    reason = `Hızlı Aşırı Alım Reddi: RSI (${rsi}) aşırı alımda, mikro momentum negatif.`;
  } else if (p < buf.ema9 && buf.ema9 < buf.ema20 && rateOfChange < -0.04) {
    action = 'SELL';
    confidence = 78;
    reason = `Mikro Düşüş İvmesi: Fiyat < EMA9 < EMA20, momentum: ${rateOfChange.toFixed(2)}%.`;
  } else {
    action = 'HOLD';
    confidence = 65;
    reason = `Yatay / Kararsız Akış: RSI (${rsi}), Momentum: ${rateOfChange.toFixed(2)}%.`;
  }

  // Calculate score (0-100)
  const score = Math.min(98, Math.max(30, Math.round(confidence + (rateOfChange * 5))));

  return {
    symbol,
    action,
    confidence,
    score,
    indicators,
    reason,
    timestamp: Date.now(),
  };
}
