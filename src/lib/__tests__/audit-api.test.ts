/**
 * Tests for the HCS audit trail API route (GET /api/hedera/audit)
 * and the mirror-node HCS helpers (getTopicMessages, decodeHcsMessage).
 */

const mockVerifyAuth = jest.fn();
jest.mock('@/lib/auth', () => ({
  verifyAuth: mockVerifyAuth,
  unauthorized: (msg?: string) => {
    const { NextResponse } = require('next/server');
    return NextResponse.json({ error: msg || 'Unauthorized' }, { status: 401 });
  },
}));

const mockGetTopicMessages = jest.fn();
const mockDecodeHcsMessage = jest.fn();
jest.mock('@/lib/mirror-node', () => ({
  getTopicMessages: mockGetTopicMessages,
  decodeHcsMessage: mockDecodeHcsMessage,
}));

import { NextRequest } from 'next/server';

// Helper to build a fake NextRequest
function makeRequest(url: string) {
  return new NextRequest(new URL(url, 'http://localhost:3000'));
}

describe('GET /api/hedera/audit', () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeAll(() => {
    process.env.AUDIT_TOPIC_ID = '0.0.400';
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    const mod = await import('@/app/api/hedera/audit/route');
    GET = mod.GET;
  });

  it('returns 401 when not authenticated', async () => {
    mockVerifyAuth.mockResolvedValue({ authenticated: false, error: 'No token' });

    const res = await GET(makeRequest('/api/hedera/audit'));
    expect(res.status).toBe(401);
  });

  it('returns decoded messages on success', async () => {
    mockVerifyAuth.mockResolvedValue({ authenticated: true, email: 'a@b.com', sub: '1' });
    mockGetTopicMessages.mockResolvedValue([
      { sequence_number: 1, consensus_timestamp: '1700000000.000', message: 'eyJ0eXBlIjoiVEVTVCJ9' },
      { sequence_number: 2, consensus_timestamp: '1700000001.000', message: 'eyJ0eXBlIjoiVEVTVDIifQ==' },
    ]);
    mockDecodeHcsMessage
      .mockReturnValueOnce({ type: 'TEST' })
      .mockReturnValueOnce({ type: 'TEST2' });

    const res = await GET(makeRequest('/api/hedera/audit'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]).toEqual({
      sequenceNumber: 1,
      timestamp: '1700000000.000',
      data: { type: 'TEST' },
    });
    expect(mockGetTopicMessages).toHaveBeenCalledWith('0.0.400', 25);
  });

  it('respects the limit query param', async () => {
    mockVerifyAuth.mockResolvedValue({ authenticated: true, email: 'a@b.com', sub: '1' });
    mockGetTopicMessages.mockResolvedValue([]);

    await GET(makeRequest('/api/hedera/audit?limit=5'));

    expect(mockGetTopicMessages).toHaveBeenCalledWith('0.0.400', 5);
  });

  it('returns raw message when decoding fails', async () => {
    mockVerifyAuth.mockResolvedValue({ authenticated: true, email: 'a@b.com', sub: '1' });
    mockGetTopicMessages.mockResolvedValue([
      { sequence_number: 1, consensus_timestamp: '1700000000.000', message: 'not-valid-json' },
    ]);
    mockDecodeHcsMessage.mockImplementation(() => { throw new Error('bad json'); });

    const res = await GET(makeRequest('/api/hedera/audit'));
    const body = await res.json();

    expect(body.messages[0].data).toEqual({ raw: 'not-valid-json' });
  });

  it('handles mirror node errors gracefully', async () => {
    mockVerifyAuth.mockResolvedValue({ authenticated: true, email: 'a@b.com', sub: '1' });
    mockGetTopicMessages.mockRejectedValue(new Error('Mirror Node error: 503'));

    const res = await GET(makeRequest('/api/hedera/audit'));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.messages).toEqual([]);
    expect(body.error).toBe('Failed to fetch audit trail');
  });

  it('returns empty when AUDIT_TOPIC_ID is not set', async () => {
    const saved = process.env.AUDIT_TOPIC_ID;
    delete process.env.AUDIT_TOPIC_ID;
    try {
      mockVerifyAuth.mockResolvedValue({ authenticated: true, email: 'a@b.com', sub: '1' });

      jest.resetModules();
      const mod = await import('@/app/api/hedera/audit/route');
      const res = await mod.GET(makeRequest('/api/hedera/audit'));
      const body = await res.json();

      expect(body.messages).toEqual([]);
      expect(body.error).toBe('Audit topic not configured');
    } finally {
      process.env.AUDIT_TOPIC_ID = saved;
    }
  });
});
