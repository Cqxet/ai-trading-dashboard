import { MarketData, AccountInfo, TradeOrder, Position } from '@/types/trading';

const ALPACA_PAPER_BASE = 'https://paper-api.alpaca.markets';
const ALPACA_DATA_BASE = 'https://data.alpaca.markets';

// In-memory demo balances & positions fallback if no real keys
let demoNasdaqCash = 100000; // $100,000 USD
let demoNasdaqPositions: { [symbol: string]: { qty: number; entryPrice: number } } = {
  AAPL: { qty: 25, entryPrice: 220.5 },
  NVDA: { qty: 15, entryPrice: 118.2 },
  TSLA: { qty: 20, entryPrice: 245.0 },
};
let demoNasdaqOrders: TradeOrder[] = [];

// Base prices for simulation fallback
const defaultStockPrices: Record<string, number> = {
  AAPL: 228.45,
  NVDA: 122.80,
  MSFT: 428.15,
  TSLA: 254.30,
  QQQ: 489.60,
  AMZN: 188.75,
};

export async function getNasdaqMarketData(symbol: string, apiKey?: string, secretKey?: string): Promise<MarketData> {
  const sym = symbol.toUpperCase().trim();
  const key = apiKey || process.env.ALPACA_API_KEY;
  const secret = secretKey || process.env.ALPACA_API_SECRET;

  if (key && secret) {
    try {
      // 1. Fetch latest quote
      const quoteRes = await fetch(`${ALPACA_DATA_BASE}/v2/stocks/${sym}/quotes/latest`, {
        headers: {
          'APCA-API-KEY-ID': key,
          'APCA-API-SECRET-KEY': secret,
        },
        cache: 'no-store',
      });

      // 2. Fetch bars for 24h mini chart
      const barsRes = await fetch(`${ALPACA_DATA_BASE}/v2/stocks/${sym}/bars?timeframe=1Hour&limit=24`, {
        headers: {
          'APCA-API-KEY-ID': key,
          'APCA-API-SECRET-KEY': secret,
        },
        cache: 'no-store',
      });

      if (quoteRes.ok) {
        const quoteData = await quoteRes.json();
        const quote = quoteData.quote;
        const currentPrice = quote.ap || quote.bp || defaultStockPrices[sym] || 150;

        let history: { time: string; price: number }[] = [];
        if (barsRes.ok) {
          const barsData = await barsRes.json();
          if (barsData.bars && Array.isArray(barsData.bars)) {
            history = barsData.bars.map((b: any) => ({
              time: new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              price: b.c,
            }));
          }
        }

        const openPrice = history.length > 0 ? history[0].price : currentPrice * 0.98;
        const diff = currentPrice - openPrice;
        const diffPct = (diff / openPrice) * 100;

        return {
          symbol: sym,
          price: currentPrice,
          change24h: diff,
          changePercent24h: diffPct,
          high24h: currentPrice * 1.025,
          low24h: currentPrice * 0.985,
          volume24h: 3824000,
          timestamp: Date.now(),
          history: history.length > 0 ? history : undefined,
        };
      }
    } catch (err) {
      console.warn(`Alpaca data fetch failed for ${sym}:`, err);
    }
  }

  // Realistic mock / fallback
  const basePrice = defaultStockPrices[sym] || 150.0;
  const jitter = (Math.sin(Date.now() / 10000) * 0.015);
  const currentPrice = parseFloat((basePrice * (1 + jitter)).toFixed(2));
  const changePct = 1.45 + (Math.sin(Date.now() / 15000) * 0.8);
  const changeVal = parseFloat(((currentPrice * changePct) / 100).toFixed(2));

  const history = Array.from({ length: 24 }).map((_, i) => ({
    time: `${i}:00`,
    price: parseFloat((basePrice * (1 + Math.sin(i / 2.5) * 0.018)).toFixed(2)),
  }));

  return {
    symbol: sym,
    price: currentPrice,
    change24h: changeVal,
    changePercent24h: parseFloat(changePct.toFixed(2)),
    high24h: parseFloat((currentPrice * 1.02).toFixed(2)),
    low24h: parseFloat((currentPrice * 0.985).toFixed(2)),
    volume24h: 4210000,
    timestamp: Date.now(),
    history,
  };
}

export async function getNasdaqAccount(apiKey?: string, secretKey?: string): Promise<AccountInfo> {
  const key = apiKey || process.env.ALPACA_API_KEY;
  const secret = secretKey || process.env.ALPACA_API_SECRET;

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

        const positions: Position[] = positionsRaw.map((p: any) => ({
          symbol: p.symbol,
          quantity: parseFloat(p.qty),
          entryPrice: parseFloat(p.avg_entry_price),
          currentPrice: parseFloat(p.current_price),
          marketValue: parseFloat(p.market_value),
          unrealizedPl: parseFloat(p.unrealized_pl),
          unrealizedPlPercent: parseFloat(p.unrealized_plpc) * 100,
          side: p.side === 'long' ? 'long' : 'short',
        }));

        return {
          equity: parseFloat(acc.equity),
          cash: parseFloat(acc.cash),
          buyingPower: parseFloat(acc.buying_power),
          currency: 'USD',
          isDemo: false,
          statusMessage: 'Connected to Alpaca Paper Trading ($100,000 Sandbox)',
          positions,
        };
      }
    } catch (err) {
      console.warn('Alpaca account fetch failed, fallback to mock:', err);
    }
  }

  // Simulated Alpaca Paper Portfolio
  const positions: Position[] = Object.entries(demoNasdaqPositions).map(([sym, pos]) => {
    const curPrice = defaultStockPrices[sym] || pos.entryPrice * 1.05;
    const marketValue = pos.qty * curPrice;
    const pl = (curPrice - pos.entryPrice) * pos.qty;
    const plPercent = ((curPrice - pos.entryPrice) / pos.entryPrice) * 100;
    return {
      symbol: sym,
      quantity: pos.qty,
      entryPrice: pos.entryPrice,
      currentPrice: curPrice,
      marketValue,
      unrealizedPl: pl,
      unrealizedPlPercent: plPercent,
      side: 'long',
    };
  });

  const totalPositionsValue = positions.reduce((acc, p) => acc + p.marketValue, 0);

  return {
    equity: demoNasdaqCash + totalPositionsValue,
    cash: demoNasdaqCash,
    buyingPower: demoNasdaqCash * 2, // 2x margin paper standard
    currency: 'USD',
    isDemo: true,
    statusMessage: key ? 'Alpaca API credentials check failed — using Paper Trading Sandbox' : 'Alpaca Paper Trading Sandbox ($100,000 test balance, zero risk)',
    positions,
  };
}

export async function executeNasdaqTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  executedBy: 'AI' | 'MANUAL' = 'MANUAL',
  apiKey?: string,
  secretKey?: string
): Promise<TradeOrder> {
  const sym = symbol.toUpperCase().trim();
  const key = apiKey || process.env.ALPACA_API_KEY;
  const secret = secretKey || process.env.ALPACA_API_SECRET;

  const market = await getNasdaqMarketData(sym, key, secret);
  const tradePrice = market.price;

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
          notes: 'Executed on Alpaca Paper Trading',
        };
        demoNasdaqOrders.unshift(order);
        return order;
      }
    } catch (err) {
      console.warn('Alpaca paper order failed, fallback to simulation:', err);
    }
  }

  // Simulated execution
  const totalCost = quantity * tradePrice;
  if (side === 'BUY') {
    demoNasdaqCash = Math.max(0, demoNasdaqCash - totalCost);
    if (!demoNasdaqPositions[sym]) {
      demoNasdaqPositions[sym] = { qty: quantity, entryPrice: tradePrice };
    } else {
      const prev = demoNasdaqPositions[sym];
      const newQty = prev.qty + quantity;
      const newAvg = (prev.qty * prev.entryPrice + quantity * tradePrice) / newQty;
      demoNasdaqPositions[sym] = { qty: newQty, entryPrice: newAvg };
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
    notes: 'Simulated on Nasdaq Paper Engine ($100k balance)',
  };

  demoNasdaqOrders.unshift(order);
  return order;
}

export function getNasdaqOrderHistory(): TradeOrder[] {
  return demoNasdaqOrders;
}
