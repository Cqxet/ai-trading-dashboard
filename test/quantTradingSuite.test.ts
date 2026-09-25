import test from 'node:test';
import assert from 'node:assert/strict';

// Import FeatureEngine directly from lib/core
import { FeatureEngine } from '../lib/core/featureEngine';
import { QuantSignalEngine } from '../lib/core/quantSignalEngine';
import { StrategyRegistry, MomentumBreakoutStrategy, TrendFollowingStrategy, MeanReversionStrategy } from '../lib/core/strategyRegistry';
import { JevMarketSupervisor } from '../lib/core/jevSupervisor';
import { HardRiskEngine } from '../lib/core/hardRiskEngine';
import { PositionManager } from '../lib/core/positionManager';
import { LocalPaperExecutionAdapter } from '../lib/core/executionEngine';
import { EventStore } from '../lib/core/eventStore';
import { JevEvaluationSchema } from '../lib/core/types';

test('1. Feature Engine - Indicator & Microstructure Calculation', (t) => {
  const engine = new FeatureEngine();

  // Test EMA calculation
  const values = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
  const ema9 = engine.calculateEMA(values, 9);
  assert.ok(ema9 > 15 && ema9 <= 20, `EMA9 should be close to recent prices, got ${ema9}`);

  // Test RSI calculation
  const steadyUp = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
  const rsiBull = engine.calculateRSI(steadyUp, 14);
  assert.ok(rsiBull >= 80, `Steadily rising prices should yield high RSI, got ${rsiBull}`);

  const steadyDown = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10];
  const rsiBear = engine.calculateRSI(steadyDown, 14);
  assert.ok(rsiBear <= 20, `Steadily falling prices should yield low RSI, got ${rsiBear}`);

  // Test Orderbook features
  const bookTicker = {
    symbol: 'BTCUSDT',
    bidPrice: 65000.0,
    bidQty: 10.0,
    askPrice: 65002.0,
    askQty: 5.0,
    timestamp: Date.now(),
  };

  const dummyCandles = [
    { timestamp: Date.now() - 60000, time: '12:00', open: 64900, high: 65050, low: 64880, close: 65000, volume: 15.5 },
  ];

  const features = engine.computeFeatures('BTCUSDT', dummyCandles, bookTicker);
  assert.equal(features.symbol, 'BTCUSDT');
  assert.ok(features.orderbook.spread > 0, 'Spread should be positive');
  assert.ok(features.orderbook.imbalance > 0, 'Bid depth > ask depth should yield positive imbalance');
  assert.ok(features.orderbook.bookPressure === 'BID_DOMINANT');
});

test('2. Quant Signal Engine - 6 Pillar Score Breakdown', (t) => {
  const engine = new FeatureEngine();
  const dummyCandles = [];
  let p = 60000;
  const now = Date.now();
  for (let i = 0; i < 30; i++) {
    p += 25;
    dummyCandles.push({
      timestamp: now - (29 - i) * 1000, // recent fresh ticks
      time: `12:${i < 10 ? '0' + i : i}`,
      open: p - 10,
      high: p + 15,
      low: p - 12,
      close: p,
      volume: 10 + i * 2,
    });
  }

  const bookTicker = {
    symbol: 'BTCUSDT',
    bidPrice: p - 1,
    bidQty: 25.0,
    askPrice: p + 1,
    askQty: 8.0,
    timestamp: Date.now(),
  };

  const features = engine.computeFeatures('BTCUSDT', dummyCandles, bookTicker, {
    high24h: p + 200,
    low24h: p - 500,
    change24hPct: 3.5,
    volume24h: 5_000_000,
  });

  const signalEngine = new QuantSignalEngine();
  const signal = signalEngine.evaluate(features, 'momentum_breakout');

  assert.equal(signal.symbol, 'BTCUSDT');
  assert.ok(['BUY', 'HOLD'].includes(signal.signal));
  assert.ok(signal.breakdown.totalScore > 0 && signal.breakdown.totalScore <= 100);
  assert.ok(signal.breakdown.trendScore >= 0);
  assert.ok(signal.breakdown.momentumScore >= 0);
  assert.ok(signal.breakdown.volumeScore >= 0);
  assert.ok(signal.breakdown.liquidityScore >= 0);
  assert.ok(signal.breakdown.volatilityScore >= 0);
  assert.ok(signal.breakdown.orderbookScore >= 0);
  assert.ok(signal.reasons.length > 0);
});

test('3. JEV Supervisor - Zod Schema Validation & Deterministic Fallback', (t) => {
  // Test valid schema
  const validData = {
    market_regime: 'TREND_UP',
    entry_quality: 0.82,
    signal_conflict: 0.15,
    liquidity_risk: 0.10,
    volatility_risk: 0.25,
    abnormal_market: 0.05,
    confidence: 88,
    reasoning: 'Clear trend alignment with strong book depth',
  };

  const parseResult = JevEvaluationSchema.safeParse(validData);
  assert.ok(parseResult.success, 'Valid JEV payload must pass Zod schema');

  // Test invalid schema rejection
  const invalidData = {
    market_regime: 'INVALID_REGIME',
    entry_quality: 1.5, // out of range
  };
  const invalidResult = JevEvaluationSchema.safeParse(invalidData);
  assert.ok(!invalidResult.success, 'Invalid JEV payload must be rejected');

  // Test deterministic fallback computation
  const supervisor = new JevMarketSupervisor();
  const engine = new FeatureEngine();
  const dummyCandles = [
    { timestamp: Date.now() - 60000, time: '12:00', open: 65000, high: 65100, low: 64950, close: 65050, volume: 10 },
  ];
  const features = engine.computeFeatures('BTCUSDT', dummyCandles, null);
  const fallback = supervisor.computeDeterministicFallback(features, null);

  assert.equal(fallback.symbol, 'BTCUSDT');
  assert.ok(fallback.entryQuality >= 0 && fallback.entryQuality <= 1.0);
  assert.ok(fallback.isFallback, 'Must be marked as fallback');
});

test('4. Hard Risk Engine - Deterministic Non-Bypassable Gates', (t) => {
  const riskEngine = new HardRiskEngine({
    maxSpreadBps: 20,
    maxStaleTickAgeMs: 5000,
    enableLiveTrading: false,
  });

  const dummyFeatures = {
    symbol: 'BTCUSDT',
    timestamp: Date.now(),
    version: '2.0.0',
    price: { last: 65000, return1s: 0, return5s: 0, return1m: 0, return5m: 0, high24h: 66000, low24h: 64000, change24hPct: 1.5 },
    trend: { ema9: 65010, ema21: 64980, ema50: 64900, emaSpread: 0.1, slope: 0.05, adx: 28, trendDirection: 'BULLISH' },
    momentum: { rsi14: 62, macd: 5.2, macdSignal: 4.1, macdHist: 1.1, roc: 0.8 },
    volatility: { atr14: 120, atrPct: 0.18, realizedVol: 0.2, volatilityPercentile: 30, isHighVolatility: false },
    volume: { volume24h: 10_000_000, relativeVolume: 1.4, volumeDelta: 50, buySellPressure: 0.6 },
    orderbook: { bidPrice: 64999, askPrice: 65001, spread: 2, spreadBps: 3.0, imbalance: 0.2, bidDepth: 10, askDepth: 8, topDepth: 18, microprice: 65000, bookPressure: 'BALANCED' },
    marketQuality: { liquidityScore: 90, volatilityScore: 85, spreadQuality: 92, staleScore: 95, isStale: false, tickAgeMs: 150 },
  };

  const dummySignal = {
    symbol: 'BTCUSDT',
    signal: 'BUY',
    score: 0.82,
    breakdown: { trendScore: 85, momentumScore: 80, volumeScore: 80, liquidityScore: 90, volatilityScore: 80, orderbookScore: 75, totalScore: 82 },
    strategy: 'momentum_breakout',
    reasons: ['EMA bullish'],
    suggestedStopDistance: 250,
    timestamp: Date.now(),
    featureVersion: '2.0.0',
  };

  // Case A: LIVE Trading Blocked when enableLiveTrading=false
  const liveDecision = riskEngine.evaluate({
    signal: dummySignal,
    features: dummyFeatures,
    portfolioEquity: 10.0,
    cashBalance: 10.0,
    openPositions: [],
    dailyRealizedPnL: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    lastOrderTimestamps: {},
    tradingMode: 'LIVE',
  });
  assert.equal(liveDecision.action, 'PAUSE_SYSTEM');
  assert.ok(liveDecision.reasons[0].includes('LIVE_TRADING_DISABLED'));

  // Case B: Stale Market Data Rejection
  const staleFeatures = {
    ...dummyFeatures,
    marketQuality: { ...dummyFeatures.marketQuality, isStale: true, tickAgeMs: 12000 },
  };
  const staleDecision = riskEngine.evaluate({
    signal: dummySignal,
    features: staleFeatures,
    portfolioEquity: 10.0,
    cashBalance: 10.0,
    openPositions: [],
    dailyRealizedPnL: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    lastOrderTimestamps: {},
    tradingMode: 'LOCAL_SIM',
  });
  assert.equal(staleDecision.action, 'REJECT');
  assert.ok(staleDecision.reasons.some((r) => r.includes('STALE_DATA')));

  // Case C: Wide Spread Rejection
  const wideSpreadFeatures = {
    ...dummyFeatures,
    orderbook: { ...dummyFeatures.orderbook, spreadBps: 45 },
  };
  const wideDecision = riskEngine.evaluate({
    signal: dummySignal,
    features: wideSpreadFeatures,
    portfolioEquity: 10.0,
    cashBalance: 10.0,
    openPositions: [],
    dailyRealizedPnL: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    lastOrderTimestamps: {},
    tradingMode: 'LOCAL_SIM',
  });
  assert.equal(wideDecision.action, 'REJECT');
  assert.ok(wideDecision.reasons.some((r) => r.includes('SPREAD_TOO_WIDE')));

  // Case D: Valid Clean Setup Approves with Position Sizing
  const cleanDecision = riskEngine.evaluate({
    signal: dummySignal,
    features: dummyFeatures,
    portfolioEquity: 100.0,
    cashBalance: 100.0,
    openPositions: [],
    dailyRealizedPnL: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    lastOrderTimestamps: {},
    tradingMode: 'LOCAL_SIM',
  });
  assert.equal(cleanDecision.action, 'ALLOW');
  assert.ok(cleanDecision.approvedQuantity > 0);
  assert.ok(cleanDecision.calculatedStopLoss < dummyFeatures.price.last);
});

test('5. Position Manager & Execution Adapter - P&L, Slippage & Stop Loss', async (t) => {
  const posManager = PositionManager.getInstance();
  posManager.init(100.0);

  const adapter = new LocalPaperExecutionAdapter();

  // Place BUY Order
  const buyIntent = {
    decisionId: 'dec_1',
    clientOrderId: 'ord_buy_1',
    strategyId: 'momentum',
    signalId: 'sig_1',
    symbol: 'BTCUSDT',
    side: 'BUY',
    quantity: 0.001,
    price: 60000.0,
    orderType: 'MARKET',
    stopLoss: 59000.0,
    takeProfit: 62000.0,
    timestamp: Date.now(),
    source: 'QUANT_ENGINE',
  };

  const buyOrder = await adapter.placeOrder(buyIntent);
  assert.equal(buyOrder.status, 'FILLED');
  assert.ok(buyOrder.slippageCost >= 0);
  assert.ok(buyOrder.fee > 0);

  // Check Position
  const pos = posManager.getPosition('BTCUSDT');
  assert.ok(pos !== undefined);
  assert.equal(pos.symbol, 'BTCUSDT');
  assert.equal(pos.quantity, 0.001);

  // Check Tick Exit: Price falls to Stop Loss (58500 <= 59000)
  const exitCheck = posManager.checkTickExits('BTCUSDT', 58500.0);
  assert.ok(exitCheck !== null);
  assert.equal(exitCheck.shouldExit, true);
  assert.equal(exitCheck.side, 'SELL');
  assert.ok(exitCheck.reason.includes('STOP_LOSS_TRIGGERED'));
});

test('6. Event Store - Decision Audit Trace & A/B Shadow Comparison', (t) => {
  const store = new EventStore();

  const dummyFeatures = {
    symbol: 'ETHUSDT',
    timestamp: Date.now(),
    version: '2.0.0',
    price: { last: 3500 },
  };

  const dummySignal = {
    symbol: 'ETHUSDT',
    signal: 'BUY',
    score: 0.78,
    breakdown: { totalScore: 78 },
    strategy: 'trend_following',
    reasons: ['EMA stack'],
    timestamp: Date.now(),
  };

  const dummyRisk = {
    action: 'ALLOW',
    decisionId: 'dec_eth_101',
    reasons: ['Clean risk'],
    riskScore: 20,
    evaluatedAt: Date.now(),
  };

  store.recordAudit('dec_eth_101', 'ETHUSDT', dummyFeatures, dummySignal, dummyRisk, null, null);

  const retrieved = store.getAuditRecord('dec_eth_101');
  assert.ok(retrieved !== undefined);
  assert.equal(retrieved.decisionId, 'dec_eth_101');
  assert.equal(retrieved.symbol, 'ETHUSDT');
  assert.equal(retrieved.riskDecision.action, 'ALLOW');

  const abComparison = store.getABTestComparison();
  assert.ok(abComparison.totalSignals >= 1);
  assert.ok(abComparison.pathAWinRate > 0);
  assert.ok(abComparison.pathBWinRate >= 0);
});

test('7. Chaos & Failure - Emergency Stop & Flatten Positions', async (t) => {
  const posManager = PositionManager.getInstance();
  posManager.init(50.0);

  const adapter = new LocalPaperExecutionAdapter();
  await adapter.placeOrder({
    decisionId: 'chaos_1',
    clientOrderId: 'chaos_pos_1',
    strategyId: 'momentum',
    signalId: 'sig_1',
    symbol: 'ETHUSDT',
    side: 'BUY',
    quantity: 0.01,
    price: 3500.0,
    orderType: 'MARKET',
    timestamp: Date.now(),
    source: 'QUANT_ENGINE',
  });

  assert.equal(posManager.getPositions().length, 1);

  // Trigger emergency flatten
  const { tradingWorker } = await import('../lib/core/tradingWorker');
  const flattenResult = await tradingWorker.handleEmergencyAction('FLATTEN_POSITIONS', true);
  assert.equal(flattenResult.success, true);
  assert.ok(flattenResult.message.includes('Emergency flatten complete'));
  assert.equal(posManager.getPositions().length, 0);
});

test('8. Chaos & Failure - Order Rate Limiter & Cooldown Guard', (t) => {
  const riskEngine = new HardRiskEngine({
    cooldownPeriodMs: 30000,
  });

  const dummyFeatures = {
    symbol: 'SOLUSDT',
    timestamp: Date.now(),
    version: '2.0.0',
    price: { last: 150 },
    trend: { ema9: 150, ema21: 149, ema50: 145, slope: 0.1, adx: 25, trendDirection: 'BULLISH' },
    momentum: { rsi14: 55, macdHist: 0.5 },
    volatility: { atr14: 3, atrPct: 2.0 },
    volume: { volume24h: 5_000_000, relativeVolume: 1.5 },
    orderbook: { spreadBps: 5, imbalance: 0.1 },
    marketQuality: { liquidityScore: 85, volatilityScore: 80, isStale: false, tickAgeMs: 50 },
  };

  const dummySignal = {
    symbol: 'SOLUSDT',
    signal: 'BUY',
    score: 0.8,
    breakdown: { totalScore: 80 },
    strategy: 'momentum_breakout',
    reasons: ['Edge detected'],
    suggestedStopDistance: 3,
    timestamp: Date.now(),
    featureVersion: '2.0.0',
  };

  // Cooldown test: Last order happened 5 seconds ago
  const decisionCooldown = riskEngine.evaluate({
    signal: dummySignal,
    features: dummyFeatures,
    portfolioEquity: 100.0,
    cashBalance: 100.0,
    openPositions: [],
    dailyRealizedPnL: 0,
    maxDrawdownPct: 0,
    consecutiveLosses: 0,
    lastOrderTimestamps: { SOLUSDT: Date.now() - 5000 },
    tradingMode: 'LOCAL_SIM',
  });

  assert.equal(decisionCooldown.action, 'REJECT');
  assert.ok(decisionCooldown.reasons[0].includes('SYMBOL_COOLDOWN'));
});
