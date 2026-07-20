-- Broker desk orders — manual fill by partner; later API sync
CREATE TABLE IF NOT EXISTS public.broker_orders (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_account_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  symbol TEXT NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  notional_usd DOUBLE PRECISION,
  limit_price DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'filled', 'cancelled', 'failed')),
  notes TEXT,
  fill_tx_id TEXT,
  filled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_orders_user ON public.broker_orders(user_email);
CREATE INDEX IF NOT EXISTS idx_broker_orders_status ON public.broker_orders(status);

ALTER TABLE public.broker_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON public.broker_orders FOR ALL USING (true) WITH CHECK (true);
-- Broker orders (desk) + server wallet key backup + testnet account for cards demo

CREATE TABLE IF NOT EXISTS public.broker_orders (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_account_id TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  symbol TEXT NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  notional_usd DOUBLE PRECISION,
  limit_price DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'filled', 'cancelled', 'failed')),
  notes TEXT,
  fill_tx_id TEXT,
  filled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_broker_orders_user ON public.broker_orders(user_email);
CREATE INDEX IF NOT EXISTS idx_broker_orders_status ON public.broker_orders(status);

ALTER TABLE public.broker_orders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all" ON public.broker_orders;
CREATE POLICY "service_role_all" ON public.broker_orders FOR ALL USING (true) WITH CHECK (true);

-- Server-held encrypted private key (primary network wallet)
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS server_wallet_key TEXT;

-- Testnet wallet for cards demo when primary network is mainnet
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS testnet_hedera_account_id TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS testnet_public_key TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS testnet_server_wallet_key TEXT;
-- Profile fields + card applications (mainnet waitlist / review)

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS city TEXT;

CREATE TABLE IF NOT EXISTS public.card_applications (
  id BIGSERIAL PRIMARY KEY,
  user_email TEXT NOT NULL,
  user_account_id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  country TEXT,
  city TEXT,
  employment_status TEXT,
  monthly_income_usd DOUBLE PRECISION,
  portfolio_value_usd DOUBLE PRECISION,
  tx_volume_90d_usd DOUBLE PRECISION,
  checklist_portfolio_ok BOOLEAN NOT NULL DEFAULT false,
  checklist_activity_ok BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_card_apps_email ON public.card_applications(user_email);
CREATE INDEX IF NOT EXISTS idx_card_apps_status ON public.card_applications(status);

ALTER TABLE public.card_applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_all_card_apps" ON public.card_applications;
CREATE POLICY "service_role_all_card_apps" ON public.card_applications FOR ALL USING (true) WITH CHECK (true);
-- Allow processing status for auto-confirm pipeline
ALTER TABLE public.broker_orders DROP CONSTRAINT IF EXISTS broker_orders_status_check;
ALTER TABLE public.broker_orders ADD CONSTRAINT broker_orders_status_check
  CHECK (status IN ('pending', 'processing', 'filled', 'cancelled', 'failed'));
-- Persist auto-created Folio equity HTS token IDs (one per stock symbol, shared by all users)
CREATE TABLE IF NOT EXISTS public.folio_equity_tokens (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_id TEXT NOT NULL UNIQUE,
  decimals INTEGER NOT NULL DEFAULT 6,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.folio_equity_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_equity_tokens" ON public.folio_equity_tokens;
CREATE POLICY "service_role_equity_tokens" ON public.folio_equity_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- Wallet simulation columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS server_wallet_key TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS wallet_passphrase TEXT;

