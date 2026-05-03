// Mock the plaid module before importing routes
jest.mock('../plaid', () => ({
  plaidClient: {
    linkTokenCreate: jest.fn(),
    itemPublicTokenExchange: jest.fn(),
    investmentsHoldingsGet: jest.fn(),
  },
  isPlaidConfigured: true,
  setAccessToken: jest.fn(),
  getAccessToken: jest.fn(),
  hasAccessToken: jest.fn(),
}));

// Create a fake JWT with email claim for auth tests
const fakeJwt = 'header.' + Buffer.from(JSON.stringify({ email: 'test@example.com', sub: 'test-user' })).toString('base64') + '.signature';

// Helper to create mock NextRequest
function mockRequest(options: { method?: string; body?: object; searchParams?: Record<string, string>; authenticated?: boolean } = {}) {
  const url = new URL('http://localhost:3000/api/test');
  if (options.searchParams) {
    Object.entries(options.searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const headers = new Map<string, string>();
  if (options.authenticated !== false) {
    headers.set('authorization', `Bearer ${fakeJwt}`);
  }
  return {
    json: jest.fn().mockResolvedValue(options.body || {}),
    nextUrl: url,
    headers: { get: (key: string) => headers.get(key.toLowerCase()) ?? null },
  } as unknown as import('next/server').NextRequest;
}

describe('POST /api/plaid/create-link-token', () => {
  let POST: (req: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();

    // Re-mock after resetModules
    jest.doMock('../plaid', () => ({
      plaidClient: {
        linkTokenCreate: jest.fn(),
        itemPublicTokenExchange: jest.fn(),
        investmentsHoldingsGet: jest.fn(),
      },
      isPlaidConfigured: true,
      setAccessToken: jest.fn(),
      getAccessToken: jest.fn(),
      hasAccessToken: jest.fn(),
    }));

    const route = await import('@/app/api/plaid/create-link-token/route');
    POST = route.POST;
  });

  it('returns link_token on success', async () => {
    const { plaidClient: client } = require('../plaid');
    (client.linkTokenCreate as jest.Mock).mockResolvedValue({
      data: { link_token: 'link-sandbox-abc123' },
    });

    const req = mockRequest({ body: { userId: 'user-1' } });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.link_token).toBe('link-sandbox-abc123');
  });

  it('returns 500 on Plaid error', async () => {
    const { plaidClient: client } = require('../plaid');
    (client.linkTokenCreate as jest.Mock).mockRejectedValue(new Error('Plaid API error'));

    const req = mockRequest({ body: { userId: 'user-1' } });
    const res = await POST(req);

    expect(res.status).toBe(500);
  });
});

describe('POST /api/plaid/create-link-token (not configured)', () => {
  let POST: (req: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('../plaid', () => ({
      plaidClient: {},
      isPlaidConfigured: false,
      setAccessToken: jest.fn(),
      getAccessToken: jest.fn(),
      hasAccessToken: jest.fn(),
    }));
    const route = await import('@/app/api/plaid/create-link-token/route');
    POST = route.POST;
  });

  it('returns 501 when not configured', async () => {
    const req = mockRequest({ body: {} });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(501);
    expect(data.error).toBe('plaid_not_configured');
  });
});

describe('POST /api/plaid/exchange-token', () => {
  let POST: (req: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('../plaid', () => ({
      plaidClient: {
        itemPublicTokenExchange: jest.fn(),
      },
      isPlaidConfigured: true,
      setAccessToken: jest.fn(),
      getAccessToken: jest.fn(),
      hasAccessToken: jest.fn(),
    }));
    const route = await import('@/app/api/plaid/exchange-token/route');
    POST = route.POST;
  });

  it('exchanges token and stores access_token', async () => {
    const { plaidClient: client, setAccessToken: mockSet } = require('../plaid');
    (client.itemPublicTokenExchange as jest.Mock).mockResolvedValue({
      data: { access_token: 'access-sandbox-xyz' },
    });

    const req = mockRequest({ body: { public_token: 'public-sandbox-abc', userId: 'user-1' } });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('test@example.com', 'access-sandbox-xyz');
  });

  it('returns 400 when missing public_token', async () => {
    const req = mockRequest({ body: {} });
    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toBe('Missing public_token');
  });
});

describe('GET /api/plaid/holdings', () => {
  let GET: (req: import('next/server').NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    jest.doMock('../plaid', () => ({
      plaidClient: {
        investmentsHoldingsGet: jest.fn(),
      },
      isPlaidConfigured: true,
      setAccessToken: jest.fn(),
      getAccessToken: jest.fn(),
      hasAccessToken: jest.fn(),
    }));
    const route = await import('@/app/api/plaid/holdings/route');
    GET = route.GET;
  });

  it('returns mapped holdings array using auth email', async () => {
    const { plaidClient: client, getAccessToken: mockGet } = require('../plaid');
    (mockGet as jest.Mock).mockResolvedValue('access-token');
    (client.investmentsHoldingsGet as jest.Mock).mockResolvedValue({
      data: {
        holdings: [
          { security_id: 'sec-1', quantity: 10 },
          { security_id: 'sec-2', quantity: 5 },
        ],
        securities: [
          { security_id: 'sec-1', ticker_symbol: 'AAPL', name: 'Apple Inc', type: 'equity' },
          { security_id: 'sec-2', ticker_symbol: 'NFLX', name: 'Netflix Inc', type: 'equity' },
        ],
      },
    });

    const req = mockRequest();
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockGet).toHaveBeenCalledWith('test@example.com');
    expect(data.holdings).toHaveLength(2);
    expect(data.holdings[0]).toMatchObject({
      symbol: 'AAPL',
      name: 'Apple Inc',
      shares: 10,
      icon: 'A',
    });
  });

  it('returns 401 when no access token', async () => {
    const { getAccessToken: mockGet } = require('../plaid');
    (mockGet as jest.Mock).mockResolvedValue(undefined);

    const req = mockRequest();
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(401);
    expect(data.error).toBe('not_connected');
  });

  it('returns empty array for empty holdings', async () => {
    const { plaidClient: client, getAccessToken: mockGet } = require('../plaid');
    (mockGet as jest.Mock).mockResolvedValue('access-token');
    (client.investmentsHoldingsGet as jest.Mock).mockResolvedValue({
      data: { holdings: [], securities: [] },
    });

    const req = mockRequest();
    const res = await GET(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.holdings).toHaveLength(0);
  });

  it('returns 500 on Plaid error', async () => {
    const { plaidClient: client, getAccessToken: mockGet } = require('../plaid');
    (mockGet as jest.Mock).mockResolvedValue('access-token');
    (client.investmentsHoldingsGet as jest.Mock).mockRejectedValue(new Error('API error'));

    const req = mockRequest();
    const res = await GET(req);

    expect(res.status).toBe(500);
  });
});
