// Mock supabase before importing plaid
jest.mock('../supabase', () => {
  const store: Record<string, string> = {};
  return {
    supabase: {
      from: (_table: string) => ({
        upsert: (row: { user_id: string; access_token: string }) => {
          store[row.user_id] = row.access_token;
          return { error: null };
        },
        select: (col?: string) => ({
          eq: (_field: string, value: string) => ({
            single: () => ({
              data: store[value]
                ? col === 'user_id'
                  ? { user_id: value }
                  : { access_token: store[value] }
                : null,
            }),
          }),
        }),
      }),
    },
  };
});

// Mock plaid npm package
jest.mock('plaid', () => ({
  Configuration: jest.fn().mockImplementation(() => ({})),
  PlaidApi: jest.fn().mockImplementation(() => ({})),
  PlaidEnvironments: { sandbox: 'https://sandbox.plaid.com' },
}));

describe('plaid token store', () => {
  let setAccessToken: (userId: string, token: string) => Promise<void>;
  let getAccessToken: (userId: string) => Promise<string | undefined>;
  let hasAccessToken: (userId: string) => Promise<boolean>;

  beforeEach(() => {
    jest.resetModules();
    const plaid = require('../plaid');
    setAccessToken = plaid.setAccessToken;
    getAccessToken = plaid.getAccessToken;
    hasAccessToken = plaid.hasAccessToken;
  });

  it('stores and retrieves access token', async () => {
    await setAccessToken('user-1', 'token-abc');
    expect(await getAccessToken('user-1')).toBe('token-abc');
  });

  it('returns undefined for unknown user', async () => {
    expect(await getAccessToken('unknown')).toBeUndefined();
  });

  it('hasAccessToken returns true for stored user', async () => {
    await setAccessToken('user-1', 'token-abc');
    expect(await hasAccessToken('user-1')).toBe(true);
  });

  it('hasAccessToken returns false for unknown user', async () => {
    expect(await hasAccessToken('unknown')).toBe(false);
  });

  it('overwrites existing token', async () => {
    await setAccessToken('user-1', 'old-token');
    await setAccessToken('user-1', 'new-token');
    expect(await getAccessToken('user-1')).toBe('new-token');
  });
});

describe('isPlaidConfigured', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns true when both env vars set', () => {
    process.env = { ...originalEnv, PLAID_CLIENT_ID: 'id', PLAID_SECRET: 'secret' };
    const { isPlaidConfigured } = require('../plaid');
    expect(isPlaidConfigured).toBe(true);
  });

  it('returns false when client ID missing', () => {
    process.env = { ...originalEnv, PLAID_SECRET: 'secret' };
    delete process.env.PLAID_CLIENT_ID;
    const { isPlaidConfigured } = require('../plaid');
    expect(isPlaidConfigured).toBe(false);
  });

  it('returns false when secret missing', () => {
    process.env = { ...originalEnv, PLAID_CLIENT_ID: 'id' };
    delete process.env.PLAID_SECRET;
    const { isPlaidConfigured } = require('../plaid');
    expect(isPlaidConfigured).toBe(false);
  });
});
