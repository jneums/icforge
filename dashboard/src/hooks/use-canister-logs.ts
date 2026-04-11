import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCanisterLogs,
  fetchLogSettings,
  updateLogSettings,
  type LogPeriod,
  type CanisterLogsResponse,
  type LogSettings,
} from '@/api/canister-logs';

/** Fetch paginated canister logs */
export function useCanisterLogs(
  canisterId: string | null,
  params?: {
    period?: LogPeriod;
    level?: string;
    search?: string;
    limit?: number;
  }
) {
  return useQuery<CanisterLogsResponse>({
    queryKey: ['canister-logs', canisterId, params],
    queryFn: () => fetchCanisterLogs(canisterId!, params),
    enabled: !!canisterId,
  });
}

/** Fetch project log retention settings */
export function useLogSettings(projectId: string | null) {
  return useQuery<LogSettings>({
    queryKey: ['log-settings', projectId],
    queryFn: () => fetchLogSettings(projectId!),
    enabled: !!projectId,
  });
}

/** Update project log retention */
export function useUpdateLogSettings(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (retentionHours: number) =>
      updateLogSettings(projectId, retentionHours),
    onSuccess: (data) => {
      queryClient.setQueryData(['log-settings', projectId], data);
    },
  });
}
