/**
 * Tests for server-side Hedera helpers (prepare/submit pattern)
 * Verifies the non-custodial transaction preparation flow
 */

// Mock the entire @hashgraph/sdk
const mockToBytes = jest.fn().mockReturnValue(new Uint8Array([10, 20, 30]));
const mockSign = jest.fn().mockResolvedValue(undefined);
const mockExecute = jest.fn().mockResolvedValue({
  getReceipt: jest.fn().mockResolvedValue({ accountId: { toString: () => '0.0.12345' } }),
  transactionId: { toString: () => '0.0.6256036@1234567890.000' },
});
const _mockFreezeWith = jest.fn().mockReturnThis();
const mockSetKey = jest.fn().mockReturnThis();
const mockSetInitialBalance = jest.fn().mockReturnThis();
const mockSetAccountId = jest.fn().mockReturnThis();
const mockSetTokenIds = jest.fn().mockReturnThis();
const mockSetTransactionValidDuration = jest.fn().mockReturnThis();
const mockAddTokenTransfer = jest.fn().mockReturnThis();

jest.mock('@hashgraph/sdk', () => {
  const mockClient = {
    setOperator: jest.fn(),
    setDefaultMaxTransactionFee: jest.fn(),
  };

  return {
    Client: { forTestnet: () => mockClient },
    AccountId: { fromString: (s: string) => ({ toString: () => s }) },
    PrivateKey: {
      fromStringDer: () => ({ publicKey: { toStringDer: () => 'mock-pub' } }),
      generateED25519: () => ({
        toStringDer: () => 'mock-priv-der',
        publicKey: { toStringDer: () => 'mock-pub-der', toString: () => 'mock-pub' },
      }),
    },
    PublicKey: {
      fromString: (s: string) => ({ toStringDer: () => s }),
      fromStringDer: (s: string) => ({ toStringDer: () => s }),
    },
    AccountCreateTransaction: jest.fn().mockImplementation(() => ({
      setKey: mockSetKey,
      setInitialBalance: mockSetInitialBalance,
      freezeWith: jest.fn().mockReturnValue({
        execute: mockExecute,
      }),
    })),
    TokenAssociateTransaction: jest.fn().mockImplementation(() => ({
      setAccountId: mockSetAccountId,
      setTokenIds: mockSetTokenIds,
      setTransactionValidDuration: mockSetTransactionValidDuration,
      freezeWith: jest.fn().mockReturnValue({
        toBytes: mockToBytes,
      }),
    })),
    TransferTransaction: jest.fn().mockImplementation(() => ({
      addTokenTransfer: mockAddTokenTransfer,
      setTransactionValidDuration: mockSetTransactionValidDuration,
      freezeWith: jest.fn().mockReturnValue({
        toBytes: mockToBytes,
      }),
    })),
    Transaction: {
      fromBytes: () => ({
        sign: mockSign,
        execute: mockExecute,
        toBytes: mockToBytes,
      }),
    },
    TokenId: { fromString: (s: string) => s },
    Hbar: jest.fn().mockImplementation((n: number) => n),
    TokenCreateTransaction: jest.fn(),
    TokenType: { FungibleCommon: 0, NonFungibleUnique: 1 },
    TokenSupplyType: { Infinite: 0, Finite: 1 },
    TokenMintTransaction: jest.fn(),
    AccountBalanceQuery: jest.fn(),
  };
});

// Set env vars before importing
process.env.HEDERA_OPERATOR_ID = '0.0.6256036';
process.env.HEDERA_OPERATOR_KEY = '302e020100300506032b65700422042000000000000000000000000000000000000000000000000000000000000000ff';

import {
  createAccountWithPublicKey,
  prepareTokenAssociation,
  prepareCollateralLock,
} from '../hedera';

describe('Non-custodial Hedera helpers', () => {
  describe('createAccountWithPublicKey', () => {
    it('creates account with provided public key, returns account ID', async () => {
      const accountId = await createAccountWithPublicKey('user-public-key-der');
      expect(accountId).toBe('0.0.12345');
      expect(mockSetKey).toHaveBeenCalled();
      expect(mockSetInitialBalance).toHaveBeenCalled();
    });
  });

  describe('prepareTokenAssociation', () => {
    it('returns unsigned transaction bytes', async () => {
      const bytes = await prepareTokenAssociation('0.0.12345', ['0.0.100', '0.0.200']);
      expect(bytes).toEqual(new Uint8Array([10, 20, 30]));
      expect(mockSetAccountId).toHaveBeenCalled();
      expect(mockSetTokenIds).toHaveBeenCalled();
      expect(mockSetTransactionValidDuration).toHaveBeenCalledWith(180);
    });
  });

  describe('prepareCollateralLock', () => {
    it('returns unsigned transfer transaction bytes', async () => {
      const bytes = await prepareCollateralLock('0.0.100', '0.0.12345', 1000000);
      expect(bytes).toEqual(new Uint8Array([10, 20, 30]));
      // Should add two token transfers (debit user, credit operator)
      expect(mockAddTokenTransfer).toHaveBeenCalledTimes(2);
    });
  });
});
