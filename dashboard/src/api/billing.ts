import { apiFetch } from './client';
import type { BillingBalance, ComputeTransaction, AutoTopupSettings } from './types';

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

export async function getTransactions(): Promise<ComputeTransaction[]> {
  const data = await apiFetch<{ transactions: ComputeTransaction[] }>('/api/v1/billing/transactions');
  return data.transactions ?? [];
}
