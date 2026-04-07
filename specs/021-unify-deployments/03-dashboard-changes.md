# 03 — Dashboard Changes

## Overview

Kill `BuildDetail.tsx`. Keep `DeployDetail.tsx` as the single detail page.
Remove the Builds tab. Remove the `Build` type. All entries are deployments.

## File-by-file changes

### 3.1 api/types.ts

**Remove:** `Build` interface entirely.

**Update `Deployment`** — add fields that were on Build:

```typescript
export interface Deployment {
  id: string;
  project_id: string;
  canister_name: string;
  status: string;
  commit_sha: string | null;
  commit_message: string | null;
  branch: string | null;
  repo_full_name: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  // NEW fields (from Build):
  trigger: string | null;       // push, pull_request, cli, dashboard
  pr_number: number | null;
  created_at: string;
  build_duration_ms: number | null;
}
```

**Remove** from `Project` (ProjectWithCanisters):
- `latest_deployment` stays as-is (already Deployment type)

### 3.2 api/deploys.ts

**Remove:** `fetchBuild()`

**Add:** `fetchDeployment()` (replaces fetchBuild):

```typescript
export async function fetchDeployment(
  deployId: string
): Promise<{ deployment: Deployment; logs: LogEntry[] }> {
  return apiFetch(`/api/v1/deployments/${deployId}`);
}
```

**Keep:** `fetchDeployLogs`, `fetchDeployStatus`, `streamDeployLogs` — unchanged.

### 3.3 api/projects.ts

```typescript
// BEFORE:
fetchProject(id): Promise<{ project: Project; deployments: Deployment[]; builds: Build[] }>

// AFTER:
fetchProject(id): Promise<{ project: Project; deployments: Deployment[] }>
```

### 3.4 hooks/use-project.ts

Remove `builds` from the in-progress check:

```typescript
// BEFORE:
const builds = query.state.data?.builds;
const deployments = query.state.data?.deployments;
const isActive =
  deployments?.some(...) || builds?.some(...);

// AFTER:
const deployments = query.state.data?.deployments;
const isActive = deployments?.some(
  (d: { status: string }) => IN_PROGRESS_STATUSES.includes(d.status)
);
```

### 3.5 pages/ProjectDetail.tsx

**Remove:** `BuildRow` component, Builds tab, `builds` destructuring.

**Update `DeployRow`** — add trigger badge (was on BuildRow):

```typescript
function DeployRow({ deploy, projectId }: { deploy: Deployment; projectId: string }) {
  return (
    <div onClick={() => navigate(`/projects/${projectId}/deploys/${deploy.id}`)}>
      <StatusDot status={deploy.status} />
      <Badge>{deploy.canister_name}</Badge>
      <span>{deploy.commit_message || "No commit message"}</span>
      <span>{deploy.commit_sha?.slice(0, 7)}</span>
      <span>{formatRelativeTime(deploy.created_at)}</span>
    </div>
  );
}
```

**Tabs:** Remove Builds tab. Two tabs remain: **Deployments** (default), **Canisters**.

```typescript
// BEFORE: 3 tabs — Builds, Deployments, Canisters
// AFTER:  2 tabs — Deployments, Canisters

const { project, deployments = [] } = data;
// Remove: builds = []

<Tabs defaultValue="deploys">
  <TabsTrigger value="deploys">
    Deployments ({deployments.length})
  </TabsTrigger>
  <TabsTrigger value="canisters">
    Canisters ({canisters.length})
  </TabsTrigger>
</Tabs>
```

**latestStatus:** Use `deployments[0]?.status` only (no latestBuild fallback).

### 3.6 pages/DeployDetail.tsx

**Minor update** — add trigger/created_at to the summary card:

```
Show:
  - canister_name
  - trigger badge (push / cli / dashboard / pull_request)
  - commit info (sha + message, linked to GitHub)
  - branch (linked to GitHub)
  - created_at (relative time)
  - error_message (if failed)
  - canister_id + Visit button (if live)
```

The page already has SSE streaming for in-progress deploys.
No structural change needed — it works as-is.

The only difference: deployments that were previously only visible via
BuildDetail (queued/building/failed) will now show up in DeployDetail
since they exist in the deployments table from the start.

### 3.7 pages/BuildDetail.tsx

**Delete this file entirely.**

### 3.8 App.tsx

```typescript
// REMOVE:
import BuildDetail from "./pages/BuildDetail";
<Route path="/projects/:id/builds/:buildId" element={...} />

// ADD redirect for bookmarks/links:
<Route
  path="/projects/:id/builds/:buildId"
  element={<Navigate to={`/projects/${id}/deploys/${buildId}`} replace />}
/>
```

### 3.9 components/app-breadcrumbs.tsx

Remove the `/projects/:id/builds/:buildId` parsing branch.
The `/projects/:id/deploys/:deployId` branch already handles it.

### 3.10 components/status-badge.tsx / status-dot.tsx

**Add:** `deploying` status (new stage between building and live).

```typescript
// status-badge.tsx
deploying: { label: "Deploying", className: "bg-info/15 text-info border-info/20" },

// status-dot.tsx
deploying: "bg-info animate-pulse",
```
