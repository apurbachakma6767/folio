// Plaid client singleton + Supabase-backed token store

import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { supabase } from './supabase';

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID || '',
      'PLAID-SECRET': process.env.PLAID_SECRET || '',
    },
  },
});

export const plaidClient = new PlaidApi(configuration);

export const isPlaidConfigured = !!(
  process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET
);

export async function setAccessToken(userId: string, token: string): Promise<void> {
  const { error } = await supabase
    .from('plaid_tokens')
    .upsert({
      user_id: userId,
      access_token: token,
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
}

export async function getAccessToken(userId: string): Promise<string | undefined> {
  const { data } = await supabase
    .from('plaid_tokens')
    .select('access_token')
    .eq('user_id', userId)
    .single();
  return data?.access_token ?? undefined;
}

export async function hasAccessToken(userId: string): Promise<boolean> {
  const { data } = await supabase
    .from('plaid_tokens')
    .select('user_id')
    .eq('user_id', userId)
    .single();
  return !!data;
}
