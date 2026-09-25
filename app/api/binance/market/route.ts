import { NextResponse } from 'next/server';
import { getBinanceMainnetMarketData } from '@/lib/services/binanceMarketService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'BTCUSDT';
  const timeframe = searchParams.get('timeframe') || '1h';

  try {
    const data = await getBinanceMainnetMarketData(symbol, timeframe);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
