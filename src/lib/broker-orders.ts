// Broker desk orders — user requests; auto-fill or ops fill later.
// Falls back to file-backed store if broker_orders table is missing (local / unmigrated DB).

import fs from 'fs';
import path from 'path';
import { supabase } from './supabase';

export type OrderSide = 'buy' | 'sell';
export type OrderStatus = 'pending' | 'processing' | 'filled' | 'cancelled' | 'failed';

export interface BrokerOrder {
  id: number;
  userEmail: string;
  userAccountId: string;
  side: OrderSide;
  symbol: string;
  shares: number;
  notionalUsd?: number;
  limitPrice?: number;
  status: OrderStatus;
  notes?: string;
  fillTxId?: string;
  filledAt?: string;
  createdAt: string;
}

interface OrderRow {
  id: number;
  user_email: string;
  user_account_id: string;
  side: string;
  symbol: string;
  shares: number;
  notional_usd: number | null;
  limit_price: number | null;
  status: string;
  notes: string | null;
  fill_tx_id: string | null;
  filled_at: string | null;
  created_at: string;
}

const DATA_DIR = path.join(process.cwd(), '.data');
const FILE_STORE = path.join(DATA_DIR, 'broker-orders.json');

/** In-process + file-backed fallback when Supabase table not migrated */
let memoryOrders: BrokerOrder[] = [];
let memoryNextId = 1;
let forceMemory: boolean | null = null;
let fileLoaded = false;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST205' ||
    error.code === '42P01' ||
    /broker_orders|schema cache|does not exist/i.test(error.message || '')
  );
}

function rowToOrder(row: OrderRow): BrokerOrder {
  return {
    id: row.id,
    userEmail: row.user_email,
    userAccountId: row.user_account_id,
    side: row.side as OrderSide,
    symbol: row.symbol,
    shares: Number(row.shares),
    notionalUsd: row.notional_usd != null ? Number(row.notional_usd) : undefined,
    limitPrice: row.limit_price != null ? Number(row.limit_price) : undefined,
    status: row.status as OrderStatus,
    notes: row.notes ?? undefined,
    fillTxId: row.fill_tx_id ?? undefined,
    filledAt: row.filled_at ?? undefined,
    createdAt: row.created_at,
  };
}

function loadFileStore(): void {
  if (fileLoaded) return;
  fileLoaded = true;
  try {
    if (fs.existsSync(FILE_STORE)) {
      const raw = JSON.parse(fs.readFileSync(FILE_STORE, 'utf8')) as {
        nextId?: number;
        orders?: BrokerOrder[];
      };
      memoryOrders = raw.orders || [];
      memoryNextId = raw.nextId || (memoryOrders.reduce((m, o) => Math.max(m, o.id), 0) + 1);
    }
  } catch (e) {
    console.warn('[broker-orders] file load failed', e);
  }
}

function persistFileStore(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      FILE_STORE,
      JSON.stringify({ nextId: memoryNextId, orders: memoryOrders }, null, 2)
    );
  } catch (e) {
    console.warn('[broker-orders] file persist failed', e);
  }
}

function createMemoryOrder(input: {
  userEmail: string;
  userAccountId: string;
  side: OrderSide;
  symbol: string;
  shares: number;
  notionalUsd?: number;
  limitPrice?: number;
  notes?: string;
}): BrokerOrder {
  loadFileStore();
  const order: BrokerOrder = {
    id: memoryNextId++,
    userEmail: input.userEmail.toLowerCase(),
    userAccountId: input.userAccountId,
    side: input.side,
    symbol: input.symbol.toUpperCase(),
    shares: input.shares,
    notionalUsd: input.notionalUsd,
    limitPrice: input.limitPrice,
    status: 'pending',
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };
  memoryOrders.unshift(order);
  persistFileStore();
  return order;
}

export async function createOrder(input: {
  userEmail: string;
  userAccountId: string;
  side: OrderSide;
  symbol: string;
  shares: number;
  notionalUsd?: number;
  limitPrice?: number;
  notes?: string;
}): Promise<BrokerOrder> {
  if (forceMemory) {
    return createMemoryOrder(input);
  }

  const { data, error } = await supabase
    .from('broker_orders')
    .insert({
      user_email: input.userEmail.toLowerCase(),
      user_account_id: input.userAccountId,
      side: input.side,
      symbol: input.symbol.toUpperCase(),
      shares: input.shares,
      notional_usd: input.notionalUsd ?? null,
      limit_price: input.limitPrice ?? null,
      status: 'pending',
      notes: input.notes ?? null,
    })
    .select()
    .single();

  if (error) {
    if (isMissingTable(error)) {
      console.warn(
        '[broker-orders] table missing — using file-backed store. Run migration 20260720_wallet_and_orders.sql'
      );
      forceMemory = true;
      return createMemoryOrder(input);
    }
    throw error;
  }
  forceMemory = false;
  return rowToOrder(data);
}

export async function listOrders(userEmail?: string): Promise<BrokerOrder[]> {
  if (forceMemory) {
    loadFileStore();
    const email = userEmail?.toLowerCase();
    return email
      ? memoryOrders.filter((o) => o.userEmail === email)
      : [...memoryOrders];
  }

  let q = supabase.from('broker_orders').select().order('created_at', { ascending: false });
  if (userEmail) q = q.eq('user_email', userEmail.toLowerCase());
  const { data, error } = await q;

  if (error) {
    if (isMissingTable(error)) {
      console.warn('[broker-orders] table missing — file store');
      forceMemory = true;
      loadFileStore();
      const email = userEmail?.toLowerCase();
      return email
        ? memoryOrders.filter((o) => o.userEmail === email)
        : [...memoryOrders];
    }
    throw error;
  }
  forceMemory = false;
  return (data ?? []).map(rowToOrder);
}

export async function getOrder(id: number): Promise<BrokerOrder | undefined> {
  if (forceMemory) {
    loadFileStore();
    return memoryOrders.find((o) => o.id === id);
  }

  const { data, error } = await supabase
    .from('broker_orders')
    .select()
    .eq('id', id)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      forceMemory = true;
      loadFileStore();
      return memoryOrders.find((o) => o.id === id);
    }
    if (error.code !== 'PGRST116') throw error;
    return undefined;
  }
  return data ? rowToOrder(data) : undefined;
}

export async function markOrderFilled(
  id: number,
  fillTxId?: string,
  notes?: string
): Promise<BrokerOrder> {
  if (forceMemory) {
    loadFileStore();
    const o = memoryOrders.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    o.status = 'filled';
    o.fillTxId = fillTxId;
    o.filledAt = new Date().toISOString();
    // Keep settlement note for audit; append fill info
    if (notes) o.notes = notes;
    persistFileStore();
    return o;
  }

  const { data, error } = await supabase
    .from('broker_orders')
    .update({
      status: 'filled',
      fill_tx_id: fillTxId ?? null,
      filled_at: new Date().toISOString(),
      notes: notes ?? undefined,
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (isMissingTable(error)) {
      forceMemory = true;
      return markOrderFilled(id, fillTxId, notes);
    }
    throw error;
  }
  return rowToOrder(data);
}

export async function markOrderStatus(
  id: number,
  status: OrderStatus,
  notes?: string
): Promise<BrokerOrder> {
  if (forceMemory) {
    loadFileStore();
    const o = memoryOrders.find((x) => x.id === id);
    if (!o) throw new Error('Order not found');
    o.status = status;
    if (notes) o.notes = notes;
    persistFileStore();
    return o;
  }

  const { data, error } = await supabase
    .from('broker_orders')
    .update({ status, notes: notes ?? undefined })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (isMissingTable(error)) {
      forceMemory = true;
      return markOrderStatus(id, status, notes);
    }
    // DB may not allow 'processing' until migration — treat as soft skip
    if (status === 'processing') {
      console.warn('[broker-orders] processing status not stored:', error.message);
      const existing = await getOrder(id);
      if (existing) return { ...existing, status: 'processing' };
    }
    throw error;
  }
  return rowToOrder(data);
}
