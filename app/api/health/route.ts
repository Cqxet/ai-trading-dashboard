import { NextResponse } from 'next/server';
import { SystemHealthReport } from '@/types/trading';
import { tradingWorker } from '@/lib/core/tradingWorker';
import { marketDataEngine } from '@/lib/core/marketDataEngine';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const binanceKey = request.headers.get('x-binance-key') || process.env.BINANCE_API_KEY || process.env.BINANCE_TESTNET_API_KEY;
  const alpacaKey = request.headers.get('x-alpaca-key') || process.env.ALPACA_API_KEY || process.env.ALPACA_PAPER_API_KEY;
  const jevKey = request.headers.get('x-jev-key') || process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY;

  // 1. Check Binance Mainnet Market Data
  let binanceMarket = { status: 'ERROR' as 'OK' | 'ERROR', latencyMs: 0, message: '', source: 'BINANCE_MAINNET' };
  try {
    const t0 = Date.now();
    const res = await fetch('https://api.binance.com/api/v3/ping', { cache: 'no-store' });
    binanceMarket.latencyMs = Date.now() - t0;
    if (res.ok) {
      binanceMarket.status = 'OK';
      binanceMarket.message = 'Binance Mainnet Market Data Erişilebilir';
    } else {
      binanceMarket.message = `HTTP ${res.status}`;
    }
  } catch (err: any) {
    binanceMarket.message = err.message;
  }

  // 2. Check Binance Testnet Trading
  let binanceTrading = { status: 'ERROR' as 'OK' | 'ERROR' | 'UNCONFIGURED', latencyMs: 0, message: '', source: 'BINANCE_TESTNET' };
  try {
    const t0 = Date.now();
    const res = await fetch('https://testnet.binance.vision/api/v3/ping', { cache: 'no-store' });
    binanceTrading.latencyMs = Date.now() - t0;
    if (res.ok) {
      if (!binanceKey) {
        binanceTrading.status = 'UNCONFIGURED';
        binanceTrading.message = 'API Key girilmedi (Sandbox devrede)';
      } else {
        binanceTrading.status = 'OK';
        binanceTrading.message = 'Binance Spot Testnet API Erişilebilir';
      }
    } else {
      binanceTrading.message = `HTTP ${res.status}`;
    }
  } catch (err: any) {
    binanceTrading.message = err.message;
  }

  // 3. Check Alpaca / Nasdaq Market Data
  let alpacaMarket = { status: 'ERROR' as 'OK' | 'ERROR', latencyMs: 0, message: '', source: 'ALPACA_OR_YAHOO' };
  try {
    const t0 = Date.now();
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/AAPL?interval=1h&range=1d', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      cache: 'no-store',
    });
    alpacaMarket.latencyMs = Date.now() - t0;
    if (res.ok) {
      alpacaMarket.status = 'OK';
      alpacaMarket.message = 'Canlı Hisse / Nasdaq Market Data Erişilebilir';
    } else {
      alpacaMarket.message = `HTTP ${res.status}`;
    }
  } catch (err: any) {
    alpacaMarket.message = err.message;
  }

  // 4. Check Alpaca Paper Trading
  let alpacaTrading = { status: 'ERROR' as 'OK' | 'ERROR' | 'UNCONFIGURED', latencyMs: 0, message: '', source: 'ALPACA_PAPER' };
  try {
    const t0 = Date.now();
    const res = await fetch('https://paper-api.alpaca.markets/v2/clock', {
      headers: alpacaKey ? { 'APCA-API-KEY-ID': alpacaKey } : {},
      cache: 'no-store',
    });
    alpacaTrading.latencyMs = Date.now() - t0;
    if (res.ok) {
      alpacaTrading.status = 'OK';
      alpacaTrading.message = 'Alpaca Paper Trading API Erişilebilir';
    } else if (!alpacaKey) {
      alpacaTrading.status = 'UNCONFIGURED';
      alpacaTrading.message = 'Alpaca API Key girilmedi (Sandbox devrede)';
    } else {
      alpacaTrading.message = `HTTP ${res.status}: Geçersiz veya yetkisiz anahtar`;
    }
  } catch (err: any) {
    alpacaTrading.message = err.message;
  }

  // 5. Check JEV API
  let jev = { status: 'ERROR' as 'OK' | 'ERROR' | 'UNCONFIGURED', latencyMs: 0, message: '', source: 'TYPESAFE_JEV' };
  if (!jevKey) {
    jev.status = 'UNCONFIGURED';
    jev.message = 'Jev API anahtarı eklenmedi (Deterministik Kural Motoru devrede)';
  } else {
    try {
      const t0 = Date.now();
      const res = await fetch('https://api.typesafe.ai/v1/systemone', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jevKey}`,
        },
        body: JSON.stringify({
          model: 'jev-latest',
          state: 'ping',
          questions: {},
        }),
      });
      jev.latencyMs = Date.now() - t0;
      jev.status = res.status < 500 ? 'OK' : 'ERROR';
      jev.message = res.ok ? 'Jev API Bağlantısı Başarılı' : `Durum: ${res.status}`;
    } catch (err: any) {
      jev.message = err.message;
    }
  }

  const workerHealth = tradingWorker.getHealthReport();
  const wsMetrics = marketDataEngine.getHealthMetrics();

  const report = {
    timestamp: new Date().toISOString(),
    binanceMarket,
    binanceTrading,
    alpacaMarket,
    alpacaTrading,
    jev,
    worker: workerHealth,
    websocket: wsMetrics,
  };

  return NextResponse.json(report);
}
