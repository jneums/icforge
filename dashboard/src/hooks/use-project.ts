import { useQuery } from '@tanstack/react-query';
import { fetchProject } from '@/api';

const IN_PROGRESS_STATUSES = ['queued', 'building', 'deploying', 'created'];

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id),
    enabled: !!id,
    refetchInterval: (query) => {
      const deployments = query.state.data?.deployments;
      if (
        deployments?.some((d: { status: string }) => IN_PROGRESS_STATUSES.includes(d.status))
      ) {
        return 3000;
      }
      // Slow poll to catch newly-triggered deployments
      return 30_000;
    },
  });
}
