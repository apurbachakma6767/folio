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

/**
 * Dev-only auth for scripts / local E2E.
 * Header: Authorization: Bearer folio-dev:<email>
 * Requires FOLIO_ALLOW_DEV_AUTH=true and non-production.
 */
function tryDevAuth(token: string): AuthResult | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (!['1', 'true', 'yes'].includes((process.env.FOLIO_ALLOW_DEV_AUTH || '').toLowerCase())) {
    return null;
  }
  if (!token.startsWith('folio-dev:')) return null;
  const email = token.slice('folio-dev:'.length).trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  console.warn(`[auth] Dev auth as ${email} (FOLIO_ALLOW_DEV_AUTH)`);
  return { authenticated: true, email, sub: email };
}

export async function verifyAuth(req: NextRequest): Promise<AuthResult | AuthError> {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing authorization header' };
  }

  const token = authHeader.slice(7);

  const dev = tryDevAuth(token);
  if (dev) return dev;

  // Unsigned demo JWT (header.payload.) — development only when JWKS unavailable
  // or when explicitly allowed for local E2E against Supabase test users.
  if (
    process.env.NODE_ENV !== 'production' &&
    ['1', 'true', 'yes'].includes((process.env.FOLIO_ALLOW_DEV_AUTH || '').toLowerCase())
  ) {
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
          email?: string;
          sub?: string;
        };
        if (payload.email) {
          console.warn('[auth] Dev mode: accepting unsigned JWT email claim');
          return {
            authenticated: true,
            email: payload.email,
            sub: payload.sub || payload.email,
          };
        }
      }
    } catch {
      /* fall through to JWKS */
    }
  }

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
