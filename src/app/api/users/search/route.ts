import { NextRequest, NextResponse } from 'next/server';
import { searchUsers } from '@/lib/user-registry';
import { verifyAuth, unauthorized } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);
  const query = req.nextUrl.searchParams.get('q') || '';

  if (query.length < 2) {
    return NextResponse.json({ users: [] });
  }

  const users = await searchUsers(query);

  // Don't expose private keys — only return safe fields
  const safe = users.map((u) => ({
    email: u.email,
    name: u.name,
    hederaAccountId: u.hederaAccountId,
  }));

  return NextResponse.json({ users: safe });
}
