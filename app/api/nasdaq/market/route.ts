import { NextResponse } from 'next/server';
import { getNasdaqMarketData } from '@/lib/alpaca';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get('symbol') || 'AAPL';
  
  const apiKey = request.headers.get('x-alpaca-key') || undefined;
  const secretKey = request.headers.get('x-alpaca-secret') || undefined;

  try {
    const data = await getNasdaqMarketData(symbol, apiKey, secretKey);
    return NextResponse.json(data);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
