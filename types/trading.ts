export type ExchangeType = 'nasdaq' | 'binance';

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
  history?: { time: string; price: number }[];
}

export interface AccountInfo {
  equity: number;
  cash: number;
  buyingPower: number;
  currency: string;
  isDemo: boolean;
  statusMessage?: string;
  positions: Position[];
}

export interface Position {
  symbol: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPercent: number;
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
}

export interface AIAnalysisResult {
  action: ActionType;
  confidence: number; // 0 to 100
  targetPrice: number;
  stopLoss: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  suggestedQuantity: number;
  keyIndicators: {
    trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    rsiEstimate: number;
    support: number;
    resistance: number;
  };
  timestamp: string;
}
