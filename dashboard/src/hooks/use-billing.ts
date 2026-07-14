import {
  useQuery,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getBillingBalance,
  createCheckout,
  getBillingPortal,
  updateAutoTopup,
  getTransactions,
  getCostsByCanister,
} from '@/api';
import type { AutoTopupSettings, TransactionFilters } from '@/api';
import type { TransactionsPage } from '@/api/types';

export function useBillingBalance() {
  return useQuery({
    queryKey: ['billing', 'balance'],
    queryFn: getBillingBalance,
  });
}

export function useTransactions(filters: TransactionFilters = {}) {
  return useInfiniteQuery({
    queryKey: ['billing', 'transactions', filters],
    queryFn: ({ pageParam }) => getTransactions(filters, pageParam),
    initialPageParam: undefined as { before: string; before_id: string } | undefined,
    getNextPageParam: (last: TransactionsPage) =>
      last.next_before && last.next_before_id
        ? { before: last.next_before, before_id: last.next_before_id }
        : undefined,
  });
}

export function useCostsByCanister(range: { from?: string; to?: string }) {
  return useQuery({
    queryKey: ['billing', 'costs-by-canister', range],
    queryFn: () => getCostsByCanister(range),
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
