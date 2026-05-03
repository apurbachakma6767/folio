import { NextRequest, NextResponse } from 'next/server';
import { getNote } from '@/lib/spend-notes';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const user = await getUser(auth.email);
  if (!user?.hederaAccountId) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  const { id } = await params;
  const noteId = parseInt(id, 10);
  if (Number.isNaN(noteId)) {
    return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
  }
  const note = await getNote(noteId);

  if (!note || note.userAccountId !== user.hederaAccountId) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return NextResponse.json({ note });
}
