import {
  RiskLimits,
  RiskEvaluationContext,
  RiskDecision,
  RiskDecisionAction,
} from './types';

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPortfolioExposurePct: 0.60,      // Max 60% of equity in open positions
  maxSymbolExposurePct: 0.20,         // Max 20% of equity in single symbol
  maxSimultaneousPositions: 3,        // Max 3 concurrent positions
  maxRiskPerTradePct: 0.015,          // Max 1.5% equity risked per trade
  maxDailyLossPct: 0.05,              // Kill switch at 5% daily loss
  maxDrawdownKillSwitchPct: 0.10,     // Kill switch at 10% peak-to-trough drawdown
  maxConsecutiveLosses: 3,            // Cooldown after 3 back-to-back losses
  cooldownPeriodMs: 30_000,           // 30-second cooldown per symbol
  maxSpreadBps: 25,                   // Max 25 basis points spread allowed
  maxEstimatedSlippageBps: 10,        // Max 10 basis points estimated slippage
  minLiquidity24hUsdt: 1_000_000,     // Minimum 1M USDT 24h volume
  maxStaleTickAgeMs: 10_000,          // Max 10s tick age
  enableLiveTrading: false,           // Default false (safe live lockout)
};

export class HardRiskEngine {
  private static instance: HardRiskEngine;
  private limits: RiskLimits;
  private orderRateHistory: number[] = []; // Timestamp array for rate limit check

  public constructor(customLimits?: Partial<RiskLimits>) {
    this.limits = {
      ...DEFAULT_RISK_LIMITS,
      enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true',
      ...customLimits,
    };
  }

  public static getInstance(): HardRiskEngine {
    if (!HardRiskEngine.instance) {
      HardRiskEngine.instance = new HardRiskEngine();
    }
    return HardRiskEngine.instance;
  }

  public getLimits(): RiskLimits {
    return { ...this.limits };
  }

  public updateLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = {
      ...this.limits,
      ...newLimits,
      enableLiveTrading: process.env.ENABLE_LIVE_TRADING === 'true' && (newLimits.enableLiveTrading ?? this.limits.enableLiveTrading),
    };
  }

  /**
   * Non-bypassable deterministic risk verification.
   * Can NEVER be overridden by JEV, Gemini, or frontend.
   */
  public evaluate(context: RiskEvaluationContext): RiskDecision {
    const {
      signal,
      jev,
      features,
      portfolioEquity,
      cashBalance,
      openPositions,
      dailyRealizedPnL,
      maxDrawdownPct,
      consecutiveLosses,
      lastOrderTimestamps,
      tradingMode,
    } = context;

    const decisionId = `risk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const reasons: string[] = [];
    let action: RiskDecisionAction = 'ALLOW';
    let riskScore = 15; // baseline low risk

    const symbol = features.symbol.toUpperCase();
    const currentPrice = features.price.last;

    // 1. LIVE TRADING HARD LOCKOUT
    if (tradingMode === 'LIVE' && !this.limits.enableLiveTrading) {
      return {
        action: 'PAUSE_SYSTEM',
        decisionId,
        reasons: ['LIVE_TRADING_DISABLED: ENABLE_LIVE_TRADING flag is false. Real money orders blocked.'],
        evaluatedAt: Date.now(),
        riskScore: 100,
      };
    }

    // 2. DAILY LOSS LIMIT KILL SWITCH
    if (portfolioEquity > 0) {
      const dailyLossPct = (dailyRealizedPnL / portfolioEquity) * -1;
      if (dailyLossPct >= this.limits.maxDailyLossPct) {
        return {
          action: 'PAUSE_SYSTEM',
          decisionId,
          reasons: [`DAILY_LOSS_EXCEEDED: Realized daily loss (-${(dailyLossPct * 100).toFixed(1)}%) hit kill switch limit (-${(this.limits.maxDailyLossPct * 100).toFixed(1)}%).`],
          evaluatedAt: Date.now(),
          riskScore: 100,
        };
      }
    }

    // 3. MAX DRAWDOWN KILL SWITCH
    if (maxDrawdownPct >= this.limits.maxDrawdownKillSwitchPct) {
      return {
        action: 'PAUSE_SYSTEM',
        decisionId,
        reasons: [`MAX_DRAWDOWN_HIT: Portfolio drawdown (${(maxDrawdownPct * 100).toFixed(1)}%) reached emergency ceiling (${(this.limits.maxDrawdownKillSwitchPct * 100).toFixed(1)}%).`],
        evaluatedAt: Date.now(),
        riskScore: 100,
      };
    }

    // 4. STALE MARKET DATA CHECK
    if (features.marketQuality.isStale || features.marketQuality.tickAgeMs > this.limits.maxStaleTickAgeMs) {
      action = 'REJECT';
      riskScore += 40;
      reasons.push(`STALE_DATA: Tick age (${features.marketQuality.tickAgeMs}ms) exceeds max allowable threshold (${this.limits.maxStaleTickAgeMs}ms).`);
    }

    // 5. MAX SPREAD CHECK
    if (features.orderbook.spreadBps > this.limits.maxSpreadBps) {
      action = 'REJECT';
      riskScore += 30;
      reasons.push(`SPREAD_TOO_WIDE: Bid/Ask spread (${features.orderbook.spreadBps} bps) exceeds limit (${this.limits.maxSpreadBps} bps).`);
    }

    // 6. MINIMUM LIQUIDITY CHECK
    if (features.volume.volume24h < this.limits.minLiquidity24hUsdt) {
      action = 'REJECT';
      riskScore += 25;
      reasons.push(`INSUFFICIENT_LIQUIDITY: 24h volume (${features.volume.volume24h.toLocaleString()} USDT) is below required minimum (${this.limits.minLiquidity24hUsdt.toLocaleString()} USDT).`);
    }

    // 7. ORDER RATE LIMIT (Max 4 orders per second)
    const now = Date.now();
    this.orderRateHistory = this.orderRateHistory.filter((t) => now - t < 1000);
    if (this.orderRateHistory.length >= 4) {
      return {
        action: 'REJECT',
        decisionId,
        reasons: ['RATE_LIMIT_EXCEEDED: Exceeded max 4 orders/sec velocity limit.'],
        evaluatedAt: now,
        riskScore: 85,
      };
    }

    // 8. COOLDOWN / DUPLICATE ORDER CHECK
    const lastOrderTime = lastOrderTimestamps[symbol] || 0;
    if (now - lastOrderTime < this.limits.cooldownPeriodMs) {
      const waitSec = Math.ceil((this.limits.cooldownPeriodMs - (now - lastOrderTime)) / 1000);
      return {
        action: 'REJECT',
        decisionId,
        reasons: [`SYMBOL_COOLDOWN: Order cooldown active for ${symbol}. Please wait ${waitSec}s.`],
        evaluatedAt: now,
        riskScore: 60,
      };
    }

    // 9. CONSECUTIVE LOSSES COOLDOWN
    if (consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      action = 'REJECT';
      riskScore += 35;
      reasons.push(`CONSECUTIVE_LOSS_PAUSE: Hit ${consecutiveLosses} consecutive losses. Trading throttled.`);
    }

    // 10. JEV SUPERVISOR INTEGRATION & ANOMALOUS MARKET CHECKS
    if (jev) {
      if (jev.regime === 'UNSTABLE') {
        action = 'REJECT';
        riskScore += 45;
        reasons.push('JEV_REGIME_UNSTABLE: Supervisor classified market microstructure as UNSTABLE.');
      } else if (jev.abnormalMarket >= 0.7) {
        action = 'REJECT';
        riskScore += 40;
        reasons.push(`JEV_ANOMALY_DETECTED: High anomaly score (${(jev.abnormalMarket * 100).toFixed(0)}%). Probable trap/fakeout.`);
      } else if (jev.liquidityRisk >= 0.8) {
        action = 'REDUCE_SIZE';
        riskScore += 25;
        reasons.push(`JEV_LIQUIDITY_WARNING: Supervisor flagged elevated liquidity risk (${(jev.liquidityRisk * 100).toFixed(0)}%). Reducing position size.`);
      } else if (jev.signalConflict >= 0.75) {
        action = 'REDUCE_SIZE';
        riskScore += 20;
        reasons.push(`JEV_SIGNAL_CONFLICT: High divergence between technical indicators (${(jev.signalConflict * 100).toFixed(0)}%).`);
      }
    }

    // If signal is SELL, check if we even hold a position to sell (Spot mode guard)
    const existingPosition = openPositions.find((p) => p.symbol === symbol);
    if (signal.signal === 'SELL' && (!existingPosition || existingPosition.quantity <= 0)) {
      return {
        action: 'REJECT',
        decisionId,
        reasons: [`NO_POSITION_TO_SELL: Spot mode cannot short. No open position held for ${symbol}.`],
        evaluatedAt: now,
        riskScore: 40,
      };
    }

    // 11. PORTFOLIO & SYMBOL EXPOSURE CHECKS (for BUY)
    let approvedQuantity = 0;
    let stopLoss = signal.stopLoss;
    let takeProfit = signal.targetPrice;

    if (signal.signal === 'BUY') {
      // Check maximum simultaneous open positions
      if (!existingPosition && openPositions.length >= this.limits.maxSimultaneousPositions) {
        return {
          action: 'REJECT',
          decisionId,
          reasons: [`MAX_POSITIONS_REACHED: Already holding ${openPositions.length}/${this.limits.maxSimultaneousPositions} concurrent positions.`],
          evaluatedAt: now,
          riskScore: 70,
        };
      }

      // Calculate risk-based quantity: (portfolioEquity * maxRiskPerTradePct) / stopDistance
      const stopDistance = signal.suggestedStopDistance > 0
        ? signal.suggestedStopDistance
        : currentPrice * 0.02; // 2% fallback distance

      const riskCapital = portfolioEquity * this.limits.maxRiskPerTradePct;
      let calculatedQty = riskCapital / stopDistance;

      // Max symbol exposure cap (e.g. 20% of equity)
      const maxSymbolUsdt = portfolioEquity * this.limits.maxSymbolExposurePct;
      const existingSymbolExposure = existingPosition ? existingPosition.quantity * currentPrice : 0;
      const remainingSymbolUsdt = Math.max(0, maxSymbolUsdt - existingSymbolExposure);

      const maxAffordableQty = remainingSymbolUsdt / currentPrice;
      calculatedQty = Math.min(calculatedQty, maxAffordableQty);

      // Check available cash
      const availableCashQty = (cashBalance * 0.98) / currentPrice; // leave 2% buffer for fees/slippage
      calculatedQty = Math.min(calculatedQty, availableCashQty);

      // Check overall portfolio exposure
      const currentExposure = openPositions.reduce((sum, p) => sum + p.quantity * p.currentPrice, 0);
      const maxTotalExposure = portfolioEquity * this.limits.maxPortfolioExposurePct;
      const remainingPortfolioUsdt = Math.max(0, maxTotalExposure - currentExposure);
      calculatedQty = Math.min(calculatedQty, remainingPortfolioUsdt / currentPrice);

      // If action is REDUCE_SIZE, cut quantity by 50%
      if (action === 'REDUCE_SIZE') {
        calculatedQty = calculatedQty * 0.5;
      }

      // Min notional check: Minimum $1.50 for micro simulation, $5.00 for live Binance
      const minNotional = tradingMode === 'LIVE' ? 5.0 : 1.5;
      const notional = calculatedQty * currentPrice;

      if (notional < minNotional) {
        return {
          action: 'REJECT',
          decisionId,
          reasons: [`MIN_NOTIONAL_UNMET: Order value (${notional.toFixed(2)} USDT) is below exchange minimum (${minNotional} USDT).`],
          evaluatedAt: now,
          riskScore: 65,
        };
      }

      approvedQuantity = this.normalizeQuantity(symbol, calculatedQty, currentPrice);

      if (!stopLoss) {
        stopLoss = parseFloat((currentPrice - stopDistance).toFixed(4));
      }
      if (!takeProfit) {
        takeProfit = parseFloat((currentPrice + stopDistance * 2.0).toFixed(4));
      }
    } else if (signal.signal === 'SELL' && existingPosition) {
      approvedQuantity = existingPosition.quantity;
    }

    // Estimated slippage & fee
    const notionalValue = approvedQuantity * currentPrice;
    const estimatedFee = notionalValue * 0.001; // 0.1%
    const estimatedSlippageCost = notionalValue * (this.limits.maxEstimatedSlippageBps / 10_000);

    // Record rate
    if (action === 'ALLOW' || action === 'REDUCE_SIZE') {
      this.orderRateHistory.push(now);
    }

    return {
      action,
      decisionId,
      reasons: reasons.length > 0 ? reasons : ['All deterministic risk controls passed cleanly.'],
      evaluatedAt: now,
      approvedQuantity,
      calculatedStopLoss: stopLoss,
      calculatedTakeProfit: takeProfit,
      estimatedSlippageCost: parseFloat(estimatedSlippageCost.toFixed(4)),
      estimatedFee: parseFloat(estimatedFee.toFixed(4)),
      riskScore: Math.min(100, Math.max(0, riskScore)),
    };
  }

  /**
   * Normalizes quantity to standard Binance exchange step sizes avoiding floating point glitches.
   */
  public normalizeQuantity(symbol: string, rawQty: number, price: number): number {
    if (rawQty <= 0) return 0;

    // BTC precision: 5-6 decimals, ETH: 4 decimals, SOL: 2 decimals, low price: 1 decimal
    let precision = 4;
    if (symbol.startsWith('BTC')) precision = 5;
    else if (symbol.startsWith('ETH')) precision = 4;
    else if (symbol.startsWith('SOL')) precision = 2;
    else if (price < 10) precision = 1;

    const factor = Math.pow(10, precision);
    const normalized = Math.floor(rawQty * factor) / factor;
    return normalized;
  }
}

export const hardRiskEngine = HardRiskEngine.getInstance();
