import crypto from 'crypto';
import { AccountInfo, TradeOrder, Position } from '@/types/trading';
import { getBinanceMainnetMarketData } from './binanceMarketService';

const BINANCE_TESTNET_BASE = 'https://testnet.binance.vision';

// In-memory demo balances & positions fallback (10 USDT fixed realistic starter balance)
let demoBinanceCash = 10.0;
let demoBinancePositions: { [symbol: string]: { qty: number; entryPrice: number } } = {};
let demoBinanceOrders: TradeOrder[] = [];

export function resetBinanceDemoBalance(): void {
  demoBinanceCash = 10.0;
  demoBinancePositions = {};
  demoBinanceOrders = [];
}

function getBinanceCredentials(apiKey?: string, secretKey?: string) {
  const key = apiKey || process.env.BINANCE_TESTNET_API_KEY || process.env.BINANCE_API_KEY || process.env.BINANCE_KEY;
  const secret = secretKey || process.env.BINANCE_TESTNET_API_SECRET || process.env.BINANCE_API_SECRET || process.env.BINANCE_SECRET;
  return { key, secret };
}

function signQuery(query: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(query).digest('hex');
}

export async function getBinanceTradingAccount(apiKey?: string, secretKey?: string): Promise<AccountInfo> {
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
        
        // Find non-zero asset balances
        const activeBalances = data.balances.filter((b: any) => parseFloat(b.free) > 0 && b.asset !== 'USDT');
        
        // Value positions using REAL Mainnet Market Prices!
        const positions: Position[] = [];
        let totalPositionsMarketValue = 0;

        for (const b of activeBalances) {
          const sym = `${b.asset}USDT`;
          const qty = parseFloat(b.free);
          let currentRealPrice = 0;
          try {
            const mkt = await getBinanceMainnetMarketData(sym);
            currentRealPrice = mkt.price;
          } catch {
            currentRealPrice = 0;
          }

          const marketValue = qty * currentRealPrice;
          totalPositionsMarketValue += marketValue;

          positions.push({
            symbol: sym,
            quantity: qty,
            entryPrice: currentRealPrice, // testnet doesn't keep avg cost directly
            currentPrice: currentRealPrice,
            marketValue,
            unrealizedPl: 0,
            unrealizedPlPercent: 0,
            side: 'long',
          });
        }

        console.log(`[TRADING][BINANCE_TESTNET] Account connected. Cash=${cash} USDT, Positions=${positions.length}`);

        return {
          accountType: 'BINANCE_TESTNET',
          equity: cash + totalPositionsMarketValue,
          cash,
          buyingPower: cash,
          currency: 'USDT',
          isDemo: false,
          status: 'CONNECTED',
          statusMessage: 'Binance Spot Testnet Hesabına Bağlı (Canlı Testnet API)',
          positions,
          unrealizedPnL: 0,
          orders: demoBinanceOrders,
        };
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.error(`[TRADING][BINANCE_TESTNET] API Error: ${errJson.msg || res.statusText}`);
        return {
          accountType: 'BINANCE_TESTNET',
          equity: 0,
          cash: 0,
          buyingPower: 0,
          currency: 'USDT',
          isDemo: false,
          status: 'API_KEY_INVALID',
          statusMessage: `Binance Testnet API Hatası: ${errJson.msg || 'Geçersiz API Anahtarı'}. Alım/satım devre dışı.`,
          positions: [],
          unrealizedPnL: 0,
          orders: [],
        };
      }
    } catch (err: any) {
      console.error('[TRADING][BINANCE_TESTNET] Network exception:', err.message);
    }
  }

  // Fallback to 10 USDT Sandbox Simulation with REAL Mainnet Valuation!
  const positions: Position[] = [];
  let totalPositionsValue = 0;
  let totalUnrealizedPnL = 0;

  for (const [sym, pos] of Object.entries(demoBinancePositions)) {
    let currentRealPrice = pos.entryPrice;
    try {
      const realMkt = await getBinanceMainnetMarketData(sym);
      currentRealPrice = realMkt.price;
    } catch {
      // Keep entry price if real market data temporarily unreachable
    }

    const marketValue = pos.qty * currentRealPrice;
    const unrealizedPl = (currentRealPrice - pos.entryPrice) * pos.qty;
    const unrealizedPlPercent = pos.entryPrice > 0 ? ((currentRealPrice / pos.entryPrice) - 1) * 100 : 0;

    totalPositionsValue += marketValue;
    totalUnrealizedPnL += unrealizedPl;

    positions.push({
      symbol: sym,
      quantity: pos.qty,
      entryPrice: pos.entryPrice,
      currentPrice: currentRealPrice,
      marketValue: parseFloat(marketValue.toFixed(4)),
      unrealizedPl: parseFloat(unrealizedPl.toFixed(4)),
      unrealizedPlPercent: parseFloat(unrealizedPlPercent.toFixed(2)),
      side: 'long',
    });
  }

  const totalEquity = demoBinanceCash + totalPositionsValue;

  return {
    accountType: 'BINANCE_TESTNET',
    equity: parseFloat(totalEquity.toFixed(2)),
    cash: parseFloat(demoBinanceCash.toFixed(2)),
    buyingPower: parseFloat(demoBinanceCash.toFixed(2)),
    currency: 'USDT',
    isDemo: true,
    status: 'CONNECTED',
    statusMessage: key ? 'Binance API anahtarı geçersiz — 10$ Sandbox Modu aktif' : 'Binance 10 USDT Sandbox Simülasyonu (Gerçek Mainnet Fiyat Değerlemeli)',
    positions,
    unrealizedPnL: parseFloat(totalUnrealizedPnL.toFixed(4)),
    orders: demoBinanceOrders,
  };
}

export async function executeBinanceTradingOrder(
  symbol: string,
  side: 'BUY' | 'SELL',
  quantity: number,
  executedBy: 'AI' | 'MANUAL' = 'MANUAL',
  apiKey?: string,
  secretKey?: string
): Promise<TradeOrder> {
  const { key, secret } = getBinanceCredentials(apiKey, secretKey);
  const formattedSymbol = symbol.toUpperCase().replace('/', '').replace('-', '').trim();

  // 1. Fetch REAL current market price from Binance Mainnet
  const realMarket = await getBinanceMainnetMarketData(formattedSymbol);
  const tradePrice = realMarket.price;

  // 2. If valid Testnet keys provided, execute on real Binance Spot Testnet
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
          notes: 'Binance Spot Testnet üzerinde yürütüldü',
        };
        demoBinanceOrders.unshift(order);
        console.log(`[TRADING][BINANCE_TESTNET] Order placed: ${side} ${quantity} ${formattedSymbol} at ${tradePrice}`);
        return order;
      } else {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(`Binance Testnet Emir Hatası: ${errJson.msg || res.statusText}`);
      }
    } catch (err: any) {
      console.error('[TRADING][BINANCE_TESTNET] Order failed:', err.message);
      throw err;
    }
  }

  // 3. Sandbox execution (scaled for 10 USDT balance)
  let actualQty = quantity;
  let totalCost = actualQty * tradePrice;

  if (side === 'BUY') {
    if (demoBinanceCash < 0.20) {
      throw new Error(`Yetersiz bakiye: Güncel nakit $${demoBinanceCash.toFixed(2)} USDT. Yeni pozisyon açılamaz.`);
    }
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
    notes: 'Binance Testnet Sandbox (Gerçek Fiyatla Yürütüldü)',
  };

  demoBinanceOrders.unshift(order);
  return order;
}

export function getBinanceTradingOrders(): TradeOrder[] {
  return demoBinanceOrders;
}
