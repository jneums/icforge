import { apiFetch, apiFetchRaw } from './client';
import type { LogEntry } from './types';

/* ── Canister Log Types ─────────────────────────────────────── */

export interface CanisterLogEntry extends LogEntry {
  id?: string;
  log_index?: number;
  ic_timestamp?: number;
  collected_at?: string;
}

export interface CanisterLogsResponse {
  canister_id: string;
  logs: CanisterLogEntry[];
  next_before: number | null;
  count: number;
}

export interface LogSettings {
  project_id: string;
  log_retention_hours: number;
  allowed_values: number[];
  log_count: number;
}

/* ── API Functions ──────────────────────────────────────────── */

export type LogPeriod = '1h' | '6h' | '24h' | '7d' | '30d';

export async function fetchCanisterLogs(
  canisterId: string,
  params?: {
    period?: LogPeriod;
    level?: string;
    search?: string;
    limit?: number;
    before?: number;
  }
): Promise<CanisterLogsResponse> {
  const query = new URLSearchParams();
  if (params?.period) query.set('period', params.period);
  if (params?.level) query.set('level', params.level);
  if (params?.search) query.set('search', params.search);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.before) query.set('before', String(params.before));

  const qs = query.toString();
  const path = `/api/v1/canisters/${canisterId}/logs${qs ? `?${qs}` : ''}`;
  return apiFetch<CanisterLogsResponse>(path);
}

export async function fetchLogSettings(projectId: string): Promise<LogSettings> {
  return apiFetch<LogSettings>(`/api/v1/projects/${projectId}/settings/logs`);
}

export async function updateLogSettings(
  projectId: string,
  retentionHours: number
): Promise<LogSettings> {
  return apiFetch<LogSettings>(`/api/v1/projects/${projectId}/settings/logs`, {
    method: 'PUT',
    body: JSON.stringify({ log_retention_hours: retentionHours }),
  });
}

/** SSE stream for canister logs — returns raw response for streaming */
export async function streamCanisterLogs(
  canisterId: string,
  signal?: AbortSignal
): Promise<Response> {
  return apiFetchRaw(`/api/v1/canisters/${canisterId}/logs/stream`, { signal });
}
