import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || 'BTCUSDT').toUpperCase();
  const targetUrl = `https://data-api.binance.vision/api/v3/ticker/24hr?symbol=${symbol}`;
  const startTime = Date.now();
  const vercelRegion = process.env.VERCEL_REGION || 'local';

  try {
    const res = await fetch(targetUrl, {
      cache: 'no-store',
      headers: {
        'Accept': 'application/json',
      },
    });

    const latencyMs = Date.now() - startTime;

    if (!res.ok) {
      const errorBody = await res.text();
      return NextResponse.json(
        {
          ok: false,
          httpStatus: res.status,
          statusText: res.statusText,
          error: errorBody,
          source: 'BINANCE_DATA_API',
          url: targetUrl,
          latencyMs,
          vercelRegion,
        },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({
      ok: true,
      symbol: data.symbol,
      price: parseFloat(data.lastPrice),
      high24h: parseFloat(data.highPrice),
      low24h: parseFloat(data.lowPrice),
      volume24h: parseFloat(data.volume),
      changePercent: parseFloat(data.priceChangePercent),
      source: 'BINANCE_DATA_API',
      timestamp: data.closeTime || Date.now(),
      latencyMs,
      vercelRegion,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        httpStatus: 500,
        error: error.message,
        source: 'BINANCE_DATA_API',
        url: targetUrl,
        latencyMs: Date.now() - startTime,
        vercelRegion,
      },
      { status: 500 }
    );
  }
}
