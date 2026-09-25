import { NextResponse } from 'next/server';
import { getBinanceTradingAccount, resetBinanceDemoBalance } from '@/lib/services/binanceTradingService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-binance-key') || undefined;
  const secretKey = request.headers.get('x-binance-secret') || undefined;

  try {
    const account = await getBinanceTradingAccount(apiKey, secretKey);
    return NextResponse.json(account);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    resetBinanceDemoBalance();
    const account = await getBinanceTradingAccount();
    return NextResponse.json({ success: true, message: 'Binance bakiyesi 10.00 USDT olarak sıfırlandı.', ...account });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
