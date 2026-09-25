import { NextResponse } from 'next/server';
import { getBinanceAccount, getBinanceOrderHistory, resetBinanceDemoBalance } from '@/lib/binance';

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

export async function POST() {
  try {
    resetBinanceDemoBalance();
    const account = await getBinanceAccount();
    return NextResponse.json({ success: true, message: 'Binance bakiyesi 10.00 USDT olarak sıfırlandı.', ...account });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
