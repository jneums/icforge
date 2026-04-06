import { useQuery } from '@tanstack/react-query';
import { fetchDeployStatus, fetchDeployLogs } from '@/api';

const IN_PROGRESS_STATUSES = ['pending', 'building', 'deploying', 'created'];

export function useDeployStatus(deployId: string) {
  return useQuery({
    queryKey: ['deploy-status', deployId],
    queryFn: () => fetchDeployStatus(deployId),
    enabled: !!deployId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (status && IN_PROGRESS_STATUSES.includes(status)) return 3000;
      return false;
    },
  });
}

export function useDeployLogs(deployId: string) {
  return useQuery({
    queryKey: ['deploy-logs', deployId],
    queryFn: () => fetchDeployLogs(deployId),
    enabled: !!deployId,
  });
}
