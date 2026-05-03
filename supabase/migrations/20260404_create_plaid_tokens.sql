-- Plaid access token storage (one token per user)
CREATE TABLE IF NOT EXISTS plaid_tokens (
  user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RLS: service role only (server-side access via SUPABASE_SERVICE_ROLE_KEY)
ALTER TABLE plaid_tokens ENABLE ROW LEVEL SECURITY;
