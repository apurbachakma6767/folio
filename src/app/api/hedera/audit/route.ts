import { NextRequest, NextResponse } from 'next/server';
import { getTopicMessages, decodeHcsMessage } from '@/lib/mirror-node';
import { verifyAuth, unauthorized } from '@/lib/auth';

// GET /api/hedera/audit — fetch audit trail from HCS via Mirror Node
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const topicId = process.env.AUDIT_TOPIC_ID;
  if (!topicId) {
    return NextResponse.json({ messages: [], error: 'Audit topic not configured' });
  }

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '25', 10) || 25;
    const raw = await getTopicMessages(topicId, limit);

    const messages = raw.map((msg) => {
      try {
        return {
          sequenceNumber: msg.sequence_number,
          timestamp: msg.consensus_timestamp,
          data: decodeHcsMessage(msg.message),
        };
      } catch {
        return {
          sequenceNumber: msg.sequence_number,
          timestamp: msg.consensus_timestamp,
          data: { raw: msg.message },
        };
      }
    });

    return NextResponse.json({ messages });
  } catch (error) {
    console.error('Audit trail error:', error);
    return NextResponse.json({ messages: [], error: 'Failed to fetch audit trail' }, { status: 500 });
  }
}
