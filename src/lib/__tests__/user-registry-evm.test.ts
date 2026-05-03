/**
 * Tests for EVM-related user registry functions
 * Verifies updateEvmWallet and storeDelegationCredentials
 */

const mockUpdate = jest.fn();
const mockEq = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: jest.fn().mockReturnValue({
      update: (...args: unknown[]) => {
        mockUpdate(...args);
        return { eq: (...eqArgs: unknown[]) => {
          mockEq(...eqArgs);
          return { error: null };
        }};
      },
    }),
  },
}));

import { updateEvmWallet, storeDelegationCredentials } from '../user-registry';

describe('user-registry EVM functions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('updateEvmWallet', () => {
    it('calls supabase update with correct params', async () => {
      await updateEvmWallet('Alice@example.com', '0xWalletAddr');

      expect(mockUpdate).toHaveBeenCalledWith({
        evm_wallet_address: '0xWalletAddr',
      });
      expect(mockEq).toHaveBeenCalledWith('email', 'alice@example.com');
    });

    it('throws on supabase error', async () => {
      const { supabase } = await import('@/lib/supabase');
      (supabase.from as jest.Mock).mockReturnValueOnce({
        update: () => ({
          eq: () => ({ error: { message: 'db error' } }),
        }),
      });

      await expect(
        updateEvmWallet('alice@example.com', '0xAddr')
      ).rejects.toEqual({ message: 'db error' });
    });
  });

  describe('storeDelegationCredentials', () => {
    it('stores all three credential fields', async () => {
      await storeDelegationCredentials(
        'Bob@example.com',
        'wallet-id-1',
        'api-key-1',
        'key-share-1'
      );

      expect(mockUpdate).toHaveBeenCalledWith({
        delegation_wallet_id: 'wallet-id-1',
        delegation_api_key: 'api-key-1',
        delegation_key_share: 'key-share-1',
      });
      expect(mockEq).toHaveBeenCalledWith('email', 'bob@example.com');
    });

    it('throws on supabase error', async () => {
      const { supabase } = await import('@/lib/supabase');
      (supabase.from as jest.Mock).mockReturnValueOnce({
        update: () => ({
          eq: () => ({ error: { message: 'insert failed' } }),
        }),
      });

      await expect(
        storeDelegationCredentials('bob@example.com', 'w', 'k', 's')
      ).rejects.toEqual({ message: 'insert failed' });
    });
  });
});
