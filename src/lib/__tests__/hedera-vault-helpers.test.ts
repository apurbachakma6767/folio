import { hexWith0x, isFolioVaultConfigured } from '../hedera';

describe('hedera vault helpers', () => {
  const savedVault = process.env.FOLIO_VAULT_CONTRACT_ID;

  afterEach(() => {
    if (savedVault === undefined) delete process.env.FOLIO_VAULT_CONTRACT_ID;
    else process.env.FOLIO_VAULT_CONTRACT_ID = savedVault;
  });

  it('hexWith0x adds 0x when missing', () => {
    expect(hexWith0x('abcd'.repeat(10))).toBe(`0x${'abcd'.repeat(10)}`);
    expect(hexWith0x('0x' + 'ab'.repeat(20))).toBe(`0x${'ab'.repeat(20)}`);
  });

  it('isFolioVaultConfigured reads env', () => {
    delete process.env.FOLIO_VAULT_CONTRACT_ID;
    expect(isFolioVaultConfigured()).toBe(false);
    process.env.FOLIO_VAULT_CONTRACT_ID = '0.0.12345';
    expect(isFolioVaultConfigured()).toBe(true);
  });
});
