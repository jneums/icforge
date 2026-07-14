import { apiFetch } from './client';
import type {
  BillingBalance,
  AutoTopupSettings,
  TransactionsPage,
  CostsByCanister,
} from './types';

export async function getBillingBalance(): Promise<BillingBalance> {
  return apiFetch<BillingBalance>('/api/v1/billing/balance');
}

export async function createCheckout(amountDollars: number): Promise<{ checkout_url: string }> {
  return apiFetch('/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ amount: amountDollars }),
  });
}

export async function getBillingPortal(): Promise<{ portal_url: string }> {
  return apiFetch('/api/v1/billing/portal');
}


export async function updateAutoTopup(settings: AutoTopupSettings): Promise<{ ok: boolean }> {
  return apiFetch('/api/v1/billing/auto-topup', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export interface TransactionFilters {
  type?: 'credit' | 'debit';
  category?: string;
}

export async function getTransactions(
  filters: TransactionFilters = {},
  cursor?: { before: string; before_id: string },
  limit = 25
): Promise<TransactionsPage> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (filters.type) query.set('type', filters.type);
  if (filters.category) query.set('category', filters.category);
  if (cursor) {
    query.set('before', cursor.before);
    query.set('before_id', cursor.before_id);
  }
  return apiFetch<TransactionsPage>(`/api/v1/billing/transactions?${query}`);
}

export async function getCostsByCanister(range: {
  from?: string;
  to?: string;
}): Promise<CostsByCanister> {
  const query = new URLSearchParams();
  if (range.from) query.set('from', range.from);
  if (range.to) query.set('to', range.to);
  const qs = query.toString();
  return apiFetch<CostsByCanister>(
    `/api/v1/billing/costs-by-canister${qs ? `?${qs}` : ''}`
  );
}
