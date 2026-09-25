import { NextResponse } from 'next/server';
import { analyzeMarketWithGemini } from '@/lib/gemini';
import { analyzeMarketWithRealJev } from '@/lib/services/jevService';
import { MarketData } from '@/types/trading';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { exchange, marketData, strategy, aiEngine = 'jev' } = body;

    if (!exchange || !marketData) {
      return NextResponse.json({ error: 'Missing exchange or marketData' }, { status: 400 });
    }

    let analysis;
    if (aiEngine === 'jev') {
      const jevKey = request.headers.get('x-jev-key') || undefined;
      analysis = await analyzeMarketWithRealJev(exchange, marketData as MarketData, strategy, jevKey);
    } else {
      const geminiKey = request.headers.get('x-gemini-key') || undefined;
      analysis = await analyzeMarketWithGemini(exchange, marketData as MarketData, strategy, geminiKey);
    }

    return NextResponse.json(analysis);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
