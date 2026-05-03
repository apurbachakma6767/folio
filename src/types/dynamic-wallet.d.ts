// Type declarations for packages whose .d.ts files don't ship in the dist.

// viem — types are referenced but not bundled in some install configurations
declare module 'viem' {
  export function encodeFunctionData(options: {
    abi: readonly unknown[];
    functionName: string;
    args?: readonly unknown[];
  }): string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createPublicClient(options: any): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function http(url?: string): any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function parseAbi<T extends readonly string[]>(abi: T): any;
}

declare module 'viem/chains' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const baseSepolia: any;
}

// @dynamic-labs/sdk-react-core — types not bundled in dist
declare module '@dynamic-labs/sdk-react-core' {
  import type { FC, ReactNode } from 'react';
  export function useDynamicContext(): {
    user?: { email?: string; userId?: string; firstName?: string; lastName?: string };
    primaryWallet?: { address: string; connector?: unknown };
    setShowAuthFlow: (show: boolean) => void;
    handleLogOut: () => Promise<void>;
    sdkHasLoaded: boolean;
  };
  export function useUserWallets(): Array<{
    address: string;
    chain?: string;
    connector?: { name: string; isEmbeddedWallet?: boolean };
  }>;
  export function getAuthToken(): Promise<string | null>;
  export const DynamicContextProvider: FC<{
    settings: Record<string, unknown>;
    theme?: string;
    children: ReactNode;
  }>;
}

// @dynamic-labs/ethereum — wallet connectors
declare module '@dynamic-labs/ethereum' {
  export const EthereumWalletConnectors: unknown;
}

declare module '@dynamic-labs-wallet/node-evm' {
  export class DynamicEvmWalletClient {
    constructor(options: { environmentId: string; enableMPCAccelerator?: boolean });
    authenticateApiToken(token: string): Promise<void>;
    createWalletAccount(options: {
      thresholdSignatureScheme: string;
      password?: string;
      backUpToClientShareService?: boolean;
      onError?: (error: Error) => void;
    }): Promise<{
      address: string;
      id: string;
      accountAddress: string;
      rawPublicKey: string;
      publicKeyHex: string;
      externalServerKeyShares?: string;
      walletId: string;
    }>;
    signMessage(options: { walletId: string; message: string }): Promise<string>;
    signTransaction(options: {
      walletId: string;
      transaction: Record<string, unknown>;
    }): Promise<string>;
  }

  export function createDelegatedEvmWalletClient(options: {
    environmentId: string;
    apiKey: string;
    baseMPCRelayApiUrl?: string;
    debug?: boolean;
  }): unknown;

  export function delegatedSignMessage(
    client: unknown,
    options: {
      walletId: string;
      walletApiKey: string;
      keyShare: string;
      message: string;
    }
  ): Promise<string>;

  export function delegatedSignTransaction(
    client: unknown,
    options: {
      walletId: string;
      walletApiKey: string;
      keyShare: string;
      transaction: Record<string, unknown>;
    }
  ): Promise<string>;

  export function delegatedSignTypedData(
    client: unknown,
    options: {
      walletId: string;
      walletApiKey: string;
      keyShare: string;
      typedData: Record<string, unknown>;
    }
  ): Promise<string>;

  export function revokeDelegation(
    client: unknown,
    options: { walletId: string; walletApiKey: string }
  ): Promise<void>;
}

declare module '@dynamic-labs-wallet/core' {
  export enum ThresholdSignatureScheme {
    TWO_OF_TWO = 'TWO_OF_TWO',
    TWO_OF_THREE = 'TWO_OF_THREE',
    THREE_OF_FIVE = 'THREE_OF_FIVE',
  }

  export enum WalletOperation {
    CREATE = 'CREATE',
    SIGN = 'SIGN',
  }

  export class DynamicWalletClient {
    constructor(options: { environmentId: string });
    authenticateApiToken(token: string): Promise<void>;
  }

  export function getMPCChainConfig(chain: string): unknown;
  export function getExternalServerKeyShareBackupInfo(
    walletId: string
  ): unknown;
}
