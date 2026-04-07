import { apiFetch } from './client';
import type { Project, Deployment, Build } from './types';

export async function fetchProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/api/v1/projects');
  return data.projects ?? [];
}

export async function fetchProject(id: string): Promise<{ project: Project; deployments: Deployment[]; builds: Build[] }> {
  return apiFetch(`/api/v1/projects/${id}`);
}

export async function createProject(params: {
  name: string;
  canisters: { name: string; recipe?: string }[];
  subnet?: string;
}): Promise<{ project: Project }> {
  return apiFetch('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
