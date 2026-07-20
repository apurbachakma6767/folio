import { NextRequest, NextResponse } from 'next/server';
import { verifyAuth, unauthorized } from '@/lib/auth';
import { getUser, updateUserProfile } from '@/lib/user-registry';

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  const user = await getUser(auth.email);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  return NextResponse.json({
    profile: {
      email: user.email,
      name: user.name,
      displayName: user.displayName || user.name,
      birthDate: user.birthDate || '',
      phone: user.phone || '',
      country: user.country || '',
      city: user.city || '',
      hederaAccountId: user.hederaAccountId,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth.authenticated) return unauthorized(auth.error);

  try {
    const body = await req.json();
    const user = await updateUserProfile(auth.email, {
      displayName: body.displayName ?? body.name,
      name: body.displayName ?? body.name,
      birthDate: body.birthDate,
      phone: body.phone,
      country: body.country,
      city: body.city,
    });
    return NextResponse.json({
      success: true,
      profile: {
        email: user.email,
        name: user.name,
        displayName: user.displayName || user.name,
        birthDate: user.birthDate || '',
        phone: user.phone || '',
        country: user.country || '',
        city: user.city || '',
      },
    });
  } catch (error) {
    console.error('[profile PATCH]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Update failed' },
      { status: 500 }
    );
  }
}
