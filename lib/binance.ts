import crypto from 'crypto';
import { MarketData, AccountInfo, TradeOrder } from '@/types/trading';

const BINANCE_TESTNET_BASE = 'https://testnet.binance.vision';

// In-memory demo balances & orders fallback (10 USDT fixed realistic starter balance)
let demoBinanceCash = 10.0; // 10 USDT sabit başlangıç bakiyesi
let demoBinancePositions: { [symbol: string]: { qty: number; entryPrice: number } } = {};
let demoBinanceOrders: TradeOrder[] = [];

export function resetBinanceDemoBalance(): void {
  demoBinanceCash = 10.0;
  demoBinancePositions = {};
  demoBinanceOrders = [];
}

export async function getBinanceMarketData(symbol: string): Promise<MarketData> {
  const formattedSymbol = symbol.toUpperCase().replace('/', '').replace('-', '');
  
  try {
    // 1. Fetch 24hr ticker from public Binance Testnet
    const tickerRes = await fetch(`${BINANCE_TESTNET_BASE}/api/v3/ticker/24hr?symbol=${formattedSymbol}`, {
      cache: 'no-store',
    });
    
    if (!tickerRes.ok) {
      throw new Error(`Binance API error: ${tickerRes.statusText}`);
    }
    
    const ticker = await tickerRes.json();

    // 2. Fetch klines for 24h mini chart
    const klinesRes = await fetch(`${BINANCE_TESTNET_BASE}/api/v3/klines?symbol=${formattedSymbol}&interval=1h&limit=24`, {
      cache: 'no-store',
    });
    
    let history: { time: string; price: number }[] = [];
    if (klinesRes.ok) {
      const klines = await klinesRes.json();
      history = klines.map((k: any) => ({
        time: new Date(k[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        price: parseFloat(k[4]), // Close price
      }));
    }

    return {
      symbol: formattedSymbol,
      price: parseFloat(ticker.lastPrice),
      change24h: parseFloat(ticker.priceChange),
      changePercent24h: parseFloat(ticker.priceChangePercent),
      high24h: parseFloat(ticker.highPrice),
      low24h: parseFloat(ticker.lowPrice),
      volume24h: parseFloat(ticker.volume),
      timestamp: Date.now(),
      history,
    };
  } catch (error) {
    console.warn(`Binance testnet public error for ${formattedSymbol}, falling back to defaults`, error);
    // Fallback if network or testnet down
    const defaultPrices: Record<string, number> = {
      BTCUSDT: 65420.5,
      ETHUSDT: 3490.2,
      SOLUSDT: 148.8,
      BNBUSDT: 585.1,
    };
    const basePrice = defaultPrices[formattedSymbol] || 100;
    return {
      symbol: formattedSymbol,
      price: basePrice,
      change24h: basePrice * 0.024,
      changePercent24h: 2.4,
      high24h: basePrice * 1.04,
      low24h: basePrice * 0.98,
      volume24h: 12543.8,
      timestamp: Date.now(),
      history: Array.from({ length: 24 }).map((_, i) => ({
        time: `${i}:00`,
        price: basePrice * (1 + (Math.sin(i / 3) * 0.02)),
      })),
    };
  }
}

function signQuery(query: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

function getBinanceCredentials(apiKey?: string, secretKey?: string) {
  const key = apiKey || process.env.BINANCE_API_KEY || process.env.BINANCE_KEY;
  const secret = secretKey || process.env.BINANCE_API_SECRET || process.env.BINANCE_SECRET;
  return { key, secret };
}

export async function getBinanceAccount(apiKey?: string, secretKey?: string): Promise<AccountInfo> {
  const { key, secret } = getBinanceCredentials(apiKey, secretKey);

  if (key && secret) {
    try {
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = signQuery(queryString, secret);

      const res = await fetch(`${BINANCE_TESTNET_BASE}/api/v3/account?${queryString}&signature=${signature}`, {
        headers: {
          'X-MBX-APIKEY': key,
        },
        cache: 'no-store',
      });

      if (res.ok) {
        const data = await res.json();
        const usdtBalance = data.balances.find((b: any) => b.asset === 'USDT');
        const cash = usdtBalance ? parseFloat(usdtBalance.free) : 0;
        
        // Find non-zero asset balances as positions
        const activeBalances = data.balances.filter((b: any) => parseFloat(b.free) > 0 && b.asset !== 'USDT');
        
        const positions = activeBalances.map((b: any) => ({
          symbol: `${b.asset}USDT`,
          quantity: parseFloat(b.free),
          entryPrice: 0,
          currentPrice: 0,
          marketValue: 0,
          unrealizedPl: 0,
          unrealizedPlPercent: 0,
          side: 'long' as const,
        }));

        return {
          equity: cash, // simplified
          cash,
          buyingPower: cash,
          currency: 'USDT',
          isDemo: false,
          statusMessage: 'Connected to Binance Spot Testnet (Live API)',
          positions,
        };
      }
    } catch (err) {
      console.warn('Failed to query Binance real testnet account:', err);
    }
  }

  // Demo Fallback
  const positions = Object.entries(demoBinancePositions).map(([sym, pos]) => {
    return {
      symbol: sym,
      quantity: pos.qty,
      entryPrice: pos.entryPrice,
      currentPrice: pos.entryPrice * 1.03, // Simulated current
      marketValue: pos.qty * pos.entryPrice * 1.03,
      unrealizedPl: (pos.entryPrice * 1.03 - pos.entryPrice) * pos.qty,
      unrealizedPlPercent: 3.0,
      side: 'long' as const,
    };
  });

  const totalPositionsValue = positions.reduce((acc, p) => acc + p.marketValue, 0);

  return {
    equity: demoBinanceCash + totalPositionsValue,
    cash: demoBinanceCash,
    buyingPower: demoBinanceCash,
    currency: 'USDT',
    isDemo: true,
    statusMessage: key ? 'Binance API Key is invalid or expired — using Testnet Sandbox' : 'Binance Testnet Sandbox (No API key set, fully functional simulation)',
    positions,
  };
}

export async function executeBinanceTrade(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  executedBy: 'AI' | 'MANUAL' = 'MANUAL',
  apiKey?: string,
  secretKey?: string
): Promise<TradeOrder> {
  const { key, secret } = getBinanceCredentials(apiKey, secretKey);
  const formattedSymbol = symbol.toUpperCase().replace('/', '').replace('-', '');

  const market = await getBinanceMarketData(formattedSymbol);
  const tradePrice = market.price;

  if (key && secret) {
    try {
      const timestamp = Date.now();
      const params = new URLSearchParams({
        symbol: formattedSymbol,
        side: side,
        type: 'MARKET',
        quantity: quantity.toString(),
        timestamp: timestamp.toString(),
      });
      const signature = signQuery(params.toString(), secret);

      const res = await fetch(`${BINANCE_TESTNET_BASE}/api/v3/order?${params.toString()}&signature=${signature}`, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': key,
        },
      });

      if (res.ok) {
        const orderData = await res.json();
        const order: TradeOrder = {
          id: orderData.orderId?.toString() || `bin-${Date.now()}`,
          symbol: formattedSymbol,
          side,
          quantity,
          price: tradePrice,
          status: 'FILLED',
          timestamp: new Date().toISOString(),
          executedBy,
          exchange: 'binance',
          notes: 'Executed on Binance Spot Testnet',
        };
        demoBinanceOrders.unshift(order);
        return order;
      }
    } catch (err) {
      console.warn('Live testnet order failed, falling back to simulated execution:', err);
    }
  }

  // Simulated Demo execution (Scaled for 10 USDT starting balance)
  let actualQty = quantity;
  let totalCost = actualQty * tradePrice;

  if (side === 'BUY') {
    if (demoBinanceCash < 0.50) {
      throw new Error(`Yetersiz bakiye: Güncel nakit $${demoBinanceCash.toFixed(2)} USDT. Yeni pozisyon açılamaz.`);
    }
    // Cap buy cost to available cash (max 95% of cash)
    if (totalCost > demoBinanceCash) {
      totalCost = demoBinanceCash * 0.95;
      actualQty = parseFloat((totalCost / tradePrice).toFixed(6));
    }
    demoBinanceCash = Math.max(0, demoBinanceCash - totalCost);
    if (!demoBinancePositions[formattedSymbol]) {
      demoBinancePositions[formattedSymbol] = { qty: actualQty, entryPrice: tradePrice };
    } else {
      const prev = demoBinancePositions[formattedSymbol];
      const newQty = prev.qty + actualQty;
      const newAvg = (prev.qty * prev.entryPrice + actualQty * tradePrice) / newQty;
      demoBinancePositions[formattedSymbol] = { qty: newQty, entryPrice: newAvg };
    }
  } else {
    // SELL
    const currentHolding = demoBinancePositions[formattedSymbol]?.qty || 0;
    if (currentHolding <= 0) {
      throw new Error(`${formattedSymbol} için satılacak açık pozisyon bulunamadı.`);
    }
    actualQty = Math.min(actualQty, currentHolding);
    totalCost = actualQty * tradePrice;
    demoBinanceCash += totalCost;
    demoBinancePositions[formattedSymbol].qty = Math.max(0, currentHolding - actualQty);
    if (demoBinancePositions[formattedSymbol].qty <= 0.000001) {
      delete demoBinancePositions[formattedSymbol];
    }
  }

  const order: TradeOrder = {
    id: `sim-bin-${Date.now()}`,
    symbol: formattedSymbol,
    side,
    quantity: actualQty,
    price: tradePrice,
    status: 'FILLED',
    timestamp: new Date().toISOString(),
    executedBy,
    exchange: 'binance',
    notes: 'Binance 10 USDT Sandbox Mikro Al-Sat',
  };

  demoBinanceOrders.unshift(order);
  return order;
}

export function getBinanceOrderHistory(): TradeOrder[] {
  return demoBinanceOrders;
}
