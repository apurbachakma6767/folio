const originalEnv = process.env;

beforeEach(() => {
  process.env = { ...originalEnv };
});

afterAll(() => {
  process.env = originalEnv;
});

describe('lithic mock mode', () => {
  it('returns a mock virtual card when LITHIC_MOCK=true', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard } = await import('../lithic');

    const result = await issueVirtualCard(5000); // $50.00 in cents

    expect(result.success).toBe(true);
    expect(result.card).toBeDefined();
    expect(result.card!.pan).toMatch(/^4000/); // Visa test prefix
    expect(result.card!.cvv).toBe('123');
    expect(result.card!.expMonth).toBe('12');
    expect(result.card!.expYear).toBe('2030');
    expect(result.card!.state).toBe('OPEN');
    expect(result.card!.spendLimit).toBe(5000);
    expect(result.card!.spendLimitDuration).toBe('FOREVER');
    expect(result.card!.totalSpent).toBe(0);
    expect(result.card!.token).toMatch(/^mock-card-/);
  });

  it('returns different spend limits for different amounts', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard } = await import('../lithic');

    const card1 = await issueVirtualCard(2500);
    const card2 = await issueVirtualCard(7500);

    expect(card1.card!.spendLimit).toBe(2500);
    expect(card2.card!.spendLimit).toBe(7500);
  });

  it('returns error when API fails and not in mock mode', async () => {
    process.env.LITHIC_MOCK = 'false';
    process.env.LITHIC_API_KEY = 'fake-key';

    jest.resetModules();
    const { issueVirtualCard } = await import('../lithic');

    const result = await issueVirtualCard(5000);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('freezes a mock card', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard, freezeCard } = await import('../lithic');

    const issued = await issueVirtualCard(5000);
    expect(issued.card!.state).toBe('OPEN');

    const frozen = await freezeCard(issued.card!.token);
    expect(frozen.success).toBe(true);
    expect(frozen.card!.state).toBe('PAUSED');
  });

  it('unfreezes a frozen mock card', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard, freezeCard, unfreezeCard } = await import('../lithic');

    const issued = await issueVirtualCard(5000);
    await freezeCard(issued.card!.token);

    const unfrozen = await unfreezeCard(issued.card!.token);
    expect(unfrozen.success).toBe(true);
    expect(unfrozen.card!.state).toBe('OPEN');
  });

  it('updates spend limit on a mock card', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard, updateSpendLimit } = await import('../lithic');

    const issued = await issueVirtualCard(5000);
    expect(issued.card!.spendLimit).toBe(5000);

    const updated = await updateSpendLimit(issued.card!.token, 10000);
    expect(updated.success).toBe(true);
    expect(updated.card!.spendLimit).toBe(10000);
  });

  it('returns error when freezing non-existent card in mock mode', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { freezeCard } = await import('../lithic');

    const result = await freezeCard('non-existent-token');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Card not found');
  });

  it('retrieves existing mock card details', async () => {
    process.env.LITHIC_MOCK = 'true';

    jest.resetModules();
    const { issueVirtualCard, getCardDetails } = await import('../lithic');

    const issued = await issueVirtualCard(3000);
    const details = await getCardDetails(issued.card!.token);

    expect(details.success).toBe(true);
    expect(details.card!.token).toBe(issued.card!.token);
    expect(details.card!.spendLimit).toBe(3000);
  });
});
