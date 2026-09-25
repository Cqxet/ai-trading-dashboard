import { NextResponse } from 'next/server';
import { eventStore } from '@/lib/core/eventStore';

export const dynamic = 'force-dynamic';

export async function GET() {
  const comparison = eventStore.getABTestComparison();
  return NextResponse.json(comparison);
}
