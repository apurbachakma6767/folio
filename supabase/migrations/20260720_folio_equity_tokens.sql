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
