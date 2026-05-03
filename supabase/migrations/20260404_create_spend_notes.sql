CREATE TABLE spend_notes (
  id              BIGSERIAL PRIMARY KEY,
  symbol          TEXT NOT NULL,
  serial          INTEGER NOT NULL,
  recipient       TEXT NOT NULL,
  recipient_name  TEXT NOT NULL,
  amount          NUMERIC(18,6) NOT NULL,
  shares          NUMERIC(18,6) NOT NULL,
  shares_hts      BIGINT NOT NULL,
  stock_price     NUMERIC(18,6) NOT NULL,
  floor           NUMERIC(18,6) NOT NULL,
  cap             NUMERIC(18,6) NOT NULL,
  duration_months INTEGER NOT NULL,
  expiry_date     TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','repaid','settled','liquidated')),
  tx_id           TEXT NOT NULL,
  settlement_tx_id TEXT,
  settlement_price NUMERIC(18,6),
  settlement_shares_returned BIGINT,
  settled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_account_id TEXT NOT NULL,
  recipient_account_id TEXT,
  card_token      TEXT,
  card_last_four  TEXT,
  card_state      TEXT,
  card_spend_limit NUMERIC(18,6)
);

CREATE INDEX idx_spend_notes_status_expiry ON spend_notes(expiry_date) WHERE status = 'active';
CREATE INDEX idx_spend_notes_user ON spend_notes(user_account_id);
