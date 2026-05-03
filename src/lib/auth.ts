// Server-side auth — verify Dynamic Labs JWT from Authorization header
// Dynamic Labs JWTs are signed with the environment's key pair.
// JWKS endpoint: https://app.dynamic.xyz/api/v0/sdk/{envId}/.well-known/jwks

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  if (!jwks && envId) {
    jwks = createRemoteJWKSet(
      new URL(`https://app.dynamic.xyz/api/v0/sdk/${envId}/.well-known/jwks`)
    );
  }
  return jwks;
}

export interface AuthResult {
  authenticated: true;
  email: string;
  sub: string;
}

export interface AuthError {
  authenticated: false;
  error: string;
}

export async function verifyAuth(req: NextRequest): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing authorization header' };
  }

  const token = authHeader.slice(7);

  const keySet = getJWKS();
  if (!keySet) {
    // Dynamic Labs not configured — allow in demo mode (development/test only)
    if (process.env.NODE_ENV !== 'production') {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.email) {
          console.warn('[auth] Demo mode: JWT signature NOT verified (development only)');
          return { authenticated: true, email: payload.email, sub: payload.sub || payload.email };
        }
      } catch {
        // fall through
      }
    }
    return { authenticated: false, error: 'Auth not configured' };
  }

  try {
    const { payload } = await jwtVerify(token, keySet);
    const email = (payload as JWTPayload & { email?: string }).email;
    if (!email) {
      return { authenticated: false, error: 'Token missing email claim' };
    }
    return { authenticated: true, email, sub: payload.sub || email };
  } catch {
    return { authenticated: false, error: 'Invalid or expired token' };
  }
}

export function unauthorized(message = 'Unauthorized') {
  return NextResponse.json({ error: message }, { status: 401 });
}
