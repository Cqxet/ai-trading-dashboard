import { Candle } from './trading';

export type BotStopReason =
  | 'USER_STOPPED'
  | 'MARKET_DATA_STALE'
  | 'WEBSOCKET_DISCONNECTED'
  | 'JEV_ERROR'
  | 'JEV_TIMEOUT'
  | 'MARKET_API_ERROR'
  | 'RISK_LIMIT'
  | 'BALANCE_DEPLETED'
  | 'MAX_TRADES_LIMIT'
  | 'INTERNAL_ERROR'
  | 'COMPONENT_UNMOUNT'
  | 'NONE';

export type BotRunStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'RECONNECTING';

export interface MarketTick {
  symbol: string;
  price: number;
  bid?: number;
  ask?: number;
  spread?: number;
  volume24h?: number;
  change24h?: number;
  timestamp: number;
}

export interface FastIndicators {
  rsi: number;
  ema9: number;
  ema20: number;
  ema50: number;
  momentum: number;
  rateOfChange: number;
  volatility: number;
  spread: number;
}

export interface FastSignalResult {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number; // 0 - 100
  score: number;
  indicators: FastIndicators;
  reason: string;
  timestamp: number;
}

export interface StrategySupervisorState {
  marketRegime: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'HIGH_VOLATILITY';
  preferredSymbols: string[];
  allowLong: boolean;
  allowShort: boolean;
  maxLeverage: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH';
  minConfidence: number;
  lastUpdated: number;
  reasoning: string;
  status?: 'OK' | 'DEGRADED';
}

export interface EngineStats {
  engineMode: 'ULTRA FAST SIMULATION';
  botStatus: BotRunStatus;
  stopReason: BotStopReason;
  pauseReason?: string;
  marketStreamStatus: 'CONNECTED' | 'RECONNECTING' | 'DISCONNECTED';
  fastLoopIntervalMs: number;
  scannerIntervalSec: number;
  jevIntervalSec: number;
  watchlist: string[];
  ticksReceived: number;
  signalsProcessed: number;
  tradesCount: number;
  engineLatencyMs: number;
  lastTickTimestamp: number;
  lastSignalTimestamp: number;
  lastJevSuccessTimestamp: number;
  lastTradeTimestamp: number;
  engineStartedAt: number;
  engineUptimeSec: number;
  activeTarget: {
    symbol: string;
    mode: 'SPOT' | 'FUTURES';
    action: string;
    confidence: number;
    price: number;
    suggestedUsdt: number;
    leverage: number;
  } | null;
}
