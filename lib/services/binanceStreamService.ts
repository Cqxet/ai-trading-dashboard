import { MarketTick } from '@/types/fastEngine';

type TickCallback = (tick: MarketTick) => void;
type StatusCallback = (status: 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED') => void;

class BinanceStreamManager {
  private ws: WebSocket | null = null;
  private symbols: Set<string> = new Set(['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']);
  private listeners: Set<TickCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private isConnecting: boolean = false;
  private reconnectTimer: any = null;
  private activeStreams: string = '';
  private lastPrices: Map<string, number> = new Map();
  private reconnectAttempts: number = 0;

  constructor() {}

  public subscribe(cb: TickCallback): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  public onStatus(cb: StatusCallback): () => void {
    this.statusListeners.add(cb);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  public setWatchlist(newSymbols: string[]): void {
    if (!newSymbols || newSymbols.length === 0) return;
    const formatted = newSymbols.map((s) => s.toUpperCase().trim());
    const set = new Set(formatted);
    // Check if changed
    if (set.size === this.symbols.size && Array.from(set).every((s) => this.symbols.has(s))) {
      return;
    }
    this.symbols = set;
    this.reconnect();
  }

  public start(): void {
    if (typeof window === 'undefined') return;
    this.connect();
  }

  public stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.notifyStatus('DISCONNECTED');
  }

  private notifyStatus(status: 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED'): void {
    console.log(`[WS] ${status}`);
    this.statusListeners.forEach((cb) => {
      try {
        cb(status);
      } catch (e) {}
    });
  }

  private notifyTick(tick: MarketTick): void {
    this.listeners.forEach((cb) => {
      try {
        cb(tick);
      } catch (e) {}
    });
  }

  private reconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    this.notifyStatus('RECONNECTING');

    // Exponential reconnect backoff: 1s, 2s, 5s, 10s
    const delays = [1000, 2000, 5000, 10000];
    const delay = delays[Math.min(this.reconnectAttempts, delays.length - 1)];
    this.reconnectAttempts += 1;

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private connect(): void {
    if (this.isConnecting || typeof window === 'undefined') return;
    this.isConnecting = true;

    try {
      const streams = Array.from(this.symbols)
        .map((s) => `${s.toLowerCase()}@ticker`)
        .join('/');

      this.activeStreams = streams;
      const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

      const socket = new WebSocket(url);
      this.ws = socket;

      socket.onopen = () => {
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.notifyStatus('CONNECTED');
      };

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          const data = payload.data || payload;
          if (data && data.s && data.c) {
            const symbol = data.s.toUpperCase();
            const price = parseFloat(data.c);
            const bid = data.b ? parseFloat(data.b) : price;
            const ask = data.a ? parseFloat(data.a) : price;
            const volume24h = data.q ? parseFloat(data.q) : 0;
            const change24h = data.P ? parseFloat(data.P) : 0;
            const timestamp = data.E || Date.now();

            this.lastPrices.set(symbol, price);

            this.notifyTick({
              symbol,
              price,
              bid,
              ask,
              spread: Math.max(0, ask - bid),
              volume24h,
              change24h,
              timestamp,
            });
          }
        } catch (err) {
          // ignore parse errors
        }
      };

      socket.onerror = (e) => {
        this.isConnecting = false;
        this.notifyStatus('RECONNECTING');
      };

      socket.onclose = () => {
        this.isConnecting = false;
        this.notifyStatus('RECONNECTING');
        this.reconnect();
      };
    } catch (e) {
      this.isConnecting = false;
      this.notifyStatus('DISCONNECTED');
    }
  }

  public getLastKnownPrice(symbol: string): number | undefined {
    return this.lastPrices.get(symbol.toUpperCase());
  }
}

// Global singleton stream instance for client
let clientStreamInstance: BinanceStreamManager | null = null;

export function getBinanceStream(): BinanceStreamManager {
  if (!clientStreamInstance) {
    clientStreamInstance = new BinanceStreamManager();
  }
  return clientStreamInstance;
}
