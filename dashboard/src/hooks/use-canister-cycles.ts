import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCanisterCycles,
  updateCyclesSettings,
  manualTopup,
  fetchProjectHealth,
} from '@/api';
import type { CyclesSettingsUpdate } from '@/api';

export function useCanisterCycles(canisterId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ['canister-cycles', canisterId],
    queryFn: () => fetchCanisterCycles(canisterId!),
    enabled: !!canisterId && enabled,
  });
}

export function useProjectHealth(projectId: string | undefined) {
  return useQuery({
    queryKey: ['project-health', projectId],
    queryFn: () => fetchProjectHealth(projectId!),
    enabled: !!projectId,
    // Health data doesn't change fast — poll every 5 minutes
    refetchInterval: 5 * 60 * 1000,
  });
}

export function useCyclesSettings(canisterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: CyclesSettingsUpdate) => updateCyclesSettings(canisterId, settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canister-cycles', canisterId] });
    },
  });
}

export function useManualTopup(canisterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (amount: number) => manualTopup(canisterId, amount),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['canister-cycles', canisterId] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'balance'] });
      queryClient.invalidateQueries({ queryKey: ['billing', 'transactions'] });
    },
  });
}
