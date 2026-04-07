import { apiFetch, API_URL } from './client';
import type { LogEntry, Deployment } from './types';

export async function fetchDeployLogs(deployId: string): Promise<LogEntry[]> {
  const data = await apiFetch<{ logs: LogEntry[] }>(`/api/v1/deploy/${deployId}/logs`);
  return data.logs ?? [];
}

export async function fetchDeployStatus(deployId: string): Promise<{
  deployment_id: string;
  status: string;
  url?: string;
  canister_id?: string;
  error?: string;
  commit_sha?: string;
  commit_message?: string;
  branch?: string;
  repo_full_name?: string;
  started_at?: string;
  build_duration_ms?: number;
}> {
  return apiFetch(`/api/v1/deploy/${deployId}/status`);
}

export async function fetchDeployment(deployId: string): Promise<{ deployment: Deployment; logs: LogEntry[] }> {
  return apiFetch(`/api/v1/deployments/${deployId}`);
}

/**
 * SSE streaming for deploy logs.
 * Returns an EventSource for consuming log events.
 */
export function streamDeployLogs(deployId: string): EventSource {
  const url = `${API_URL}/api/v1/deploy/${deployId}/logs/stream`;
  return new EventSource(url);
}
