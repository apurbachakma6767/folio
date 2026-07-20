# Folio

**0% interest credit line backed by your stocks. Borrow without selling, no minimums, no taxes.**

Globally, trillions sit in brokerage accounts that people can't spend. Need cash? You either sell shares and lose up to 37% to capital gains taxes, or take a margin loan at 7-12% interest — if you even qualify (most brokerages require $500K+).

Folio gives you a 0% credit line backed by your stock portfolio. Connect your brokerage, pick a stock, spend. Your shares stay yours.

## How it works

When you spend $50 against your $225 TSLA:

1. Folio locks ~0.222 shares as collateral
2. A zero-cost collar is set — floor at $213.75 (downside protected), ceiling at $258.75 (upside temporarily capped)
3. You receive $50 USDC instantly at 0% interest
4. Repay anytime to unlock your shares, or let them auto-settle at expiry

The financial trick: selling limited upside (the call) pays for downside protection (the put). The collar parameters aren't hardcoded — a Chainlink CRE workflow computes them using real-time prices from Data Streams and implied volatility from options markets. Net cost to the user: $0.

The entire experience feels like a neobank — email login, "spend" buttons, transaction receipts. No wallets, no hex addresses, no MetaMask. The blockchain is invisible plumbing.

## Architecture

```
Plaid ──── brokerage holdings sync ────┐
                                       v
Dynamic ── email OTP auth ──────> Next.js App ──> Hedera HTS + FolioCollateralVault
                                       |          (tokens, NFT spend notes,
                                       |           vault custody, HCS audit trail)
                                       |
                              ┌────────┼────────┐
                              v        v        v
                        Chainlink   Yahoo    Vercel AI SDK
                        CRE         Finance  (collar parameter
                        workflow   (fallback)  optimization)
                           |
                           v
                     CollarOracle          Pinata IPFS
                     (Base Sepolia)        (note metadata)
```

## Tech stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 App Router, React 19, Tailwind CSS 4, TypeScript |
| Auth | Dynamic JS SDK — email OTP, server-side JWT via JWKS, zero crypto UX |
| Brokerage | Plaid — real-time holdings sync from connected accounts |
| Tokens & custody | Hedera HTS — Folio equity tokens (TSLA, AAPL, …), USDC, NFT Spend Notes, HCS audit trail; optional **FolioCollateralVault** (Solidity) for ERC-20-style `deposit` / operator `release` when `FOLIO_VAULT_*` is set |
| Pricing | Chainlink CRE workflow (Data Streams + DoltHub IV + EVM Write to CollarOracle on Base Sepolia), Yahoo Finance fallback |
| AI | Vercel AI SDK — collar optimizer (3-tier: on-chain oracle > LLM + options data > Black-Scholes fallback), Hedera Agent Kit (autonomous on-chain operations via natural language) |
| Storage | Pinata IPFS (spend note metadata), Supabase (user registry, spend notes) |
| Cards | Lithic — virtual debit cards funded by USDC advances |

## Sponsor integrations

### Hedera

Financial operations use Hedera via `@hashgraph/sdk` — mostly **HTS** and **HCS**, plus an optional **smart-contract vault** for collateral custody.

- **HTS Fungible Tokens** — equity tokens and USDC-TEST with custom fee schedules
- **HTS NFTs** — Spend Note collection, each mint records collar parameters in IPFS metadata
- **Hedera Consensus Service** — immutable audit trail for every spend, repayment, and settlement
- **Account Management** — user account creation, token associations, KYC grants, freeze/unfreeze
- **FolioCollateralVault** (Solidity on Hedera) — user `approve` + `deposit` into the vault; operator-only `release` on repay/expiry. If `FOLIO_VAULT_CONTRACT_ID` is unset, the app falls back to transferring collateral to the operator account (legacy path).

Non-custodial flow: transactions are prepared server-side as unsigned bytes, signed client-side with the user's encrypted Hedera key (AES-256-CBC), then co-signed by the operator where required (including vault deposits when configured).

The Hedera Agent Kit integration (MiniMax M1 via Vercel AI SDK) provides an autonomous AI agent for on-chain operations — checking balances, transferring tokens, minting NFTs, and submitting HCS messages via natural language.

### Chainlink

A CRE workflow is the core pricing engine:

1. **Data Streams** via Confidential HTTP — real-time asset prices at 8-decimal precision (HMAC credentials secured in the enclave)
2. **DoltHub SQL API** — options implied volatility, historical volatility, IV rank
3. **Collar computation** — zero-cost collar strikes using log-symmetric math with real market volatility
4. **EVM Write** — results written on-chain to [CollarOracle](https://sepolia.basescan.org/address/0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f) on Base Sepolia

Without this workflow, protection ranges would be hardcoded. With it, floor/cap ranges are DON-verified and market-data-driven.

### Dynamic

- **JS SDK** — email-only OTP authentication, custom themed to match the neobank aesthetic
- **Node SDK** — 2-of-2 MPC server wallets for oracle maintenance on Base Sepolia, delegation flow for automated settlement on behalf of users
- **Server-side JWT** verification via JWKS on every API route

Dynamic is what makes blockchain invisible. Users sign in with email, spend against their stocks, and never know they have a Hedera account.

## Getting started

```bash
git clone https://github.com/zalatar242/folio.git
cd folio
cp .env.example .env.local
# Fill in: HEDERA_OPERATOR_ID, HEDERA_OPERATOR_KEY,
#          NEXT_PUBLIC_DYNAMIC_ENV_ID, PINATA_API_KEY
# Optional vault (recommended): after deploy, add FOLIO_VAULT_CONTRACT_ID and FOLIO_VAULT_EVM_ADDRESS
npm install
npm run setup     # Creates tokens on Hedera (testnet by default)
npm run dev       # http://localhost:3000
```

**Knowledge base (architecture, testnet IDs, gotchas, mainnet checklist):** **[docs/KNOWLEDGE.md](./docs/KNOWLEDGE.md)**.

**Collateral vault (optional on testnet, required on mainnet):** compile and test the contract, deploy, associate vault tokens, then set env vars. Full steps and Hedera doc links are in **[DEPLOY-HEDERA.md](./DEPLOY-HEDERA.md)**.

```bash
npm run contracts:compile
npm run test:contracts
npm run deploy:vault
npm run hedera:associate-vault
# Add FOLIO_VAULT_CONTRACT_ID and FOLIO_VAULT_EVM_ADDRESS to .env.local
```

## Links

- [Live Demo](https://folio.bar)
- [CollarOracle on Base Sepolia](https://sepolia.basescan.org/address/0x00A3cF51bA20eA6f1754BaFcecA6d144e3d1D00f)
- [Hedera Testnet Explorer](https://hashscan.io/testnet)

