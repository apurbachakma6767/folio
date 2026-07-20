import {
  Client,
  AccountId,
  PrivateKey,
  PublicKey,
  AccountCreateTransaction,
  TokenCreateTransaction,
  TokenType,
  TokenSupplyType,
  TokenAssociateTransaction,
  TokenMintTransaction,
  TokenBurnTransaction,
  TransferTransaction,
  Transaction,
  AccountBalanceQuery,
  AccountInfoQuery,
  TokenInfoQuery,
  AccountAllowanceApproveTransaction,
  ContractExecuteTransaction,
  ContractFunctionParameters,
  ContractId,
  TransactionId,
  TokenId,
  Hbar,
  TopicCreateTransaction,
  TopicMessageSubmitTransaction,
  TopicId,
  CustomFixedFee,
  CustomFractionalFee,
  TokenGrantKycTransaction,
  TokenRevokeKycTransaction,
  TokenFreezeTransaction,
  TokenUnfreezeTransaction,
} from '@hashgraph/sdk';
import Long from 'long';
import { getHederaNetwork, getInitialAccountHbar } from './network';

// Module-level singleton (persists across warm serverless invocations)
let clientInstance: Client | null = null;

/** Reset client singleton (tests only). */
export function resetHederaClientForTests(): void {
  clientInstance = null;
}

/** Parse operator key: DER, ECDSA hex (64 chars), or SDK auto string. */
export function parsePrivateKey(raw: string): PrivateKey {
  const key = raw.trim();
  if (!key) throw new Error('Empty private key');
  // ECDSA raw hex (32 bytes) — common for mainnet portal exports
  const hex = key.startsWith('0x') ? key.slice(2) : key;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) {
    try {
      return PrivateKey.fromStringECDSA(hex);
    } catch {
      return PrivateKey.fromStringED25519(hex);
    }
  }
  try {
    return PrivateKey.fromStringDer(key);
  } catch {
    return PrivateKey.fromString(key);
  }
}

export function getClient(): Client {
  if (clientInstance) return clientInstance;

  const operatorId = process.env.HEDERA_OPERATOR_ID!;
  const operatorKey = parsePrivateKey(process.env.HEDERA_OPERATOR_KEY!);
  const network = getHederaNetwork();

  clientInstance =
    network === 'mainnet' ? Client.forMainnet() : Client.forTestnet();
  clientInstance.setOperator(AccountId.fromString(operatorId), operatorKey);
  clientInstance.setDefaultMaxTransactionFee(new Hbar(100));

  return clientInstance;
}

export function getOperatorId(): AccountId {
  return AccountId.fromString(process.env.HEDERA_OPERATOR_ID!);
}

export function getOperatorKey(): PrivateKey {
  return parsePrivateKey(process.env.HEDERA_OPERATOR_KEY!);
}

// Create a fungible token (equity HTS or USDC-TEST)
export async function createFungibleToken(
  name: string,
  symbol: string,
  initialSupply: number,
  decimals: number = 6
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(decimals)
    .setInitialSupply(initialSupply)
    .setTreasuryAccountId(getOperatorId())
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.tokenId!.toString();
}

/**
 * Create Folio equity HTS token (shared by all users for this symbol).
 * No KYC/freeze keys — users with maxAutomaticTokenAssociations can receive
 * on buy without an explicit associate + KYC (avoids INVALID_SIGNATURE / KYC fails).
 */
export async function createEquityStockToken(
  name: string,
  symbol: string,
  decimals: number = 6
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();

  const tx = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(decimals)
    .setInitialSupply(0)
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    // Intentionally NO kycKey / freezeKey
    .setMaxTransactionFee(new Hbar(25))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.tokenId!.toString();
}

/**
 * Remove KYC (and optionally freeze) keys from an existing equity token so
 * auto-association + transfer works without grantKyc.
 * Requires admin key = operator.
 */
export async function clearTokenKycAndFreeze(tokenId: string): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const { TokenUpdateTransaction, KeyList } = await import('@hashgraph/sdk');

  const info = await new TokenInfoQuery()
    .setTokenId(TokenId.fromString(tokenId))
    .execute(client);

  if (!info.kycKey && !info.freezeKey) return;

  const empty = new KeyList();
  let tx = new TokenUpdateTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setMaxTransactionFee(new Hbar(200));

  if (info.kycKey) tx = tx.setKycKey(empty);
  if (info.freezeKey) tx = tx.setFreezeKey(empty);

  const frozen = await tx.freezeWith(client);
  await frozen.sign(operatorKey);
  const resp = await frozen.execute(client);
  await resp.getReceipt(client);
  console.log(`[hedera] cleared KYC/freeze on ${tokenId}`);
}

/** True if account is associated with this HTS token (mirror-first, reliable). */
export async function isTokenAssociated(
  accountId: string,
  tokenId: string
): Promise<boolean> {
  try {
    const { getMirrorNodeBase } = await import('./network');
    const base = getMirrorNodeBase();
    const res = await fetch(
      `${base}/api/v1/accounts/${accountId}/tokens?token.id=${encodeURIComponent(tokenId)}&limit=1`
    );
    if (res.ok) {
      const data = (await res.json()) as { tokens?: { token_id: string }[] };
      if ((data.tokens || []).some((t) => t.token_id === tokenId)) return true;
    }
  } catch {
    /* fall through */
  }
  // Balance map includes associated tokens (even at 0)
  try {
    const balances = await getTokenBalances(accountId);
    if (balances.has(tokenId)) return true;
  } catch {
    /* */
  }
  return false;
}

/**
 * True if account can auto-associate new HTS (max automatic associations with free slots).
 * Our createAccount sets max=100 — buy/receive can skip explicit TokenAssociate.
 */
export async function canAutoAssociateTokens(accountId: string): Promise<boolean> {
  try {
    const { getMirrorNodeBase } = await import('./network');
    const res = await fetch(`${getMirrorNodeBase()}/api/v1/accounts/${accountId}`);
    if (!res.ok) return false;
    const data = (await res.json()) as {
      max_automatic_token_associations?: number;
      balance?: { tokens?: unknown[] };
    };
    const max = data.max_automatic_token_associations ?? 0;
    if (max === -1) return true; // unlimited
    if (max <= 0) return false;
    // Approximate used associations from balance tokens list (mirror caps page size)
    const used = data.balance?.tokens?.length ?? 0;
    return used < max;
  } catch {
    return false;
  }
}

// Create an NFT collection (SPEND-NOTE)
export async function createNftCollection(
  name: string,
  symbol: string,
  maxSupply: number = 1000
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.NonFungibleUnique)
    .setDecimals(0)
    .setInitialSupply(0)
    .setTreasuryAccountId(getOperatorId())
    .setSupplyType(TokenSupplyType.Finite)
    .setMaxSupply(maxSupply)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.tokenId!.toString();
}

export interface SpendNoteMetadata {
  name: string;
  asset: string;
  shares_collared: number;        // integer decimal 6
  stock_price_at_spend: number;   // integer decimal 6
  collar_floor: number;           // integer decimal 6
  collar_cap: number;             // integer decimal 6
  advance_usdc: number;           // integer decimal 6
  platform_spread: number;        // integer decimal 6
  created_at: string;             // ISO string
  expires_at: string;             // ISO string
  status: string;                 // 'active'
}

export async function mintSpendNoteWithIpfs(
  metadata: SpendNoteMetadata
): Promise<{ serial: number; cid: string }> {
  let cid: string;

  const pinataKey = process.env.PINATA_JWT || process.env.PINATA_API_KEY;
  if (!pinataKey) {
    cid = 'demo-cid';
  } else {
    const response = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pinataKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pinataContent: metadata,
        pinataMetadata: { name: metadata.name },
      }),
    });
    const data = await response.json();
    cid = data.IpfsHash;
  }

  const serial = await mintSpendNote(new TextEncoder().encode(`ipfs://${cid}`));
  return { serial, cid };
}

// Mint a Spend Note NFT with metadata
export async function mintSpendNote(metadata: Uint8Array): Promise<number> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const tokenId = TokenId.fromString(process.env.SPEND_NOTE_TOKEN_ID!);

  const tx = new TokenMintTransaction()
    .setTokenId(tokenId)
    .addMetadata(metadata)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.serials[0].toNumber();
}

// Mint additional supply of a fungible token (operator must be supply key)
// Mint lands in the treasury account; transfer out immediately so treasury does not hold inventory.
export async function mintFungibleToken(
  tokenId: string,
  amount: number
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenMintTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAmount(amount)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);

  return response.transactionId.toString();
}

/**
 * Burn fungible tokens from the treasury (operator) account.
 * Supply key must sign. Used so operator never retains equity inventory after sells
 * or bootstrap cleanup — stocks live with users or in the vault when collared.
 */
export async function burnFungibleToken(
  tokenId: string,
  amount: number
): Promise<string> {
  if (amount <= 0) return 'noop';
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenBurnTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAmount(amount)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);

  return response.transactionId.toString();
}

// Transfer fungible tokens (used for escrow lock + USDC advance)
export async function transferToken(
  tokenId: string,
  fromAccount: string,
  toAccount: string,
  amount: number
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TransferTransaction()
    .addTokenTransfer(
      TokenId.fromString(tokenId),
      AccountId.fromString(fromAccount),
      -amount
    )
    .addTokenTransfer(
      TokenId.fromString(tokenId),
      AccountId.fromString(toAccount),
      amount
    )
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);

  return response.transactionId.toString();
}

// Transfer NFT (Spend Note to user)
export async function transferNft(
  tokenId: string,
  serial: number,
  fromAccount: string,
  toAccount: string
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TransferTransaction()
    .addNftTransfer(
      TokenId.fromString(tokenId),
      serial,
      AccountId.fromString(fromAccount),
      AccountId.fromString(toAccount)
    )
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);

  return response.transactionId.toString();
}

// Create a new Hedera account (for new app users)
export async function createAccount(): Promise<{ accountId: string; privateKey: string }> {
  const client = getClient();
  const newKey = PrivateKey.generateED25519();
  const initialHbar = getInitialAccountHbar();

  const tx = new AccountCreateTransaction()
    .setKey(newKey.publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  const accountId = receipt.accountId!.toString();

  return { accountId, privateKey: newKey.toStringDer() };
}

// ── Hedera Consensus Service (HCS) — Audit Trail ─────────────────────

// Create a topic for audit logging (run once during setup)
export async function createAuditTopic(memo: string = 'Folio Spend Note Audit Trail'): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TopicCreateTransaction()
    .setAdminKey(operatorKey.publicKey)
    .setSubmitKey(operatorKey.publicKey)
    .setTopicMemo(memo)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.topicId!.toString();
}

// Submit an audit message to HCS topic
export async function submitAuditMessage(
  topicId: string,
  message: Record<string, unknown>
): Promise<{ sequenceNumber: number; transactionId: string }> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TopicMessageSubmitTransaction()
    .setTopicId(TopicId.fromString(topicId))
    .setMessage(JSON.stringify(message))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return {
    sequenceNumber: receipt.topicSequenceNumber?.toNumber() ?? 0,
    transactionId: response.transactionId.toString(),
  };
}

// ── Custom Fee Schedules ──────────────────���──────────────────────────

// Create a fungible token with custom fee schedule (platform spread)
export async function createFungibleTokenWithFees(
  name: string,
  symbol: string,
  initialSupply: number,
  decimals: number = 6,
  fractionalFeeNumerator: number = 5,   // 0.5% = 5/1000
  fractionalFeeDenominator: number = 1000,
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();

  const fee = new CustomFractionalFee()
    .setNumerator(fractionalFeeNumerator)
    .setDenominator(fractionalFeeDenominator)
    .setFeeCollectorAccountId(operatorId);

  const tx = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(decimals)
    .setInitialSupply(initialSupply)
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .setCustomFees([fee])
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.tokenId!.toString();
}

// Create a stock token with KYC + freeze controls and optional royalty
export async function createStockTokenWithCompliance(
  name: string,
  symbol: string,
  initialSupply: number,
  decimals: number = 6,
  fixedFeeAmount: number = 0, // fixed fee per transfer in tinybars
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();

  const fees = [];
  if (fixedFeeAmount > 0) {
    fees.push(
      new CustomFixedFee()
        .setAmount(fixedFeeAmount)
        .setFeeCollectorAccountId(operatorId)
    );
  }

  const tx = new TokenCreateTransaction()
    .setTokenName(name)
    .setTokenSymbol(symbol)
    .setTokenType(TokenType.FungibleCommon)
    .setDecimals(decimals)
    .setInitialSupply(initialSupply)
    .setTreasuryAccountId(operatorId)
    .setSupplyType(TokenSupplyType.Infinite)
    .setSupplyKey(operatorKey.publicKey)
    .setAdminKey(operatorKey.publicKey)
    .setKycKey(operatorKey.publicKey)      // KYC gating
    .setFreezeKey(operatorKey.publicKey)    // Freeze capability
    .setFreezeDefault(true)                // Frozen by default — must grant KYC
    .setCustomFees(fees)
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  const receipt = await response.getReceipt(client);

  return receipt.tokenId!.toString();
}

// ── KYC / Compliance Controls ────────────────────────────────────────

export async function grantKyc(tokenId: string, accountId: string): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenGrantKycTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAccountId(AccountId.fromString(accountId))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);
}

export async function revokeKyc(tokenId: string, accountId: string): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenRevokeKycTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAccountId(AccountId.fromString(accountId))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);
}

export async function freezeAccount(tokenId: string, accountId: string): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenFreezeTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAccountId(AccountId.fromString(accountId))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);
}

export async function unfreezeAccount(tokenId: string, accountId: string): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = new TokenUnfreezeTransaction()
    .setTokenId(TokenId.fromString(tokenId))
    .setAccountId(AccountId.fromString(accountId))
    .freezeWith(client);

  const signed = await tx.sign(operatorKey);
  const response = await signed.execute(client);
  await response.getReceipt(client);
}

// Get token balances for an account
export async function getTokenBalances(
  accountId: string
): Promise<Map<string, number>> {
  const client = getClient();
  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(accountId))
    .execute(client);

  const result = new Map<string, number>();
  if (balance.tokens) {
    // Convert the token map — values are Long objects, use toString() to avoid precision loss
    const tokenMap = balance.tokens._map ?? balance.tokens;
    if (tokenMap instanceof Map) {
      tokenMap.forEach((value: unknown, key: unknown) => {
        result.set(String(key), Number(String(value)));
      });
    }
  }

  return result;
}

/** HBAR balance in whole HBAR (not tinybars). */
export async function getHbarBalance(accountId: string): Promise<number> {
  const client = getClient();
  const balance = await new AccountBalanceQuery()
    .setAccountId(AccountId.fromString(accountId))
    .execute(client);
  const tiny = balance.hbars.toTinybars();
  const n = typeof tiny.toNumber === 'function' ? Number(tiny.toString()) : Number(tiny);
  return n / 100_000_000;
}

// --- Non-custodial helpers ---

// Create account using a client-provided public key (no private key on server)
export async function createAccountWithPublicKey(
  publicKeyDer: string
): Promise<string> {
  const client = getClient();
  const publicKey = PublicKey.fromString(publicKeyDer);
  const initialHbar = getInitialAccountHbar();

  const tx = new AccountCreateTransaction()
    .setKey(publicKey)
    .setInitialBalance(new Hbar(initialHbar))
    // Auto-associate new equity HTS tokens (buy NVDA etc. without extra assoc step)
    .setMaxAutomaticTokenAssociations(100)
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.accountId!.toString();
}

/** Operator is fee payer so user txs are gasless (user only signs). */
function gaslessTxId(): TransactionId {
  return TransactionId.generate(getOperatorId());
}

// Prepare an unsigned token association transaction for client-side signing (gasless)
export async function prepareTokenAssociation(
  accountId: string,
  tokenIds: string[]
): Promise<Uint8Array> {
  const client = getClient();

  const tx = new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds(tokenIds.map((id) => TokenId.fromString(id)))
    .setTransactionId(gaslessTxId())
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

/**
 * Associate tokens + grant KYC + unfreeze using the user's server-held private key.
 * Used at trade fill so we don't depend on client-signed associate (INVALID_SIGNATURE
 * was failing KYC and then stock transfer).
 */
export async function ensureUserTokenReady(
  accountId: string,
  tokenId: string,
  userPrivateKeyDer: string
): Promise<void> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();
  const userKey = PrivateKey.fromStringDer(userPrivateKeyDer);

  const already = await isTokenAssociated(accountId, tokenId);
  if (!already) {
    const tx = await new TokenAssociateTransaction()
      .setAccountId(AccountId.fromString(accountId))
      .setTokenIds([TokenId.fromString(tokenId)])
      .setTransactionId(TransactionId.generate(operatorId))
      .setTransactionValidDuration(180)
      .freezeWith(client);
    await tx.sign(userKey);
    await tx.sign(operatorKey);
    const resp = await tx.execute(client);
    try {
      await resp.getReceipt(client);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('TOKEN_ALREADY_ASSOCIATED')) throw e;
    }
  }

  try {
    await grantKyc(tokenId, accountId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already|ACCOUNT_KYC|SUCCESS/i.test(msg)) {
      // grantKyc may throw if already granted — ignore benign cases
      if (!msg.includes('ACCOUNT_KYC_ALREADY_GRANTED')) {
        console.warn('[ensureUserTokenReady] grantKyc:', msg);
      }
    }
  }
  try {
    await unfreezeAccount(tokenId, accountId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/already|not frozen|TOKEN_HAS_NO_FREEZE/i.test(msg)) {
      console.warn('[ensureUserTokenReady] unfreeze:', msg);
    }
  }
}

// Prepare an unsigned collateral lock transaction for client-side signing (gasless)
export async function prepareCollateralLock(
  stockTokenId: string,
  userAccountId: string,
  amount: number
): Promise<Uint8Array> {
  const client = getClient();
  const operatorId = getOperatorId();

  const tx = new TransferTransaction()
    .addTokenTransfer(
      TokenId.fromString(stockTokenId),
      AccountId.fromString(userAccountId),
      -amount
    )
    .addTokenTransfer(
      TokenId.fromString(stockTokenId),
      operatorId,
      amount
    )
    .setTransactionId(gaslessTxId())
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

// Prepare unsigned USDC repayment transaction (user → operator, gasless)
export async function prepareRepayment(
  usdcTokenId: string,
  userAccountId: string,
  amount: number
): Promise<Uint8Array> {
  const client = getClient();
  const operatorId = getOperatorId();

  const tx = new TransferTransaction()
    .addTokenTransfer(
      TokenId.fromString(usdcTokenId),
      AccountId.fromString(userAccountId),
      -amount
    )
    .addTokenTransfer(
      TokenId.fromString(usdcTokenId),
      operatorId,
      amount
    )
    .setTransactionId(gaslessTxId())
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

// Submit a client-signed transaction, adding operator co-signature (gasless fee payer)
export async function submitSignedTransaction(
  signedTxBytes: Uint8Array
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = Transaction.fromBytes(signedTxBytes);
  // Operator is fee payer for gasless txs — must co-sign after user.
  // ECDSA + ED25519 multi-sig is valid when both keys match account/payer.
  await tx.sign(operatorKey);

  try {
    const response = await tx.execute(client);
    await response.getReceipt(client);
    return response.transactionId.toString();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('INVALID_SIGNATURE') || msg.includes('status INVALID_SIGNATURE')) {
      throw new Error(
        'INVALID_SIGNATURE: wallet key does not match this Hedera account (or fee payer key). ' +
          'Log out, unlock with your passphrase / restore from backup, then try again. ' +
          'If the token is already associated, you can ignore this and retry the order.'
      );
    }
    if (msg.includes('TOKEN_ALREADY_ASSOCIATED')) {
      return 'already-associated';
    }
    throw e;
  }
}

/** 40-char hex from `toSolidityAddress()` → `0x` + lower hex for ContractFunctionParameters */
export function hexWith0x(solidityAddress: string): `0x${string}` {
  const s = solidityAddress.startsWith('0x') ? solidityAddress.slice(2) : solidityAddress;
  return `0x${s}` as `0x${string}`;
}

export function isFolioVaultConfigured(): boolean {
  return Boolean(process.env.FOLIO_VAULT_CONTRACT_ID?.trim());
}

export function getFolioVaultContractId(): string {
  const id = process.env.FOLIO_VAULT_CONTRACT_ID?.trim();
  if (!id) {
    throw new Error('FOLIO_VAULT_CONTRACT_ID is not set');
  }
  return id;
}

/** Remaining HTS fungible allowance from owner to vault contract (spender), or 0 if none. */
export async function getFungibleTokenAllowance(
  ownerAccountId: string,
  vaultContractId: string,
  tokenId: string
): Promise<Long> {
  const client = getClient();
  const owner = AccountId.fromString(ownerAccountId);
  const vault = ContractId.fromString(vaultContractId);
  const tid = TokenId.fromString(tokenId);
  const info = await new AccountInfoQuery().setAccountId(owner).execute(client);
  for (const a of info.tokenAllowances) {
    if (
      a.tokenId.toString() === tid.toString() &&
      a.spenderAccountId != null &&
      a.spenderAccountId.toString() === vault.toString()
    ) {
      // null amount can appear for some allowance shapes; treat as "enough" vs a finite need
      if (a.amount == null) {
        return Long.fromString('9223372036854775807');
      }
      return a.amount;
    }
  }
  return Long.ZERO;
}

/**
 * User approves operator to move tokens (gasless fee payer = operator).
 * Used so operator can pull collateral into vault without user-paid gas.
 */
export async function prepareTokenAllowanceForVault(
  tokenId: string,
  ownerAccountId: string,
  _vaultContractId: string,
  amount: number | Long
): Promise<Uint8Array> {
  const client = getClient();
  const userId = AccountId.fromString(ownerAccountId);
  const spender = getOperatorId();
  const amt = Long.isLong(amount) ? amount : Long.fromNumber(amount);
  // Operator pays fees; user signs to authorize allowance (gasless for user)
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(TokenId.fromString(tokenId), userId, spender, amt)
    .setTransactionId(gaslessTxId())
    .setTransactionValidDuration(180)
    .freezeWith(client);
  return tx.toBytes();
}

/**
 * Prepare vault deposit call. Fee payer = operator (gasless).
 * User must still co-sign so the contract call is authorized for their allowance.
 * On Hedera, when operator is payer, we use approved HTS pull via operator after allowance instead
 * of user-paid deposit — see executeVaultDepositWithAllowance.
 */
export async function prepareVaultDeposit(
  vaultContractId: string,
  stockTokenId: string,
  userAccountId: string,
  amountHts: number
): Promise<Uint8Array> {
  const client = getClient();
  const userId = AccountId.fromString(userAccountId);
  const tokenAddr = hexWith0x(TokenId.fromString(stockTokenId).toSolidityAddress());
  // Keep user in transaction id for msg.sender on deposit(), but zero max fee so
  // operator co-sign path still works when we fall back — prefer executeVaultDepositWithAllowance.
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(vaultContractId))
    .setGas(800_000)
    .setFunction(
      'deposit',
      new ContractFunctionParameters()
        .addAddress(tokenAddr)
        .addUint256(Long.fromNumber(amountHts))
    )
    .setTransactionId(TransactionId.generate(userId))
    .setMaxTransactionFee(new Hbar(0))
    .setTransactionValidDuration(180)
    .freezeWith(client);
  return tx.toBytes();
}

/**
 * Gasless vault custody: after user has approved vault, operator pulls tokens into vault
 * account via HTS approved transfer (operator pays all fees).
 */
export async function executeVaultDepositWithAllowance(
  vaultContractId: string,
  stockTokenId: string,
  userAccountId: string,
  amountHts: number
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();
  const vaultId = AccountId.fromString(vaultContractId);
  const userId = AccountId.fromString(userAccountId);
  const token = TokenId.fromString(stockTokenId);

  const tx = new TransferTransaction()
    .addApprovedTokenTransfer(token, userId, -amountHts)
    .addTokenTransfer(token, vaultId, amountHts)
    .setTransactionId(TransactionId.generate(operatorId))
    .setTransactionValidDuration(180)
    .freezeWith(client);

  await tx.sign(operatorKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}

/** User-signed only (contract call / allowance); do not add operator signature. */
export async function submitClientSignedTransaction(signedTxBytes: Uint8Array): Promise<string> {
  const client = getClient();
  const tx = Transaction.fromBytes(signedTxBytes);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}

/**
 * Return collateral from vault to user.
 *
 * Deposit path uses HTS approved transfers into the vault *account* (not Solidity
 * deposit()). Tokens therefore sit as HTS balances on the contract account.
 * Calling Solidity `release()` → IERC20.transfer often reverts for that path.
 * Instead: HTS TransferTransaction vault → user, signed by vault admin (operator).
 */
export async function executeVaultRelease(
  vaultContractId: string,
  stockTokenId: string,
  userAccountId: string,
  amountHts: number
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const operatorId = getOperatorId();
  const vaultId = AccountId.fromString(vaultContractId);
  const userId = AccountId.fromString(userAccountId);
  const token = TokenId.fromString(stockTokenId);

  const tx = new TransferTransaction()
    .addTokenTransfer(token, vaultId, -amountHts)
    .addTokenTransfer(token, userId, amountHts)
    .setTransactionId(TransactionId.generate(operatorId))
    .setTransactionValidDuration(180)
    .freezeWith(client);

  // Vault admin key (operator) must authorize spending vault's HTS balance
  await tx.sign(operatorKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}
