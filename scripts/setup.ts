// Setup script: creates tokens + HCS audit topic on Hedera testnet
// Run: npx tsx scripts/setup.ts
//
// Creates:
//   1. MOCK-TSLA — stock token with KYC + freeze controls
//   2. MOCK-AAPL — stock token with KYC + freeze controls
//   3. USDC-TEST — stablecoin with 0.5% fractional fee (platform spread)
//   4. SPEND-NOTE — NFT collection for structured spend notes
//   5. Audit Topic — HCS topic for verifiable audit trail

import 'dotenv/config';
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
  const operatorKey = PrivateKey.fromStringDer(process.env.HEDERA_OPERATOR_KEY!);

  const client = Client.forTestnet();
  client.setOperator(operatorId, operatorKey);
  client.setDefaultMaxTransactionFee(new Hbar(30));

  console.log(`Operator: ${operatorId}\n`);

  // ── 1. MOCK-TSLA (stock token with KYC + freeze) ──────────────────
  console.log('Creating MOCK-TSLA (with KYC + freeze controls)...');
  const tslaCreate = new TokenCreateTransaction()
    .setTokenName('Mock Tesla')
    .setTokenSymbol('MOCK-TSLA')
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(44_000_000) // 44 shares
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
  console.log(`  MOCK_TSLA_TOKEN_ID=${tslaId}`);

  // ── 2. MOCK-AAPL (stock token with KYC + freeze) ──────────────────
  console.log('Creating MOCK-AAPL (with KYC + freeze controls)...');
  const aaplCreate = new TokenCreateTransaction()
    .setTokenName('Mock Apple')
    .setTokenSymbol('MOCK-AAPL')
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(6)
    .setInitialSupply(10_000_000) // 10 shares
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
  console.log(`  MOCK_AAPL_TOKEN_ID=${aaplId}`);

  // ── 3. USDC-TEST (stablecoin with 0.5% platform fee) ──────────────
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
  const usdcId = (await usdcResp.getReceipt(client)).tokenId!;
  console.log(`  USDC_TEST_TOKEN_ID=${usdcId}`);

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
  console.log('\n--- Add these to your .env.local ---');
  console.log(`MOCK_TSLA_TOKEN_ID=${tslaId}`);
  console.log(`MOCK_AAPL_TOKEN_ID=${aaplId}`);
  console.log(`USDC_TEST_TOKEN_ID=${usdcId}`);
  console.log(`SPEND_NOTE_TOKEN_ID=${noteId}`);
  console.log(`AUDIT_TOPIC_ID=${topicId}`);

  console.log('\n--- Hedera Services Used ---');
  console.log('• HTS: 4 tokens (2 stock w/ KYC+freeze, 1 stablecoin w/ fees, 1 NFT)');
  console.log('• HCS: 1 audit topic for verifiable spend note trail');
  console.log('• Custom Fees: 0.5% fractional fee on USDC transfers');
  console.log('• Compliance: KYC + freeze keys on stock tokens');

  client.close();
}

main().catch(console.error);
