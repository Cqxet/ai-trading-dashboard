import { NextResponse } from 'next/server';
import { analyzeMarketWithGemini } from '@/lib/gemini';
import { analyzeMarketWithJev } from '@/lib/jev';
import { MarketData } from '@/types/trading';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { exchange, marketData, strategy, aiEngine = 'gemini' } = body;

    if (!exchange || !marketData) {
      return NextResponse.json({ error: 'Missing exchange or marketData' }, { status: 400 });
    }

    let analysis;
    if (aiEngine === 'jev') {
      const jevKey = request.headers.get('x-jev-key') || undefined;
      analysis = await analyzeMarketWithJev(exchange, marketData as MarketData, strategy, jevKey);
    } else {
      const geminiKey = request.headers.get('x-gemini-key') || undefined;
      analysis = await analyzeMarketWithGemini(exchange, marketData as MarketData, strategy, geminiKey);
    }

    return NextResponse.json(analysis);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
