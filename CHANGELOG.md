# Changelog

All notable changes to Folio will be documented in this file.

## [0.2.9.3] - 2026-04-05

### Added
- One-command CRE workflow simulation script for ETHGlobal judges (`chainlink/simulate.sh`)
- Automatic mock server lifecycle with EXIT trap cleanup and readiness polling

## [0.2.9.2] - 2026-04-05

### Removed
- Dynamic Wallet card from Settings page — internal EVM wallet details are not user-facing

## [0.2.9.1] - 2026-04-05

### Fixed
- Plaid brokerage integration showing "unavailable" after login due to auth timing race — useEffect now re-runs when Dynamic auth state changes

## [0.2.9.0] - 2026-04-05

### Changed
- AI optimization endpoint now fetches price, volatility, and treasury balance in parallel (~3x faster)
- Replaced multi-step agentic LLM pre-flight with direct Hedera SDK balance check (5-10s down to ~200ms)
- All 3 collar durations (1/2/3 months) computed in a single API call, enabling instant duration switching
- Added 5-minute AI recommendation cache keyed by symbol to skip redundant LLM calls
- Renamed "Your Protection" to "Price Range" on spend page for clearer neobank framing
- Confirmation page now shows floor/cap prices inline in the advance summary
- AI analysis on confirmation page moved to a collapsible section showing actual reasoning instead of generic text
- SpendResult type extended with floor, cap, floorPct, capPct fields

## [0.2.8.0] - 2026-04-05

### Changed
- Chainlink is now the primary price source with a 3-tier fallback: Chainlink Price Feed, CRE CollarOracle, Yahoo Finance, then hardcoded
- Added direct Chainlink Price Feed reads via `getLatestPrice` on the CollarOracle contract, independent of the CRE workflow
- Tightened staleness window from 1 hour to 10 minutes for CRE data and 5 minutes for direct price feeds, matching the CRE cron schedule
- Price data now includes collar parameters (floor/cap/volatility) when available from the Chainlink oracle
- Chainlink prices now track change/changePercent across fetches instead of always returning zero
- Frontend PriceData type updated to include `chainlink` source and optional collar fields

## [0.2.7.0] - 2026-04-05

### Added
- Hedera Agent Kit integration with MiniMax M1 for autonomous on-chain operations (AI & Agentic Payments bounty)
- AI agent endpoint (`/api/ai/agent`) supporting freeform prompts and structured actions (balance checks, audit logs, collar analysis)
- Agentic pre-flight in collar optimization: AI agent verifies treasury USDC balance before recommending advances
- Folio logo as SVG favicon replacing default Next.js icon

### Fixed
- Mirror node transaction ID normalization only replaces timestamp dot, not account ID dots
- Auth demo bypass gated to non-production environments (was active in all environments)
- USDC rounding in escrow uses `Math.round` instead of `Math.floor` to prevent off-by-one losses
- Chainlink route now requires authentication (was previously unprotected)
- Users can only access/modify their own encryption keys via ownership checks
- Card freeze endpoint scoped to authenticated user's notes (was querying all notes)
- parseInt calls include radix and NaN fallback across audit, transactions, and notes routes
- Error responses return proper 500 status codes instead of 200 with error body
- Note ID validation rejects non-numeric IDs with 400 instead of passing NaN
- SpendFlow amount input prevents multiple decimal points
- `selectedNoteId` falsy check changed to `!== null` so noteId 0 works correctly
- Per-symbol price cache prevents stale data when fetching different stock symbols

### Changed
- Removed dead EvmWallet component (duplicated in Settings.tsx)
- Removed duplicated `getThirdFriday`/`getExpiryDate` from ai-collar-optimizer, imports from collar.ts
- Removed dead `onViewNote` prop from CardResult component
- Updated escrow and AiBubble tests for signed-transaction and two-step repay patterns

## [0.2.6.1] - 2026-04-05

### Added
- HCS audit trail API test suite covering auth, message decode, error handling, and missing topic
- Escrow audit failure resilience tests proving HCS outages don't break transactions
- Mirror node `decodeHcsMessage` round-trip tests for valid, malformed, and non-JSON payloads

## [0.2.6.0] - 2026-04-04

### Added
- Emerald AI bubble that watches your positions and suggests when to settle advances
- Outstanding Advance card on Portfolio screen showing most urgent active note
- Bottom sheet settle flow with one-tap repayment from the AI bubble
- Contextual suggestion logic: near-expiry, near-cap, stock-up, and default variants
- Active notes state management in page.tsx with automatic refresh after spend/settle
- 17 new tests covering AI bubble visibility, suggestions, settle flow, and Portfolio advance card
- MockUSDC contract on Base Sepolia with public mint for testnet demos
- Foundry deploy script (DeployMockUSDC.s.sol) and SetPriceFeeds script for Chainlink oracle setup
- Auto-mint 25 USDC to user's Dynamic embedded wallet on registration
- Oracle maintenance fee (0.10 USDC per spend) sent on Base Sepolia to fund Chainlink updates
- Stale oracle fallback: Dynamic server wallet pushes fresh CollarOracle data when CRE workflow is behind

### Changed
- Notes API routes now user-scoped via auth email lookup (previously accepted any userAccountId)
- Price fetch includes collateral symbols from active notes for accurate AI suggestions
- NoteDetail catch block no longer falsely marks note as repaid on API failure
- Portfolio "Available to Spend" card shrinks to single line when an advance is active
- KYC grant and token unfreeze now wired into user registration (stock tokens have freezeDefault=true)
- Dynamic server wallet repurposed from redundant USDC transfer to oracle maintenance
- EVM settlement block now encodes real ERC-20 calldata instead of empty 0x stub

## [0.2.5.1] - 2026-04-04

### Changed
- Rewrite README to lead with value proposition ("0% Loans Against Your Stocks") instead of implementation details
- Update page metadata from "Prime Broker in Your Pocket" to "0% Loans Against Your Stocks"
- Replace "zero-cost collar" terminology with plain-English explanation in spend flow UI
- Change status messages from "Collar expired" to "Loan expired" for user-facing clarity
- Add market comparison section to README (Fidelity/Schwab SBLOCs vs Folio)

## [0.2.5.0] - 2026-04-04

### Added
- Persistent spend notes via Supabase `spend_notes` table (replaces in-memory store)
- Escrow lifecycle: automated settlement on collar expiry with Hedera token transfers
- Settlement math engine handling four outcomes: early repay, in-range settle, above-cap settle, below-floor liquidation
- User repayment endpoint (`POST /api/spend/repay`) with USDC return and collateral release
- Vercel cron job (`/api/cron/settle-expired`) runs every 4 hours to process expired collars
- HCS audit logging for all settlement events (COLLAR_REPAID, COLLAR_SETTLED, COLLAR_LIQUIDATED)
- Settlement details display in NoteDetail (settlement price, shares returned)
- New note statuses: `settled` and `liquidated` with distinct visual treatment

### Changed
- All spend note storage migrated from in-memory array to Supabase
- Card freeze route uses Supabase update instead of in-memory mutation

## [0.2.4.0] - 2026-04-04

### Fixed
- Spend flow INVALID_SIGNATURE error: added pre-flight balance check so the collateral lock transaction is only attempted when the user has sufficient stock tokens on Hedera
- AI collar analysis details now shown on the confirmation screen after completing a spend (previously discarded)

## [0.2.3.0] - 2026-04-04

### Added
- Supabase migration for `plaid_tokens` table with RLS enabled, enabling persistent Plaid token storage across deploys
- Test assertion verifying holdings endpoint resolves user from JWT auth
- Reusable prepaid Visa cards via Lithic (upgraded from single-use to UNLOCKED type)
- Card detail page with full card visual, collar protection range, and card info
- Card freeze/unfreeze functionality with Lithic API integration and visual feedback
- Spending limit update support via Lithic PATCH endpoint
- Card freeze API route (`/api/cards/freeze`) with ownership verification
- Single note API route (`/api/notes/[id]`) for card detail data
- Cards list separates active vs past cards with richer mini-card visuals
- Frozen card overlay badge and dimmed visual state
- Tap-to-reveal PAN on card result screen (masked by default)
- 4 new Lithic tests: freeze, unfreeze, spend limit update, card retrieval

### Fixed
- Plaid holdings endpoint now uses authenticated user email instead of trusting client-supplied userId query parameter
- Frontend Plaid hook no longer sends hardcoded 'demo-user' to API routes

### Changed
- Card visuals now use DESIGN.md color tokens instead of hardcoded navy gradients
- "Virtual Card" label updated to "Prepaid Card" across all card surfaces
- CardResult primary action changed from "View All Cards" to "View Card Details"
- Card list items are now tappable, navigating to new card detail page
- Lithic mock mode persists cards in memory for freeze/unfreeze testing

## [0.2.2.0] - 2026-04-04

### Added
- Dynamic embedded EVM wallets auto-created on signup via EthereumWalletConnectors
- Dynamic Node SDK server wallet for platform EVM treasury (2-of-2 MPC)
- Delegated signing system with HMAC-verified webhook handler for server-side signing on behalf of users
- EVM settlement step in spend flow, sending USDC to user's embedded wallet on Base Sepolia
- EvmWallet component displaying embedded wallet address with copy button and network badge
- Dynamic Wallet card in Settings showing wallet address and MPC security info
- API routes: `/api/dynamic/server-wallet`, `/api/dynamic/delegation`, `/api/users/evm-wallet`
- Type declarations for Dynamic Node SDK packages
- Supabase migration for EVM wallet address and delegation credential columns

### Changed
- Dynamic provider now includes EthereumWalletConnectors for embedded wallet support
- Registration flow stores EVM wallet address alongside Hedera account
- Settings page relabeled "Wallet Key" to "Hedera Signing Key" to distinguish from Dynamic wallet
- next.config.ts adds serverExternalPackages for Dynamic Node SDK native modules

## [0.2.1.1] - 2026-04-04

### Fixed
- New accounts not showing $500 USDC balance due to race condition in registration hook
- Dynamic SDK `user` object reference changes were cancelling in-flight registration responses

## [0.2.1.0] - 2026-04-04

### Changed
- User registry and Plaid token storage migrated from local JSON files to Supabase Postgres
- All registry and token functions are now async with proper await handling
- App is now deployable on serverless platforms (Vercel) with no filesystem dependency

### Added
- Supabase client integration (`@supabase/supabase-js`)
- `users` and `plaid_tokens` Postgres tables replacing `.user-registry.json` and `.plaid-tokens.json`

## [0.2.0.3] - 2026-04-04

### Fixed
- Portfolio page now shows individual holdings (TSLA, AAPL) instead of hiding them behind a "Connect Brokerage" button when Plaid is available in demo mode

## [0.3.0.0] - 2026-04-04

### Added
- Virtual Visa debit card issuing via Lithic API (sandbox + mock mode)
- Card result screen with full PAN, CVV (tap to reveal), expiry, and balance display
- Cards section in nav with history of issued cards
- Lithic integration with mock mode for demo without API key

### Changed
- Spend flow rewritten: "Get Card" replaces "Send Payment" as primary action
- "Loan" terminology softened to "advance" across all UI (SpendFlow, Confirmation, NoteDetail)
- "Repay" → "Settle", "Loan Summary" → "Advance Summary", "Protected until" replaces "Repay by"
- Duration hardcoded to 1 month for card flow (removed duration picker)
- Nav labels: "Send" → "Spend"

### Removed
- Bitrefill gift card integration (replaced by Lithic virtual cards)
- Brand picker component (universal Visa card, no brand selection needed)
- Recipient selector from spend flow (card flow is self-serve)

## [0.2.0.2] - 2026-04-04

### Fixed
- "Connect Brokerage" button was hidden when showing demo holdings, making it impossible to link a real Plaid account

## [0.2.0.1] - 2026-04-04

### Fixed
- Login screen now uses the app's green accent design system (was gray `bg-white/10`)
- Added Folio "F" logo icon to login card to match sidebar branding
- CollarGraph now shows the correct stock name instead of hardcoded "Tesla"

## [0.2.0.0] - 2026-04-04

### Changed
- Auth flow is now email-only — no wallet connectors, no crypto language
- Dynamic SDK modal styled to match neobank design system (dark theme, emerald accent, Inter font)
- Login button says "Sign in" instead of "Connect"
- Auth guard copy updated to "Sign in with your email to continue"

### Removed
- `@dynamic-labs/ethereum` wallet connector dependency
