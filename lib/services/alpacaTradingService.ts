import { AccountInfo, TradeOrder, Position } from '@/types/trading';
import { getRealStockMarketData } from './alpacaMarketService';

const ALPACA_PAPER_BASE = 'https://paper-api.alpaca.markets';

// In-memory demo balances & positions fallback ($100k standard paper portfolio)
let demoNasdaqCash = 100000;
let demoNasdaqPositions: { [symbol: string]: { qty: number; entryPrice: number } } = {
  AAPL: { qty: 25, entryPrice: 220.5 },
  NVDA: { qty: 15, entryPrice: 118.2 },
  TSLA: { qty: 20, entryPrice: 245.0 },
};
let demoNasdaqOrders: TradeOrder[] = [];

function getAlpacaCredentials(apiKey?: string, secretKey?: string) {
  const key = apiKey || process.env.ALPACA_PAPER_API_KEY || process.env.ALPACA_API_KEY || process.env.ALPACA_KEY || process.env.APCA_API_KEY_ID;
  const secret = secretKey || process.env.ALPACA_PAPER_SECRET_KEY || process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET || process.env.APCA_API_SECRET_KEY;
  return { key, secret };
}

export async function getAlpacaPaperAccount(apiKey?: string, secretKey?: string): Promise<AccountInfo> {
  const { key, secret } = getAlpacaCredentials(apiKey, secretKey);

  if (key && secret) {
    try {
      const [accRes, posRes] = await Promise.all([
        fetch(`${ALPACA_PAPER_BASE}/v2/account`, {
          headers: {
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
          },
          cache: 'no-store',
        }),
        fetch(`${ALPACA_PAPER_BASE}/v2/positions`, {
          headers: {
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
          },
          cache: 'no-store',
        }),
      ]);

      if (accRes.ok) {
        const acc = await accRes.json();
        const positionsRaw = posRes.ok ? await posRes.json() : [];

        // Value positions using REAL stock prices from Market Data API!
        const positions: Position[] = [];
        let totalUnrealizedPnL = 0;

        for (const p of positionsRaw) {
          const sym = p.symbol;
          const qty = parseFloat(p.qty);
          const entryPrice = parseFloat(p.avg_entry_price);

          let currentRealPrice = parseFloat(p.current_price);
          try {
            const mkt = await getRealStockMarketData(sym);
            currentRealPrice = mkt.price;
          } catch {
            // Keep broker price if market service unavailable
          }

          const marketValue = qty * currentRealPrice;
          const unrealizedPl = (currentRealPrice - entryPrice) * qty;
          const unrealizedPlPercent = entryPrice > 0 ? ((currentRealPrice / entryPrice) - 1) * 100 : 0;

          totalUnrealizedPnL += unrealizedPl;

          positions.push({
            symbol: sym,
            quantity: qty,
            entryPrice,
            currentPrice: currentRealPrice,
            marketValue: parseFloat(marketValue.toFixed(2)),
            unrealizedPl: parseFloat(unrealizedPl.toFixed(2)),
            unrealizedPlPercent: parseFloat(unrealizedPlPercent.toFixed(2)),
            side: p.side === 'long' ? 'long' : 'short',
          });
        }

        console.log(`[TRADING][ALPACA_PAPER] Account connected. Equity=${acc.equity} USD`);

        return {
          accountType: 'ALPACA_PAPER',
          equity: parseFloat(acc.equity),
          cash: parseFloat(acc.cash),
          buyingPower: parseFloat(acc.buying_power),
          currency: 'USD',
          isDemo: false,
          status: 'CONNECTED',
          statusMessage: 'Alpaca Paper Trading Hesabına Bağlı (Canlı Paper API)',
          positions,
          unrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(2)),
          orders: demoNasdaqOrders,
        };
      } else {
        const errJson = await accRes.json().catch(() => ({}));
        console.error(`[TRADING][ALPACA_PAPER] API Error: ${errJson.message || accRes.statusText}`);
        return {
          accountType: 'ALPACA_PAPER',
          equity: 0,
          cash: 0,
          buyingPower: 0,
          currency: 'USD',
          isDemo: false,
          status: 'API_KEY_INVALID',
          statusMessage: `Alpaca Paper API Hatası: ${errJson.message || 'Geçersiz API Anahtarı'}. Alım/satım devre dışı.`,
          positions: [],
          unrealizedPnL: 0,
          orders: [],
        };
      }
    } catch (err: any) {
      console.error('[TRADING][ALPACA_PAPER] Network error:', err.message);
    }
  }

  // Fallback to Paper Sandbox Simulation with REAL Market Valuation!
  const positions: Position[] = [];
  let totalPositionsValue = 0;
  let totalUnrealizedPnL = 0;

  for (const [sym, pos] of Object.entries(demoNasdaqPositions)) {
    let currentRealPrice = pos.entryPrice;
    try {
      const realMkt = await getRealStockMarketData(sym);
      currentRealPrice = realMkt.price;
    } catch {
      // Keep entry price if real market feed temporarily unreachable
    }

    const marketValue = pos.qty * currentRealPrice;
    const pl = (currentRealPrice - pos.entryPrice) * pos.qty;
    const plPercent = pos.entryPrice > 0 ? ((currentRealPrice / pos.entryPrice) - 1) * 100 : 0;

    totalPositionsValue += marketValue;
    totalUnrealizedPnL += pl;

    positions.push({
      symbol: sym,
      quantity: pos.qty,
      entryPrice: pos.entryPrice,
      currentPrice: currentRealPrice,
      marketValue: parseFloat(marketValue.toFixed(2)),
      unrealizedPl: parseFloat(pl.toFixed(2)),
      unrealizedPlPercent: parseFloat(plPercent.toFixed(2)),
      side: 'long',
    });
  }

  return {
    accountType: 'ALPACA_PAPER',
    equity: parseFloat((demoNasdaqCash + totalPositionsValue).toFixed(2)),
    cash: demoNasdaqCash,
    buyingPower: demoNasdaqCash * 2,
    currency: 'USD',
    isDemo: true,
    status: 'CONNECTED',
    statusMessage: key ? 'Alpaca API anahtarı geçersiz — Paper Sandbox Modu aktif' : 'Alpaca Paper Trading Sandbox ($100k Sanal Bakiye, Gerçek Piyasa Değerlemeli)',
    positions,
    unrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(2)),
    orders: demoNasdaqOrders,
  };
}

export async function executeAlpacaPaperTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  executedBy: 'AI' | 'MANUAL' = 'MANUAL',
  apiKey?: string,
  secretKey?: string
): Promise<TradeOrder> {
  const sym = symbol.toUpperCase().trim();
  const { key, secret } = getAlpacaCredentials(apiKey, secretKey);

  // 1. Fetch REAL current stock market price
  const realMarket = await getRealStockMarketData(sym);
  const tradePrice = realMarket.price;

  // 2. If valid paper keys provided, execute on real Alpaca Paper API
  if (key && secret) {
    try {
      const res = await fetch(`${ALPACA_PAPER_BASE}/v2/orders`, {
        method: 'POST',
        headers: {
          'APCA-API-KEY-ID': key,
          'APCA-API-SECRET-KEY': secret,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          symbol: sym,
          qty: quantity,
          side: side.toLowerCase(),
          type: 'market',
          time_in_force: 'day',
        }),
      });

      if (res.ok) {
        const orderData = await res.json();
        const order: TradeOrder = {
          id: orderData.id || `alp-${Date.now()}`,
          symbol: sym,
          side,
          quantity,
          price: tradePrice,
          status: 'FILLED',
          timestamp: new Date().toISOString(),
          executedBy,
          exchange: 'nasdaq',
          notes: 'Alpaca Paper Trading üzerinde yürütüldü',
        };
        demoNasdaqOrders.unshift(order);
        console.log(`[TRADING][ALPACA_PAPER] Order executed: ${side} ${quantity} ${sym} at ${tradePrice}`);
        return order;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`Alpaca Paper Emir Hatası: ${errJson.message || res.statusText}`);
      }
    } catch (err: any) {
      console.error('[TRADING][ALPACA_PAPER] Order execution error:', err.message);
      throw err;
    }
  }

  // 3. Sandbox execution (real price applied)
  const totalCost = quantity * tradePrice;
  if (side === 'BUY') {
    demoNasdaqCash = Math.max(0, demoNasdaqCash - totalCost);
    if (!demoNasdaqPositions[sym]) {
      demoNasdaqPositions[sym] = { qty: quantity, entryPrice: tradePrice };
    } else {
      const prev = demoNasdaqPositions[sym];
      const newQty = prev.qty + quantity;
      const newAvg = (prev.qty * prev.entryPrice + quantity * tradePrice) / newQty;
      demoNasdaqPositions[sym] = { qty: newQty, entryPrice: parseFloat(newAvg.toFixed(2)) };
    }
  } else {
    demoNasdaqCash += totalCost;
    if (demoNasdaqPositions[sym]) {
      demoNasdaqPositions[sym].qty = Math.max(0, demoNasdaqPositions[sym].qty - quantity);
      if (demoNasdaqPositions[sym].qty <= 0) {
        delete demoNasdaqPositions[sym];
      }
    }
  }

  const order: TradeOrder = {
    id: `sim-alp-${Date.now()}`,
    symbol: sym,
    side,
    quantity,
    price: tradePrice,
    status: 'FILLED',
    timestamp: new Date().toISOString(),
    executedBy,
    exchange: 'nasdaq',
    notes: 'Alpaca Paper Sandbox (Gerçek Fiyatla Yürütüldü)',
  };

  demoNasdaqOrders.unshift(order);
  return order;
}

export function getAlpacaTradingOrders(): TradeOrder[] {
  return demoNasdaqOrders;
}
