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
  TransferTransaction,
  Transaction,
  AccountBalanceQuery,
  AccountInfoQuery,
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

// Module-level singleton (persists across warm serverless invocations)
let clientInstance: Client | null = null;

export function getClient(): Client {
  if (clientInstance) return clientInstance;

  const operatorId = process.env.HEDERA_OPERATOR_ID!;
  const operatorKey = process.env.HEDERA_OPERATOR_KEY!;

  clientInstance = Client.forTestnet();
  clientInstance.setOperator(
    AccountId.fromString(operatorId),
    PrivateKey.fromStringDer(operatorKey)
  );
  clientInstance.setDefaultMaxTransactionFee(new Hbar(10));

  return clientInstance;
}

export function getOperatorId(): AccountId {
  return AccountId.fromString(process.env.HEDERA_OPERATOR_ID!);
}

export function getOperatorKey(): PrivateKey {
  return PrivateKey.fromStringDer(process.env.HEDERA_OPERATOR_KEY!);
}

// Create a fungible token (MOCK-TSLA or USDC-TEST)
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

  const tx = new AccountCreateTransaction()
    .setKey(newKey.publicKey)
    .setInitialBalance(new Hbar(5)) // Fund with 5 HBAR for testnet tx fees
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

// --- Non-custodial helpers ---

// Create account using a client-provided public key (no private key on server)
export async function createAccountWithPublicKey(
  publicKeyDer: string
): Promise<string> {
  const client = getClient();
  const publicKey = PublicKey.fromString(publicKeyDer);

  const tx = new AccountCreateTransaction()
    .setKey(publicKey)
    .setInitialBalance(new Hbar(5))
    .freezeWith(client);

  const response = await tx.execute(client);
  const receipt = await response.getReceipt(client);
  return receipt.accountId!.toString();
}

// Prepare an unsigned token association transaction for client-side signing
export async function prepareTokenAssociation(
  accountId: string,
  tokenIds: string[]
): Promise<Uint8Array> {
  const client = getClient();

  const tx = new TokenAssociateTransaction()
    .setAccountId(AccountId.fromString(accountId))
    .setTokenIds(tokenIds.map((id) => TokenId.fromString(id)))
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

// Prepare an unsigned collateral lock transaction for client-side signing
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
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

// Prepare unsigned USDC repayment transaction (user → operator)
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
    .setTransactionValidDuration(180)
    .freezeWith(client);

  return tx.toBytes();
}

// Submit a client-signed transaction, adding operator co-signature
export async function submitSignedTransaction(
  signedTxBytes: Uint8Array
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();

  const tx = Transaction.fromBytes(signedTxBytes);
  await tx.sign(operatorKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);

  return response.transactionId.toString();
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

export async function prepareTokenAllowanceForVault(
  tokenId: string,
  ownerAccountId: string,
  vaultContractId: string,
  amount: number | Long
): Promise<Uint8Array> {
  const client = getClient();
  const userId = AccountId.fromString(ownerAccountId);
  const vault = ContractId.fromString(vaultContractId);
  const amt = Long.isLong(amount) ? amount : Long.fromNumber(amount);
  const tx = new AccountAllowanceApproveTransaction()
    .approveTokenAllowance(TokenId.fromString(tokenId), userId, vault, amt)
    .setTransactionId(TransactionId.generate(userId))
    .setTransactionValidDuration(180)
    .freezeWith(client);
  return tx.toBytes();
}

export async function prepareVaultDeposit(
  vaultContractId: string,
  stockTokenId: string,
  userAccountId: string,
  amountHts: number
): Promise<Uint8Array> {
  const client = getClient();
  const userId = AccountId.fromString(userAccountId);
  const tokenAddr = hexWith0x(TokenId.fromString(stockTokenId).toSolidityAddress());
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
    .setTransactionValidDuration(180)
    .freezeWith(client);
  return tx.toBytes();
}

/** User-signed only (contract call / allowance); do not add operator signature. */
export async function submitClientSignedTransaction(signedTxBytes: Uint8Array): Promise<string> {
  const client = getClient();
  const tx = Transaction.fromBytes(signedTxBytes);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}

export async function executeVaultRelease(
  vaultContractId: string,
  stockTokenId: string,
  userAccountId: string,
  amountHts: number
): Promise<string> {
  const client = getClient();
  const operatorKey = getOperatorKey();
  const userAddr = hexWith0x(AccountId.fromString(userAccountId).toSolidityAddress());
  const tokenAddr = hexWith0x(TokenId.fromString(stockTokenId).toSolidityAddress());
  const tx = new ContractExecuteTransaction()
    .setContractId(ContractId.fromString(vaultContractId))
    .setGas(800_000)
    .setFunction(
      'release',
      new ContractFunctionParameters()
        .addAddress(tokenAddr)
        .addAddress(userAddr)
        .addUint256(Long.fromNumber(amountHts))
    )
    .freezeWith(client);
  await tx.sign(operatorKey);
  const response = await tx.execute(client);
  await response.getReceipt(client);
  return response.transactionId.toString();
}
