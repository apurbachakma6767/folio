// Setup script: creates tokens + HCS audit topic on Hedera (testnet or mainnet)
// Run: npx tsx scripts/setup.ts
//
// Creates:
//   1. TSLA equity HTS (KYC + freeze) — bootstrap only
//   2. AAPL equity HTS (KYC + freeze) — bootstrap only
//   3. USDC-TEST stablecoin (skipped if USE_NATIVE_USDC=true → Circle USDC)
//   4. SPEND-NOTE — NFT collection for structured spend notes
//   5. Audit Topic — HCS topic for verifiable audit trail
//
// Remaining Trade symbols (NVDA, MSFT, …): npx tsx scripts/ensure-all-equity-tokens.ts
// Primary store for equity IDs: Supabase folio_equity_tokens (env is optional seed only).
//
// Mainnet Thrive: set HEDERA_NETWORK=mainnet USE_NATIVE_USDC=true
// and use Circle USDC 0.0.456858 as USDC_TOKEN_ID (see scripts/setup-mainnet.ts).

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config();

import {
  Client,
  AccountId,
  PrivateKey,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TopicCreateTransaction,
  CustomFractionalFee,
  Hbar,
} from '@hashgraph/sdk';

async function main() {
  const operatorId = AccountId.fromString(process.env.HEDERA_OPERATOR_ID!);
  // Support DER, ECDSA hex, or auto (see parsePrivateKey in hedera.ts)
  const { parsePrivateKey } = await import('../src/lib/hedera');
  const operatorKey = parsePrivateKey(process.env.HEDERA_OPERATOR_KEY!);
  const network = (process.env.HEDERA_NETWORK || 'testnet').toLowerCase();
  const useNativeUsdc = ['1', 'true', 'yes'].includes(
    (process.env.USE_NATIVE_USDC || '').toLowerCase()
  );

  const client = network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(50));

  console.log(`Network: ${network}`);
  console.log(`Operator: ${operatorId}`);
  console.log(`USE_NATIVE_USDC: ${useNativeUsdc}\n`);

  // Folio HTS equity tokens (tokenized positions), not CUSIP broker shares.
  // On-chain + env keys use clean symbols (TSLA / AAPL), never MOCK-*.
  const isMainnet = network === 'mainnet';
  const tslaName = isMainnet ? 'Tesla' : 'Tesla (Testnet)';
  const tslaSymbol = 'TSLA';
  const aaplName = isMainnet ? 'Apple' : 'Apple (Testnet)';
  const aaplSymbol = 'AAPL';

  // ── 1. TSLA equity HTS (KYC + freeze) ─────────────────────────────
  console.log(`Creating ${tslaSymbol} HTS (${tslaName})...`);
  const tslaCreate = new TokenCreateTransaction()
    .setTokenName(tslaName)
    .setTokenSymbol(tslaSymbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(0) // operator is supply key only — no treasury stock inventory
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .setKycKey(operatorKey.publicKey)      // KYC gating
    .setFreezeKey(operatorKey.publicKey)    // Freeze capability
    .freezeWith(client);

  const tslaSigned = await tslaCreate.sign(operatorKey);
  const tslaResp = await tslaSigned.execute(client);
  const tslaId = (await tslaResp.getReceipt(client)).tokenId!;
  console.log(`  TSLA_TOKEN_ID=${tslaId}`);

  // ── 2. AAPL equity HTS (KYC + freeze) ─────────────────────────────
  console.log(`Creating ${aaplSymbol} HTS (${aaplName})...`);
  const aaplCreate = new TokenCreateTransaction()
    .setTokenName(aaplName)
    .setTokenSymbol(aaplSymbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(0) // no bootstrap inventory on operator
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .setKycKey(operatorKey.publicKey)
    .setFreezeKey(operatorKey.publicKey)
    .freezeWith(client);

  const aaplSigned = await aaplCreate.sign(operatorKey);
  const aaplResp = await aaplSigned.execute(client);
  const aaplId = (await aaplResp.getReceipt(client)).tokenId!;
  console.log(`  AAPL_TOKEN_ID=${aaplId}`);

  // ── 3. USDC (mock on testnet; native Circle on mainnet) ───────────
  let usdcId: string | null = null;
  if (useNativeUsdc) {
    usdcId = process.env.USDC_TOKEN_ID?.trim() || '0.0.456858';
    console.log(`Skipping USDC create — using native USDC_TOKEN_ID=${usdcId}`);
  } else {
    console.log('Creating USDC-TEST (with 0.5% fractional fee)...');

    const usdcFee = new CustomFractionalFee()
      .setNumerator(5)
      .setDenominator(1000) // 5/1000 = 0.5%
      .setFeeCollectorAccountId(operatorId);

    const usdcCreate = new TokenCreateTransaction()
      .setTokenName('Test USDC')
      .setTokenSymbol('USDC-TEST')
      .setTokenType(TokenType.FungibleCommon)
      .setDecimals(6)
      .setInitialSupply(10_000_000_000) // 10,000 USDC
      .setTreasuryAccountId(operatorId)
      .setSupplyType(TokenSupplyType.Infinite)
      .setSupplyKey(operatorKey.publicKey)
      .setAdminKey(operatorKey.publicKey)
      .setCustomFees([usdcFee])
      .freezeWith(client);

    const usdcSigned = await usdcCreate.sign(operatorKey);
    const usdcResp = await usdcSigned.execute(client);
    usdcId = (await usdcResp.getReceipt(client)).tokenId!.toString();
    console.log(`  USDC_TEST_TOKEN_ID=${usdcId}`);
  }

  // ── 4. SPEND-NOTE NFT collection ──────────────────────────────────
  console.log('Creating SPEND-NOTE NFT...');
  const noteCreate = new TokenCreateTransaction()
    .setTokenName('Folio Spend Note')
    .setTokenSymbol('SPEND-NOTE')
    .setTokenType(TokenType.NonFungibleUnique)
    .setDecimals(0)
    .setInitialSupply(0)
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(1000)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .freezeWith(client);

  const noteSigned = await noteCreate.sign(operatorKey);
  const noteResp = await noteSigned.execute(client);
  const noteId = (await noteResp.getReceipt(client)).tokenId!;
  console.log(`  SPEND_NOTE_TOKEN_ID=${noteId}`);

  // ── 5. HCS Audit Topic ────────────────────────────────────────────
  console.log('Creating HCS audit topic...');
  const topicCreate = new TopicCreateTransaction()
    .setAdminKey(operatorKey.publicKey)
    .setSubmitKey(operatorKey.publicKey)
    .setTopicMemo('Folio Spend Note Audit Trail — verifiable on-chain record of all collar operations')
    .freezeWith(client);

  const topicSigned = await topicCreate.sign(operatorKey);
  const topicResp = await topicSigned.execute(client);
  const topicId = (await topicResp.getReceipt(client)).topicId!;
  console.log(`  AUDIT_TOPIC_ID=${topicId}`);

  // ── Summary ────────────────────────────────────────────────────────
  // Bootstrap only creates TSLA + AAPL; remaining TRADE_STOCKS via ensure-all-equity-tokens
  // Primary store for equity IDs: Supabase folio_equity_tokens (not env-only)
  console.log('\n--- Add these to your env / Vercel ---');
  console.log(`HEDERA_NETWORK=${network}`);
  console.log(`TSLA_TOKEN_ID=${tslaId}`);
  console.log(`AAPL_TOKEN_ID=${aaplId}`);
  if (useNativeUsdc) {
    console.log(`USDC_TOKEN_ID=${usdcId}`);
    console.log(`USDC_TEST_TOKEN_ID=${usdcId}`);
  } else {
    console.log(`USDC_TEST_TOKEN_ID=${usdcId}`);
  }
  console.log(`SPEND_NOTE_TOKEN_ID=${noteId}`);
  console.log(`AUDIT_TOPIC_ID=${topicId}`);

  // Persist TSLA/AAPL to DB when Supabase is configured
  try {
    const { supabase } = await import('../src/lib/supabase');
    await supabase.from('folio_equity_tokens').upsert([
      { symbol: 'TSLA', name: tslaName, token_id: tslaId.toString(), decimals: 6 },
      { symbol: 'AAPL', name: aaplName, token_id: aaplId.toString(), decimals: 6 },
    ]);
    console.log('\nPersisted TSLA/AAPL to folio_equity_tokens');
  } catch (e) {
    console.warn(
      '\nCould not persist equity tokens to Supabase (run migrations / check service role):',
      e instanceof Error ? e.message : e
    );
  }

  console.log('\nNext: create remaining Trade equities (NVDA, MSFT, …):');
  console.log(
    isMainnet
      ? '  npx tsx scripts/ensure-all-equity-tokens.ts --mainnet'
      : '  npx tsx scripts/ensure-all-equity-tokens.ts'
  );
  console.log('Primary store: Supabase folio_equity_tokens (env seeds optional).');

  console.log('\n--- Hedera Services Used ---');
  console.log(
    useNativeUsdc
      ? '• HTS: equity tokens (TSLA/AAPL + more via ensure-all), Circle USDC, Spend Note NFT'
      : '• HTS: equity tokens, test USDC, Spend Note NFT'
  );
  console.log('• HCS: 1 audit topic for verifiable spend note trail');
  console.log('• On-chain names: clean symbols (TSLA, AAPL, …)');
  console.log(
    '\nThen: npm run deploy:vault && npm run hedera:associate-vault'
  );

  client.close();
}

main().catch(console.error);
