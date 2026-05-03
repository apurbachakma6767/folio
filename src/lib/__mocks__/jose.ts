// Mock for jose ESM package in Jest (CommonJS) tests
export function createRemoteJWKSet() {
  return async () => ({});
}

export async function jwtVerify(token: string) {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
  return { payload };
}

export type JWTPayload = Record<string, unknown>;
