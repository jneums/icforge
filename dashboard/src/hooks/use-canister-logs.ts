import { useInfiniteQuery, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchCanisterLogs,
  fetchLogSettings,
  updateLogSettings,
  type LogPeriod,
  type CanisterLogsResponse,
  type CanisterLogEntry,
  type LogSettings,
} from '@/api/canister-logs';

/** Infinite-scroll canister logs — pages backward through time via next_before cursor */
export function useCanisterLogs(
  canisterId: string | null,
  params?: {
    period?: LogPeriod;
    level?: string;
    search?: string;
    limit?: number;
  }
) {
  return useInfiniteQuery<CanisterLogsResponse, Error>({
    queryKey: ['canister-logs', canisterId, params],
    queryFn: ({ pageParam }) =>
      fetchCanisterLogs(canisterId!, {
        ...params,
        before: pageParam as number | undefined,
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (lastPage) => lastPage.next_before ?? undefined,
    enabled: !!canisterId,
  });
}

/** Flatten all pages into a single chronological (oldest-first) array */
export function flattenLogPages(
  pages: CanisterLogsResponse[] | undefined
): CanisterLogEntry[] {
  if (!pages) return [];
  // Each page is DESC (newest first). Pages themselves go newest→oldest.
  // Reverse each page, then reverse the page order to get chronological.
  const allLogs: CanisterLogEntry[] = [];
  for (let i = pages.length - 1; i >= 0; i--) {
    const page = pages[i];
    for (let j = page.logs.length - 1; j >= 0; j--) {
      allLogs.push(page.logs[j]);
    }
  }
  return allLogs;
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
