/**
 * Tests for Dynamic delegated wallet helpers
 * Verifies client caching, message signing, and transaction signing
 */

const mockDelegatedClient = { type: 'delegated-client' };
const mockCreateDelegatedEvmWalletClient = jest
  .fn()
  .mockReturnValue(mockDelegatedClient);
const mockDelegatedSignMessage = jest
  .fn()
  .mockResolvedValue('0xdelegated-sig');
const mockDelegatedSignTransaction = jest
  .fn()
  .mockResolvedValue('0xdelegated-tx-sig');

jest.mock('@dynamic-labs-wallet/node-evm', () => ({
  createDelegatedEvmWalletClient: mockCreateDelegatedEvmWalletClient,
  delegatedSignMessage: mockDelegatedSignMessage,
  delegatedSignTransaction: mockDelegatedSignTransaction,
}));

jest.mock('crypto', () => ({
  privateDecrypt: jest.fn().mockReturnValue(
    Buffer.from(
      JSON.stringify({
        walletId: 'w-1',
        walletApiKey: 'key-1',
        keyShare: 'share-1',
      })
    )
  ),
  constants: { RSA_PKCS1_OAEP_PADDING: 4 },
}));

describe('dynamic-delegation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      DYNAMIC_ENVIRONMENT_ID: 'test-env-id',
      DYNAMIC_API_TOKEN: 'test-api-token',
      DYNAMIC_DELEGATION_PRIVATE_KEY: 'test-private-key',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDelegatedClient', () => {
    it('creates client with env vars', async () => {
      const { getDelegatedClient } = await import('../dynamic-delegation');

      const client = getDelegatedClient();

      expect(mockCreateDelegatedEvmWalletClient).toHaveBeenCalledWith({
        environmentId: 'test-env-id',
        apiKey: 'test-api-token',
      });
      expect(client).toBe(mockDelegatedClient);
    });

    it('returns cached instance on second call', async () => {
      const { getDelegatedClient } = await import('../dynamic-delegation');

      const first = getDelegatedClient();
      const second = getDelegatedClient();

      expect(first).toBe(second);
      expect(mockCreateDelegatedEvmWalletClient).toHaveBeenCalledTimes(1);
    });
  });

  describe('decryptWebhookPayload', () => {
    it('decrypts encrypted data using RSA private key', async () => {
      const crypto = await import('crypto');
      const { decryptWebhookPayload } = await import(
        '../dynamic-delegation'
      );

      const result = decryptWebhookPayload('base64-encrypted-data');

      expect(crypto.privateDecrypt).toHaveBeenCalledWith(
        {
          key: 'test-private-key',
          padding: 4,
          oaepHash: 'sha256',
        },
        expect.any(Buffer)
      );
      expect(result).toEqual({
        walletId: 'w-1',
        walletApiKey: 'key-1',
        keyShare: 'share-1',
      });
    });
  });

  describe('delegatedSign', () => {
    it('calls delegatedSignMessage with correct params', async () => {
      const { delegatedSign } = await import('../dynamic-delegation');

      const credentials = {
        walletId: 'w-1',
        walletApiKey: 'key-1',
        keyShare: 'share-1',
      };
      const sig = await delegatedSign(credentials, 'hello');

      expect(mockDelegatedSignMessage).toHaveBeenCalledWith(
        mockDelegatedClient,
        {
          walletId: 'w-1',
          walletApiKey: 'key-1',
          keyShare: 'share-1',
          message: 'hello',
        }
      );
      expect(sig).toBe('0xdelegated-sig');
    });
  });

  describe('delegatedSignTx', () => {
    it('calls delegatedSignTransaction with correct params', async () => {
      const { delegatedSignTx } = await import('../dynamic-delegation');

      const credentials = {
        walletId: 'w-2',
        walletApiKey: 'key-2',
        keyShare: 'share-2',
      };
      const tx = { to: '0xRecipient', value: '1000' };
      const sig = await delegatedSignTx(credentials, tx);

      expect(mockDelegatedSignTransaction).toHaveBeenCalledWith(
        mockDelegatedClient,
        {
          walletId: 'w-2',
          walletApiKey: 'key-2',
          keyShare: 'share-2',
          transaction: tx,
        }
      );
      expect(sig).toBe('0xdelegated-tx-sig');
    });
  });
});
