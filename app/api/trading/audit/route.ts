import { NextResponse } from 'next/server';
import { eventStore } from '@/lib/core/eventStore';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const decisionId = searchParams.get('decisionId');
  const symbol = searchParams.get('symbol') || undefined;

  if (decisionId) {
    const record = eventStore.getAuditRecord(decisionId);
    if (!record) {
      return NextResponse.json({ error: 'Audit record not found' }, { status: 404 });
    }
    return NextResponse.json(record);
  }

  const records = eventStore.getRecentAuditRecords(symbol, 40);
  return NextResponse.json({ records });
}
