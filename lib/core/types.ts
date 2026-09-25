import { z } from 'zod';

export type ExchangeType = 'nasdaq' | 'binance';
export type TradingMode = 'LOCAL_SIM' | 'BINANCE_TESTNET' | 'ALPACA_PAPER' | 'LIVE';
export type ActionType = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';

export type MarketRegime =
  | 'TREND_UP'
  | 'TREND_DOWN'
  | 'RANGE'
  | 'BREAKOUT'
  | 'HIGH_VOLATILITY'
  | 'UNSTABLE';

export type OrderLifecycleState =
  | 'CREATED'
  | 'SUBMITTING'
  | 'ACKNOWLEDGED'
  | 'NEW'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_PENDING'
  | 'CANCELED'
  | 'REJECTED'
  | 'EXPIRED';

export type RiskDecisionAction =
  | 'ALLOW'
  | 'REJECT'
  | 'REDUCE_SIZE'
  | 'PAUSE_SYSTEM';

export type EmergencyAction =
  | 'STOP_NEW_ENTRIES'
  | 'CANCEL_ALL_OPEN_ORDERS'
  | 'FLATTEN_POSITIONS';

export interface Candle {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BookTicker {
  symbol: string;
  bidPrice: number;
  bidQty: number;
  askPrice: number;
  askQty: number;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// FEATURE ENGINE TYPES
// ---------------------------------------------------------------------------
export interface PriceFeatures {
  last: number;
  return1s: number;
  return5s: number;
  return1m: number;
  return5m: number;
  high24h: number;
  low24h: number;
  change24hPct: number;
}

export interface TrendFeatures {
  ema9: number;
  ema21: number;
  ema50: number;
  emaSpread: number;
  slope: number;
  adx: number;
  trendDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
}

export interface MomentumFeatures {
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHist: number;
  roc: number;
}

export interface VolatilityFeatures {
  atr14: number;
  atrPct: number;
  realizedVol: number;
  volatilityPercentile: number;
  isHighVolatility: boolean;
}

export interface VolumeFeatures {
  volume24h: number;
  relativeVolume: number;
  volumeDelta: number;
  buySellPressure: number;
}

export interface OrderbookFeatures {
  bidPrice: number;
  askPrice: number;
  spread: number;
  spreadBps: number;
  imbalance: number; // -1.0 (all ask) to +1.0 (all bid)
  bidDepth: number;
  askDepth: number;
  topDepth: number;
  microprice: number;
  bookPressure: 'BID_DOMINANT' | 'ASK_DOMINANT' | 'BALANCED';
}

export interface MarketQualityFeatures {
  liquidityScore: number; // 0 - 100
  volatilityScore: number; // 0 - 100
  spreadQuality: number; // 0 - 100
  staleScore: number; // 0 - 100 (100 = fresh, 0 = stale)
  isStale: boolean;
  tickAgeMs: number;
}

export interface FeatureSnapshot {
  symbol: string;
  timestamp: number;
  version: string;
  price: PriceFeatures;
  trend: TrendFeatures;
  momentum: MomentumFeatures;
  volatility: VolatilityFeatures;
  volume: VolumeFeatures;
  orderbook: OrderbookFeatures;
  marketQuality: MarketQualityFeatures;
}

// ---------------------------------------------------------------------------
// QUANT SIGNAL ENGINE TYPES
// ---------------------------------------------------------------------------
export interface ScoreBreakdown {
  trendScore: number;      // 0 - 100
  momentumScore: number;   // 0 - 100
  volumeScore: number;     // 0 - 100
  liquidityScore: number;  // 0 - 100
  volatilityScore: number; // 0 - 100
  orderbookScore: number;  // 0 - 100
  totalScore: number;      // 0 - 100
}

export interface QuantSignal {
  symbol: string;
  signal: ActionType;
  score: number; // 0.0 - 1.0
  breakdown: ScoreBreakdown;
  strategy: string;
  reasons: string[];
  suggestedStopDistance: number;
  targetPrice?: number;
  stopLoss?: number;
  timestamp: number;
  featureVersion: string;
}

export interface StrategySignal {
  signal: ActionType;
  score: number;
  reasons: string[];
  targetPrice?: number;
  stopLoss?: number;
  suggestedStopDistance?: number;
}

export interface StrategyEvaluationContext {
  features: FeatureSnapshot;
  currentPosition?: Position | null;
  activeRegime?: MarketRegime;
}

export interface TradingStrategy {
  id: string;
  name: string;
  description: string;
  compatibleRegimes: MarketRegime[];
  evaluate(context: StrategyEvaluationContext): StrategySignal;
}

// ---------------------------------------------------------------------------
// JEV SUPERVISOR TYPES & ZOD SCHEMA
// ---------------------------------------------------------------------------
export const JevEvaluationSchema = z.object({
  market_regime: z.enum([
    'TREND_UP',
    'TREND_DOWN',
    'RANGE',
    'BREAKOUT',
    'HIGH_VOLATILITY',
    'UNSTABLE',
  ]),
  entry_quality: z.number().min(0).max(1),
  signal_conflict: z.number().min(0).max(1),
  liquidity_risk: z.number().min(0).max(1),
  volatility_risk: z.number().min(0).max(1),
  abnormal_market: z.number().min(0).max(1),
  confidence: z.number().min(0).max(100),
  reasoning: z.string().optional().default(''),
});

export type JevEvaluationData = z.infer<typeof JevEvaluationSchema>;

export interface JevEvaluation {
  symbol: string;
  timestamp: number;
  validUntil: number;
  regime: MarketRegime;
  entryQuality: number;     // 0.0 - 1.0
  signalConflict: number;   // 0.0 - 1.0 (low = aligned, high = conflicting indicators)
  liquidityRisk: number;    // 0.0 - 1.0
  volatilityRisk: number;   // 0.0 - 1.0
  abnormalMarket: number;   // 0.0 - 1.0 (anomalous conditions)
  modelConfidence: number;  // 0 - 100 (JEV confidence in its evaluation, NOT trade win rate)
  reasoning: string;
  isCached: boolean;
  isFallback: boolean;
}

// ---------------------------------------------------------------------------
// HARD RISK ENGINE TYPES
// ---------------------------------------------------------------------------
export interface RiskLimits {
  maxPortfolioExposurePct: number; // default 0.60 (60%)
  maxSymbolExposurePct: number;    // default 0.20 (20%)
  maxSimultaneousPositions: number; // default 3
  maxRiskPerTradePct: number;      // default 0.015 (1.5%)
  maxDailyLossPct: number;         // default 0.05 (5%)
  maxDrawdownKillSwitchPct: number;// default 0.10 (10%)
  maxConsecutiveLosses: number;    // default 3
  cooldownPeriodMs: number;        // default 30000 (30s)
  maxSpreadBps: number;            // default 25 bps
  maxEstimatedSlippageBps: number; // default 10 bps
  minLiquidity24hUsdt: number;     // default 1,000,000 USDT
  maxStaleTickAgeMs: number;       // default 10000 (10s)
  enableLiveTrading: boolean;      // strict guard: default false
}

export interface RiskEvaluationContext {
  signal: QuantSignal;
  jev?: JevEvaluation | null;
  features: FeatureSnapshot;
  portfolioEquity: number;
  cashBalance: number;
  openPositions: Position[];
  dailyRealizedPnL: number;
  maxDrawdownPct: number;
  consecutiveLosses: number;
  lastOrderTimestamps: Record<string, number>;
  tradingMode: TradingMode;
}

export interface RiskDecision {
  action: RiskDecisionAction;
  decisionId: string;
  reasons: string[];
  evaluatedAt: number;
  approvedQuantity?: number;
  calculatedStopLoss?: number;
  calculatedTakeProfit?: number;
  estimatedSlippageCost?: number;
  estimatedFee?: number;
  riskScore: number; // 0 (safe) - 100 (extreme danger)
}

// ---------------------------------------------------------------------------
// ORDER LIFECYCLE & EXECUTION ADAPTERS
// ---------------------------------------------------------------------------
export interface OrderIntent {
  decisionId: string;
  clientOrderId: string;
  strategyId: string;
  signalId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price?: number;
  orderType: 'MARKET' | 'LIMIT';
  stopLoss?: number;
  takeProfit?: number;
  trailingStopPct?: number;
  timeframe?: string;
  timestamp: number;
  source: 'MANUAL' | 'QUANT_ENGINE' | 'AI_SUPERVISOR';
}

export interface TradeOrder {
  id: string;
  clientOrderId?: string;
  decisionId?: string;
  strategyId?: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  executedQuantity?: number;
  price: number;
  averageExecutionPrice?: number;
  status: OrderLifecycleState | 'FILLED' | 'PENDING' | 'REJECTED';
  timestamp: string;
  createdAtMs?: number;
  updatedAtMs?: number;
  executedBy: 'AI' | 'MANUAL';
  exchange: ExchangeType;
  tradingMode?: TradingMode;
  notes?: string;
  fee?: number;
  slippageCost?: number;
  stopLoss?: number;
  takeProfit?: number;
  orderType?: 'MARKET' | 'LIMIT';
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPercent: number;
  side: 'long' | 'short';
  stopLoss?: number;
  takeProfit?: number;
  trailingStopTrigger?: number;
  highestPriceSinceEntry?: number;
  lowestPriceSinceEntry?: number;
  entryTimestamp?: number;
  strategyId?: string;
  decisionId?: string;
}

export interface Trade {
  id: string;
  clientOrderId: string;
  decisionId?: string;
  time: string;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  executionPrice: number;
  quantity: number;
  usdtValue: number;
  grossPnL: number;
  fee: number;
  slippageCost: number;
  netPnL: number;
  realizedPnL: number;
  source: 'MANUAL' | 'QUANT_ENGINE' | 'AI_SUPERVISOR';
  jevRegime?: MarketRegime;
  jevConfidence?: number;
  quantScore?: number;
  reasons?: string[];
}

export interface ExecutionAdapter {
  name: string;
  mode: TradingMode;
  placeOrder(intent: OrderIntent): Promise<TradeOrder>;
  cancelOrder(orderId: string, symbol: string): Promise<boolean>;
  getOrder(orderId: string, symbol: string): Promise<TradeOrder | null>;
  getOpenOrders(symbol?: string): Promise<TradeOrder[]>;
  getPositions(): Promise<Position[]>;
  getBalances(): Promise<{ cash: number; equity: number; currency: string }>;
}

// ---------------------------------------------------------------------------
// AUDIT TRACE & A/B TEST RECORD
// ---------------------------------------------------------------------------
export interface AuditDecisionRecord {
  decisionId: string;
  symbol: string;
  timestamp: number;
  timeISO: string;
  marketPrice: number;
  features: FeatureSnapshot;
  quantSignal: QuantSignal;
  jevEvaluation?: JevEvaluation | null;
  riskDecision: RiskDecision;
  orderIntent?: OrderIntent | null;
  orderResult?: TradeOrder | null;
  tradeOutcome?: {
    exitPrice?: number;
    realizedPnL?: number;
    durationMs?: number;
  };
}

export interface ABTestComparison {
  totalSignals: number;
  pathAQuantOnlyTrades: number;
  pathAWinRate: number;
  pathANetPnL: number;
  pathAMaxDrawdown: number;
  pathBQuantJevTrades: number;
  pathBWinRate: number;
  pathBNetPnL: number;
  pathBMaxDrawdown: number;
  jevVetoedCount: number;
  jevVetoedHypotheticalPnL: number;
  jevAlphaScore: number; // positive = JEV saved capital, negative = JEV blocked winners
}

// ---------------------------------------------------------------------------
// ENGINE HEALTH & METRICS
// ---------------------------------------------------------------------------
export type MarketConnectionState =
  | 'DISCONNECTED'
  | 'CONNECTING'
  | 'SYNCING'
  | 'READY'
  | 'DEGRADED'
  | 'RECONNECTING';

export interface MarketDataHealthMetrics {
  connectionState: MarketConnectionState;
  reconnectCount: number;
  lastTickAgeMs: number;
  tickRatePerSec: number;
  wsLatencyMs: number;
  subscribedSymbols: string[];
  droppedEvents: number;
  queueSize: number;
}

export interface EngineHealthReport {
  timestamp: string;
  tradingMode: TradingMode;
  liveTradingEnabled: boolean;
  marketData: MarketDataHealthMetrics;
  workerUptimeSec: number;
  activePositionsCount: number;
  pendingOrdersCount: number;
  dailyRealizedPnL: number;
  currentDrawdownPct: number;
  circuitBreakerActive: boolean;
  circuitBreakerReason?: string;
  jevSupervisorStatus: 'HEALTHY' | 'DEGRADED' | 'DISABLED';
  jevSupervisorLatencyMs: number;
  subsystems: {
    binanceWs: { status: 'OK' | 'ERROR' | 'DEGRADED'; message: string };
    alpaca: { status: 'OK' | 'ERROR' | 'UNCONFIGURED'; message: string };
    jev: { status: 'OK' | 'ERROR' | 'DEGRADED'; message: string };
    riskEngine: { status: 'OK' | 'PAUSED'; message: string };
  };
}
