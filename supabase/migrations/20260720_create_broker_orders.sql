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
