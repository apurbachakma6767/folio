# Design System — Folio

## Product Context
- **What this is:** Portfolio-backed spending app. "Goldman Sachs for everyone at 0%."
- **Who it's for:** Regular people with stock portfolios who want to spend without selling
- **Space/industry:** Neobank / fintech (Mercury, Ramp, Robinhood territory)
- **Project type:** Web app with dashboard + transaction flows
- **Key constraint:** Must look like a neobank, NOT a crypto app. No hex addresses, no "on-chain" labels, no token IDs visible in the UI. Blockchain is invisible plumbing.

## Aesthetic Direction
- **Direction:** Luxury/Refined with Utilitarian density
- **Decoration level:** Intentional — subtle gradient overlays on key surfaces, not flat everywhere
- **Mood:** Premium, trustworthy, private-bank-in-your-pocket. Dark mode that feels sophisticated, not "startup dark theme." Every UI element should pass the "would Mercury show this?" test.
- **Reference sites:** mercury.com, robinhood.com, wealthfront.com

## Typography
- **Display/Hero:** Geist — clean geometric sans-serif, ships via next/font with zero layout shift
- **Body:** Geist — same family, lighter weights for body text
- **UI/Labels:** Geist — 11px uppercase with wide tracking for section headers
- **Data/Tables:** Geist — supports tabular-nums for aligned financial data
- **Code:** Geist Mono
- **Loading:** via `next/font/google` or `next/font/local` for zero layout shift
- **Scale:**
  - Hero value: 44px / weight 700 / tracking -0.02em
  - Page heading: 28px / weight 700 / tracking -0.01em
  - Section heading: 20px / weight 600
  - Body: 15px / weight 400 / line-height 1.6
  - Small body: 13px / weight 400
  - Label: 11px / weight 600 / uppercase / tracking 0.06em
  - Caption: 10px / weight 600

## Color
- **Approach:** Restrained — one accent + neutrals, color is rare and meaningful
- **Accent:** #10B981 (emerald-500) — primary action color, CTA buttons, active states, "available to spend" highlight
- **Accent hover:** #059669 (emerald-600)
- **Accent muted:** rgba(16, 185, 129, 0.12) — backgrounds for active nav, badges, ghost buttons
- **Background base:** #0C0C0E — warm near-black (slightly warmer than pure #0A0A0B)
- **Background surface:** #161618 — cards, sidebar
- **Background elevated:** #1E1E21 — dropdowns, stat boxes, elevated cards
- **Border:** rgba(255,255,255,0.06) — subtle card edges
- **Text primary:** #F5F5F7 — headings, values, primary content
- **Text secondary:** #A1A1AA — body text, secondary info
- **Text tertiary:** #71717A — labels, captions, helper text
- **Positive:** #10B981 — gains, success states (same as accent, intentional)
- **Negative:** #EF4444 — losses, errors, destructive actions
- **Warning:** #F59E0B — expiry warnings, attention needed
- **Info:** #3B82F6 — neutral informational states
- **Dark mode:** This IS dark mode. No light mode planned.

## Spacing
- **Base unit:** 4px
- **Density:** Comfortable
- **Scale:** 2xs(2) xs(4) sm(8) md(16) lg(24) xl(32) 2xl(48) 3xl(64)
- **Card padding:** 20-24px
- **Section gaps:** 32-40px
- **Inline element gaps:** 8-12px

## Layout
- **Approach:** Hybrid — mobile-first card flow on small screens, sidebar + wider content on desktop
- **Grid:** Single column mobile, sidebar(240px) + content on desktop (md: 768px breakpoint)
- **Max content width:** 640px on desktop (up from current 420px), 420px on mobile
- **Border radius:**
  - sm: 8px — small buttons, badges
  - md: 12px — inputs, stat boxes, inner cards
  - lg: 16px — cards, main containers
  - full: 9999px — pills, avatars, dots
- **Responsive rules:**
  - < 768px: Bottom tab navigation, full-width content, 20px horizontal padding
  - >= 768px: Left sidebar navigation (240px), centered content area, 40px padding

## Motion
- **Approach:** Minimal-functional
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)
- **Duration:** micro(50-100ms) short(150-250ms) medium(250-400ms)
- **Patterns:**
  - Button hover: translateY(-1px) + shadow increase, 150ms
  - Card hover: border-color lighten, 200ms
  - Page transitions: none (instant navigation)
  - Loading: Skeleton shimmer (not spinners)
  - Status dots: Subtle pulse animation (2s infinite)
- **No scroll-driven effects.** No parallax. No entrance animations on scroll.

## Component Patterns
- **Cards:** bg-surface, 1px border, 16px radius, shadow-card. Hover lightens border.
- **Buttons:** Primary (accent bg, black text, shadow glow), Secondary (elevated bg, border, white text), Ghost (accent-muted bg, accent text), Danger (red-muted bg, red text)
- **Inputs:** Transparent bg, 1px rgba border, 12px radius. Focus: accent border color.
- **Pills/Badges:** 100px radius, 10px font, colored bg at 12% opacity
- **Empty states:** Icon in rounded square (bg-elevated), bold title, subtitle text, optional CTA button
- **Loading:** Skeleton shimmer animations, NOT spinner circles

## Neobank Rules (from user feedback)
- Use "Receipt" not "NFT Token"
- Use "View on explorer" not IPFS links
- Show user name/avatar instead of wallet addresses
- Use "Send Payment" not "Transfer tokens"
- Use "Transactions" not "Spend Notes"
- Never show hex addresses in the main UI
- The blockchain layer is invisible plumbing

## Spending Experience

The spending flow is the core product experience. It should feel like Venmo backed by stocks, not a trading terminal.

### Core Principle
The product is the 0% loan. Not the collar. Not the AI. Not the blockchain. Users spend money and repay it. Everything else is invisible plumbing.

### The Deal Card
The spend flow shows exactly 4 facts before sending:
- **They get:** dollar amount
- **Collateral:** shares locked (e.g., "0.222 TSLA")
- **Your cost:** $0
- **Repay by:** date

No floor/cap numbers in the default view. No protection range. No confidence scores. No volatility percentages. These live behind a "Learn more" link for judges and power users.

**Consequence line:** "Repay $X anytime to unlock your shares. If not repaid by [date], you can extend for a fee or shares are sold to settle."

### AI Voice
The AI speaks like a financially savvy friend, not a Bloomberg terminal. One sentence, human language, actionable.

**Four states:**
1. **Thinking:** "★ Checking TSLA market conditions..."
2. **Good:** "★ Good time — TSLA has been steady this month."
3. **Warning:** "★ Heads up: TSLA earnings on Apr 17. You're covered either way." (amber star for caution)
4. **Fallback:** "★ Market-based pricing applied." (gray, when no LLM available)

**Never say:** "implied volatility", "put/call ratio", "quantitative model", "expected move", "risk assessment", confidence percentages, or any quant jargon in the default UI. All of that lives behind "Learn more."

**Always say:** plain English, first person when appropriate, actionable. The AI's job is to build confidence or flag something worth knowing.

### Duration Picker
AI recommends one duration with a star (★). No explanation needed inline. Switching is instant. If the user picks a different one, AI updates to one-line guidance: "Longer loan, more flexibility."

### Transaction Progress
Replace generic status text with contextual steps:
- ✓ Locking 0.222 TSLA as collateral
- ● Confirming your signature
- ○ Sending $50 to Alex

Each step shows a checkmark when done. If slow (>5s), show "Usually takes a few seconds." No jargon, no "submitting to Hedera."

### Confirmation Screen
**Hero line:** "$50 sent to Alex" with subtitle "*without selling a single share*" in accent color. This is the emotional payoff.

**Minimal data:** Collateral locked, repay amount + date. That's it.

**AI visible by default (not collapsed):** Forward-looking, reassuring. "TSLA looks steady. Your shares should be fine through May. I'll nudge you before the deadline."

**One primary CTA:** "Back to Portfolio." Receipt link is secondary: "View receipt ↗" (not "Verify on Hedera Testnet").

### AI Settlement Bubble
The green dot is a persistent deadline buddy, not a one-shot notification.

**Behavior:**
- Don't auto-dismiss after 10 minutes. Let users X it out.
- Re-surface when context changes (new day, price move, <7 days to expiry)
- Turn amber when urgent (<3 days to expiry)

**Tone examples:**
- Normal: "12 days to repay your $50 TSLA loan. Your shares are doing well. Tap to settle."
- Urgent: "2 days left on your $50 TSLA loan. Settle now to keep your shares, or extend for a fee."
- Post-settlement: "Shares unlocked! Your 0.222 TSLA is fully yours again."

**Bottom sheet on tap:** Amount due, shares to unlock, settle button. No collar analysis.

### Repayment / Expiry Language
- Always mention the extension option: "If not repaid by [date], you can extend for a fee or shares are sold to settle."
- Never frame it as pure liquidation without the extension alternative
- The AI bubble should proactively suggest extension when deadline is near and user hasn't acted

### What Lives Behind "Learn More"
For judges, power users, and the SEC:
- CollarGraph visualization
- Floor/cap dollar amounts and percentages
- AI confidence score and risk level
- Reasoning paragraph with market data
- "Why is this free?" explanation (cap as cost mechanism)
- "How downside protection works" explanation

This content exists and is accurate. It's just not the default experience.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-04 | Initial design system created | Created by /design-consultation. Competitive research: Mercury, Ramp, Robinhood, Wealthfront. |
| 2026-04-04 | Geist over Inter | Inter is the most overused font in tech. Geist ships via next/font, has tabular-nums, modern. |
| 2026-04-04 | Emerald green accent retained | User preferred existing emerald over gold/amber alternative. Familiar, works well in dark mode. |
| 2026-04-04 | Warm near-black backgrounds | Shifted from #0A0A0B to #0C0C0E for slightly warmer feel. More premium than pure black. |
| 2026-04-04 | 640px max content on desktop | Previous 420px wasted desktop space. 640px gives room for data while staying focused. |
| 2026-04-04 | Skeleton loaders over spinners | Industry standard for fintech. Reduces perceived load time, looks more polished. |
| 2026-04-05 | Spending experience redesign | Strip collar from default view. AI as one-liner advisor, not analyst. 4 facts + 1 AI sentence = the deal card. |
| 2026-04-05 | Extension option on expiry | Always mention "extend for a fee" as alternative to liquidation. Makes the product friendlier. |
