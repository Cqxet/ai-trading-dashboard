import { NextResponse } from 'next/server';
import { getBinanceAccount, getBinanceOrderHistory } from '@/lib/binance';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-binance-key') || undefined;
  const secretKey = request.headers.get('x-binance-secret') || undefined;

  try {
    const account = await getBinanceAccount(apiKey, secretKey);
    const orders = getBinanceOrderHistory();
    return NextResponse.json({ ...account, orders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
