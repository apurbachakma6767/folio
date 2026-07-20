-- Folio Database Schema
-- Run this in the Supabase SQL Editor: https://app.supabase.com/project/_/sql

-- ── Users table ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.users (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  hedera_account_id TEXT NOT NULL DEFAULT '',
  public_key TEXT,
  encrypted_key TEXT,
  key_salt TEXT,
  key_iv TEXT,
  evm_wallet_address TEXT,
  delegation_wallet_id TEXT,
  delegation_api_key TEXT,
  delegation_key_share TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Spend notes table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.spend_notes (
  id BIGSERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  serial BIGINT NOT NULL,
  recipient TEXT NOT NULL,
  recipient_name TEXT NOT NULL DEFAULT '',
  amount DOUBLE PRECISION NOT NULL,
  shares DOUBLE PRECISION NOT NULL,
  shares_hts BIGINT NOT NULL,
  stock_price DOUBLE PRECISION NOT NULL,
  floor DOUBLE PRECISION NOT NULL,
  cap DOUBLE PRECISION NOT NULL,
  duration_months INTEGER NOT NULL DEFAULT 1,
  expiry_date TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  tx_id TEXT NOT NULL DEFAULT '',
  settlement_tx_id TEXT,
  settlement_price DOUBLE PRECISION,
  settlement_shares_returned BIGINT,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_account_id TEXT NOT NULL,
  recipient_account_id TEXT,
  recipient_email TEXT,
  card_token TEXT,
  card_last_four TEXT,
  card_state TEXT,
  card_spend_limit INTEGER
);

-- ── Plaid tokens table ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plaid_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_spend_notes_user ON public.spend_notes(user_account_id);
CREATE INDEX IF NOT EXISTS idx_spend_notes_status ON public.spend_notes(status);
CREATE INDEX IF NOT EXISTS idx_spend_notes_expiry ON public.spend_notes(expiry_date);

-- ── RLS policy (allow service role) ──────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spend_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plaid_tokens ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (app uses service_role key)
CREATE POLICY "service_role_all" ON public.users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.spend_notes FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON public.plaid_tokens FOR ALL USING (true) WITH CHECK (true);
