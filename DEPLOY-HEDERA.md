# Hedera testnet: env, vault contract, deployment

This guide matches how Folio is wired in this repo: HTS tokens from `npm run setup`, collateral in **`FolioCollateralVault`** when `FOLIO_VAULT_CONTRACT_ID` is set, otherwise the legacy “transfer stock to operator” path.

Official references:

- [Deploying smart contracts](https://docs.hedera.com/hedera/core-concepts/smart-contracts/deploying-smart-contracts) (bytecode, gas, SDK vs Hardhat)
- [System smart contracts / HTS precompile `0x167`](https://docs.hedera.com/hedera/core-concepts/smart-contracts/system-smart-contracts)
- [ERC-20 style HTS](https://docs.hedera.com/hedera/core-concepts/smart-contracts/tokens-managed-by-smart-contracts/erc-20-fungible-tokens) (`approve` / `transferFrom`)
- [Associate tokens](https://docs.hedera.com/hedera/sdks-and-apis/sdks/token-service/associate-tokens-to-an-account)
- [Hedera Portal](https://portal.hedera.com/) (testnet account)
- [Hashscan testnet](https://hashscan.io/testnet)

## 1. Layman: full project environment

1. **Clone and install**  
   From the project folder: `npm install`.

2. **Environment file**  
   Copy `.env.example` to `.env.local`. Next.js loads `.env.local` automatically for `npm run dev`.

3. **Hedera operator (your “bank admin” key on testnet)**  
   Create a testnet account on the Hedera Portal. Put **Account ID** and **private key (DER)** into `HEDERA_OPERATOR_ID` and `HEDERA_OPERATOR_KEY`.

4. **Create tokens and audit topic**  
   Run `npm run setup`. Copy the printed `MOCK_*`, `USDC_TEST_TOKEN_ID`, `SPEND_NOTE_TOKEN_ID`, and `AUDIT_TOPIC_ID` into `.env.local`.

5. **Optional services** (only if you use those features)  
   Fill Dynamic, Supabase, Pinata, Plaid, Lithic, etc., as in `.env.example`.

6. **Collateral vault (new)**  
   After you deploy the vault (below), add `FOLIO_VAULT_CONTRACT_ID` and `FOLIO_VAULT_EVM_ADDRESS` to `.env.local`. If you omit them, the app keeps the **legacy** collateral transfer to the operator account.

## 2. Compile the Solidity vault (your machine)

From the repo root:

```bash
npm run contracts:compile
```

This writes artifacts under `contracts/folio-vault/artifacts/`.

Run Solidity unit tests (local Hardhat EVM, not Hedera):

```bash
npm run test:contracts
```

## 3. Deploy the vault to Hedera testnet (layman steps)

1. **Compile** (step above) so `FolioCollateralVault.json` exists under `contracts/folio-vault/artifacts/`.

2. **HBAR**  
   Your operator account needs enough testnet HBAR to pay for `ContractCreateTransaction` (fees + gas). Use the [portal faucet](https://portal.hedera.com/) if needed.

3. **Run deploy script**  
   ```bash
   npm run deploy:vault
   ```  
   This uses `ContractCreateTransaction` from [`@hashgraph/sdk`](https://docs.hedera.com/hedera/sdks-and-apis/sdks) and prints two lines to paste into `.env.local`:
   - `FOLIO_VAULT_CONTRACT_ID` — Hedera `0.0.x`
   - `FOLIO_VAULT_EVM_ADDRESS` — `0x…` (for explorers / debugging)

4. **Let the vault hold MOCK stocks**  
   Stock tokens from `setup` use KYC + freeze. Run:
   ```bash
   npm run hedera:associate-vault
   ```  
   This associates MOCK-TSLA and MOCK-AAPL with the vault, grants KYC, and unfreezes the vault for those tokens (same idea as user onboarding in `register/complete`).

5. **Hashsan**  
   Open [Hashscan](https://hashscan.io/testnet), paste your contract id, and confirm the contract exists.

6. **Restart the app**  
   `npm run dev` so Next.js picks up new env vars.

## 4. What the app does with the vault

- **Spend prepare**: If `FOLIO_VAULT_CONTRACT_ID` is set, the user may sign an **allowance** tx (HTS `approve` for the vault) and always signs a **vault `deposit`** tx. Otherwise the legacy single **collateral transfer** tx is used.
- **Spend execute**: Submits those signed txs (allowance first if present), then continues with USDC advance, spend-note NFT, and audit as before.
- **Repay / expiry**: Returns stock via **`release`** on the vault (operator-signed) when the vault is configured; otherwise operator `transferToken` to the user.

Chainlink / Base oracle code is unchanged; pricing still comes from your existing `getStockPrice` stack.
