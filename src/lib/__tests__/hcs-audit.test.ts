/**
 * Tests for HCS audit logging integration:
 * 1. mirror-node decodeHcsMessage round-trip
 * 2. escrow audit failure resilience (HCS down shouldn't break transactions)
 */

import { decodeHcsMessage } from '../mirror-node';

// ── decodeHcsMessage round-trip ─────────────────────────────────────

describe('decodeHcsMessage', () => {
  it('decodes a valid base64 JSON message', () => {
    const payload = { type: 'COLLAR_REPAID', noteId: 1, timestamp: '2026-01-01' };
    const encoded = Buffer.from(JSON.stringify(payload)).toString('base64');
    expect(decodeHcsMessage(encoded)).toEqual(payload);
  });

  it('throws on malformed input (non-JSON after decode)', () => {
    // Node base64 decoder is permissive; the throw comes from JSON.parse
    expect(() => decodeHcsMessage('!!!not-base64!!!')).toThrow();
  });

  it('throws on non-JSON content', () => {
    const encoded = Buffer.from('just a string').toString('base64');
    expect(() => decodeHcsMessage(encoded)).toThrow();
  });
});

// ── escrow audit failure resilience ─────────────────────────────────

const mockTransferToken = jest.fn().mockResolvedValue('tx-transfer');
const mockGetOperatorId = jest.fn().mockReturnValue({ toString: () => '0.0.6256036' });
const mockSubmitAuditMessage = jest.fn();
const mockSettleNote = jest.fn().mockResolvedValue(undefined);

jest.mock('../hedera', () => ({
  transferToken: mockTransferToken,
  getOperatorId: mockGetOperatorId,
  submitAuditMessage: mockSubmitAuditMessage,
  submitSignedTransaction: jest.fn().mockResolvedValue(undefined),
  isFolioVaultConfigured: jest.fn().mockReturnValue(false),
  getFolioVaultContractId: jest.fn(),
  executeVaultRelease: jest.fn(),
}));

const mockGetNote = jest.fn();

jest.mock('../spend-notes', () => ({
  getNote: mockGetNote,
  settleNote: mockSettleNote,
}));

const mockGetStockPrice = jest.fn();

jest.mock('../price', () => ({
  getStockPrice: mockGetStockPrice,
}));

jest.mock('../token-registry', () => ({
  getTokenIdForSymbol: (s: string) => `0.0.${s === 'TSLA' ? '100' : '200'}`,
}));

// Set env vars before any imports that evaluate them at module load time
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const key of ['HEDERA_OPERATOR_ID', 'HEDERA_OPERATOR_KEY', 'USDC_TEST_TOKEN_ID', 'AUDIT_TOPIC_ID']) {
    savedEnv[key] = process.env[key];
  }
  process.env.HEDERA_OPERATOR_ID = '0.0.6256036';
  process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b65700422042000000000000000000000000000000000000000000000000000000000000000ff';
  process.env.USDC_TEST_TOKEN_ID = '0.0.300';
  process.env.AUDIT_TOPIC_ID = '0.0.400';
});

afterAll(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
});

describe('escrow audit failure resilience', () => {
  const activeNote = {
    id: 1,
    symbol: 'TSLA',
    serial: 1,
    recipient: '0.0.12345',
    recipientName: 'Test',
    amount: 100,
    shares: 0.5,
    sharesHts: 500_000,
    stockPrice: 250,
    floor: 200,
    cap: 300,
    durationMonths: 1,
    expiryDate: '2020-01-01T00:00:00.000Z', // safely in the past
    status: 'active',
    txId: 'tx-1',
    createdAt: '2019-12-01T00:00:00.000Z',
    userAccountId: '0.0.99999',
  };

  beforeEach(() => {
    jest.resetAllMocks();
    mockTransferToken.mockResolvedValue('tx-transfer');
    mockGetOperatorId.mockReturnValue({ toString: () => '0.0.6256036' });
    mockSettleNote.mockResolvedValue(undefined);
    mockGetNote.mockResolvedValue({ ...activeNote });
    mockGetStockPrice.mockResolvedValue({ price: 260, changePercent: 4 });
  });

  it('repayment succeeds even when HCS audit throws', async () => {
    mockSubmitAuditMessage.mockRejectedValue(new Error('HCS topic unavailable'));

    const { executeRepayment } = await import('../escrow');
    const result = await executeRepayment(1, '0.0.99999');

    expect(result.outcome).toBe('repaid');
    expect(mockSubmitAuditMessage).toHaveBeenCalled();
    expect(mockSettleNote).toHaveBeenCalled();
  });

  it('expired settlement succeeds even when HCS audit throws', async () => {
    mockSubmitAuditMessage.mockRejectedValue(new Error('HCS topic unavailable'));

    const { executeExpiredSettlement } = await import('../escrow');
    const result = await executeExpiredSettlement(1);

    expect(result.outcome).toBe('settled');
    expect(mockSubmitAuditMessage).toHaveBeenCalled();
    expect(mockSettleNote).toHaveBeenCalled();
  });

  it('repayment succeeds when AUDIT_TOPIC_ID is missing (no audit attempted)', async () => {
    const saved = process.env.AUDIT_TOPIC_ID;
    delete process.env.AUDIT_TOPIC_ID;
    try {
      const { executeRepayment } = await import('../escrow');
      const result = await executeRepayment(1, '0.0.99999');

      expect(result.outcome).toBe('repaid');
      expect(mockSubmitAuditMessage).not.toHaveBeenCalled();
      expect(mockSettleNote).toHaveBeenCalled();
    } finally {
      process.env.AUDIT_TOPIC_ID = saved;
    }
  });
});
