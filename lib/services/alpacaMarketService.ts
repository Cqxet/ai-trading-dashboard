import { MarketData, Candle } from '@/types/trading';

const ALPACA_DATA_BASE = 'https://data.alpaca.markets';
const stockMarketCache: Map<string, { data: MarketData; cachedAt: number }> = new Map();

function mapTimeframeToYahoo(timeframe: string): { interval: string; range: string } {
  switch (timeframe) {
    case '1m': return { interval: '1m', range: '1d' };
    case '5m': return { interval: '5m', range: '1d' };
    case '15m': return { interval: '15m', range: '5d' };
    case '1h': return { interval: '1h', range: '1mo' };
    case '4h': return { interval: '1h', range: '1mo' }; // approx
    case '1d': return { interval: '1d', range: '1y' };
    default: return { interval: '1h', range: '1mo' };
  }
}

export async function getRealStockMarketData(
  symbol: string,
  timeframe: string = '1h',
  apiKey?: string,
  secretKey?: string
): Promise<MarketData> {
  const sym = symbol.toUpperCase().trim();
  const startTime = Date.now();

  const key = apiKey || process.env.ALPACA_API_KEY || process.env.ALPACA_KEY || process.env.APCA_API_KEY_ID;
  const secret = secretKey || process.env.ALPACA_API_SECRET || process.env.ALPACA_SECRET || process.env.APCA_API_SECRET_KEY;

  // 1. Try Alpaca Data API if keys are provided
  if (key && secret) {
    try {
      const [quoteRes, barsRes] = await Promise.all([
        fetch(`${ALPACA_DATA_BASE}/v2/stocks/${sym}/quotes/latest`, {
          headers: {
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
          },
          cache: 'no-store',
        }),
        fetch(`${ALPACA_DATA_BASE}/v2/stocks/${sym}/bars?timeframe=1Hour&limit=30`, {
          headers: {
            'APCA-API-KEY-ID': key,
            'APCA-API-SECRET-KEY': secret,
          },
          cache: 'no-store',
        }),
      ]);

      if (quoteRes.ok && barsRes.ok) {
        const quoteData = await quoteRes.json();
        const barsData = await barsRes.json();
        const quote = quoteData.quote;
        const currentPrice = quote.ap || quote.bp;

        if (currentPrice) {
          const bars = barsData.bars || [];
          const candles: Candle[] = bars.map((b: any) => ({
            timestamp: new Date(b.t).getTime(),
            time: new Date(b.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
            volume: b.v,
          }));

          const openPrice = candles.length > 0 ? candles[0].open : currentPrice;
          const change24h = currentPrice - openPrice;
          const changePercent24h = openPrice > 0 ? (change24h / openPrice) * 100 : 0;
          const high24h = candles.length > 0 ? Math.max(...candles.map(c => c.high)) : currentPrice;
          const low24h = candles.length > 0 ? Math.min(...candles.map(c => c.low)) : currentPrice;
          const volume24h = candles.reduce((acc, c) => acc + c.volume, 0);

          const latencyMs = Date.now() - startTime;
          const result: MarketData = {
            symbol: sym,
            price: currentPrice,
            change24h: parseFloat(change24h.toFixed(2)),
            changePercent24h: parseFloat(changePercent24h.toFixed(2)),
            high24h: parseFloat(high24h.toFixed(2)),
            low24h: parseFloat(low24h.toFixed(2)),
            volume24h,
            timestamp: Date.now(),
            source: 'ALPACA_MARKET_DATA',
            latencyMs,
            isStale: false,
            bid: quote.bp,
            ask: quote.ap,
            candles,
            timeframe,
            history: candles.map(c => ({ time: c.time, price: c.close })),
          };

          stockMarketCache.set(sym, { data: result, cachedAt: Date.now() });
          console.log(`[MARKET][ALPACA][${sym}] price=${currentPrice} source=ALPACA_MARKET_DATA latency=${latencyMs}ms`);
          return result;
        }
      }
    } catch (err: any) {
      console.warn(`[MARKET][ALPACA][${sym}] Alpaca Data API failed, falling back to public market data feed:`, err.message);
    }
  }

  // 2. Fetch REAL market data from public financial feed (Yahoo Finance live chart API)
  try {
    const { interval, range } = mapTimeframeToYahoo(timeframe);
    const yahooRes = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        cache: 'no-store',
      }
    );

    if (yahooRes.ok) {
      const data = await yahooRes.json();
      const chartResult = data.chart?.result?.[0];

      if (chartResult && chartResult.meta) {
        const meta = chartResult.meta;
        const currentPrice = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose || currentPrice;
        const change24h = currentPrice - prevClose;
        const changePercent24h = prevClose > 0 ? (change24h / prevClose) * 100 : 0;
        const high24h = meta.regularMarketDayHigh || currentPrice;
        const low24h = meta.regularMarketDayLow || currentPrice;
        const volume24h = meta.regularMarketVolume || 0;

        const timestamps = chartResult.timestamp || [];
        const quote = chartResult.indicators?.quote?.[0] || {};
        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];

        const candles: Candle[] = [];
        for (let i = 0; i < timestamps.length; i++) {
          if (closes[i] !== null && closes[i] !== undefined) {
            candles.push({
              timestamp: timestamps[i] * 1000,
              time: new Date(timestamps[i] * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              open: opens[i] || closes[i],
              high: highs[i] || closes[i],
              low: lows[i] || closes[i],
              close: closes[i],
              volume: volumes[i] || 0,
            });
          }
        }

        const latencyMs = Date.now() - startTime;
        const result: MarketData = {
          symbol: sym,
          price: parseFloat(currentPrice.toFixed(2)),
          change24h: parseFloat(change24h.toFixed(2)),
          changePercent24h: parseFloat(changePercent24h.toFixed(2)),
          high24h: parseFloat(high24h.toFixed(2)),
          low24h: parseFloat(low24h.toFixed(2)),
          volume24h,
          timestamp: Date.now(),
          source: 'YAHOO_FINANCE_LIVE',
          latencyMs,
          isStale: false,
          candles,
          timeframe,
          history: candles.slice(-24).map(c => ({ time: c.time, price: c.close })),
        };

        stockMarketCache.set(sym, { data: result, cachedAt: Date.now() });
        console.log(`[MARKET][NASDAQ][${sym}] price=${currentPrice} source=YAHOO_FINANCE_LIVE latency=${latencyMs}ms`);
        return result;
      }
    }
  } catch (err: any) {
    console.error(`[MARKET][NASDAQ][${sym}] Yahoo Finance API error:`, err.message);
  }

  // 3. Check for stale cache within 60s
  const cached = stockMarketCache.get(sym);
  if (cached) {
    const ageSec = Math.round((Date.now() - cached.cachedAt) / 1000);
    if (ageSec <= 60) {
      console.warn(`[MARKET][NASDAQ][${sym}] Serving STALE cache (${ageSec}s old)`);
      return {
        ...cached.data,
        isStale: true,
        staleAgeSec: ageSec,
        latencyMs: Date.now() - startTime,
      };
    }
  }

  // STRICT: NEVER return fake prices!
  throw new Error(`Market Data Unavailable: Could not fetch real NASDAQ market data for ${sym}`);
}
