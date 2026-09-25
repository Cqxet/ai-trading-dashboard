import { NextResponse } from 'next/server';
import { tradingWorker } from '@/lib/core/tradingWorker';
import { TradingMode } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  const health = tradingWorker.getHealthReport();
  return NextResponse.json(health);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, mode, strategy } = body;

    if (mode) {
      tradingWorker.setTradingMode(mode as TradingMode);
    }
    if (strategy) {
      tradingWorker.setStrategy(strategy);
    }

    if (action === 'start') {
      tradingWorker.start();
      return NextResponse.json({ success: true, message: 'Trading worker started' });
    } else if (action === 'stop') {
      tradingWorker.stop(body.reason || 'USER_COMMAND');
      return NextResponse.json({ success: true, message: 'Trading worker stopped' });
    }

    return NextResponse.json({ success: true, health: tradingWorker.getHealthReport() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
