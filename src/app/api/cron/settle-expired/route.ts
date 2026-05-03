import { NextRequest, NextResponse } from 'next/server';
import { getExpiredActiveNotes } from '@/lib/spend-notes';
import { executeExpiredSettlement } from '@/lib/escrow';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const expired = await getExpiredActiveNotes();

  if (expired.length === 0) {
    return NextResponse.json({ message: 'No expired notes to settle', processed: 0 });
  }

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const note of expired) {
    try {
      await executeExpiredSettlement(note.id);
      processed++;
    } catch (error) {
      failed++;
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Note ${note.id}: ${msg}`);
      console.error(`Failed to settle note ${note.id}:`, error);
    }
  }

  return NextResponse.json({
    message: `Settled ${processed} of ${expired.length} expired notes`,
    processed,
    failed,
    errors: errors.length > 0 ? errors : undefined,
  });
}
