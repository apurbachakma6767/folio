-- Simulation / load-test only: store wallet passphrase for automated unlock.
-- Do NOT use for production mainnet with real funds without encrypting at rest.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS server_wallet_key TEXT;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS wallet_passphrase TEXT;

COMMENT ON COLUMN public.users.wallet_passphrase IS
  'Test/simulation passphrase for automated wallet unlock. Not for production custody.';
