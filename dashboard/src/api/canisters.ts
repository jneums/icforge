import { apiFetch } from './client';
import type { EnvironmentVariable, CanisterComputeInfo, ProjectHealth } from './types';

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const data = await apiFetch<{ environment_variables: EnvironmentVariable[] }>(
    `/api/v1/canisters/${canisterId}/env`
  );
  return data.environment_variables ?? [];
}

export type ComputePeriod = '1h' | '6h' | '24h' | '7d' | '30d';

export async function fetchCanisterCompute(canisterId: string, period: ComputePeriod = '24h'): Promise<CanisterComputeInfo> {
  return apiFetch<CanisterComputeInfo>(`/api/v1/canisters/${canisterId}/cycles?period=${period}`);
}

export async function fetchProjectHealth(projectId: string): Promise<ProjectHealth> {
  return apiFetch<ProjectHealth>(`/api/v1/projects/${projectId}/health`);
}
