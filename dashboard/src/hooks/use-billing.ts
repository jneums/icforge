import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getBillingBalance,
  createCheckout,
  getBillingPortal,
  updateAutoTopup,
  getTransactions,
} from '@/api';
import type { AutoTopupSettings } from '@/api';

export function useBillingBalance() {
  return useQuery({
    queryKey: ['billing', 'balance'],
    queryFn: getBillingBalance,
  });
}

export function useTransactions() {
  return useQuery({
    queryKey: ['billing', 'transactions'],
    queryFn: getTransactions,
  });
}

export function useCheckout() {
  return useMutation({
    mutationFn: (amountDollars: number) => createCheckout(amountDollars),
    onSuccess: (data) => {
      window.location.href = data.checkout_url;
    },
  });
}

export function useBillingPortal() {
  return useMutation({
    mutationFn: () => getBillingPortal(),
    onSuccess: (data) => {
      window.location.href = data.portal_url;
    },
  });
}

export function useAutoTopup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: AutoTopupSettings) => updateAutoTopup(settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing', 'balance'] });
    },
  });
}
