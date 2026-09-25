export type ExchangeType = 'nasdaq' | 'binance';

export type ActionType = 'BUY' | 'SELL' | 'HOLD';

export interface Candle {
  timestamp: number;
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MarketData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
  source: string; // e.g. "BINANCE_MAINNET", "ALPACA_MARKET_DATA", "YAHOO_FINANCE_LIVE"
  latencyMs: number;
  isStale: boolean;
  staleAgeSec?: number;
  bid?: number;
  ask?: number;
  open24h?: number;
  candles: Candle[];
  timeframe: string; // "1m" | "5m" | "15m" | "1h" | "4h" | "1d"
  history?: { time: string; price: number }[];
}

export interface AccountInfo {
  accountType: 'BINANCE_TESTNET' | 'ALPACA_PAPER';
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
  isDemo: boolean;
  status: 'CONNECTED' | 'API_KEY_INVALID' | 'UNAVAILABLE' | 'RESTRICTED_LOCATION';
  statusMessage: string;
  positions: Position[];
  realizedPnL?: number;
  unrealizedPnL: number;
  orders?: TradeOrder[];
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number; // REAL current market price
  marketValue: number;  // quantity * currentPrice
  unrealizedPl: number; // (currentPrice - entryPrice) * quantity
  unrealizedPlPercent: number; // ((currentPrice / entryPrice) - 1) * 100
  side: 'long' | 'short';
}

export interface TradeOrder {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  price: number;
  status: 'FILLED' | 'PENDING' | 'REJECTED';
  timestamp: string;
  executedBy: 'AI' | 'MANUAL';
  exchange: ExchangeType;
  notes?: string;
  orderType?: 'MARKET' | 'LIMIT';
}

export interface AIAnalysisResult {
  action: ActionType;
  confidence: number; // 0 to 100
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedQuantity: number;
  marketSource: string;
  keyIndicators: {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rsiEstimate: number;
    support: number;
    resistance: number;
    ema20?: number;
    ema50?: number;
    atr?: number;
  };
  timestamp: string;
}

export interface ComponentHealth {
  status: 'OK' | 'ERROR' | 'UNCONFIGURED';
  latencyMs?: number;
  message?: string;
  source?: string;
}

export interface SystemHealthReport {
  timestamp: string;
  binanceMarket: ComponentHealth;
  binanceTrading: ComponentHealth;
  alpacaMarket: ComponentHealth;
  alpacaTrading: ComponentHealth;
  jev: ComponentHealth;
}
