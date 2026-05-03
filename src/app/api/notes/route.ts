import { NextRequest, NextResponse } from 'next/server';
import { getNotes, getNote, updateNoteStatus } from '@/lib/spend-notes';
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
    if (!note || note.userAccountId !== user.hederaAccountId) {
      return NextResponse.json({ error: 'Note not found' }, { status: 404 });
    }
    return NextResponse.json({ notes: [note] });
  }

  const notes = await getNotes(user.hederaAccountId);
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
