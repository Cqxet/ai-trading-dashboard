import {
  TradingStrategy,
  StrategyEvaluationContext,
  StrategySignal,
  MarketRegime,
} from './types';

export class MomentumBreakoutStrategy implements TradingStrategy {
  public id = 'momentum_breakout';
  public name = 'Momentum Breakout';
  public description = 'Detects volume surge and orderbook pressure breaking out in directional momentum';
  public compatibleRegimes: MarketRegime[] = ['BREAKOUT', 'TREND_UP', 'TREND_DOWN'];

  public evaluate(context: StrategyEvaluationContext): StrategySignal {
    const { features, activeRegime } = context;
    const { price, trend, momentum, volume, orderbook, volatility } = features;
    const reasons: string[] = [];

    let buyScore = 0;
    let sellScore = 0;

    // 1. Trend alignment
    if (trend.ema9 > trend.ema21) {
      buyScore += 25;
      reasons.push('EMA9 above EMA21');
    } else if (trend.ema9 < trend.ema21) {
      sellScore += 25;
      reasons.push('EMA9 below EMA21');
    }

    // 2. Volume expansion
    if (volume.relativeVolume >= 1.25) {
      if (volume.buySellPressure > 0.55) {
        buyScore += 25;
        reasons.push(`High relative volume (${volume.relativeVolume}x) with buy pressure`);
      } else if (volume.buySellPressure < 0.45) {
        sellScore += 25;
        reasons.push(`High relative volume (${volume.relativeVolume}x) with sell pressure`);
      }
    }

    // 3. Momentum & RSI confirmation
    if (momentum.rsi14 >= 52 && momentum.rsi14 <= 72 && momentum.macdHist > 0) {
      buyScore += 25;
      reasons.push(`Bullish RSI momentum (${momentum.rsi14}) and positive MACD histogram`);
    } else if (momentum.rsi14 <= 48 && momentum.rsi14 >= 28 && momentum.macdHist < 0) {
      sellScore += 25;
      reasons.push(`Bearish RSI momentum (${momentum.rsi14}) and negative MACD histogram`);
    }

    // 4. Orderbook pressure
    if (orderbook.imbalance > 0.15 && orderbook.bookPressure === 'BID_DOMINANT') {
      buyScore += 25;
      reasons.push(`Orderbook bid pressure dominant (+${(orderbook.imbalance * 100).toFixed(0)}%)`);
    } else if (orderbook.imbalance < -0.15 && orderbook.bookPressure === 'ASK_DOMINANT') {
      sellScore += 25;
      reasons.push(`Orderbook ask pressure dominant (${(orderbook.imbalance * 100).toFixed(0)}%)`);
    }

    // Regime booster or dampener
    if (activeRegime === 'BREAKOUT') {
      buyScore = Math.min(100, buyScore + 10);
      sellScore = Math.min(100, sellScore + 10);
    } else if (activeRegime === 'RANGE') {
      buyScore = Math.max(0, buyScore - 20);
      sellScore = Math.max(0, sellScore - 20);
    }

    const currentPrice = price.last;
    const atr = Math.max(0.01, volatility.atr14);
    const stopDistance = atr * 1.5;

    if (buyScore >= 70 && buyScore > sellScore) {
      return {
        signal: 'BUY',
        score: buyScore / 100,
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((currentPrice + atr * 2.5).toFixed(4)),
        stopLoss: parseFloat((currentPrice - stopDistance).toFixed(4)),
      };
    }

    if (sellScore >= 70 && sellScore > buyScore) {
      return {
        signal: 'SELL',
        score: sellScore / 100,
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((currentPrice - atr * 2.5).toFixed(4)),
        stopLoss: parseFloat((currentPrice + stopDistance).toFixed(4)),
      };
    }

    return {
      signal: 'HOLD',
      score: Math.max(buyScore, sellScore) / 100,
      reasons: reasons.length > 0 ? reasons : ['No clear breakout criteria met'],
    };
  }
}

export class TrendFollowingStrategy implements TradingStrategy {
  public id = 'trend_following';
  public name = 'Trend Following';
  public description = 'Rides sustained directional trends with multi-EMA alignment and ADX strength';
  public compatibleRegimes: MarketRegime[] = ['TREND_UP', 'TREND_DOWN'];

  public evaluate(context: StrategyEvaluationContext): StrategySignal {
    const { features, activeRegime } = context;
    const { price, trend, momentum, volatility } = features;
    const reasons: string[] = [];

    const isBullStack = trend.ema9 > trend.ema21 && trend.ema21 > trend.ema50;
    const isBearStack = trend.ema9 < trend.ema21 && trend.ema21 < trend.ema50;
    const hasTrendStrength = trend.adx >= 22;

    const currentPrice = price.last;
    const atr = Math.max(0.01, volatility.atr14);
    const stopDistance = atr * 2.0;

    if (isBullStack && hasTrendStrength && trend.slope > 0) {
      reasons.push('Full EMA triple bullish alignment (EMA9 > EMA21 > EMA50)');
      reasons.push(`ADX trend strength confirmed (${trend.adx})`);
      if (momentum.rsi14 >= 45 && momentum.rsi14 <= 70) {
        reasons.push(`RSI (${momentum.rsi14}) in healthy trend continuation zone`);
      }

      let score = 75;
      if (activeRegime === 'TREND_UP') score += 15;
      if (trend.emaSpread > 0.5) score += 10;

      return {
        signal: 'BUY',
        score: Math.min(0.98, score / 100),
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((currentPrice + atr * 3.0).toFixed(4)),
        stopLoss: parseFloat((currentPrice - stopDistance).toFixed(4)),
      };
    }

    if (isBearStack && hasTrendStrength && trend.slope < 0) {
      reasons.push('Full EMA triple bearish alignment (EMA9 < EMA21 < EMA50)');
      reasons.push(`ADX trend strength confirmed (${trend.adx})`);

      let score = 75;
      if (activeRegime === 'TREND_DOWN') score += 15;

      return {
        signal: 'SELL',
        score: Math.min(0.98, score / 100),
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((currentPrice - atr * 3.0).toFixed(4)),
        stopLoss: parseFloat((currentPrice + stopDistance).toFixed(4)),
      };
    }

    return {
      signal: 'HOLD',
      score: 0.45,
      reasons: ['Trend not cleanly established across all moving averages'],
    };
  }
}

export class MeanReversionStrategy implements TradingStrategy {
  public id = 'mean_reversion';
  public name = 'Mean Reversion';
  public description = 'Exploits oversold and overbought statistical extremes inside ranges';
  public compatibleRegimes: MarketRegime[] = ['RANGE'];

  public evaluate(context: StrategyEvaluationContext): StrategySignal {
    const { features, activeRegime } = context;
    const { price, trend, momentum, orderbook, volatility } = features;
    const reasons: string[] = [];

    const currentPrice = price.last;
    const atr = Math.max(0.01, volatility.atr14);
    const stopDistance = atr * 1.2;

    // Extreme oversold bounce
    if (momentum.rsi14 < 30 && orderbook.imbalance > -0.1) {
      reasons.push(`Oversold RSI extreme (${momentum.rsi14})`);
      reasons.push('Orderbook bid absorption detected');

      let score = 72;
      if (activeRegime === 'RANGE') score += 18;

      return {
        signal: 'BUY',
        score: score / 100,
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((trend.ema21).toFixed(4)), // Target back to mean
        stopLoss: parseFloat((currentPrice - stopDistance).toFixed(4)),
      };
    }

    // Extreme overbought reversal
    if (momentum.rsi14 > 70 && orderbook.imbalance < 0.1) {
      reasons.push(`Overbought RSI extreme (${momentum.rsi14})`);
      reasons.push('Orderbook ask exhaustion detected');

      let score = 72;
      if (activeRegime === 'RANGE') score += 18;

      return {
        signal: 'SELL',
        score: score / 100,
        reasons,
        suggestedStopDistance: stopDistance,
        targetPrice: parseFloat((trend.ema21).toFixed(4)), // Target back to mean
        stopLoss: parseFloat((currentPrice + stopDistance).toFixed(4)),
      };
    }

    return {
      signal: 'HOLD',
      score: 0.4,
      reasons: ['Price is not at an extreme range boundary'],
    };
  }
}

export class StrategyRegistry {
  private static instance: StrategyRegistry;
  private strategies: Map<string, TradingStrategy> = new Map();

  private constructor() {
    this.register(new MomentumBreakoutStrategy());
    this.register(new TrendFollowingStrategy());
    this.register(new MeanReversionStrategy());
  }

  public static getInstance(): StrategyRegistry {
    if (!StrategyRegistry.instance) {
      StrategyRegistry.instance = new StrategyRegistry();
    }
    return StrategyRegistry.instance;
  }

  public register(strategy: TradingStrategy): void {
    this.strategies.set(strategy.id, strategy);
  }

  public get(id: string): TradingStrategy | undefined {
    return this.strategies.get(id);
  }

  public getAll(): TradingStrategy[] {
    return Array.from(this.strategies.values());
  }

  public getStrategiesForRegime(regime: MarketRegime): TradingStrategy[] {
    return this.getAll().filter((s) => s.compatibleRegimes.includes(regime));
  }
}

export const strategyRegistry = StrategyRegistry.getInstance();
