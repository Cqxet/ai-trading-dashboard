import {
  FeatureSnapshot,
  QuantSignal,
  ScoreBreakdown,
  ActionType,
  Position,
  MarketRegime,
} from './types';
import { strategyRegistry } from './strategyRegistry';

export class QuantSignalEngine {
  private static instance: QuantSignalEngine;

  public static getInstance(): QuantSignalEngine {
    if (!QuantSignalEngine.instance) {
      QuantSignalEngine.instance = new QuantSignalEngine();
    }
    return QuantSignalEngine.instance;
  }

  /**
   * Generates a fully deterministic QuantSignal with a comprehensive score breakdown.
   */
  public evaluate(
    features: FeatureSnapshot,
    preferredStrategyId: string = 'momentum_breakout',
    currentPosition?: Position | null,
    activeRegime?: MarketRegime
  ): QuantSignal {
    const breakdown = this.computeScoreBreakdown(features);

    // Get selected strategy or fallback to momentum breakout
    let strategy = strategyRegistry.get(preferredStrategyId);
    if (!strategy) {
      strategy = strategyRegistry.get('momentum_breakout')!;
    }

    const stratSignal = strategy.evaluate({
      features,
      currentPosition,
      activeRegime,
    });

    const reasons = [...stratSignal.reasons];

    // Combine strategy evaluation with deterministic score breakdown
    let signalAction: ActionType = stratSignal.signal;

    // Safety: If overall totalScore is too weak (< 55), downgrade to HOLD
    if (breakdown.totalScore < 55 && signalAction !== 'HOLD') {
      reasons.push(`Total quantitative score too low (${breakdown.totalScore}/100) to confirm signal`);
      signalAction = 'HOLD';
    }

    // Safety: Stale market check
    if (features.marketQuality.isStale) {
      reasons.push('Data is stale (>10s) - Signal overridden to NO_TRADE');
      signalAction = 'NO_TRADE';
    }

    return {
      symbol: features.symbol,
      signal: signalAction,
      score: breakdown.totalScore / 100,
      breakdown,
      strategy: strategy.id,
      reasons,
      suggestedStopDistance: stratSignal.suggestedStopDistance || features.volatility.atr14 * 1.5,
      targetPrice: stratSignal.targetPrice,
      stopLoss: stratSignal.stopLoss,
      timestamp: Date.now(),
      featureVersion: features.version,
    };
  }

  /**
   * Computes the 6-pillar score breakdown:
   * 1. trendScore (25%)
   * 2. momentumScore (20%)
   * 3. volumeScore (15%)
   * 4. liquidityScore (15%)
   * 5. volatilityScore (10%)
   * 6. orderbookScore (15%)
   */
  public computeScoreBreakdown(features: FeatureSnapshot): ScoreBreakdown {
    const { trend, momentum, volume, marketQuality, volatility, orderbook } = features;

    // 1. Trend score (0-100)
    let trendScore = 50;
    if (trend.trendDirection === 'BULLISH') {
      trendScore = 70 + Math.min(25, Math.abs(trend.slope) * 200 + trend.adx * 0.3);
    } else if (trend.trendDirection === 'BEARISH') {
      trendScore = 30 - Math.min(25, Math.abs(trend.slope) * 200 + trend.adx * 0.3);
    } else {
      trendScore = 50;
    }
    trendScore = Math.min(100, Math.max(0, Math.round(trendScore)));

    // 2. Momentum score (0-100)
    let momentumScore = 50;
    // Healthy bullish momentum: RSI between 52 and 68
    if (momentum.rsi14 >= 50 && momentum.rsi14 <= 70) {
      momentumScore = 60 + ((momentum.rsi14 - 50) / 20) * 35;
    } else if (momentum.rsi14 < 30) {
      momentumScore = 75; // strong oversold potential
    } else if (momentum.rsi14 > 70) {
      momentumScore = 35; // overbought risk
    } else {
      momentumScore = 45;
    }
    if (momentum.macdHist > 0) momentumScore += 5;
    momentumScore = Math.min(100, Math.max(0, Math.round(momentumScore)));

    // 3. Volume score (0-100)
    let volumeScore = 50;
    if (volume.relativeVolume >= 1.5) {
      volumeScore = 90;
    } else if (volume.relativeVolume >= 1.1) {
      volumeScore = 75;
    } else if (volume.relativeVolume >= 0.8) {
      volumeScore = 55;
    } else {
      volumeScore = 30; // volume drought
    }
    volumeScore = Math.min(100, Math.max(0, Math.round(volumeScore)));

    // 4. Liquidity score (0-100)
    const liquidityScore = Math.min(100, Math.max(0, Math.round(marketQuality.liquidityScore)));

    // 5. Volatility score (0-100)
    const volatilityScore = Math.min(100, Math.max(0, Math.round(marketQuality.volatilityScore)));

    // 6. Orderbook score (0-100)
    let orderbookScore = 50;
    if (orderbook.imbalance > 0.2) {
      orderbookScore = 60 + orderbook.imbalance * 35;
    } else if (orderbook.imbalance < -0.2) {
      orderbookScore = 40 - Math.abs(orderbook.imbalance) * 35;
    } else {
      orderbookScore = 50;
    }
    orderbookScore = Math.min(100, Math.max(0, Math.round(orderbookScore)));

    // Weighted total score
    const totalScore = Math.round(
      trendScore * 0.25 +
      momentumScore * 0.20 +
      volumeScore * 0.15 +
      liquidityScore * 0.15 +
      volatilityScore * 0.10 +
      orderbookScore * 0.15
    );

    return {
      trendScore,
      momentumScore,
      volumeScore,
      liquidityScore,
      volatilityScore,
      orderbookScore,
      totalScore: Math.min(100, Math.max(0, totalScore)),
    };
  }
}

export const quantSignalEngine = QuantSignalEngine.getInstance();
