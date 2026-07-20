// Hedera network + Thrive/mainnet safety configuration
//
// HEDERA_NETWORK=testnet|mainnet (default: testnet)
// Production guards protect a small real-USDC treasury on mainnet.

export type HederaNetworkName = 'testnet' | 'mainnet';

export function getHederaNetwork(): HederaNetworkName {
  const raw = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase().trim();
  if (raw === 'mainnet') return 'mainnet';
  return 'testnet';
}

export function isMainnet(): boolean {
  return getHederaNetwork() === 'mainnet';
}

export function isProduction(): boolean {
  return (
    process.env.FOLIO_ENV === 'production' ||
    process.env.NODE_ENV === 'production' ||
    isMainnet()
  );
}

/** Public HashScan base URL for explorer links in the UI. */
export function getHashscanBase(): string {
  if (process.env.NEXT_PUBLIC_HASHSCAN_BASE) {
    return process.env.NEXT_PUBLIC_HASHSCAN_BASE.replace(/\/$/, '');
  }
  return isMainnet()
    ? 'https://hashscan.io/mainnet'
    : 'https://hashscan.io/testnet';
}

/** Mirror Node REST base URL. */
export function getMirrorNodeBase(): string {
  if (process.env.HEDERA_MIRROR_NODE_URL) {
    return process.env.HEDERA_MIRROR_NODE_URL.replace(/\/$/, '');
  }
  return isMainnet()
    ? 'https://mainnet-public.mirrornode.hedera.com'
    : 'https://testnet.mirrornode.hedera.com';
}

/** JSON-RPC (HashIO) for EVM contract reads. */
export function getHederaRpcUrl(): string {
  if (isMainnet()) {
    return process.env.HEDERA_MAINNET_RPC_URL || 'https://mainnet.hashio.io/api';
  }
  return process.env.HEDERA_TESTNET_RPC_URL || 'https://testnet.hashio.io/api';
}

/** Hedera EVM chain id: mainnet 295, testnet 296. */
export function getHederaEvmChainId(): number {
  return isMainnet() ? 295 : 296;
}

/**
 * USDC HTS token id.
 * Prefer USDC_TOKEN_ID (Circle mainnet 0.0.456858); fall back to USDC_TEST_TOKEN_ID.
 */
export function getUsdcTokenId(): string | undefined {
  return (
    process.env.USDC_TOKEN_ID?.trim() ||
    process.env.USDC_TEST_TOKEN_ID?.trim() ||
    undefined
  );
}

/** HBAR to fund new user accounts (mainnet should stay low). */
export function getInitialAccountHbar(): number {
  const raw = process.env.INITIAL_ACCOUNT_HBAR;
  if (raw != null && raw !== '' && !Number.isNaN(Number(raw))) {
    return Math.max(0.1, Number(raw));
  }
  return isMainnet() ? 1 : 5;
}

// ── Spend / treasury guards ─────────────────────────────────────────────

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (v == null || v === '') return defaultValue;
  return !['0', 'false', 'no', 'off'].includes(v.toLowerCase());
}

function envNumber(key: string, defaultValue: number): number {
  const v = process.env[key];
  if (v == null || v === '' || Number.isNaN(Number(v))) return defaultValue;
  return Number(v);
}

/** Kill switch for all advances. */
export function isSpendPaused(): boolean {
  return envBool('SPEND_PAUSED', false);
}

/**
 * Mint free Folio equity HTS to new users / holdings sync.
 * Default: false on mainnet/production (users acquire stock via Trade or external deposit).
 * Testnet default: true for local demo UX.
 */
export function allowDemoMintStock(): boolean {
  return envBool('ALLOW_DEMO_MINT_STOCK', !isProduction());
}

/**
 * Auto-top-up free USDC to users. Must be false on mainnet with real USDC.
 * Default: false on mainnet/production, true on testnet for hackathon demo.
 */
export function allowAutoFundUsdc(): boolean {
  return envBool('ALLOW_AUTO_FUND_USDC', !isProduction());
}

/**
 * Allow minting USDC when treasury is low. Never for Circle USDC.
 * Default: false on mainnet/production.
 */
export function allowMintUsdc(): boolean {
  return envBool('ALLOW_MINT_USDC', !isProduction());
}

/** Require FolioCollateralVault (no legacy operator transfer). */
export function requireVault(): boolean {
  return envBool('REQUIRE_VAULT', isMainnet());
}

/** Max single spend in USD. */
export function getMaxSpendUsdc(): number {
  return envNumber('MAX_SPEND_USDC', isMainnet() ? 2 : 1_000_000);
}

/** Max sum of active advances (all users) in USD. */
export function getMaxOutstandingUsdc(): number {
  return envNumber('MAX_OUTSTANDING_USDC', isMainnet() ? 10 : 1_000_000);
}

/** Max sum of active advances per user in USD. */
export function getPerUserMaxSpendUsdc(): number {
  return envNumber('PER_USER_MAX_SPEND_USDC', isMainnet() ? 5 : 1_000_000);
}
