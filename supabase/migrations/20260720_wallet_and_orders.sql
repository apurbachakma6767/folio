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
