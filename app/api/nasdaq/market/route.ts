import { NextResponse } from 'next/server';
import { getRealStockMarketData } from '@/lib/services/alpacaMarketService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'AAPL';
  const timeframe = searchParams.get('timeframe') || '1h';
  
  const apiKey = request.headers.get('x-alpaca-key') || undefined;
  const secretKey = request.headers.get('x-alpaca-secret') || undefined;

  try {
    const data = await getRealStockMarketData(symbol, timeframe, apiKey, secretKey);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
