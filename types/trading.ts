export * from '@/lib/core/types';

// Backward compatibility aliases if any
export type ActionType = 'BUY' | 'SELL' | 'HOLD';

export interface MarketData {
  symbol: string;
  price: number;
  change24h: number;
  changePercent24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
  timestamp: number;
  source: string;
  latencyMs: number;
  isStale: boolean;
  staleAgeSec?: number;
  bid?: number;
  ask?: number;
  open24h?: number;
  candles: import('@/lib/core/types').Candle[];
  timeframe: string;
  history?: { time: string; price: number }[];
}

export interface AccountInfo {
  accountType: 'BINANCE_TESTNET' | 'ALPACA_PAPER' | 'LOCAL_SIM';
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
  isDemo: boolean;
  status: 'CONNECTED' | 'API_KEY_INVALID' | 'UNAVAILABLE' | 'RESTRICTED_LOCATION';
  statusMessage: string;
  positions: import('@/lib/core/types').Position[];
  realizedPnL?: number;
  unrealizedPnL: number;
  orders?: import('@/lib/core/types').TradeOrder[];
}

export interface VirtualPosition {
  symbol: string;
  quantity: number;
  averageEntry: number;
}

export interface VirtualTrade {
  id: string;
  time: string;
  timestamp: number;
  symbol: string;
  side: 'BUY' | 'SELL';
  executionPrice: number;
  quantity: number;
  usdtValue: number;
  fee: number;
  realizedPnL: number;
  source: 'MANUAL' | 'JEV_BOT' | 'QUANT_ENGINE';
  jevConfidence?: number;
}

export interface VirtualWalletState {
  version: 1;
  initialBalance: number;
  cash: number;
  positions: VirtualPosition[];
  trades: VirtualTrade[];
  realizedPnL: number;
}

export interface AIAnalysisResult {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
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

export interface SimulationPosition {
  symbol: string;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
}

export interface SimulationTrade {
  id: string;
  timestamp: number;
  time: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  usdtValue: number;
  fee: number;
  realizedPnL?: number;
  jevConfidence?: number;
  source: 'MANUAL' | 'JEV_BOT';
  status: 'FILLED' | 'REJECTED';
  notes?: string;
}

export interface SimulationWallet {
  version: number;
  initialBalance: number;
  cash: number;
  equity: number;
  realizedPnL: number;
  positions: SimulationPosition[];
  trades: SimulationTrade[];
  createdAt: number;
  updatedAt: number;
}
