# 09 — Data Layer: API Client + TanStack Query Hooks

**Scope:** Introduce a layered architecture: `api/` → `hooks/` → components
**Priority:** P0 — do alongside or immediately after 00-setup
**Depends on:** Nothing (can be done independently of Tailwind migration)
**Estimated effort:** Medium

---

## 1. Problem

Every page currently does its own manual data fetching:

```tsx
// Current pattern (repeated in every page)
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  fetchSomething()
    .then(setData)
    .catch(e => setError(e.message))
    .finally(() => setLoading(false));
}, []);
```

This causes:
- **Duplicated boilerplate** — every page has the same useState/useEffect/try-catch pattern
- **No caching** — navigating away and back re-fetches everything
- **No background refetch** — data goes stale, no way to refresh without full page reload
- **No request deduplication** — two components fetching the same project make two HTTP calls
- **Race conditions** — no cancellation on unmount, stale closures on fast navigation
- **API logic leaks into components** — `fetchCanisterEnv` called directly inside `CanisterRow`

## 2. Target Architecture

Three layers, strict dependency direction:

```
src/
├── api/              ← Layer 1: Pure HTTP functions (no React)
│   ├── client.ts     ← apiFetch, error handling, token management
│   ├── types.ts      ← All TypeScript interfaces
│   ├── projects.ts   ← fetchProjects, fetchProject
│   ├── deploys.ts    ← fetchDeployLogs, fetchDeployStatus, streamDeployLogs
│   ├── canisters.ts  ← fetchCanisterEnv
│   ├── auth.ts       ← fetchMe, devLogin
│   └── tokens.ts     ← createToken, revokeToken, listTokens
│
├── hooks/            ← Layer 2: TanStack Query wrappers (React hooks)
│   ├── use-projects.ts
│   ├── use-project.ts
│   ├── use-deploy.ts
│   ├── use-canister-env.ts
│   ├── use-auth.ts
│   └── use-tokens.ts
│
├── pages/            ← Layer 3: Components consume hooks only
│   ├── Projects.tsx      ← uses useProjects()
│   ├── ProjectDetail.tsx ← uses useProject(id)
│   ├── DeployDetail.tsx  ← uses useDeploy(id), useDeployLogs(id)
│   └── Settings.tsx      ← uses useAuth(), useTokens()
```

**Rules:**
- Pages/components NEVER import from `api/` directly
- Hooks NEVER do `useState` for server state — TanStack Query manages it
- API functions are pure async functions — no React, no side effects
- Types are shared across all layers via `api/types.ts`

## 3. Install TanStack Query

```bash
cd ~/icforge/dashboard
npm install @tanstack/react-query
npm install -D @tanstack/react-query-devtools   # optional but useful
```

## 4. Layer 1: API Client

### `src/api/client.ts`

Keep the existing `apiFetch` pattern, just move it to its own file and add better error handling:

```ts
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

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { ...options, headers });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ApiError(res.status, body || `Request failed: ${res.status}`);
  }

  return res.json();
}

/** For SSE streaming — returns raw response */
export async function apiFetchRaw(path: string, options: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return fetch(`${API_URL}${path}`, { ...options, headers });
}

export { API_URL };
```

### `src/api/types.ts`

Move all interfaces here (from current `api.ts`):

```ts
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

export interface Canister { ... }
export interface Deployment { ... }
export interface User { ... }
export interface LogEntry { ... }
export interface EnvironmentVariable { ... }
export interface ApiToken { ... }
```

### `src/api/projects.ts`

```ts
import { apiFetch } from './client';
import type { Project, Deployment } from './types';

export async function fetchProjects(): Promise<Project[]> {
  const data = await apiFetch<{ projects: Project[] }>('/api/v1/projects');
  return data.projects ?? [];
}

export async function fetchProject(id: string): Promise<{ project: Project; deployments: Deployment[] }> {
  return apiFetch(`/api/v1/projects/${id}`);
}
```

### `src/api/deploys.ts`

```ts
import { apiFetch, apiFetchRaw, API_URL } from './client';
import type { LogEntry } from './types';

export async function fetchDeployLogs(deployId: string): Promise<LogEntry[]> {
  const data = await apiFetch<{ logs: LogEntry[] }>(`/api/v1/deploy/${deployId}/logs`);
  return data.logs ?? [];
}

export async function fetchDeployStatus(deployId: string) {
  return apiFetch<{
    deployment_id: string;
    status: string;
    url?: string;
    canister_id?: string;
    error?: string;
  }>(`/api/v1/deploy/${deployId}/status`);
}

/**
 * SSE streaming for deploy logs.
 * Returns an EventSource-like interface for consuming log events.
 */
export function streamDeployLogs(deployId: string): EventSource {
  // SSE needs auth in URL or custom EventSource — keep existing approach
  // This is the one case where we can't use apiFetch
  const url = `${API_URL}/api/v1/deploy/${deployId}/logs/stream`;
  return new EventSource(url);  // simplified — real impl needs auth headers
}
```

### `src/api/canisters.ts`

```ts
import { apiFetch } from './client';
import type { EnvironmentVariable } from './types';

export async function fetchCanisterEnv(canisterId: string): Promise<EnvironmentVariable[]> {
  const data = await apiFetch<{ environment_variables: EnvironmentVariable[] }>(
    `/api/v1/canisters/${canisterId}/env`
  );
  return data.environment_variables ?? [];
}
```

### `src/api/auth.ts`

```ts
import { apiFetch, setToken } from './client';
import type { User } from './types';

export async function fetchMe(): Promise<User> {
  const data = await apiFetch<{ user: User }>('/api/v1/auth/me');
  return data.user;
}

export async function devLogin(): Promise<string> {
  const data = await apiFetch<{ token: string }>('/api/v1/auth/dev-token', { method: 'POST' });
  setToken(data.token);
  return data.token;
}
```

### `src/api/index.ts` (barrel export)

```ts
export * from './client';
export * from './types';
export * from './projects';
export * from './deploys';
export * from './canisters';
export * from './auth';
export * from './tokens';
```

## 5. Layer 2: TanStack Query Hooks

### Setup: `QueryClientProvider` in `main.tsx`

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,         // Data stays fresh for 30s
      retry: 1,                   // Retry failed requests once
      refetchOnWindowFocus: false, // Don't spam on tab switch
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthProvider>
  </QueryClientProvider>
);
```

### `src/hooks/use-projects.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchProjects } from '../api';

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });
}
```

Usage in component:
```tsx
function Projects() {
  const { data: projects, isLoading, error } = useProjects();
  // That's it. No useState, no useEffect, no manual error handling.
}
```

### `src/hooks/use-project.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchProject } from '../api';

export function useProject(id: string) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id),
    enabled: !!id,
  });
}
```

### `src/hooks/use-canister-env.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchCanisterEnv } from '../api';

export function useCanisterEnv(canisterId: string | null, enabled = false) {
  return useQuery({
    queryKey: ['canister-env', canisterId],
    queryFn: () => fetchCanisterEnv(canisterId!),
    enabled: enabled && !!canisterId,  // only fetch when user expands the section
  });
}
```

This replaces the manual fetch-on-expand pattern in `CanisterRow`:

```tsx
// Before (manual):
const [envVars, setEnvVars] = useState(null);
const [envLoading, setEnvLoading] = useState(false);
const toggleEnv = () => {
  if (!expanded && envVars === null) {
    setEnvLoading(true);
    fetchCanisterEnv(id).then(setEnvVars)...
  }
};

// After (TanStack Query):
const [expanded, setExpanded] = useState(false);
const { data: envVars, isLoading: envLoading } = useCanisterEnv(canisterId, expanded);
```

### `src/hooks/use-deploy.ts`

```ts
import { useQuery } from '@tanstack/react-query';
import { fetchDeployStatus, fetchDeployLogs } from '../api';

const IN_PROGRESS_STATUSES = ['pending', 'building', 'deploying', 'created'];

export function useDeployStatus(deployId: string) {
  return useQuery({
    queryKey: ['deploy-status', deployId],
    queryFn: () => fetchDeployStatus(deployId),
    enabled: !!deployId,
    refetchInterval: (query) => {
      // Poll while in-progress, stop when terminal
      const status = query.state.data?.status;
      if (status && IN_PROGRESS_STATUSES.includes(status)) return 3000;
      return false;
    },
  });
}

export function useDeployLogs(deployId: string) {
  return useQuery({
    queryKey: ['deploy-logs', deployId],
    queryFn: () => fetchDeployLogs(deployId),
    enabled: !!deployId,
  });
}
```

### `src/hooks/use-auth.ts`

Keep the existing `AuthContext` for login/logout actions, but the `fetchMe` query could optionally move to TanStack Query. For now, leave `AuthContext` as-is — it's simple enough and handles the login/logout side effects (localStorage). Just re-export from hooks:

```ts
export { useAuth } from '../contexts/AuthContext';
```

## 6. Migration Path

This can be done incrementally — one page at a time:

1. Create `src/api/` directory, move and split `api.ts` into modules
2. Create barrel `src/api/index.ts`
3. Update all existing imports from `'../api'` → `'../api'` (barrel keeps this working)
4. Install TanStack Query, add `QueryClientProvider` to `main.tsx`
5. Create hooks one at a time, migrate pages one at a time:
   - `useProjects()` → migrate `Projects.tsx`
   - `useProject(id)` → migrate `ProjectDetail.tsx`
   - `useCanisterEnv()` → migrate `CanisterRow` in ProjectDetail
   - `useDeployStatus()` + `useDeployLogs()` → migrate `DeployDetail.tsx`

**Important:** The old `src/api.ts` can remain as a barrel re-export during migration so nothing breaks:

```ts
// src/api.ts (temporary, remove after all pages migrated)
export * from './api/index';
```

## 7. SSE Streaming (Special Case)

The DeployDetail page uses Server-Sent Events for real-time log streaming. This doesn't fit neatly into TanStack Query's request/response model.

**Approach:** Keep SSE logic in a custom hook (`useDeployStream`) that:
- Lives in `src/hooks/use-deploy-stream.ts`
- Uses the `api/deploys.ts` streaming helpers
- Manages its own state with `useState` (TanStack Query not appropriate for streaming)
- Invalidates the `['deploy-status']` query when stream completes

```ts
export function useDeployStream(deployId: string) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const queryClient = useQueryClient();

  useEffect(() => {
    // SSE setup — similar to current DeployDetail logic
    // On stream end: queryClient.invalidateQueries(['deploy-status', deployId])
  }, [deployId]);

  return { logs, isStreaming };
}
```

## 8. What This Replaces in Other Specs

The `useApi` hook proposed in `08-technical-debt.md` is **no longer needed** — TanStack Query provides everything that hook was trying to do (loading, error, retry) plus caching, deduplication, background refetch, and polling.

Remove the `useApi` section from 08-technical-debt.

## 9. Checklist

- [ ] Install `@tanstack/react-query` (and optionally devtools)
- [ ] Create `src/api/` directory structure (client, types, projects, deploys, canisters, auth, tokens, index)
- [ ] Move all interfaces from `api.ts` → `api/types.ts`
- [ ] Move `apiFetch` + token utils → `api/client.ts`
- [ ] Split API functions into domain modules (projects, deploys, canisters, auth)
- [ ] Create barrel export `api/index.ts`
- [ ] Temporarily keep `src/api.ts` as re-export for backwards compat
- [ ] Add `QueryClientProvider` to `main.tsx` with sensible defaults
- [ ] Create `src/hooks/use-projects.ts`
- [ ] Create `src/hooks/use-project.ts`
- [ ] Create `src/hooks/use-canister-env.ts`
- [ ] Create `src/hooks/use-deploy.ts` (status + logs)
- [ ] Create `src/hooks/use-deploy-stream.ts` (SSE)
- [ ] Migrate `Projects.tsx` to use `useProjects()`
- [ ] Migrate `ProjectDetail.tsx` to use `useProject()` + `useCanisterEnv()`
- [ ] Migrate `DeployDetail.tsx` to use `useDeployStatus()` + `useDeployStream()`
- [ ] Delete old `src/api.ts` once all pages migrated
- [ ] Remove `useApi` hook from 08-technical-debt spec (superseded)
- [ ] Verify no component imports directly from `src/api/`
