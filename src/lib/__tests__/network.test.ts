/**
 * Tests for src/lib/network.ts — network selection and Thrive spend guards.
 */

describe('network config', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function load() {
    return require('../network') as typeof import('../network');
  }

  it('defaults to testnet', () => {
    delete process.env.HEDERA_NETWORK;
    const { getHederaNetwork, isMainnet, getHashscanBase, getMirrorNodeBase } = load();
    expect(getHederaNetwork()).toBe('testnet');
    expect(isMainnet()).toBe(false);
    expect(getHashscanBase()).toContain('testnet');
    expect(getMirrorNodeBase()).toContain('testnet');
  });

  it('selects mainnet URLs when HEDERA_NETWORK=mainnet', () => {
    process.env.HEDERA_NETWORK = 'mainnet';
    const {
      getHederaNetwork,
      isMainnet,
      getHashscanBase,
      getMirrorNodeBase,
      getHederaEvmChainId,
      getInitialAccountHbar,
      getMaxSpendUsdc,
      getMaxOutstandingUsdc,
      allowAutoFundUsdc,
      allowMintUsdc,
      allowDemoMintStock,
    } = load();
    expect(getHederaNetwork()).toBe('mainnet');
    expect(isMainnet()).toBe(true);
    expect(getHashscanBase()).toBe('https://hashscan.io/mainnet');
    expect(getMirrorNodeBase()).toContain('mainnet');
    expect(getHederaEvmChainId()).toBe(295);
    expect(getInitialAccountHbar()).toBe(1);
    expect(getMaxSpendUsdc()).toBe(2);
    expect(getMaxOutstandingUsdc()).toBe(10);
    expect(allowAutoFundUsdc()).toBe(false);
    expect(allowMintUsdc()).toBe(false);
    expect(allowDemoMintStock()).toBe(false);
  });

  it('respects env overrides for caps and flags', () => {
    process.env.HEDERA_NETWORK = 'mainnet';
    process.env.MAX_SPEND_USDC = '1';
    process.env.ALLOW_AUTO_FUND_USDC = 'true';
    process.env.INITIAL_ACCOUNT_HBAR = '0.5';
    const { getMaxSpendUsdc, allowAutoFundUsdc, getInitialAccountHbar } = load();
    expect(getMaxSpendUsdc()).toBe(1);
    expect(allowAutoFundUsdc()).toBe(true);
    expect(getInitialAccountHbar()).toBe(0.5);
  });

  it('getUsdcTokenId prefers USDC_TOKEN_ID over USDC_TEST_TOKEN_ID', () => {
    process.env.USDC_TOKEN_ID = '0.0.456858';
    process.env.USDC_TEST_TOKEN_ID = '0.0.999';
    const { getUsdcTokenId } = load();
    expect(getUsdcTokenId()).toBe('0.0.456858');
  });
});
