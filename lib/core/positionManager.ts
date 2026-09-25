import {
  Position,
  Trade,
  OrderIntent,
  TradeOrder,
} from './types';

export class PositionManager {
  private static instance: PositionManager;
  private positions: Map<string, Position> = new Map();
  private trades: Trade[] = [];
  private initialCapital: number = 10.0;
  private cashBalance: number = 10.0;
  private peakEquity: number = 10.0;
  private consecutiveLosses: number = 0;
  private dailyRealizedPnL: number = 0;

  public static getInstance(): PositionManager {
    if (!PositionManager.instance) {
      PositionManager.instance = new PositionManager();
    }
    return PositionManager.instance;
  }

  public init(initialBalance: number = 10.0): void {
    this.initialCapital = initialBalance;
    this.cashBalance = initialBalance;
    this.peakEquity = initialBalance;
    this.positions.clear();
    this.trades = [];
    this.consecutiveLosses = 0;
    this.dailyRealizedPnL = 0;
  }

  public getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  public getPosition(symbol: string): Position | undefined {
    return this.positions.get(symbol.toUpperCase());
  }

  public getTrades(): Trade[] {
    return [...this.trades];
  }

  public getBalances(): { cash: number; equity: number; unrealizedPnL: number; realizedPnL: number } {
    let unrealizedPnL = 0;
    let positionsValue = 0;

    for (const pos of this.positions.values()) {
      unrealizedPnL += pos.unrealizedPl;
      positionsValue += pos.quantity * pos.currentPrice;
    }

    const equity = this.cashBalance + positionsValue;
    if (equity > this.peakEquity) {
      this.peakEquity = equity;
    }

    const totalRealizedPnL = this.trades.reduce((sum, t) => sum + t.realizedPnL, 0);

    return {
      cash: parseFloat(this.cashBalance.toFixed(4)),
      equity: parseFloat(equity.toFixed(4)),
      unrealizedPnL: parseFloat(unrealizedPnL.toFixed(4)),
      realizedPnL: parseFloat(totalRealizedPnL.toFixed(4)),
    };
  }

  public getMaxDrawdownPct(): number {
    const { equity } = this.getBalances();
    if (this.peakEquity <= 0) return 0;
    const dd = (this.peakEquity - equity) / this.peakEquity;
    return Math.max(0, dd);
  }

  public getConsecutiveLosses(): number {
    return this.consecutiveLosses;
  }

  public getDailyRealizedPnL(): number {
    return this.dailyRealizedPnL;
  }

  /**
   * Evaluates open positions on incoming tick to trigger SL, TP, or Trailing Stop instantly.
   */
  public checkTickExits(
    symbol: string,
    currentPrice: number
  ): { shouldExit: boolean; side: 'SELL'; reason: string; position: Position } | null {
    const pos = this.positions.get(symbol.toUpperCase());
    if (!pos || pos.quantity <= 0) return null;

    // Update highest / lowest price
    if (!pos.highestPriceSinceEntry || currentPrice > pos.highestPriceSinceEntry) {
      pos.highestPriceSinceEntry = currentPrice;
    }
    if (!pos.lowestPriceSinceEntry || currentPrice < pos.lowestPriceSinceEntry) {
      pos.lowestPriceSinceEntry = currentPrice;
    }

    // Update current price & unrealized PnL
    pos.currentPrice = currentPrice;
    pos.marketValue = pos.quantity * currentPrice;
    pos.unrealizedPl = (currentPrice - pos.entryPrice) * pos.quantity;
    pos.unrealizedPlPercent = ((currentPrice / pos.entryPrice) - 1) * 100;

    // 1. Hard Stop Loss Trigger
    if (pos.stopLoss && currentPrice <= pos.stopLoss) {
      return {
        shouldExit: true,
        side: 'SELL',
        reason: `STOP_LOSS_TRIGGERED: Price (${currentPrice}) crossed stop loss (${pos.stopLoss})`,
        position: pos,
      };
    }

    // 2. Take Profit Trigger
    if (pos.takeProfit && currentPrice >= pos.takeProfit) {
      return {
        shouldExit: true,
        side: 'SELL',
        reason: `TAKE_PROFIT_TRIGGERED: Price (${currentPrice}) reached profit target (${pos.takeProfit})`,
        position: pos,
      };
    }

    // 3. Dynamic Trailing Stop (e.g. 1.5% drop from peak after reaching at least +1.5% gain)
    if (pos.highestPriceSinceEntry && pos.highestPriceSinceEntry >= pos.entryPrice * 1.015) {
      const trailingThreshold = pos.highestPriceSinceEntry * 0.985;
      if (currentPrice <= trailingThreshold) {
        return {
          shouldExit: true,
          side: 'SELL',
          reason: `TRAILING_STOP_TRIGGERED: Price (${currentPrice}) retraced from peak (${pos.highestPriceSinceEntry})`,
          position: pos,
        };
      }
    }

    return null;
  }

  /**
   * Applies an executed order to update positions, balances, and trades.
   */
  public applyExecutedOrder(order: TradeOrder): Trade | null {
    const symbol = order.symbol.toUpperCase();
    const qty = order.executedQuantity ?? order.quantity;
    const price = order.averageExecutionPrice || order.price;
    const notional = qty * price;
    const fee = order.fee || notional * 0.001;
    const slippageCost = order.slippageCost || 0;
    const clientOrderId = order.clientOrderId || order.id;

    const existingPos = this.positions.get(symbol);

    if (order.side === 'BUY') {
      this.cashBalance -= (notional + fee);

      if (existingPos) {
        // Average in
        const totalQty = existingPos.quantity + qty;
        const totalCost = existingPos.quantity * existingPos.entryPrice + notional;
        existingPos.quantity = totalQty;
        existingPos.entryPrice = totalCost / totalQty;
        existingPos.currentPrice = price;
        existingPos.marketValue = totalQty * price;
        existingPos.unrealizedPl = (price - existingPos.entryPrice) * totalQty;
        existingPos.unrealizedPlPercent = ((price / existingPos.entryPrice) - 1) * 100;
        if (order.stopLoss) existingPos.stopLoss = order.stopLoss;
        if (order.takeProfit) existingPos.takeProfit = order.takeProfit;
      } else {
        this.positions.set(symbol, {
          symbol,
          quantity: qty,
          entryPrice: price,
          currentPrice: price,
          marketValue: notional,
          unrealizedPl: 0,
          unrealizedPlPercent: 0,
          side: 'long',
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          highestPriceSinceEntry: price,
          lowestPriceSinceEntry: price,
          entryTimestamp: Date.now(),
          strategyId: order.strategyId,
          decisionId: order.decisionId,
        });
      }

      const trade: Trade = {
        id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        clientOrderId,
        decisionId: order.decisionId,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        symbol,
        side: 'BUY',
        executionPrice: price,
        quantity: qty,
        usdtValue: parseFloat(notional.toFixed(4)),
        grossPnL: 0,
        fee: parseFloat(fee.toFixed(4)),
        slippageCost: parseFloat(slippageCost.toFixed(4)),
        netPnL: parseFloat((-fee - slippageCost).toFixed(4)),
        realizedPnL: 0,
        source: order.executedBy === 'AI' ? 'QUANT_ENGINE' : 'MANUAL',
      };
      this.trades.unshift(trade);
      return trade;
    } else {
      // SELL / CLOSE
      if (!existingPos || existingPos.quantity <= 0) return null;

      const sellQty = Math.min(qty, existingPos.quantity);
      const grossPnL = (price - existingPos.entryPrice) * sellQty;
      const netPnL = grossPnL - fee - slippageCost;

      this.cashBalance += (sellQty * price - fee);
      this.dailyRealizedPnL += netPnL;

      if (netPnL < 0) {
        this.consecutiveLosses += 1;
      } else {
        this.consecutiveLosses = 0;
      }

      if (sellQty >= existingPos.quantity) {
        this.positions.delete(symbol);
      } else {
        existingPos.quantity -= sellQty;
        existingPos.marketValue = existingPos.quantity * price;
        existingPos.unrealizedPl = (price - existingPos.entryPrice) * existingPos.quantity;
      }

      const trade: Trade = {
        id: `tr_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        clientOrderId,
        decisionId: order.decisionId,
        time: new Date().toLocaleTimeString(),
        timestamp: Date.now(),
        symbol,
        side: 'SELL',
        executionPrice: price,
        quantity: sellQty,
        usdtValue: parseFloat((sellQty * price).toFixed(4)),
        grossPnL: parseFloat(grossPnL.toFixed(4)),
        fee: parseFloat(fee.toFixed(4)),
        slippageCost: parseFloat(slippageCost.toFixed(4)),
        netPnL: parseFloat(netPnL.toFixed(4)),
        realizedPnL: parseFloat(netPnL.toFixed(4)),
        source: order.executedBy === 'AI' ? 'QUANT_ENGINE' : 'MANUAL',
      };
      this.trades.unshift(trade);
      return trade;
    }
  }

  /**
   * Portfolio correlation awareness: aggregates exposure by cluster.
   */
  public getClusterExposures(): { cryptoCluster: number; equityCluster: number; stableRatio: number } {
    let cryptoValue = 0;
    let equityValue = 0;

    for (const pos of this.positions.values()) {
      if (pos.symbol.endsWith('USDT') || pos.symbol.endsWith('BTC')) {
        cryptoValue += pos.marketValue;
      } else {
        equityValue += pos.marketValue;
      }
    }

    const { equity } = this.getBalances();
    return {
      cryptoCluster: equity > 0 ? cryptoValue / equity : 0,
      equityCluster: equity > 0 ? equityValue / equity : 0,
      stableRatio: equity > 0 ? this.cashBalance / equity : 1,
    };
  }
}

export const positionManager = PositionManager.getInstance();
