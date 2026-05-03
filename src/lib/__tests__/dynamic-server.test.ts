/**
 * Tests for Dynamic EVM server wallet helpers
 * Verifies client creation, caching, and signing operations
 */

const mockAuthenticateApiToken = jest.fn().mockResolvedValue(undefined);
const mockCreateWalletAccount = jest.fn().mockResolvedValue({
  address: '0xABCD1234',
  id: 'wallet-id-123',
});
const mockSignMessage = jest.fn().mockResolvedValue('0xsig-message');
const mockSignTransaction = jest.fn().mockResolvedValue('0xsig-tx');

jest.mock('@dynamic-labs-wallet/node-evm', () => ({
  DynamicEvmWalletClient: jest.fn().mockImplementation(() => ({
    authenticateApiToken: mockAuthenticateApiToken,
    createWalletAccount: mockCreateWalletAccount,
    signMessage: mockSignMessage,
    signTransaction: mockSignTransaction,
  })),
}));

jest.mock('@dynamic-labs-wallet/core', () => ({
  ThresholdSignatureScheme: { TWO_OF_TWO: 'TWO_OF_TWO' },
}));

describe('dynamic-server', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DYNAMIC_ENVIRONMENT_ID: 'test-env-id',
      DYNAMIC_API_TOKEN: 'test-api-token',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDynamicEvmClient', () => {
    it('creates client with env vars and authenticates', async () => {
      const { getDynamicEvmClient } = await import('../dynamic-server');
      const { DynamicEvmWalletClient } = await import(
        '@dynamic-labs-wallet/node-evm'
      );

      const client = await getDynamicEvmClient();

      expect(DynamicEvmWalletClient).toHaveBeenCalledWith({
        environmentId: 'test-env-id',
      });
      expect(mockAuthenticateApiToken).toHaveBeenCalledWith('test-api-token');
      expect(client).toBeDefined();
    });

    it('returns cached instance on second call', async () => {
      const { getDynamicEvmClient } = await import('../dynamic-server');
      const { DynamicEvmWalletClient } = await import(
        '@dynamic-labs-wallet/node-evm'
      );

      const first = await getDynamicEvmClient();
      const second = await getDynamicEvmClient();

      expect(first).toBe(second);
      expect(DynamicEvmWalletClient).toHaveBeenCalledTimes(1);
      expect(mockAuthenticateApiToken).toHaveBeenCalledTimes(1);
    });

    it('throws when env vars are missing', async () => {
      delete process.env.DYNAMIC_ENVIRONMENT_ID;
      delete process.env.DYNAMIC_API_TOKEN;

      const { getDynamicEvmClient } = await import('../dynamic-server');

      await expect(getDynamicEvmClient()).rejects.toThrow(
        'Missing DYNAMIC_ENVIRONMENT_ID or DYNAMIC_API_TOKEN'
      );
    });
  });

  describe('createServerWallet', () => {
    it('calls createWalletAccount with TWO_OF_TWO', async () => {
      const { createServerWallet } = await import('../dynamic-server');

      const result = await createServerWallet();

      expect(result).toEqual({
        address: '0xABCD1234',
        walletId: 'wallet-id-123',
      });
      expect(mockCreateWalletAccount).toHaveBeenCalledWith({
        thresholdSignatureScheme: 'TWO_OF_TWO',
      });
    });
  });

  describe('serverWalletSignMessage', () => {
    it('calls client.signMessage with correct params', async () => {
      const { serverWalletSignMessage } = await import('../dynamic-server');

      const sig = await serverWalletSignMessage('wallet-1', 'hello');

      expect(mockSignMessage).toHaveBeenCalledWith({
        walletId: 'wallet-1',
        message: 'hello',
      });
      expect(sig).toBe('0xsig-message');
    });
  });

  describe('serverWalletSignTransaction', () => {
    it('calls client.signTransaction with correct params', async () => {
      const { serverWalletSignTransaction } = await import(
        '../dynamic-server'
      );

      const tx = {
        to: '0xRecipient',
        value: '1000',
        data: '0x',
        chainId: 1,
      };
      const sig = await serverWalletSignTransaction('wallet-2', tx);

      expect(mockSignTransaction).toHaveBeenCalledWith({
        walletId: 'wallet-2',
        transaction: tx,
      });
      expect(sig).toBe('0xsig-tx');
    });
  });
});
