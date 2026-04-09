import { apiFetch } from './client';
import type { EnvironmentVariable, CanisterCyclesInfo, CyclesSettingsUpdate, ProjectHealth } from './types';

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const data = await apiFetch<{ environment_variables: EnvironmentVariable[] }>(
    `/api/v1/canisters/${canisterId}/env`
  );
  return data.environment_variables ?? [];
}

export type CyclesPeriod = '1h' | '6h' | '24h' | '7d' | '30d';

export async function fetchCanisterCycles(canisterId: string, period: CyclesPeriod = '24h'): Promise<CanisterCyclesInfo> {
  return apiFetch<CanisterCyclesInfo>(`/api/v1/canisters/${canisterId}/cycles?period=${period}`);
}

export async function updateCyclesSettings(
  canisterId: string,
  settings: CyclesSettingsUpdate
): Promise<{ ok: boolean }> {
  return apiFetch(`/api/v1/canisters/${canisterId}/cycles/settings`, {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
}

export async function manualTopup(
  canisterId: string,
  amount: number
): Promise<{ ok: boolean; cycles_deposited: number; cost_cents: number; topup_id: string }> {
  return apiFetch(`/api/v1/canisters/${canisterId}/cycles/topup`, {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
}

export async function fetchProjectHealth(projectId: string): Promise<ProjectHealth> {
  return apiFetch<ProjectHealth>(`/api/v1/projects/${projectId}/health`);
}
