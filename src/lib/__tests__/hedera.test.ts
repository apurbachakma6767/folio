/**
 * Tests for src/lib/hedera.ts — Hedera SDK wrapper
 *
 * Every function in hedera.ts is exercised through a full mock of @hashgraph/sdk.
 * These tests verify that the correct SDK transactions are built, signed, and
 * executed for each Folio operation (account creation, token ops, NFT ops, queries).
 */

// ── Shared mock state ────────────────────────────────────────────────────

let executeResult: unknown;
let receiptResult: unknown;

const mockGetReceipt = jest.fn(() => Promise.resolve(receiptResult));
const mockExecute = jest.fn(() =>
  Promise.resolve({ getReceipt: mockGetReceipt, ...(executeResult as object) })
);
const mockSign = jest.fn(() => ({ execute: mockExecute }));

// freezeWith returns an object that supports BOTH patterns:
//   freezeWith → sign → execute  (most transactions)
//   freezeWith → execute          (AccountCreateTransaction)
const mockFreezeWith = jest.fn(() => ({ sign: mockSign, execute: mockExecute }));

// Chainable builder — every setter returns `this`, terminal is freezeWith/execute
function chainable() {
  const obj: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop: string | symbol) {
      if (prop === 'freezeWith') return mockFreezeWith;
      if (prop === 'execute') return mockExecute;
      const key = String(prop);
      if (!obj[key]) {
        obj[key] = jest.fn(() => new Proxy({}, handler));
      }
      return obj[key];
    },
  };
  return new Proxy(obj, handler);
}

const mockAccountCreateTransaction = jest.fn(() => chainable());
const mockTokenCreateTransaction = jest.fn(() => chainable());
const mockTokenMintTransaction = jest.fn(() => chainable());
const mockTokenAssociateTransaction = jest.fn(() => chainable());
const mockTransferTransaction = jest.fn(() => chainable());
const mockBalanceQueryExecute = jest.fn();
const mockAccountBalanceQuery = jest.fn(() => ({
  setAccountId: jest.fn().mockReturnThis(),
  execute: mockBalanceQueryExecute,
}));

const mockSetOperator = jest.fn();
const mockSetDefaultMaxTransactionFee = jest.fn();
const mockForTestnet = jest.fn(() => ({
  setOperator: mockSetOperator,
  setDefaultMaxTransactionFee: mockSetDefaultMaxTransactionFee,
}));

const sdkMock = {
  Client: { forTestnet: mockForTestnet },
  AccountId: { fromString: jest.fn((s: string) => s) },
  PrivateKey: {
    fromStringDer: jest.fn((s: string) => ({
      publicKey: `pubkey-of-${s}`,
      toStringDer: () => s,
    })),
    generateED25519: jest.fn(() => ({
      publicKey: 'generated-pubkey',
      toStringDer: () => 'generated-privkey-der',
    })),
  },
  TokenId: { fromString: jest.fn((s: string) => s) },
  TokenType: { FungibleCommon: 'FungibleCommon', NonFungibleUnique: 'NonFungibleUnique' },
  TokenSupplyType: { Infinite: 'Infinite', Finite: 'Finite' },
  Hbar: jest.fn((n: number) => ({ _hbar: n })),
  AccountCreateTransaction: mockAccountCreateTransaction,
  TokenCreateTransaction: mockTokenCreateTransaction,
  TokenMintTransaction: mockTokenMintTransaction,
  TokenAssociateTransaction: mockTokenAssociateTransaction,
  TransferTransaction: mockTransferTransaction,
  AccountBalanceQuery: mockAccountBalanceQuery,
};

jest.mock('@hashgraph/sdk', () => sdkMock);

// ── Env setup ────────────────────────────────────────────────────────────

const OPERATOR_ID = '0.0.12345';
const OPERATOR_KEY = '302e020100300506032b6570042204200000';
const SPEND_NOTE_TOKEN_ID = '0.0.99999';

beforeAll(() => {
  process.env.HEDERA_OPERATOR_ID = OPERATOR_ID;
  process.env.HEDERA_OPERATOR_KEY = OPERATOR_KEY;
  process.env.SPEND_NOTE_TOKEN_ID = SPEND_NOTE_TOKEN_ID;
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  executeResult = {};
  receiptResult = {};
});

// Re-require hedera after resetModules to get a fresh singleton
function freshHedera() {
  jest.mock('@hashgraph/sdk', () => sdkMock);
  return require('../hedera');
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('getClient', () => {
  it('creates a testnet client with operator credentials', () => {
    const { getClient } = freshHedera();
    getClient();
    expect(mockForTestnet).toHaveBeenCalledTimes(1);
    expect(mockSetOperator).toHaveBeenCalledTimes(1);
    expect(mockSetDefaultMaxTransactionFee).toHaveBeenCalledTimes(1);
  });

  it('returns same instance on subsequent calls (singleton)', () => {
    const { getClient } = freshHedera();
    const c1 = getClient();
    const c2 = getClient();
    expect(c1).toBe(c2);
    expect(mockForTestnet).toHaveBeenCalledTimes(1);
  });
});

describe('getOperatorId / getOperatorKey', () => {
  it('returns the operator account ID from env', () => {
    const { getOperatorId } = freshHedera();
    expect(getOperatorId()).toBe(OPERATOR_ID);
  });

  it('returns the operator key from env', () => {
    const { getOperatorKey } = freshHedera();
    expect(getOperatorKey().toStringDer()).toBe(OPERATOR_KEY);
  });
});

describe('createAccount', () => {
  it('creates an account and returns accountId + privateKey', async () => {
    receiptResult = { accountId: { toString: () => '0.0.55555' } };

    const { createAccount } = freshHedera();
    const result = await createAccount();

    expect(result).toEqual({
      accountId: '0.0.55555',
      privateKey: 'generated-privkey-der',
    });
    expect(mockAccountCreateTransaction).toHaveBeenCalled();
    expect(mockFreezeWith).toHaveBeenCalled();
    // createAccount uses freezeWith → execute (no sign)
    expect(mockExecute).toHaveBeenCalled();
  });
});

describe('createFungibleToken', () => {
  it('creates a fungible token and returns the token ID', async () => {
    receiptResult = { tokenId: { toString: () => '0.0.77777' } };

    const { createFungibleToken } = freshHedera();
    const tokenId = await createFungibleToken('Mock Tesla', 'MOCK-TSLA', 1_000_000_000, 6);

    expect(tokenId).toBe('0.0.77777');
    expect(mockTokenCreateTransaction).toHaveBeenCalled();
    expect(mockSign).toHaveBeenCalled();
  });
});

describe('createNftCollection', () => {
  it('creates an NFT collection and returns the token ID', async () => {
    receiptResult = { tokenId: { toString: () => '0.0.88888' } };

    const { createNftCollection } = freshHedera();
    const tokenId = await createNftCollection('Spend Note', 'SPEND-NOTE', 1000);

    expect(tokenId).toBe('0.0.88888');
    expect(mockTokenCreateTransaction).toHaveBeenCalled();
  });
});

describe('mintSpendNote', () => {
  it('mints an NFT and returns the serial number', async () => {
    receiptResult = { serials: [{ toNumber: () => 42 }] };

    const { mintSpendNote } = freshHedera();
    const serial = await mintSpendNote(new TextEncoder().encode('test-metadata'));

    expect(serial).toBe(42);
    expect(mockTokenMintTransaction).toHaveBeenCalled();
  });
});

describe('mintSpendNoteWithIpfs', () => {
  const metadata = {
    name: 'Spend Note #1',
    asset: 'MOCK-TSLA',
    shares_collared: 222222,
    stock_price_at_spend: 225000000,
    collar_floor: 213750000,
    collar_cap: 258750000,
    advance_usdc: 50000000,
    platform_spread: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2026-02-21T00:00:00.000Z',
    status: 'active',
  };

  it('falls back to demo-cid when PINATA_API_KEY is not set', async () => {
    delete process.env.PINATA_API_KEY;
    receiptResult = { serials: [{ toNumber: () => 1 }] };

    const { mintSpendNoteWithIpfs } = freshHedera();
    const result = await mintSpendNoteWithIpfs(metadata);

    expect(result).toEqual({ serial: 1, cid: 'demo-cid' });
  });

  it('uploads to Pinata when PINATA_API_KEY is set', async () => {
    process.env.PINATA_API_KEY = 'test-pinata-key';
    receiptResult = { serials: [{ toNumber: () => 7 }] };

    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValueOnce({
      json: () => Promise.resolve({ IpfsHash: 'QmTestCid123' }),
    }) as unknown as typeof fetch;

    const { mintSpendNoteWithIpfs } = freshHedera();
    const result = await mintSpendNoteWithIpfs(metadata);

    expect(result).toEqual({ serial: 7, cid: 'QmTestCid123' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.pinata.cloud/pinning/pinJSONToIPFS',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer test-pinata-key',
        }),
      })
    );

    global.fetch = originalFetch;
    delete process.env.PINATA_API_KEY;
  });
});

describe('transferToken', () => {
  it('transfers fungible tokens and returns transaction ID', async () => {
    executeResult = { transactionId: { toString: () => '0.0.12345@1234567890.000' } };
    receiptResult = {};

    const { transferToken } = freshHedera();
    const txId = await transferToken('0.0.11111', '0.0.22222', '0.0.33333', 500_000_000);

    expect(txId).toBe('0.0.12345@1234567890.000');
    expect(mockTransferTransaction).toHaveBeenCalled();
    expect(mockSign).toHaveBeenCalled();
  });
});

describe('transferNft', () => {
  it('transfers an NFT and returns transaction ID', async () => {
    executeResult = { transactionId: { toString: () => '0.0.12345@9999999999.000' } };
    receiptResult = {};

    const { transferNft } = freshHedera();
    const txId = await transferNft('0.0.99999', 42, '0.0.12345', '0.0.55555');

    expect(txId).toBe('0.0.12345@9999999999.000');
    expect(mockTransferTransaction).toHaveBeenCalled();
  });
});

describe('getTokenBalances', () => {
  it('returns a map of token balances', async () => {
    const tokenMap = new Map<string, unknown>();
    tokenMap.set('0.0.11111', BigInt(1000000));
    tokenMap.set('0.0.22222', BigInt(500000000));

    mockBalanceQueryExecute.mockResolvedValueOnce({ tokens: tokenMap });

    const { getTokenBalances } = freshHedera();
    const balances = await getTokenBalances('0.0.55555');

    expect(balances).toBeInstanceOf(Map);
    expect(balances.get('0.0.11111')).toBe(1000000);
    expect(balances.get('0.0.22222')).toBe(500000000);
  });

  it('returns empty map when account has no tokens', async () => {
    mockBalanceQueryExecute.mockResolvedValueOnce({ tokens: null });

    const { getTokenBalances } = freshHedera();
    const balances = await getTokenBalances('0.0.55555');

    expect(balances).toBeInstanceOf(Map);
    expect(balances.size).toBe(0);
  });

  it('handles _map internal structure from SDK', async () => {
    const innerMap = new Map<string, unknown>();
    innerMap.set('0.0.33333', BigInt(250000));

    mockBalanceQueryExecute.mockResolvedValueOnce({
      tokens: { _map: innerMap },
    });

    const { getTokenBalances } = freshHedera();
    const balances = await getTokenBalances('0.0.55555');

    expect(balances.get('0.0.33333')).toBe(250000);
  });
});
