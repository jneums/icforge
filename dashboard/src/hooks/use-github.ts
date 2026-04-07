import { useQuery } from '@tanstack/react-query';
import { fetchInstallations, fetchGitHubRepos, fetchRepoConfig } from '@/api';

export function useInstallations() {
  return useQuery({
    queryKey: ['github', 'installations'],
    queryFn: fetchInstallations,
  });
}

export function useGitHubRepos() {
  return useQuery({
    queryKey: ['github', 'repos'],
    queryFn: fetchGitHubRepos,
  });
}

export function useRepoConfig(repoId: string | null) {
  return useQuery({
    queryKey: ['github', 'repos', repoId, 'config'],
    queryFn: () => fetchRepoConfig(repoId!),
    enabled: !!repoId,
  });
}
