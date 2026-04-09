import { useQuery } from '@tanstack/react-query';
import { fetchCanisterCompute, fetchProjectHealth } from '@/api';
import type { ComputePeriod } from '@/api';

export function useCanisterCompute(canisterId: string | null | undefined, period: ComputePeriod = '24h', enabled = true) {
  return useQuery({
    queryKey: ['canister-compute', canisterId, period],
    queryFn: () => fetchCanisterCompute(canisterId!, period),
    enabled: !!canisterId && enabled,
    // Poll every 60s to match backend poller interval
    refetchInterval: 60_000,
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
