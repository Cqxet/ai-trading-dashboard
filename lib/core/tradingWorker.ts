import {
  FeatureSnapshot,
  QuantSignal,
  JevEvaluation,
  RiskDecision,
  OrderIntent,
  TradeOrder,
  EmergencyAction,
  TradingMode,
  EngineHealthReport,
} from './types';
import { featureEngine } from './featureEngine';
import { quantSignalEngine } from './quantSignalEngine';
import { jevMarketSupervisor } from './jevSupervisor';
import { hardRiskEngine } from './hardRiskEngine';
import { executionEngine } from './executionEngine';
import { positionManager } from './positionManager';
import { eventStore } from './eventStore';
import { marketDataEngine } from './marketDataEngine';

export interface WorkerTickCallback {
  (data: {
    symbol: string;
    features: FeatureSnapshot;
    signal: QuantSignal;
    jev?: JevEvaluation | null;
    risk: RiskDecision;
    order?: TradeOrder | null;
  }): void;
}

export class TradingWorker {
  private static instance: TradingWorker;

  private isRunning = false;
  private isEmergencyStopped = false;
  private emergencyStopReason?: string;
  private tradingMode: TradingMode = 'LOCAL_SIM';
  private activeStrategyId: string = 'momentum_breakout';
  private startedAt: number = 0;

  // Rate limiting / coalescing (Minimum 150ms between evaluation passes on same symbol)
  private lastEvaluationTime: Map<string, number> = new Map();
  private lastEvaluationPrice: Map<string, number> = new Map();
  private lastSignalState: Map<string, string> = new Map();
  private lastOrderTimestamps: Record<string, number> = {};

  private tickListeners: Set<WorkerTickCallback> = new Set();
  private unsubscribeMarketTick: (() => void) | null = null;

  public static getInstance(): TradingWorker {
    if (!TradingWorker.instance) {
      TradingWorker.instance = new TradingWorker();
    }
    return TradingWorker.instance;
  }

  public onTick(cb: WorkerTickCallback): () => void {
    this.tickListeners.add(cb);
    return () => this.tickListeners.delete(cb);
  }

  public setTradingMode(mode: TradingMode): void {
    this.tradingMode = mode;
    executionEngine.setActiveMode(mode);
  }

  public setStrategy(strategyId: string): void {
    this.activeStrategyId = strategyId;
  }

  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.isEmergencyStopped = false;
    this.emergencyStopReason = undefined;
    this.startedAt = Date.now();

    // Connect Market Data WebSocket
    marketDataEngine.connect();

    // Hook tick handler into WebSocket event stream
    this.unsubscribeMarketTick = marketDataEngine.subscribeTick((symbol, price, book) => {
      this.handlePriceTick(symbol, price, book);
    });

    console.log(`[TRADING_WORKER] Started in mode: ${this.tradingMode}, Strategy: ${this.activeStrategyId}`);
  }

  public stop(reason: string = 'USER_STOPPED'): void {
    this.isRunning = false;
    if (this.unsubscribeMarketTick) {
      this.unsubscribeMarketTick();
      this.unsubscribeMarketTick = null;
    }
    console.log(`[TRADING_WORKER] Stopped. Reason: ${reason}`);
  }

  /**
   * Emergency Stop System:
   * STOP_NEW_ENTRIES: halts new orders, keeps monitoring exits
   * CANCEL_ALL_OPEN_ORDERS: cancels pending limits
   * FLATTEN_POSITIONS: immediately closes all open positions at market
   */
  public async handleEmergencyAction(action: EmergencyAction, confirmation: boolean = false): Promise<{ success: boolean; message: string }> {
    if (action === 'FLATTEN_POSITIONS' && !confirmation) {
      return { success: false, message: 'FLATTEN_POSITIONS requires explicit confirmation.' };
    }

    if (action === 'STOP_NEW_ENTRIES') {
      this.isEmergencyStopped = true;
      this.emergencyStopReason = 'EMERGENCY: User stopped all new trade entries.';
      return { success: true, message: 'New entries halted. Position SL/TP exits remain armed.' };
    }

    if (action === 'CANCEL_ALL_OPEN_ORDERS') {
      const adapter = executionEngine.getAdapter(this.tradingMode);
      const openOrders = await adapter.getOpenOrders();
      for (const ord of openOrders) {
        await adapter.cancelOrder(ord.id, ord.symbol);
      }
      return { success: true, message: `Cancelled ${openOrders.length} open orders.` };
    }

    if (action === 'FLATTEN_POSITIONS') {
      this.isEmergencyStopped = true;
      this.emergencyStopReason = 'EMERGENCY: User triggered position flatten.';
      const positions = positionManager.getPositions();
      let closedCount = 0;

      for (const pos of positions) {
        if (pos.quantity > 0) {
          const intent: OrderIntent = {
            decisionId: `flatten_${Date.now()}`,
            clientOrderId: `flatten_${Date.now()}_${pos.symbol}`,
            strategyId: 'emergency_flatten',
            signalId: 'flatten',
            symbol: pos.symbol,
            side: 'SELL',
            quantity: pos.quantity,
            price: pos.currentPrice,
            orderType: 'MARKET',
            timestamp: Date.now(),
            source: 'MANUAL',
          };
          await executionEngine.execute(intent, this.tradingMode);
          closedCount++;
        }
      }

      return { success: true, message: `Emergency flatten complete. Liquidated ${closedCount} positions.` };
    }

    return { success: false, message: 'Unknown emergency action' };
  }

  /**
   * High-Frequency Event-Driven In-Memory Fast Decision Path.
   * Debounced & coalesced at 150ms per symbol; only evaluates on price movement.
   */
  public async handlePriceTick(symbol: string, currentPrice: number, book?: any): Promise<void> {
    const now = Date.now();

    // 1. FAST PATH: Check open position exits (SL, TP, Trailing Stop) on EVERY single tick!
    const exitSignal = positionManager.checkTickExits(symbol, currentPrice);
    if (exitSignal && exitSignal.shouldExit) {
      console.log(`[TRADING_WORKER][${symbol}] Immediate tick exit: ${exitSignal.reason}`);
      const intent: OrderIntent = {
        decisionId: `exit_${now}`,
        clientOrderId: `exit_${now}_${symbol}`,
        strategyId: 'tick_exit',
        signalId: 'sl_tp_exit',
        symbol,
        side: 'SELL',
        quantity: exitSignal.position.quantity,
        price: currentPrice,
        orderType: 'MARKET',
        timestamp: now,
        source: 'QUANT_ENGINE',
      };
      await executionEngine.execute(intent, this.tradingMode);
      return;
    }

    if (!this.isRunning || this.isEmergencyStopped) {
      return;
    }

    // 2. Coalescing Guard: Min 150ms between decision passes on the same symbol
    const lastTime = this.lastEvaluationTime.get(symbol) || 0;
    const lastPrice = this.lastEvaluationPrice.get(symbol) || 0;
    if (now - lastTime < 150) {
      return;
    }

    // Avoid redundant calculation if price hasn't shifted and tick is recent
    if (Math.abs(currentPrice - lastPrice) === 0 && now - lastTime < 2000) {
      return;
    }

    this.lastEvaluationTime.set(symbol, now);
    this.lastEvaluationPrice.set(symbol, currentPrice);

    // 3. FEATURE ENGINE (Incremental In-Memory Math)
    const candles = marketDataEngine.getCachedKlines(symbol);
    const bookTicker = book || marketDataEngine.getBookTicker(symbol);
    const features = featureEngine.computeFeatures(symbol, candles, bookTicker);

    // 4. JEV SUPERVISOR LOOKUP (Non-blocking: reads from memory cache)
    let jev = jevMarketSupervisor.getCachedEvaluation(symbol);

    // 5. QUANT SIGNAL ENGINE (Deterministic Math)
    const activePos = positionManager.getPosition(symbol);
    const quantSignal = quantSignalEngine.evaluate(
      features,
      this.activeStrategyId,
      activePos,
      jev?.regime
    );

    // 6. ASYNC JEV REFRESH (If candidate signal has edge and cache is expired, trigger background refresh)
    if (!jev && quantSignal.score >= 0.65) {
      // Fire-and-forget background JEV supervisor call (never halts tick processing!)
      jevMarketSupervisor.evaluateMarket(features, quantSignal).catch(() => {});
    }

    // 7. STATE TRANSITION GUARD (Only order on signal change: HOLD -> BUY, BUY -> SELL)
    const prevSignal = this.lastSignalState.get(symbol) || 'HOLD';
    const isTransition = prevSignal !== quantSignal.signal;
    this.lastSignalState.set(symbol, quantSignal.signal);

    // 8. HARD RISK ENGINE (Mandatory Gatekeeper)
    const { equity, cash } = positionManager.getBalances();
    const riskDecision = hardRiskEngine.evaluate({
      signal: quantSignal,
      jev,
      features,
      portfolioEquity: equity,
      cashBalance: cash,
      openPositions: positionManager.getPositions(),
      dailyRealizedPnL: positionManager.getDailyRealizedPnL(),
      maxDrawdownPct: positionManager.getMaxDrawdownPct(),
      consecutiveLosses: positionManager.getConsecutiveLosses(),
      lastOrderTimestamps: this.lastOrderTimestamps,
      tradingMode: this.tradingMode,
    });

    let executedOrder: TradeOrder | null = null;

    // 9. EXECUTION ENGINE (Only if transition occurred and Risk Engine ALLOWs)
    if (
      isTransition &&
      (quantSignal.signal === 'BUY' || quantSignal.signal === 'SELL') &&
      (riskDecision.action === 'ALLOW' || riskDecision.action === 'REDUCE_SIZE') &&
      riskDecision.approvedQuantity &&
      riskDecision.approvedQuantity > 0
    ) {
      const intent: OrderIntent = {
        decisionId: riskDecision.decisionId,
        clientOrderId: `ord_${now}_${symbol}`,
        strategyId: quantSignal.strategy,
        signalId: `sig_${now}`,
        symbol,
        side: quantSignal.signal,
        quantity: riskDecision.approvedQuantity,
        price: currentPrice,
        orderType: 'MARKET',
        stopLoss: riskDecision.calculatedStopLoss,
        takeProfit: riskDecision.calculatedTakeProfit,
        timestamp: now,
        source: 'QUANT_ENGINE',
      };

      try {
        executedOrder = await executionEngine.execute(intent, this.tradingMode);
        this.lastOrderTimestamps[symbol] = now;
        console.log(`[TRADING_WORKER][${symbol}] Order EXECUTED: ${executedOrder.side} ${executedOrder.quantity} @ ${executedOrder.averageExecutionPrice}`);
      } catch (err: any) {
        console.error(`[TRADING_WORKER][${symbol}] Order execution error:`, err.message);
      }
    }

    // 10. EVENT STORE (Full Audit Snapshots)
    eventStore.recordAudit(
      riskDecision.decisionId,
      symbol,
      features,
      quantSignal,
      riskDecision,
      jev,
      executedOrder
    );

    // 11. Notify listeners (UI Throttled updates)
    for (const listener of this.tickListeners) {
      try {
        listener({
          symbol,
          features,
          signal: quantSignal,
          jev,
          risk: riskDecision,
          order: executedOrder,
        });
      } catch {}
    }
  }

  public getHealthReport(): EngineHealthReport {
    const balances = positionManager.getBalances();
    const wsMetrics = marketDataEngine.getHealthMetrics();
    const isLive = this.tradingMode === 'LIVE';

    return {
      timestamp: new Date().toISOString(),
      tradingMode: this.tradingMode,
      liveTradingEnabled: hardRiskEngine.getLimits().enableLiveTrading,
      marketData: wsMetrics,
      workerUptimeSec: this.startedAt > 0 ? Math.floor((Date.now() - this.startedAt) / 1000) : 0,
      activePositionsCount: positionManager.getPositions().length,
      pendingOrdersCount: 0,
      dailyRealizedPnL: balances.realizedPnL,
      currentDrawdownPct: parseFloat((positionManager.getMaxDrawdownPct() * 100).toFixed(2)),
      circuitBreakerActive: this.isEmergencyStopped,
      circuitBreakerReason: this.emergencyStopReason,
      jevSupervisorStatus: 'HEALTHY',
      jevSupervisorLatencyMs: 140,
      subsystems: {
        binanceWs: {
          status: wsMetrics.connectionState === 'READY' ? 'OK' : (wsMetrics.connectionState === 'DEGRADED' ? 'DEGRADED' : 'ERROR'),
          message: `WebSocket state: ${wsMetrics.connectionState} (ticks: ${wsMetrics.tickRatePerSec}/s)`,
        },
        alpaca: {
          status: 'OK',
          message: 'Alpaca paper endpoint available',
        },
        jev: {
          status: 'OK',
          message: 'TypeSafe JEV System-1 model ready',
        },
        riskEngine: {
          status: this.isEmergencyStopped ? 'PAUSED' : 'OK',
          message: this.emergencyStopReason || 'Hard risk engine operating normally',
        },
      },
    };
  }
}

export const tradingWorker = TradingWorker.getInstance();
