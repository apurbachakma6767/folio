import { supabase } from './supabase';

export type CardAppStatus = 'submitted' | 'under_review' | 'approved' | 'rejected';

export interface CardApplication {
  id: number;
  userEmail: string;
  userAccountId: string;
  fullName: string;
  phone?: string;
  country?: string;
  city?: string;
  employmentStatus?: string;
  monthlyIncomeUsd?: number;
  portfolioValueUsd?: number;
  txVolume90dUsd?: number;
  checklistPortfolioOk: boolean;
  checklistActivityOk: boolean;
  status: CardAppStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

interface Row {
  id: number;
  user_email: string;
  user_account_id: string;
  full_name: string;
  phone: string | null;
  country: string | null;
  city: string | null;
  employment_status: string | null;
  monthly_income_usd: number | null;
  portfolio_value_usd: number | null;
  tx_volume_90d_usd: number | null;
  checklist_portfolio_ok: boolean;
  checklist_activity_ok: boolean;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToApp(row: Row): CardApplication {
  return {
    id: row.id,
    userEmail: row.user_email,
    userAccountId: row.user_account_id,
    fullName: row.full_name,
    phone: row.phone ?? undefined,
    country: row.country ?? undefined,
    city: row.city ?? undefined,
    employmentStatus: row.employment_status ?? undefined,
    monthlyIncomeUsd: row.monthly_income_usd ?? undefined,
    portfolioValueUsd: row.portfolio_value_usd ?? undefined,
    txVolume90dUsd: row.tx_volume_90d_usd ?? undefined,
    checklistPortfolioOk: row.checklist_portfolio_ok,
    checklistActivityOk: row.checklist_activity_ok,
    status: row.status as CardAppStatus,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getLatestApplication(email: string): Promise<CardApplication | null> {
  const { data, error } = await supabase
    .from('card_applications')
    .select()
    .eq('user_email', email.toLowerCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (/card_applications|schema cache|does not exist/i.test(error.message || '')) {
      return null;
    }
    throw error;
  }
  return data ? rowToApp(data) : null;
}

export async function createApplication(input: {
  userEmail: string;
  userAccountId: string;
  fullName: string;
  phone?: string;
  country?: string;
  city?: string;
  employmentStatus?: string;
  monthlyIncomeUsd?: number;
  portfolioValueUsd?: number;
  txVolume90dUsd?: number;
  checklistPortfolioOk: boolean;
  checklistActivityOk: boolean;
}): Promise<CardApplication> {
  const { data, error } = await supabase
    .from('card_applications')
    .insert({
      user_email: input.userEmail.toLowerCase(),
      user_account_id: input.userAccountId,
      full_name: input.fullName,
      phone: input.phone ?? null,
      country: input.country ?? null,
      city: input.city ?? null,
      employment_status: input.employmentStatus ?? null,
      monthly_income_usd: input.monthlyIncomeUsd ?? null,
      portfolio_value_usd: input.portfolioValueUsd ?? null,
      tx_volume_90d_usd: input.txVolume90dUsd ?? null,
      checklist_portfolio_ok: input.checklistPortfolioOk,
      checklist_activity_ok: input.checklistActivityOk,
      status: 'submitted',
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw error;
  return rowToApp(data);
}
