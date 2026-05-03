import { NextRequest, NextResponse } from 'next/server';
import { getAccountTransactions, getAccountNfts } from '@/lib/mirror-node';
import { verifyAuth, unauthorized } from '@/lib/auth';

// GET /api/hedera/transactions — fetch transaction history from Mirror Node
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const accountId = req.nextUrl.searchParams.get('accountId');
  if (!accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 });
  }

  try {
    const limit = parseInt(req.nextUrl.searchParams.get('limit') || '25', 10) || 25;
    const [transactions, nfts] = await Promise.all([
      getAccountTransactions(accountId, limit),
      getAccountNfts(accountId, process.env.SPEND_NOTE_TOKEN_ID),
    ]);

    return NextResponse.json({
      transactions: transactions.map((tx) => ({
        id: tx.transaction_id,
        timestamp: tx.consensus_timestamp,
        type: tx.name,
        result: tx.result,
        tokenTransfers: tx.token_transfers,
      })),
      spendNotes: nfts.map((nft) => ({
        tokenId: nft.token_id,
        serial: nft.serial_number,
        metadata: nft.metadata,
      })),
    });
  } catch (error) {
    console.error('Transaction history error:', error);
    return NextResponse.json({ transactions: [], spendNotes: [] }, { status: 500 });
  }
}
