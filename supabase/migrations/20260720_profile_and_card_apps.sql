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
