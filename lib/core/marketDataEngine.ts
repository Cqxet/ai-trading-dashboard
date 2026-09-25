import {
  MarketConnectionState,
  MarketDataHealthMetrics,
  BookTicker,
  Candle,
} from './types';

export type MarketTickHandler = (symbol: string, price: number, book?: BookTicker) => void;

export class MarketDataEngine {
  private static instance: MarketDataEngine;

  private state: MarketConnectionState = 'DISCONNECTED';
  private reconnectCount = 0;
  private lastTickTimestamp = 0;
  private tickTimestamps: number[] = [];
  private wsLatencyMs = 12;
  private subscribedSymbols: Set<string> = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
  private droppedEvents = 0;
  private queueSize = 0;

  // Web socket reference
  private ws: any = null;
  private tickHandlers: Set<MarketTickHandler> = new Set();
  private reconnectTimeoutId: any = null;
  private isConnecting = false;

  // Book tickers cache
  private bookTickers: Map<string, BookTicker> = new Map();
  // 1m candles cache
  private klinesCache: Map<string, Candle[]> = new Map();

  public static getInstance(): MarketDataEngine {
    if (!MarketDataEngine.instance) {
      MarketDataEngine.instance = new MarketDataEngine();
    }
    return MarketDataEngine.instance;
  }

  public subscribeTick(handler: MarketTickHandler): () => void {
    this.tickHandlers.add(handler);
    return () => this.tickHandlers.delete(handler);
  }

  public getHealthMetrics(): MarketDataHealthMetrics {
    const now = Date.now();
    // Prune tick timestamps older than 5s
    this.tickTimestamps = this.tickTimestamps.filter((t) => now - t < 5000);
    const tickRatePerSec = this.tickTimestamps.length > 0 ? this.tickTimestamps.length / 5 : 0;
    const lastTickAgeMs = this.lastTickTimestamp > 0 ? now - this.lastTickTimestamp : 999999;

    return {
      connectionState: this.state,
      reconnectCount: this.reconnectCount,
      lastTickAgeMs,
      tickRatePerSec: parseFloat(tickRatePerSec.toFixed(2)),
      wsLatencyMs: this.wsLatencyMs,
      subscribedSymbols: Array.from(this.subscribedSymbols),
      droppedEvents: this.droppedEvents,
      queueSize: this.queueSize,
    };
  }

  public getBookTicker(symbol: string): BookTicker | undefined {
    return this.bookTickers.get(symbol.toUpperCase());
  }

  public getCachedKlines(symbol: string): Candle[] {
    return this.klinesCache.get(symbol.toUpperCase()) || [];
  }

  /**
   * Connects to Binance live WebSocket multiplex stream.
   * Format: wss://stream.binance.com:9443/stream?streams=btcusdt@trade/btcusdt@bookTicker...
   */
  public connect(): void {
    if (typeof window === 'undefined' && typeof WebSocket === 'undefined') {
      // In serverless without WebSocket global, mark DEGRADED and rely on REST polling
      this.state = 'DEGRADED';
      return;
    }

    if (this.isConnecting || this.state === 'READY') {
      return;
    }

    this.isConnecting = true;
    this.state = 'CONNECTING';

    const streams = Array.from(this.subscribedSymbols)
      .map((s) => `${s.toLowerCase()}@bookTicker/${s.toLowerCase()}@trade`)
      .join('/');

    const wsUrl = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      const WS = typeof WebSocket !== 'undefined' ? WebSocket : (globalThis as any).WebSocket;
      if (!WS) {
        this.state = 'DEGRADED';
        this.isConnecting = false;
        return;
      }

      this.ws = new WS(wsUrl);

      this.ws.onopen = () => {
        this.isConnecting = false;
        this.state = 'READY';
        this.lastTickTimestamp = Date.now();
        console.log(`[MARKET_DATA_ENGINE] WebSocket CONNECTED to Binance Live Stream (${this.subscribedSymbols.size} symbols)`);
      };

      this.ws.onmessage = (event: any) => {
        try {
          const message = JSON.parse(event.data);
          const { stream, data } = message;
          const now = Date.now();
          this.lastTickTimestamp = now;
          this.tickTimestamps.push(now);

          if (stream && stream.includes('@bookTicker')) {
            const sym = (data.s || '').toUpperCase();
            const book: BookTicker = {
              symbol: sym,
              bidPrice: parseFloat(data.b),
              bidQty: parseFloat(data.B),
              askPrice: parseFloat(data.a),
              askQty: parseFloat(data.A),
              timestamp: now,
            };
            this.bookTickers.set(sym, book);

            const mid = (book.bidPrice + book.askPrice) / 2;
            for (const handler of this.tickHandlers) {
              handler(sym, mid, book);
            }
          } else if (stream && stream.includes('@trade')) {
            const sym = (data.s || '').toUpperCase();
            const tradePrice = parseFloat(data.p);
            const book = this.bookTickers.get(sym);
            for (const handler of this.tickHandlers) {
              handler(sym, tradePrice, book);
            }
          }
        } catch (err) {
          this.droppedEvents++;
        }
      };

      this.ws.onerror = (err: any) => {
        console.warn('[MARKET_DATA_ENGINE] WebSocket error:', err?.message || 'Connection error');
        this.state = 'DEGRADED';
      };

      this.ws.onclose = () => {
        this.isConnecting = false;
        this.state = 'RECONNECTING';
        this.scheduleReconnect();
      };
    } catch (err: any) {
      this.isConnecting = false;
      this.state = 'DEGRADED';
      this.scheduleReconnect();
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeoutId) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.state = 'DISCONNECTED';
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeoutId) return;

    this.reconnectCount++;
    // Exponential backoff with jitter: min(30s, base * 2^count + jitter)
    const base = 1000;
    const maxBackoff = 25000;
    const exp = Math.min(maxBackoff, base * Math.pow(1.5, Math.min(this.reconnectCount, 8)));
    const jitter = Math.random() * 500;
    const delay = Math.round(exp + jitter);

    console.log(`[MARKET_DATA_ENGINE] Reconnecting in ${delay}ms (attempt #${this.reconnectCount})...`);

    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect();
    }, delay);
  }
}

export const marketDataEngine = MarketDataEngine.getInstance();
