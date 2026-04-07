import { apiFetch } from './client';
import type { GitHubInstallation, GitHubRepo, RepoConfig } from './types';

export async function fetchInstallations(): Promise<GitHubInstallation[]> {
  const data = await apiFetch<{ installations: GitHubInstallation[] }>('/api/v1/github/installations');
  return data.installations ?? [];
}

export async function fetchGitHubRepos(): Promise<GitHubRepo[]> {
  const data = await apiFetch<{ repos: GitHubRepo[] }>('/api/v1/github/repos');
  return data.repos ?? [];
}

export async function fetchRepoConfig(repoId: string): Promise<RepoConfig> {
  return apiFetch<RepoConfig>(`/api/v1/github/repos/${repoId}/config`);
}

export async function linkRepo(params: {
  project_id: string;
  github_repo_id: string;
  production_branch?: string;
}): Promise<{ linked: boolean }> {
  return apiFetch('/api/v1/github/link', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
