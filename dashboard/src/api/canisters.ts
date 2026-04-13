import { apiFetch } from './client';
import type { EnvironmentVariable, CanisterComputeInfo, ProjectHealth } from './types';

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const data = await apiFetch<{ environment_variables: EnvironmentVariable[] }>(
    `/api/v1/canisters/${canisterId}/env`
  );
  return data.environment_variables ?? [];
}

export async function setCanisterEnv(
  canisterId: string,
  envVars: EnvironmentVariable[]
): Promise<void> {
  await apiFetch(`/api/v1/canisters/${canisterId}/env`, {
    method: 'PUT',
    body: JSON.stringify({ environment_variables: envVars }),
  });
}

export type ComputePeriod = '1h' | '6h' | '24h' | '7d' | '30d';

export async function fetchCanisterCompute(canisterId: string, period: ComputePeriod = '24h'): Promise<CanisterComputeInfo> {
  return apiFetch<CanisterComputeInfo>(`/api/v1/canisters/${canisterId}/cycles?period=${period}`);
}

export async function fetchProjectHealth(projectId: string): Promise<ProjectHealth> {
  return apiFetch<ProjectHealth>(`/api/v1/projects/${projectId}/health`);
}

export async function fetchCanisterControllers(canisterId: string): Promise<{ controllers: string[]; platform_principal: string }> {
  return apiFetch<{ controllers: string[]; platform_principal: string }>(
    `/api/v1/canisters/${canisterId}/controllers`
  );
}

export async function setCanisterControllers(
  canisterId: string,
  controllers: string[]
): Promise<void> {
  await apiFetch(`/api/v1/canisters/${canisterId}/controllers`, {
    method: 'PUT',
    body: JSON.stringify({ controllers }),
  });
}
