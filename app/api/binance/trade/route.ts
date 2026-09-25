import { NextResponse } from 'next/server';
import { executeBinanceTrade } from '@/lib/binance';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { symbol, side, quantity, executedBy } = body;

    if (!symbol || !side || !quantity) {
      return NextResponse.json({ error: 'Missing required parameters (symbol, side, quantity)' }, { status: 400 });
    }

    const apiKey = request.headers.get('x-binance-key') || undefined;
    const secretKey = request.headers.get('x-binance-secret') || undefined;

    const order = await executeBinanceTrade(symbol, side, Number(quantity), executedBy || 'MANUAL', apiKey, secretKey);
    return NextResponse.json(order);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
