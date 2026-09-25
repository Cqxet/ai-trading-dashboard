import { NextResponse } from 'next/server';
import { explanationEngine } from '@/lib/core/explanationEngine';
import { eventStore } from '@/lib/core/eventStore';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { decisionId } = body;

    if (!decisionId) {
      return NextResponse.json({ error: 'Missing decisionId' }, { status: 400 });
    }

    const audit = eventStore.getAuditRecord(decisionId);
    if (!audit) {
      return NextResponse.json({ error: 'Audit record not found' }, { status: 404 });
    }

    const geminiKey = request.headers.get('x-gemini-key') || undefined;
    const explanation = await explanationEngine.explainDecision(audit, geminiKey);

    return NextResponse.json({
      decisionId,
      explanation,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
