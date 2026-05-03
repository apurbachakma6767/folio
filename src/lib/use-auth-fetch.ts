'use client';

import { getAuthToken } from '@dynamic-labs/sdk-react-core';

// Wrapper around fetch that adds Dynamic Labs JWT to requests
export function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(input, { ...init, headers });
}
