# Folio — Project Knowledge Base

> Living document of architecture, testnet state, operational gotchas, and mainnet cutover.  
> Last updated: 2026-07-20 (post Thrive M2 testnet hardening).

---

## 1. What Folio is

**Product:** Portfolio-backed spending — “0% credit line” against stock holdings (mock HTS equities).  
**Not:** A regulated brokerage, Swarm custody, or live Visa issuing.

| Layer | Tech |
|-------|------|
| App | Next.js 16, React 19, Tailwind 4 |
| Auth | Dynamic email OTP |
| Chain | Hedera HTS + HCS + optional Solidity vault |
| DB | Supabase (service role server-side) |
| UX rule | Neobank voice — no hex / “on-chain” in main UI ([DESIGN.md](../DESIGN.md)) |

---

## 2. Networks

| | Testnet (current dev) | Mainnet (Thrive M2) |
|--|----------------------|---------------------|
| Flag | `HEDERA_NETWORK=testnet` | `HEDERA_NETWORK=mainnet` |
| UI | `NEXT_PUBLIC_HEDERA_NETWORK=testnet` | `mainnet` |
| USDC | Mock HTS `USDC_TEST_TOKEN_ID` | Circle **`0.0.456858`** |
| Vault | Required for custody path | **`REQUIRE_VAULT=true` (default on mainnet)** |
| Free USDC airdrop | Allowed (`ALLOW_AUTO_FUND_USDC`) | **Must be false** |
| Mint USDC | Allowed for mock | **Never** |
| Spend caps | Loose | `$2` / tx, `$10` outstanding, `$5` / user (defaults) |

---

## 3. Architecture (money path)

### Spend (advance)
1. **Prepare** — collar math + price; if vault configured → HTS **allowance to operator** (gasless fee payer = operator).  
2. **User signs** allowance (or legacy collateral transfer if no vault).  
3. **Execute** — operator pulls stock into vault (HTS approved transfer); pays USDC advance from treasury; mints Spend Note NFT; HCS audit.  
4. **Repay / settle** — user signs USDC repay; operator returns shares (HTS transfer from vault → user).

### Important vault behavior
- **Deposit path is hybrid:** HTS transfer **into vault account**, not always Solidity `deposit()`.  
- **Release path:** HTS transfer vault → user signed by **vault admin key** (operator). Solidity `release()` often **reverts** (`NotOperator` / non-ERC20 HTS) when funds arrived via HTS — use HTS release (implemented in `executeVaultRelease`).  
- **Vault admin key** must be set at deploy (`ContractCreateFlow` + `setAdminKey(operator)`) or associating new tokens fails with `INVALID_SIGNATURE`.

### Trade desk
1. **Prepare** — buy: USDC→treasury; sell: stock→treasury (gasless user sign).  
2. **Order** — stored in `broker_orders` (+ settlement bytes in notes).  
3. **Auto-fill** (~4s) — buy: submit settlement, mint stock→user; sell: submit settlement, USDC→user.  
4. File fallback `.data/broker-orders.json` if table missing (dev only).

### Auth
- Production: Dynamic JWT verified via JWKS.  
- Local scripts: `FOLIO_ALLOW_DEV_AUTH=true` + `Authorization: Bearer folio-dev:<email>` (never production).  
- Wallet keys: generated client-side; passphrase-encrypted backup + optional `server_wallet_key` + simulation `wallet_passphrase`.

---

## 4. Current testnet inventory (as of 2026-07-20)

Do **not** treat these as mainnet IDs.

| Resource | Value (testnet) |
|----------|-----------------|
| Operator | `0.0.4866197` |
| Vault | `0.0.9656753` |
| Vault EVM | `0x00000000000000000000000000000000009359b1` |
| CollarOracle EVM | `0x271fdeb370874999d2463852170cdd247bdf0bb1` → `0.0.9085977` |
| TSLA / AAPL HTS | `0.0.9085992` / `0.0.9085991` |
| Extra equities | NVDA…COIN ≈ `0.0.9649046+` (DB: `folio_equity_tokens`) |
| USDC (test) | `0.0.9085993` |
| Spend Note NFT | `0.0.9085995` |
| HCS audit | `0.0.9086007` |
| **Old vault (superseded)** | `0.0.9217856` — may still hold residual balances |

### Sourcify / HashScan
- Vault verified on Sourcify chain **296** with **runtime `exact_match`**.  
- Warning *“only matched with runtime bytecode”* is common on Hedera (`ContractCreateFlow`); runtime match is authoritative for call logic.  
- Verify script: `npx tsx scripts/verify-vault-sourcify.ts`  
- Links:  
  - https://repo.sourcify.dev/296/0x00000000000000000000000000000000009359b1  
  - https://hashscan.io/testnet/contract/0.0.9656753  

### Supabase
- Project ref: `uuklijbyfrszmksgeacb`  
- Pooler (IPv4): `aws-1-ap-northeast-1.pooler.supabase.com:6543`  
- User: `postgres.<ref>`  
- Direct `db.<ref>.supabase.co` is often **IPv6-only** (fails without IPv6).  
- App data access: **service role** (`SUPABASE_SERVICE_ROLE_KEY`).  
- Migrations / DDL: **DB password** + `DATABASE_URL` or SQL Editor.  


---

## 5. Key scripts

| Command | Purpose |
|---------|---------|
| `npm run setup` | Testnet TSLA/AAPL + NFT + HCS |
| `npm run setup:mainnet` | Mainnet bootstrap + Circle USDC |
| `npm run ensure:equities` | All TRADE_STOCKS → DB + `{SYMBOL}_TOKEN_ID` |
| `npm run ensure:equities:mainnet` | Same on mainnet |
| `npm run contracts:compile` | Hardhat compile vault |
| `npm run deploy:vault` | Deploy vault (admin key = operator) |
| `npm run hedera:associate-vault` | Associate all TRADE equities with vault |
| `npm run db:migrate` | Apply `supabase/migrations/*` via Postgres |
| `npx tsx scripts/backfill-passphrases.ts` | Unlock + store passphrases / server keys |
| `npx tsx scripts/ensure-all-equity-tokens.ts` | Create all trade symbol HTS |
| `npx tsx scripts/verify-vault-sourcify.ts` | Sourcify verify |
| `npx tsx scripts/e2e-trade-profile-settle.ts` | E2E: profile, buy/sell fill, spend+settle |
| `npx tsx scripts/e2e-real-users.ts` | Broader real-user API checks |
| `npx tsx scripts/verify-vault-and-features.ts` | Vault wiring smoke |

---

## 6. Mainnet — what you need **right now**

### Accounts & money
1. **Mainnet operator** Hedera account ID + private key (DER).  
2. **HBAR** for: vault deploy, token creates, associations, every spend/repay fee.  
3. **~10 USDC** on Circle token `0.0.456858` in operator (treasury).  
4. Optional spare HBAR for user account creates (`INITIAL_ACCOUNT_HBAR=1`).

### SaaS / config (can reuse testnet projects carefully)
| Need | Notes |
|------|--------|
| Dynamic | Production env ID or same env if multi-network OK |
| Supabase | Same project OK; **no wallet_passphrase in production** for real users |
| Vercel / `folio.bar` | Production env vars |
| Pinata | Spend note metadata (if used) |
| `WALLET_KEY_SECRET` | Long random secret (do **not** reuse operator key) |

---

## 7. Mainnet process (step-by-step)

### Phase A — Isolate credentials
1. Keep **testnet** `.env.local` for local dev.  
2. Use **mainnet-only** env on Vercel (or a separate `.env.mainnet` never committed).  
3. Confirm operator is a **new mainnet** account (or deliberately shared — know the risk).

### Phase B — Chain setup
```bash
# .env.local temporarily mainnet + mainnet operator keys
export HEDERA_NETWORK=mainnet
export NEXT_PUBLIC_HEDERA_NETWORK=mainnet
export USDC_TOKEN_ID=0.0.456858
export USDC_TEST_TOKEN_ID=0.0.456858

npm run setup:mainnet              # TSLA/AAPL + NFT + HCS
npm run ensure:equities:mainnet    # all TRADE_STOCKS → folio_equity_tokens
npm run contracts:compile
npm run deploy:vault               # records FOLIO_VAULT_*
npm run hedera:associate-vault     # all equity symbols
```

4. Associate operator with USDC `0.0.456858` if needed; **fund ~$10 USDC**.  
5. Verify vault on Sourcify (chain **295**):  
   `HEDERA_NETWORK=mainnet npx tsx scripts/verify-vault-sourcify.ts`

### Phase C — Safety flags (required)
```bash
FOLIO_ENV=production
ALLOW_DEMO_MINT_STOCK=false     # no free stock on register (users Trade or deposit)
ALLOW_AUTO_FUND_USDC=false      # never free real USDC
ALLOW_MINT_USDC=false           # never mint Circle USDC
REQUIRE_VAULT=true
MAX_SPEND_USDC=2
MAX_OUTSTANDING_USDC=10
PER_USER_MAX_SPEND_USDC=5
SPEND_PAUSED=false
LITHIC_MOCK=true
FOLIO_ALLOW_DEV_AUTH=false      # never on production
# Do not set wallet_passphrase for real users
```

### Phase D — Database
1. Same Supabase project is fine; migrations already include mainnet-relevant tables.  
2. Confirm SQL from `docs/KNOWLEDGE.md` / migrations applied.  
3. **Do not** backfill real-user passphrases into DB on mainnet.

### Phase E — Deploy app
1. Set all env vars on Vercel production.  
2. Redeploy.  
3. UI Settings → shows **Hedera Mainnet**.  
4. Explorer links → `hashscan.io/mainnet`.

### Phase F — Smoke test
1. Login (Dynamic).  
2. Demo portfolio (HTS mint if enabled).  
3. Spend **$1** → HashScan: USDC out, vault collateral, NFT, HCS.  
4. Reject **$3** (`MAX_SPEND_USDC`).  
5. Repay $1 → collateral released.  
6. Optional: Trade buy/sell small notional if treasury allows.  
7. Kill switch: `SPEND_PAUSED=true` if anything looks wrong.

---

## 8. Gotchas (preserve forever)

1. **Vault associate `INVALID_SIGNATURE`** → redeploy with admin key (operator).  
2. **Solidity `release()` reverts** → use HTS release with admin signature.  
3. **Dynamic SSR `window is not defined`** → client-only Dynamic provider (`ssr: false` + mount gate).  
4. **Supabase pooler region** wrong → `tenant not found`; this project uses **`aws-1-ap-northeast-1`**.  
5. **Direct DB host IPv6-only** → use pooler for local migrations.  
6. **Missing `broker_orders` / profile columns** → trade fill / profile 500 until migrations run.  
7. **Auto-fill is in-process** → serverless cold starts may need admin fill route `/api/admin/orders/fill`.  
8. **Old vault balances** (`0.0.9217856`) not auto-migrated to new vault.  
9. **Sourcify creation match null** on Hedera is expected; runtime exact match is enough.  
10. **Never** `ALLOW_MINT_USDC` / `ALLOW_AUTO_FUND_USDC` with real Circle USDC.

---

## 9. Security model (simulation vs production)

| Asset | Testnet simulation | Mainnet |
|-------|--------------------|---------|
| User private keys | Browser + encrypted backup + optional server key | Prefer passphrase-only; strong `WALLET_KEY_SECRET` |
| `wallet_passphrase` column | OK for load tests | **Do not store** for real users |
| Operator key | Full treasury + vault admin | HSM / restricted machine; never commit |
| Dev auth `folio-dev:` | Local only | **Off** |

---

## 10. Related docs

| File | Role |
|------|------|
| [DESIGN.md](../DESIGN.md) | UI/brand rules |
| [DEPLOY-HEDERA.md](../DEPLOY-HEDERA.md) | Testnet vault + setup |
| [README.md](../README.md) | Product overview |
| [Claude.md](../Claude.md) | Agent routing |

---

## 11. Quick “is the tree healthy?” commands

```bash
# Schema + passphrases + one full money path
npx tsx scripts/e2e-trade-profile-settle.ts

# Vault + sourcify
npx tsx scripts/verify-vault-and-features.ts
npx tsx scripts/verify-vault-sourcify.ts
```

If both E2E scripts pass on testnet with vault configured, local product is ready; mainnet still needs **new** operator tokens + vault + USDC treasury + production env flags above.
