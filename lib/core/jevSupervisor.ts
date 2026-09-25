import {
  FeatureSnapshot,
  QuantSignal,
  JevEvaluation,
  JevEvaluationSchema,
  MarketRegime,
} from './types';

const TYPESAFE_API_URL = 'https://api.typesafe.ai/v1/systemone';
const DEFAULT_CACHE_TTL_MS = 20_000; // 20s TTL cache

export class JevMarketSupervisor {
  private static instance: JevMarketSupervisor;
  private cache: Map<string, JevEvaluation> = new Map();
  private lastEvaluationTime: Map<string, number> = new Map();

  public static getInstance(): JevMarketSupervisor {
    if (!JevMarketSupervisor.instance) {
      JevMarketSupervisor.instance = new JevMarketSupervisor();
    }
    return JevMarketSupervisor.instance;
  }

  /**
   * Retrieves active cached supervisor evaluation if valid, otherwise returns null.
   * Ensures the fast loop is NEVER blocked by slow network calls.
   */
  public getCachedEvaluation(symbol: string): JevEvaluation | null {
    const cached = this.cache.get(symbol.toUpperCase());
    if (cached && Date.now() < cached.validUntil) {
      return { ...cached, isCached: true };
    }
    return null;
  }

  /**
   * Asynchronously evaluates market state using TypeSafe JEV System-1 decision model.
   * Validated strictly via Zod schema, with deterministic fail-safe fallback.
   */
  public async evaluateMarket(
    features: FeatureSnapshot,
    signal?: QuantSignal | null,
    apiKey?: string
  ): Promise<JevEvaluation> {
    const symbol = features.symbol.toUpperCase();
    const now = Date.now();

    // Check if recently evaluated within last 3 seconds (throttle guard)
    const lastRun = this.lastEvaluationTime.get(symbol) || 0;
    const cached = this.cache.get(symbol);
    if (cached && now - lastRun < 3000) {
      return { ...cached, isCached: true };
    }
    this.lastEvaluationTime.set(symbol, now);

    const typesafeKey = apiKey || process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_KEY;

    if (typesafeKey) {
      try {
        const compactState = {
          symbol: features.symbol,
          timeframe: '1m',
          price: {
            last: features.price.last,
            change24hPct: features.price.change24hPct,
            return1m: features.price.return1m,
            return5m: features.price.return5m,
          },
          trend: {
            direction: features.trend.trendDirection,
            ema9: features.trend.ema9,
            ema21: features.trend.ema21,
            ema50: features.trend.ema50,
            emaSpread: features.trend.emaSpread,
            slope: features.trend.slope,
            adx: features.trend.adx,
          },
          momentum: {
            rsi14: features.momentum.rsi14,
            macdHist: features.momentum.macdHist,
            roc: features.momentum.roc,
          },
          volatility: {
            atr14: features.volatility.atr14,
            atrPct: features.volatility.atrPct,
            isHighVolatility: features.volatility.isHighVolatility,
          },
          volume: {
            relativeVolume: features.volume.relativeVolume,
            buySellPressure: features.volume.buySellPressure,
          },
          orderbook: {
            spreadBps: features.orderbook.spreadBps,
            imbalance: features.orderbook.imbalance,
            bookPressure: features.orderbook.bookPressure,
          },
          marketQuality: {
            liquidityScore: features.marketQuality.liquidityScore,
            volatilityScore: features.marketQuality.volatilityScore,
            isStale: features.marketQuality.isStale,
          },
          strategy: signal ? {
            name: signal.strategy,
            candidateSignal: signal.signal,
            score: signal.score,
          } : undefined,
        };

        const payload = {
          model: 'jev-latest',
          state: JSON.stringify(compactState),
          questions: {
            market_regime: {
              type: 'choice',
              instructions: 'What is the current prevailing market regime?',
              criteria: {
                TREND_UP: 'Sustained bullish trend with higher highs and higher lows.',
                TREND_DOWN: 'Sustained bearish trend with lower lows and lower highs.',
                RANGE: 'Range-bound horizontal oscillation between established support and resistance.',
                BREAKOUT: 'Aggressive expansion breaking through previous consolidation.',
                HIGH_VOLATILITY: 'Violent multi-directional swings with widening spreads.',
                UNSTABLE: 'Chaotic orderbook, erratic microstructure or illiquid anomalies.',
              },
            },
            entry_quality: {
              type: 'score',
              instructions: 'Rate the technical entry setup quality from 0.0 to 1.0.',
              legend: { '0.0': 'Unfavorable/Trap', '0.5': 'Neutral', '0.8': 'High probability', '1.0': 'Exceptional' },
            },
            signal_conflict: {
              type: 'score',
              instructions: 'Rate conflict between indicators (0.0 = completely aligned, 1.0 = severe divergence).',
            },
            liquidity_risk: {
              type: 'score',
              instructions: 'Rate the liquidity risk (0.0 = deep liquidity, 1.0 = thin/slippage danger).',
            },
            volatility_risk: {
              type: 'score',
              instructions: 'Rate the volatility risk (0.0 = stable volatility, 1.0 = hazardous spike).',
            },
            abnormal_market: {
              type: 'score',
              instructions: 'Rate probability of market anomaly or fakeout (0.0 = normal, 1.0 = anomaly).',
            },
            confidence: {
              type: 'score',
              instructions: 'How confident is the supervisor model in this structural classification (0-100)? Note: This is MODEL confidence, NOT win rate.',
            },
          },
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

        const res = await fetch(TYPESAFE_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${typesafeKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (res.ok) {
          const raw = await res.json();
          const results = raw.results || {};

          // Normalize for Zod parsing
          const candidateData = {
            market_regime: results.market_regime?.choice || 'RANGE',
            entry_quality: Math.min(1, Math.max(0, Number(results.entry_quality?.score ?? 0.5) > 1 ? Number(results.entry_quality?.score) / 100 : Number(results.entry_quality?.score ?? 0.5))),
            signal_conflict: Math.min(1, Math.max(0, Number(results.signal_conflict?.score ?? 0.2) > 1 ? Number(results.signal_conflict?.score) / 100 : Number(results.signal_conflict?.score ?? 0.2))),
            liquidity_risk: Math.min(1, Math.max(0, Number(results.liquidity_risk?.score ?? 0.1) > 1 ? Number(results.liquidity_risk?.score) / 100 : Number(results.liquidity_risk?.score ?? 0.1))),
            volatility_risk: Math.min(1, Math.max(0, Number(results.volatility_risk?.score ?? 0.2) > 1 ? Number(results.volatility_risk?.score) / 100 : Number(results.volatility_risk?.score ?? 0.2))),
            abnormal_market: Math.min(1, Math.max(0, Number(results.abnormal_market?.score ?? 0.1) > 1 ? Number(results.abnormal_market?.score) / 100 : Number(results.abnormal_market?.score ?? 0.1))),
            confidence: Math.min(100, Math.max(0, Number(results.confidence?.score ?? 80))),
            reasoning: `JEV System-1: Regime ${results.market_regime?.choice || 'RANGE'}, Quality ${((results.entry_quality?.score ?? 0.5) * 100).toFixed(0)}%`,
          };

          const parseResult = JevEvaluationSchema.safeParse(candidateData);
          if (parseResult.success) {
            const parsed = parseResult.data;
            const evaluation: JevEvaluation = {
              symbol,
              timestamp: now,
              validUntil: now + DEFAULT_CACHE_TTL_MS,
              regime: parsed.market_regime as MarketRegime,
              entryQuality: parsed.entry_quality,
              signalConflict: parsed.signal_conflict,
              liquidityRisk: parsed.liquidity_risk,
              volatilityRisk: parsed.volatility_risk,
              abnormalMarket: parsed.abnormal_market,
              modelConfidence: parsed.confidence,
              reasoning: parsed.reasoning,
              isCached: false,
              isFallback: false,
            };

            this.cache.set(symbol, evaluation);
            return evaluation;
          }
        }
      } catch (err: any) {
        console.warn(`[JEV_SUPERVISOR][${symbol}] API evaluation failed, using deterministic supervisor fallback:`, err.message);
      }
    }

    // Deterministic supervisor fallback (100% real math rules, ZERO hallucination)
    const fallbackEvaluation = this.computeDeterministicFallback(features, signal);
    this.cache.set(symbol, fallbackEvaluation);
    return fallbackEvaluation;
  }

  /**
   * Deterministic rule-based supervisor fallback when external JEV API is unavailable.
   */
  public computeDeterministicFallback(features: FeatureSnapshot, signal?: QuantSignal | null): JevEvaluation {
    const { trend, momentum, volatility, volume, orderbook, marketQuality } = features;
    const now = Date.now();

    // 1. Classify regime deterministically
    let regime: MarketRegime = 'RANGE';
    if (volatility.isHighVolatility && volatility.atrPct > 2.5) {
      regime = 'HIGH_VOLATILITY';
    } else if (volume.relativeVolume > 1.8 && Math.abs(features.price.return1m) > 0.4) {
      regime = 'BREAKOUT';
    } else if (trend.trendDirection === 'BULLISH' && trend.adx > 22) {
      regime = 'TREND_UP';
    } else if (trend.trendDirection === 'BEARISH' && trend.adx > 22) {
      regime = 'TREND_DOWN';
    } else if (orderbook.spreadBps > 30 || marketQuality.liquidityScore < 30) {
      regime = 'UNSTABLE';
    } else {
      regime = 'RANGE';
    }

    // 2. Entry quality
    let entryQuality = 0.5;
    if (signal) {
      entryQuality = signal.score;
      if (regime === 'BREAKOUT' || (regime === 'TREND_UP' && signal.signal === 'BUY')) {
        entryQuality = Math.min(1.0, entryQuality + 0.1);
      }
    }

    // 3. Signal conflict
    let signalConflict = 0.15;
    if (trend.trendDirection === 'BULLISH' && momentum.rsi14 > 72) {
      signalConflict = 0.65; // Bullish trend but extreme overbought
    } else if (trend.trendDirection === 'BEARISH' && momentum.rsi14 < 28) {
      signalConflict = 0.65; // Bearish trend but extreme oversold
    }

    // 4. Liquidity & Volatility Risk
    const liquidityRisk = Math.min(1.0, Math.max(0.0, (100 - marketQuality.liquidityScore) / 100));
    const volatilityRisk = Math.min(1.0, Math.max(0.0, volatility.atrPct / 3.0));
    const abnormalMarket = regime === 'UNSTABLE' ? 0.8 : (regime === 'HIGH_VOLATILITY' ? 0.6 : 0.1);

    const modelConfidence = 78;

    return {
      symbol: features.symbol,
      timestamp: now,
      validUntil: now + DEFAULT_CACHE_TTL_MS,
      regime,
      entryQuality: parseFloat(entryQuality.toFixed(2)),
      signalConflict: parseFloat(signalConflict.toFixed(2)),
      liquidityRisk: parseFloat(liquidityRisk.toFixed(2)),
      volatilityRisk: parseFloat(volatilityRisk.toFixed(2)),
      abnormalMarket: parseFloat(abnormalMarket.toFixed(2)),
      modelConfidence,
      reasoning: `Deterministic Supervisor: Regime ${regime} based on ADX (${trend.adx}) & ATR% (${volatility.atrPct}%). Liquidity risk: ${(liquidityRisk * 100).toFixed(0)}%.`,
      isCached: false,
      isFallback: true,
    };
  }
}

export const jevMarketSupervisor = JevMarketSupervisor.getInstance();
