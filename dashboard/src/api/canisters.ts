import { apiFetch } from './client';
import type { EnvironmentVariable } from './types';

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const data = await apiFetch<{ environment_variables: EnvironmentVariable[] }>(
    `/api/v1/canisters/${canisterId}/env`
  );
  return data.environment_variables ?? [];
}
