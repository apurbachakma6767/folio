import { DynamicEvmWalletClient } from '@dynamic-labs-wallet/node-evm';
import { ThresholdSignatureScheme } from '@dynamic-labs-wallet/core';

// Module-level singleton (persists across warm serverless invocations)
let clientInstance: DynamicEvmWalletClient | null = null;
let clientAuthenticated = false;

/**
 * Get or create the cached DynamicEvmWalletClient singleton.
 * Authenticates with DYNAMIC_API_TOKEN on first call.
 */
export async function getDynamicEvmClient(): Promise<DynamicEvmWalletClient> {
  if (clientInstance && clientAuthenticated) return clientInstance;

  const environmentId = process.env.DYNAMIC_ENVIRONMENT_ID!;
  const authToken = (process.env.DYNAMIC_AUTH_TOKEN || process.env.DYNAMIC_API_TOKEN || process.env.DYNAMIC_API_KEY)!;

  if (!environmentId || !authToken) {
    throw new Error(
      'Missing DYNAMIC_ENVIRONMENT_ID or DYNAMIC_API_TOKEN environment variables'
    );
  }

  clientInstance = new DynamicEvmWalletClient({ environmentId });
  await clientInstance.authenticateApiToken(authToken);
  clientAuthenticated = true;

  return clientInstance;
}

/**
 * Create a 2-of-2 MPC server wallet.
 * Returns the wallet address and wallet ID.
 */
export async function createServerWallet(): Promise<{
  address: string;
  walletId: string;
}> {
  const client = await getDynamicEvmClient();

  const wallet = await client.createWalletAccount({
    thresholdSignatureScheme: ThresholdSignatureScheme.TWO_OF_TWO,
  });

  return {
    address: wallet.address,
    walletId: wallet.id,
  };
}

/**
 * Sign an arbitrary message with a server wallet.
 */
export async function serverWalletSignMessage(
  walletId: string,
  message: string
): Promise<string> {
  const client = await getDynamicEvmClient();
  const signature = await client.signMessage({ walletId, message });
  return signature;
}

/**
 * Sign a transaction with a server wallet.
 */
export async function serverWalletSignTransaction(
  walletId: string,
  transaction: {
    to: string;
    value?: string;
    data?: string;
    chainId?: number;
    nonce?: number;
    gasLimit?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
  }
): Promise<string> {
  const client = await getDynamicEvmClient();
  const signedTransaction = await client.signTransaction({
    walletId,
    transaction,
  });
  return signedTransaction;
}
