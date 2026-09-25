import { NextResponse } from 'next/server';
import { getNasdaqAccount, getNasdaqOrderHistory } from '@/lib/alpaca';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-alpaca-key') || undefined;
  const secretKey = request.headers.get('x-alpaca-secret') || undefined;

  try {
    const account = await getNasdaqAccount(apiKey, secretKey);
    const orders = getNasdaqOrderHistory();
    return NextResponse.json({ ...account, orders });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
