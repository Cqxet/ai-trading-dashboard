import { MarketData, Candle } from '@/types/trading';

const BINANCE_MAINNET_BASE = 'https://api.binance.com';

// Cache for graceful handling of momentary network hiccups (with explicit stale tagging)
const marketDataCache: Map<string, { data: MarketData; cachedAt: number }> = new Map();

export async function getBinanceMainnetMarketData(
  symbol: string,
  timeframe: string = '1h'
): Promise<MarketData> {
  const formattedSymbol = symbol.toUpperCase().replace('/', '').replace('-', '').trim();
  const startTime = Date.now();

  try {
    // 1. Fetch 24hr ticker & Book ticker from Binance Mainnet in parallel
    const [tickerRes, bookRes, klinesRes] = await Promise.all([
      fetch(`${BINANCE_MAINNET_BASE}/api/v3/ticker/24hr?symbol=${formattedSymbol}`, {
        cache: 'no-store',
      }),
      fetch(`${BINANCE_MAINNET_BASE}/api/v3/ticker/bookTicker?symbol=${formattedSymbol}`, {
        cache: 'no-store',
      }),
      fetch(`${BINANCE_MAINNET_BASE}/api/v3/klines?symbol=${formattedSymbol}&interval=${timeframe}&limit=40`, {
        cache: 'no-store',
      }),
    ]);

    const latencyMs = Date.now() - startTime;

    if (!tickerRes.ok) {
      throw new Error(`Binance Mainnet Ticker API failed with status ${tickerRes.status}: ${tickerRes.statusText}`);
    }

    const ticker = await tickerRes.json();
    const book = bookRes.ok ? await bookRes.json() : null;

    let candles: Candle[] = [];
    if (klinesRes.ok) {
      const klines = await klinesRes.json();
      candles = klines.map((k: any) => ({
        timestamp: k[0],
        time: new Date(k[0]).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
      }));
    }

    const price = parseFloat(ticker.lastPrice);
    const change24h = parseFloat(ticker.priceChange);
    const changePercent24h = parseFloat(ticker.priceChangePercent);
    const high24h = parseFloat(ticker.highPrice);
    const low24h = parseFloat(ticker.lowPrice);
    const volume24h = parseFloat(ticker.volume);
    const open24h = parseFloat(ticker.openPrice);
    const bid = book?.bidPrice ? parseFloat(book.bidPrice) : undefined;
    const ask = book?.askPrice ? parseFloat(book.askPrice) : undefined;

    const history = candles.map((c) => ({
      time: c.time,
      price: c.close,
    }));

    const result: MarketData = {
      symbol: formattedSymbol,
      price,
      change24h,
      changePercent24h,
      high24h,
      low24h,
      volume24h,
      open24h,
      bid,
      ask,
      timestamp: Date.now(),
      source: 'BINANCE_MAINNET',
      latencyMs,
      isStale: false,
      candles,
      timeframe,
      history,
    };

    // Cache successful data
    marketDataCache.set(formattedSymbol, { data: result, cachedAt: Date.now() });

    console.log(`[MARKET][BINANCE][${formattedSymbol}] price=${price} source=BINANCE_MAINNET latency=${latencyMs}ms`);

    return result;
  } catch (error: any) {
    console.error(`[MARKET][BINANCE][${formattedSymbol}] ERROR:`, error.message);

    // Check if we have recently cached data (within 45 seconds) to handle brief dropouts
    const cached = marketDataCache.get(formattedSymbol);
    if (cached) {
      const ageSec = Math.round((Date.now() - cached.cachedAt) / 1000);
      if (ageSec <= 60) {
        console.warn(`[MARKET][BINANCE][${formattedSymbol}] Serving STALE cache (${ageSec}s old)`);
        return {
          ...cached.data,
          isStale: true,
          staleAgeSec: ageSec,
          latencyMs: Date.now() - startTime,
        };
      }
    }

    // STRICT: NEVER return fake/mock/hardcoded prices!
    throw new Error(`Market Data Unavailable: Binance Mainnet connection failed for ${formattedSymbol}`);
  }
}
