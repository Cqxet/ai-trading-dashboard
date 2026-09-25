import { NextResponse } from 'next/server';
import { tradingWorker } from '@/lib/core/tradingWorker';
import { EmergencyAction } from '@/lib/core/types';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, confirmation } = body;

    if (!action || !['STOP_NEW_ENTRIES', 'CANCEL_ALL_OPEN_ORDERS', 'FLATTEN_POSITIONS'].includes(action)) {
      return NextResponse.json({ error: 'Invalid emergency action' }, { status: 400 });
    }

    const res = await tradingWorker.handleEmergencyAction(action as EmergencyAction, !!confirmation);
    return NextResponse.json(res);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
