import {
  createDelegatedEvmWalletClient,
  delegatedSignMessage,
  delegatedSignTransaction,
} from '@dynamic-labs-wallet/node-evm';
import crypto from 'crypto';

export interface DelegationCredentials {
  walletId: string;
  walletApiKey: string;
  keyShare: string;
}

let cachedClient: ReturnType<typeof createDelegatedEvmWalletClient> | null = null;

/**
 * Creates and caches a delegated EVM wallet client.
 */
export function getDelegatedClient() {
  if (cachedClient) return cachedClient;

  cachedClient = createDelegatedEvmWalletClient({
    environmentId: process.env.DYNAMIC_ENVIRONMENT_ID!,
    apiKey: (process.env.DYNAMIC_AUTH_TOKEN || process.env.DYNAMIC_API_TOKEN || process.env.DYNAMIC_API_KEY)!,
  });

  return cachedClient;
}

/**
 * Decrypts delegation webhook payload using RSA private key.
 */
export function decryptWebhookPayload(encryptedData: string): DelegationCredentials {
  const privateKey = process.env.DYNAMIC_DELEGATION_PRIVATE_KEY!;

  const decrypted = crypto.privateDecrypt(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(encryptedData, 'base64'),
  );

  return JSON.parse(decrypted.toString('utf-8')) as DelegationCredentials;
}

/**
 * Signs a message on behalf of a user using delegated credentials.
 */
export async function delegatedSign(
  credentials: DelegationCredentials,
  message: string,
): Promise<string> {
  const client = getDelegatedClient();

  const signature = await delegatedSignMessage(client, {
    walletId: credentials.walletId,
    walletApiKey: credentials.walletApiKey,
    keyShare: credentials.keyShare,
    message,
  });

  return signature;
}

/**
 * Signs a transaction on behalf of a user using delegated credentials.
 */
export async function delegatedSignTx(
  credentials: DelegationCredentials,
  transaction: Record<string, unknown>,
): Promise<string> {
  const client = getDelegatedClient();

  const signature = await delegatedSignTransaction(client, {
    walletId: credentials.walletId,
    walletApiKey: credentials.walletApiKey,
    keyShare: credentials.keyShare,
    transaction,
  });

  return signature;
}
