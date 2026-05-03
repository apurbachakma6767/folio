/**
 * Tests for escrow executor — orchestrates Hedera transfers for repayment and settlement.
 * Verifies HTS transfers, Supabase state updates, and HCS audit logging.
 */

const mockTransferToken = jest.fn().mockResolvedValue('tx-transfer');
const mockGetOperatorId = jest.fn().mockReturnValue({ toString: () => '0.0.6256036' });
const mockSubmitAuditMessage = jest.fn().mockResolvedValue(undefined);
const mockSubmitSignedTransaction = jest.fn().mockResolvedValue(undefined);

jest.mock('../hedera', () => ({
  transferToken: mockTransferToken,
  getOperatorId: mockGetOperatorId,
  submitAuditMessage: mockSubmitAuditMessage,
  submitSignedTransaction: mockSubmitSignedTransaction,
  isFolioVaultConfigured: jest.fn().mockReturnValue(false),
  getFolioVaultContractId: jest.fn().mockReturnValue('0.0.777'),
  executeVaultRelease: jest.fn().mockResolvedValue('vault-release-tx'),
}));

const mockGetNote = jest.fn();
const mockSettleNote = jest.fn().mockResolvedValue(undefined);

jest.mock('../spend-notes', () => ({
  getNote: mockGetNote,
  settleNote: mockSettleNote,
}));

jest.mock('../price', () => ({
  getStockPrice: jest.fn().mockResolvedValue({ price: 260, changePercent: 4 }),
}));

jest.mock('../token-registry', () => ({
  getTokenIdForSymbol: (s: string) => `0.0.${s === 'TSLA' ? '100' : '200'}`,
}));

// Set env vars
process.env.HEDERA_OPERATOR_ID = '0.0.6256036';
process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b65700422042000000000000000000000000000000000000000000000000000000000000000ff';
process.env.USDC_TEST_TOKEN_ID = '0.0.300';
process.env.AUDIT_TOPIC_ID = '0.0.400';

import * as hedera from '../hedera';
import { executeRepayment, executeExpiredSettlement } from '../escrow';

const activeNote = {
  id: 1,
  symbol: 'MOCK-TSLA',
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
  expiryDate: '2026-03-01T00:00:00.000Z', // expired
  status: 'active' as const,
  txId: 'tx-1',
  createdAt: '2026-02-01T00:00:00.000Z',
  userAccountId: '0.0.99999',
};

describe('escrow executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('executeRepayment', () => {
    it('returns all collateral shares to user and logs audit', async () => {
      mockGetNote.mockResolvedValue({ ...activeNote });

      const fakeSignedTx = Buffer.from('fake-signed-tx').toString('base64');
      const result = await executeRepayment(1, '0.0.99999', fakeSignedTx);

      expect(result.outcome).toBe('repaid');
      expect(result.sharesToReturnHts).toBe(500_000);

      // User-signed USDC repayment submitted
      expect(mockSubmitSignedTransaction).toHaveBeenCalledWith(
        expect.any(Uint8Array),
      );
      // Shares from operator back to user (only transferToken call, USDC
      // repayment is now user-signed via signedRepayTxBytes, not server-side)
      expect(mockTransferToken).toHaveBeenCalledWith(
        '0.0.100', '0.0.6256036', '0.0.99999', 500_000,
      );
      expect(mockTransferToken).toHaveBeenCalledTimes(1);

      // Supabase update
      expect(mockSettleNote).toHaveBeenCalledWith(1, expect.objectContaining({
        status: 'repaid',
        settlementSharesReturned: 500_000,
      }));
      // HCS audit
      expect(mockSubmitAuditMessage).toHaveBeenCalledWith(
        '0.0.400',
        expect.objectContaining({ type: 'COLLAR_REPAID', noteId: 1 }),
      );
    });

    it('rejects if note is not active', async () => {
      mockGetNote.mockResolvedValue({ ...activeNote, status: 'repaid' });

      await expect(executeRepayment(1, '0.0.99999'))
        .rejects.toThrow('already repaid');
    });

    it('rejects if account does not match', async () => {
      mockGetNote.mockResolvedValue({ ...activeNote });

      await expect(executeRepayment(1, '0.0.different'))
        .rejects.toThrow('Unauthorized');
    });

    it('rejects if note not found', async () => {
      mockGetNote.mockResolvedValue(null);

      await expect(executeRepayment(99, '0.0.99999'))
        .rejects.toThrow('not found');
    });

    it('uses vault release when FOLIO vault is configured', async () => {
      (hedera.isFolioVaultConfigured as jest.Mock).mockReturnValueOnce(true);
      mockGetNote.mockResolvedValue({ ...activeNote });

      const fakeSignedTx = Buffer.from('fake-signed-tx').toString('base64');
      await executeRepayment(1, '0.0.99999', fakeSignedTx);

      expect(hedera.executeVaultRelease).toHaveBeenCalledWith(
        '0.0.777',
        '0.0.100',
        '0.0.99999',
        500_000,
      );
      expect(mockTransferToken).not.toHaveBeenCalled();
    });
  });

  describe('executeExpiredSettlement', () => {
    it('settles expired collar and returns excess shares', async () => {
      mockGetNote.mockResolvedValue({ ...activeNote });

      const result = await executeExpiredSettlement(1);

      expect(result.outcome).toBe('settled');
      expect(result.sharesToReturnHts).toBeGreaterThan(0);

      // Should transfer remaining shares back to user
      expect(mockTransferToken).toHaveBeenCalledWith(
        '0.0.100', '0.0.6256036', '0.0.99999', result.sharesToReturnHts,
      );
      // Supabase update
      expect(mockSettleNote).toHaveBeenCalledWith(1, expect.objectContaining({
        status: 'settled',
      }));
      // HCS audit
      expect(mockSubmitAuditMessage).toHaveBeenCalledWith(
        '0.0.400',
        expect.objectContaining({ type: 'COLLAR_SETTLED' }),
      );
    });

    it('rejects if note has not expired yet', async () => {
      const futureNote = { ...activeNote, expiryDate: '2099-01-01T00:00:00.000Z' };
      mockGetNote.mockResolvedValue(futureNote);

      await expect(executeExpiredSettlement(1))
        .rejects.toThrow('has not expired yet');
    });
  });
});
