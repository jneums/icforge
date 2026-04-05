// API client for ICForge dashboard

const API_URL = import.meta.env.VITE_API_URL ?? '';

function getToken(): string | null {
  return localStorage.getItem('icforge_token');
}

export function setToken(token: string) {
  localStorage.setItem('icforge_token', token);
}

export function clearToken() {
  localStorage.removeItem('icforge_token');
}

export function isAuthenticated(): boolean {
  return !!getToken();
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

// ---------- Types ----------

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  custom_domain: string | null;
  subnet_id: string | null;
  created_at: string;
  updated_at: string;
  canisters: Canister[];
}

export interface Canister {
  id: string;
  project_id: string;
  name: string;
  type: string;
  canister_id: string | null;
  subnet_id: string | null;
  status: string;
  cycles_balance: number | null;
  created_at: string;
  updated_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  canister_name: string;
  status: string;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface User {
  id: string;
  github_id: number;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

// ---------- API calls ----------

export async function fetchProjects(): Promise<Project[]> {
  const res = await apiFetch('/api/v1/projects');
  if (!res.ok) throw new Error(`Failed to fetch projects: ${res.status}`);
  const data = await res.json();
  return data.projects ?? [];
}

export async function fetchProject(id: string): Promise<{ project: Project; deployments: Deployment[] }> {
  const res = await apiFetch(`/api/v1/projects/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch project: ${res.status}`);
  return res.json();
}

export async function fetchMe(): Promise<User> {
  const res = await apiFetch('/api/v1/auth/me');
  if (!res.ok) throw new Error(`Failed to fetch user: ${res.status}`);
  const data = await res.json();
  return data.user;
}

export async function devLogin(): Promise<string> {
  const res = await apiFetch('/api/v1/auth/dev-token', { method: 'POST' });
  if (!res.ok) throw new Error(`Dev login failed: ${res.status}`);
  const data = await res.json();
  setToken(data.token);
  return data.token;
}

export async function fetchDeployLogs(deployId: string): Promise<LogEntry[]> {
  const res = await apiFetch(`/api/v1/deploy/${deployId}/logs`);
  if (!res.ok) throw new Error(`Failed to fetch deploy logs: ${res.status}`);
  const data = await res.json();
  return data.logs ?? [];
}

export async function fetchDeployStatus(deployId: string): Promise<{
  deployment_id: string;
  status: string;
  url?: string;
  canister_id?: string;
  error?: string;
}> {
  const res = await apiFetch(`/api/v1/deploy/${deployId}/status`);
  if (!res.ok) throw new Error(`Failed to fetch deploy status: ${res.status}`);
  return res.json();
}

/** Build headers with auth for SSE streaming (used by DeployDetail) */
export function getAuthHeaders(): Record<string, string> {
  const token = getToken();
  if (token) return { Authorization: `Bearer ${token}` };
  return {};
}

export { API_URL };

export interface EnvironmentVariable {
  name: string;
  value: string;
}

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const res = await apiFetch(`/api/v1/canisters/${canisterId}/env`);
  if (!res.ok) throw new Error(`Failed to fetch canister env: ${res.status}`);
  const data = await res.json();
  return data.environment_variables ?? [];
}
