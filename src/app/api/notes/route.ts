import { NextRequest, NextResponse } from 'next/server';
import { getNotes, getNote, getNotesForAccount, updateNoteStatus } from '@/lib/spend-notes';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser } from '@/lib/user-registry';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const user = await getUser(auth.email);
  if (!user?.hederaAccountId) {
    return NextResponse.json({ notes: [] });
  }

  const searchParams = req.nextUrl.searchParams;
  const id = searchParams.get('id');

  if (id) {
    const noteId = parseInt(id, 10);
    if (Number.isNaN(noteId)) {
      return NextResponse.json({ error: 'Invalid note ID' }, { status: 400 });
    }
    const note = await getNote(noteId);
    const isParty =
      note &&
      (note.userAccountId === user.hederaAccountId ||
        note.recipientAccountId === user.hederaAccountId);
    if (!note || !isParty) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    const direction =
      note.userAccountId === user.hederaAccountId ? 'sent' : 'received';
    return NextResponse.json({ notes: [{ ...note, direction }] });
  }

  const scope = searchParams.get('scope'); // 'cards' | 'main' | null

  // Cards: only notes this user originated with a card
  if (scope === 'cards') {
    const mine = await getNotes(user.hederaAccountId);
    const notes = mine.filter((n) => !!n.cardToken || !!n.cardLastFour);
    return NextResponse.json({ notes });
  }

  // Main feed: sent + received (exclude card-only demo notes)
  const all = await getNotesForAccount(user.hederaAccountId);
  const notes = all.filter((n) => !n.cardToken && !n.cardLastFour);
  return NextResponse.json({ notes });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const user = await getUser(auth.email);
  if (!user?.hederaAccountId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body = await req.json();
  const noteId = body.noteId ?? body.id;
  const { status } = body;

  if (!noteId || !status) {
    return NextResponse.json(
      { error: 'noteId and status required' },
      { status: 400 }
    );
  }

  const existing = await getNote(noteId);
  if (!existing || existing.userAccountId !== user.hederaAccountId) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  const note = await updateNoteStatus(noteId, status);
  if (!note) {
    return NextResponse.json({ error: 'Note not found' }, { status: 404 });
  }

  return NextResponse.json(note);
}
