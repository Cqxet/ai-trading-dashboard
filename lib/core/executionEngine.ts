import {
  OrderIntent,
  TradeOrder,
  Position,
  ExecutionAdapter,
  TradingMode,
  OrderLifecycleState,
} from './types';
import { positionManager } from './positionManager';

export class LocalPaperExecutionAdapter implements ExecutionAdapter {
  public name = 'Local Paper Execution Simulator';
  public mode: TradingMode = 'LOCAL_SIM';

  private orders: Map<string, TradeOrder> = new Map();
  private slippageRate = 0.00025; // 0.025% realistic slippage
  private feeRate = 0.001;        // 0.1% exchange fee

  public async placeOrder(intent: OrderIntent): Promise<TradeOrder> {
    const now = Date.now();
    const clientOrderId = intent.clientOrderId || `ord_${now}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Idempotency Check
    if (this.orders.has(clientOrderId)) {
      return this.orders.get(clientOrderId)!;
    }

    // 2. Realistic Price Simulation (Spread & Slippage applied)
    const basePrice = intent.price || 1.0;
    const slippageMultiplier = intent.side === 'BUY'
      ? (1 + this.slippageRate)
      : (1 - this.slippageRate);

    const execPrice = parseFloat((basePrice * slippageMultiplier).toFixed(4));
    const notional = intent.quantity * execPrice;
    const fee = parseFloat((notional * this.feeRate).toFixed(4));
    const slippageCost = parseFloat((Math.abs(execPrice - basePrice) * intent.quantity).toFixed(4));

    const order: TradeOrder = {
      id: clientOrderId,
      clientOrderId,
      decisionId: intent.decisionId,
      strategyId: intent.strategyId,
      symbol: intent.symbol.toUpperCase(),
      side: intent.side,
      quantity: intent.quantity,
      executedQuantity: intent.quantity,
      price: basePrice,
      averageExecutionPrice: execPrice,
      status: 'FILLED',
      timestamp: new Date().toLocaleTimeString(),
      createdAtMs: now,
      updatedAtMs: now,
      executedBy: intent.source === 'MANUAL' ? 'MANUAL' : 'AI',
      exchange: 'binance',
      tradingMode: 'LOCAL_SIM',
      fee,
      slippageCost,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
      notes: `Paper simulated fill @ ${execPrice} (slippage: ${(this.slippageRate * 100).toFixed(3)}%, fee: ${(this.feeRate * 100).toFixed(2)}%)`,
    };

    this.orders.set(clientOrderId, order);

    // Apply to Position Manager
    positionManager.applyExecutedOrder(order);

    return order;
  }

  public async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    const order = this.orders.get(orderId);
    if (order && (order.status === 'NEW' || order.status === 'PARTIALLY_FILLED')) {
      order.status = 'CANCELED';
      order.updatedAtMs = Date.now();
      return true;
    }
    return false;
  }

  public async getOrder(orderId: string, symbol: string): Promise<TradeOrder | null> {
    return this.orders.get(orderId) || null;
  }

  public async getOpenOrders(symbol?: string): Promise<TradeOrder[]> {
    const all = Array.from(this.orders.values());
    return all.filter((o) => o.status === 'NEW' || o.status === 'PARTIALLY_FILLED');
  }

  public async getPositions(): Promise<Position[]> {
    return positionManager.getPositions();
  }

  public async getBalances(): Promise<{ cash: number; equity: number; currency: string }> {
    const balances = positionManager.getBalances();
    return {
      cash: balances.cash,
      equity: balances.equity,
      currency: 'USDT',
    };
  }
}

export class BinanceSpotExecutionAdapter implements ExecutionAdapter {
  public name = 'Binance Spot Execution Adapter';
  public mode: TradingMode;

  private apiKey?: string;
  private apiSecret?: string;
  private isLive: boolean;

  constructor(apiKey?: string, apiSecret?: string, isLive: boolean = false) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.isLive = isLive;
    this.mode = isLive ? 'LIVE' : 'BINANCE_TESTNET';
  }

  public async placeOrder(intent: OrderIntent): Promise<TradeOrder> {
    if (this.isLive && process.env.ENABLE_LIVE_TRADING !== 'true') {
      throw new Error('HARD_SAFETY_LOCKOUT: Live trading is strictly disabled (ENABLE_LIVE_TRADING !== true).');
    }

    // Call server-side Binance execution endpoint
    const res = await fetch('/api/binance/trade', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-binance-key': this.apiKey } : {}),
        ...(this.apiSecret ? { 'x-binance-secret': this.apiSecret } : {}),
      },
      body: JSON.stringify({
        symbol: intent.symbol,
        side: intent.side,
        quantity: intent.quantity,
        executedBy: intent.source === 'MANUAL' ? 'MANUAL' : 'AI',
        clientOrderId: intent.clientOrderId,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Binance order placement failed [HTTP ${res.status}]`);
    }

    const data = await res.json();
    return {
      id: data.id || intent.clientOrderId,
      clientOrderId: intent.clientOrderId,
      decisionId: intent.decisionId,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      side: intent.side,
      quantity: intent.quantity,
      executedQuantity: data.quantity || intent.quantity,
      price: data.price || intent.price || 0,
      averageExecutionPrice: data.price || intent.price,
      status: (data.status as OrderLifecycleState) || 'FILLED',
      timestamp: new Date().toLocaleTimeString(),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      executedBy: intent.source === 'MANUAL' ? 'MANUAL' : 'AI',
      exchange: 'binance',
      tradingMode: this.mode,
      fee: data.fee || (data.price * intent.quantity * 0.001),
      slippageCost: 0,
      stopLoss: intent.stopLoss,
      takeProfit: intent.takeProfit,
    };
  }

  public async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    return true;
  }

  public async getOrder(orderId: string, symbol: string): Promise<TradeOrder | null> {
    return null;
  }

  public async getOpenOrders(symbol?: string): Promise<TradeOrder[]> {
    return [];
  }

  public async getPositions(): Promise<Position[]> {
    return positionManager.getPositions();
  }

  public async getBalances(): Promise<{ cash: number; equity: number; currency: string }> {
    const res = await fetch('/api/binance/account', {
      headers: {
        ...(this.apiKey ? { 'x-binance-key': this.apiKey } : {}),
        ...(this.apiSecret ? { 'x-binance-secret': this.apiSecret } : {}),
      },
    });
    if (res.ok) {
      const acc = await res.json();
      return {
        cash: acc.cash || 0,
        equity: acc.equity || 0,
        currency: 'USDT',
      };
    }
    return { cash: 0, equity: 0, currency: 'USDT' };
  }
}

export class AlpacaExecutionAdapter implements ExecutionAdapter {
  public name = 'Alpaca Paper Execution Adapter';
  public mode: TradingMode = 'ALPACA_PAPER';

  private apiKey?: string;
  private apiSecret?: string;

  constructor(apiKey?: string, apiSecret?: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  public async placeOrder(intent: OrderIntent): Promise<TradeOrder> {
    const res = await fetch('/api/nasdaq/trade', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey ? { 'x-alpaca-key': this.apiKey } : {}),
        ...(this.apiSecret ? { 'x-alpaca-secret': this.apiSecret } : {}),
      },
      body: JSON.stringify({
        symbol: intent.symbol,
        side: intent.side,
        quantity: intent.quantity,
        executedBy: intent.source === 'MANUAL' ? 'MANUAL' : 'AI',
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `Alpaca order placement failed [HTTP ${res.status}]`);
    }

    const data = await res.json();
    return {
      id: data.id || intent.clientOrderId,
      clientOrderId: intent.clientOrderId,
      decisionId: intent.decisionId,
      strategyId: intent.strategyId,
      symbol: intent.symbol,
      side: intent.side,
      quantity: intent.quantity,
      executedQuantity: data.quantity || intent.quantity,
      price: data.price || intent.price || 0,
      averageExecutionPrice: data.price || intent.price,
      status: (data.status as OrderLifecycleState) || 'FILLED',
      timestamp: new Date().toLocaleTimeString(),
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      executedBy: intent.source === 'MANUAL' ? 'MANUAL' : 'AI',
      exchange: 'nasdaq',
      tradingMode: 'ALPACA_PAPER',
      fee: 0,
      slippageCost: 0,
    };
  }

  public async cancelOrder(orderId: string, symbol: string): Promise<boolean> {
    return true;
  }

  public async getOrder(orderId: string, symbol: string): Promise<TradeOrder | null> {
    return null;
  }

  public async getOpenOrders(symbol?: string): Promise<TradeOrder[]> {
    return [];
  }

  public async getPositions(): Promise<Position[]> {
    return [];
  }

  public async getBalances(): Promise<{ cash: number; equity: number; currency: string }> {
    const res = await fetch('/api/nasdaq/account', {
      headers: {
        ...(this.apiKey ? { 'x-alpaca-key': this.apiKey } : {}),
        ...(this.apiSecret ? { 'x-alpaca-secret': this.apiSecret } : {}),
      },
    });
    if (res.ok) {
      const acc = await res.json();
      return {
        cash: acc.cash || 0,
        equity: acc.equity || 0,
        currency: 'USD',
      };
    }
    return { cash: 0, equity: 0, currency: 'USD' };
  }
}

export class ExecutionEngine {
  private static instance: ExecutionEngine;
  private adapters: Map<TradingMode, ExecutionAdapter> = new Map();
  private activeMode: TradingMode = 'LOCAL_SIM';

  private constructor() {
    this.adapters.set('LOCAL_SIM', new LocalPaperExecutionAdapter());
    this.adapters.set('BINANCE_TESTNET', new BinanceSpotExecutionAdapter(undefined, undefined, false));
    this.adapters.set('ALPACA_PAPER', new AlpacaExecutionAdapter());
  }

  public static getInstance(): ExecutionEngine {
    if (!ExecutionEngine.instance) {
      ExecutionEngine.instance = new ExecutionEngine();
    }
    return ExecutionEngine.instance;
  }

  public setAdapter(mode: TradingMode, adapter: ExecutionAdapter): void {
    this.adapters.set(mode, adapter);
  }

  public setActiveMode(mode: TradingMode): void {
    this.activeMode = mode;
  }

  public getActiveMode(): TradingMode {
    return this.activeMode;
  }

  public getAdapter(mode?: TradingMode): ExecutionAdapter {
    const targetMode = mode || this.activeMode;
    const adapter = this.adapters.get(targetMode);
    if (!adapter) {
      return this.adapters.get('LOCAL_SIM')!;
    }
    return adapter;
  }

  public async execute(intent: OrderIntent, mode?: TradingMode): Promise<TradeOrder> {
    const adapter = this.getAdapter(mode);
    return adapter.placeOrder(intent);
  }
}

export const executionEngine = ExecutionEngine.getInstance();
