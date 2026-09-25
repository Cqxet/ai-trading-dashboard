import { NextResponse } from 'next/server';
import { getAlpacaPaperAccount } from '@/lib/services/alpacaTradingService';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const apiKey = request.headers.get('x-alpaca-key') || undefined;
  const secretKey = request.headers.get('x-alpaca-secret') || undefined;

  try {
    const account = await getAlpacaPaperAccount(apiKey, secretKey);
    return NextResponse.json(account);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
