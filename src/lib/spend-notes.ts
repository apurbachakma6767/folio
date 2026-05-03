// Spend notes — Supabase-backed persistent store for collar lifecycle

import { supabase } from './supabase';

export type NoteStatus = 'active' | 'repaid' | 'settled' | 'liquidated';

export interface SpendNote {
  id: number;
  symbol: string;
  serial: number;
  recipient: string;
  recipientName: string;
  amount: number;
  shares: number;
  sharesHts: number;
  stockPrice: number;
  floor: number;
  cap: number;
  durationMonths: number;
  expiryDate: string;
  status: NoteStatus;
  txId: string;
  settlementTxId?: string;
  settlementPrice?: number;
  settlementSharesReturned?: number;
  settledAt?: string;
  createdAt: string;
  userAccountId: string;
  recipientAccountId?: string;
  recipientEmail?: string;
  cardToken?: string;
  cardLastFour?: string;
  cardState?: 'OPEN' | 'PAUSED' | 'CLOSED';
  cardSpendLimit?: number;
}

interface NoteRow {
  id: number;
  symbol: string;
  serial: number;
  recipient: string;
  recipient_name: string;
  amount: number;
  shares: number;
  shares_hts: number;
  stock_price: number;
  floor: number;
  cap: number;
  duration_months: number;
  expiry_date: string;
  status: string;
  tx_id: string;
  settlement_tx_id: string | null;
  settlement_price: number | null;
  settlement_shares_returned: number | null;
  settled_at: string | null;
  created_at: string;
  user_account_id: string;
  recipient_account_id: string | null;
  recipient_email: string | null;
  card_token: string | null;
  card_last_four: string | null;
  card_state: string | null;
  card_spend_limit: number | null;
}

function rowToNote(row: NoteRow): SpendNote {
  return {
    id: row.id,
    symbol: row.symbol,
    serial: row.serial,
    recipient: row.recipient,
    recipientName: row.recipient_name,
    amount: Number(row.amount),
    shares: Number(row.shares),
    sharesHts: Number(row.shares_hts),
    stockPrice: Number(row.stock_price),
    floor: Number(row.floor),
    cap: Number(row.cap),
    durationMonths: row.duration_months,
    expiryDate: row.expiry_date,
    status: row.status as NoteStatus,
    txId: row.tx_id,
    settlementTxId: row.settlement_tx_id ?? undefined,
    settlementPrice: row.settlement_price != null ? Number(row.settlement_price) : undefined,
    settlementSharesReturned: row.settlement_shares_returned != null ? Number(row.settlement_shares_returned) : undefined,
    settledAt: row.settled_at ?? undefined,
    createdAt: row.created_at,
    userAccountId: row.user_account_id,
    recipientAccountId: row.recipient_account_id ?? undefined,
    recipientEmail: row.recipient_email ?? undefined,
    cardToken: row.card_token ?? undefined,
    cardLastFour: row.card_last_four ?? undefined,
    cardState: (row.card_state as SpendNote['cardState']) ?? undefined,
    cardSpendLimit: row.card_spend_limit != null ? Number(row.card_spend_limit) : undefined,
  };
}

export async function addNote(
  note: Omit<SpendNote, 'id' | 'settlementTxId' | 'settlementPrice' | 'settlementSharesReturned' | 'settledAt'>
): Promise<SpendNote> {
  const { data, error } = await supabase
    .from('spend_notes')
    .insert({
      symbol: note.symbol,
      serial: note.serial,
      recipient: note.recipient,
      recipient_name: note.recipientName,
      amount: note.amount,
      shares: note.shares,
      shares_hts: note.sharesHts,
      stock_price: note.stockPrice,
      floor: note.floor,
      cap: note.cap,
      duration_months: note.durationMonths,
      expiry_date: note.expiryDate,
      status: note.status,
      tx_id: note.txId,
      created_at: note.createdAt,
      user_account_id: note.userAccountId,
      recipient_account_id: note.recipientAccountId ?? null,
      recipient_email: note.recipientEmail ?? null,
      card_token: note.cardToken ?? null,
      card_last_four: note.cardLastFour ?? null,
      card_state: note.cardState ?? null,
      card_spend_limit: note.cardSpendLimit ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToNote(data);
}

export async function getNotes(userAccountId?: string): Promise<SpendNote[]> {
  let query = supabase.from('spend_notes').select().order('created_at', { ascending: false });
  if (userAccountId) {
    query = query.eq('user_account_id', userAccountId);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(rowToNote);
}

export async function getNote(id: number): Promise<SpendNote | undefined> {
  const { data, error } = await supabase
    .from('spend_notes')
    .select()
    .eq('id', id)
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ? rowToNote(data) : undefined;
}

export async function updateNoteStatus(
  id: number,
  status: NoteStatus
): Promise<SpendNote | undefined> {
  const { data, error } = await supabase
    .from('spend_notes')
    .update({ status })
    .eq('id', id)
    .select()
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return data ? rowToNote(data) : undefined;
}

export async function settleNote(
  id: number,
  settlement: {
    status: 'repaid' | 'settled' | 'liquidated';
    settlementTxId: string;
    settlementPrice: number;
    settlementSharesReturned: number;
  }
): Promise<SpendNote | undefined> {
  const { data, error } = await supabase
    .from('spend_notes')
    .update({
      status: settlement.status,
      settlement_tx_id: settlement.settlementTxId,
      settlement_price: settlement.settlementPrice,
      settlement_shares_returned: settlement.settlementSharesReturned,
      settled_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data ? rowToNote(data) : undefined;
}

export async function getExpiredActiveNotes(): Promise<SpendNote[]> {
  const { data, error } = await supabase
    .from('spend_notes')
    .select()
    .eq('status', 'active')
    .lte('expiry_date', new Date().toISOString());
  if (error) throw error;
  return (data ?? []).map(rowToNote);
}
