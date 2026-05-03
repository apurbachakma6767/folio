-- Add EVM wallet and Dynamic delegation columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS evm_wallet_address TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delegation_wallet_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delegation_api_key TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS delegation_key_share TEXT;
