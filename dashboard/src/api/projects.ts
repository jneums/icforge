import { apiFetch } from './client';
import type { Project, Deployment } from './types';

export async function fetchProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/api/v1/projects');
  return data.projects ?? [];
}

export async function fetchProject(id: string): Promise<{ project: Project; deployments: Deployment[] }> {
  return apiFetch(`/api/v1/projects/${id}`);
}
