import { NextResponse } from 'next/server';
import { getBinanceMarketData } from '@/lib/binance';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'BTCUSDT';

  try {
    const data = await getBinanceMarketData(symbol);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
