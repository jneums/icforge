# 04 — CLI Changes

## Overview

The CLI currently hits `/api/v1/builds` to trigger and stream.
Switch to `/api/v1/deployments`. Keep `/api/v1/builds` as backend
aliases so old CLI versions don't break immediately.

## File-by-file changes

### 4.1 cli/src/commands/deploy.ts

**Trigger endpoint:**
```typescript
// BEFORE:
const response = await apiFetch("/api/v1/builds", { method: "POST", body: ... });
const data = await response.json() as { build_id: string };
const result = await streamBuildLogs(data.build_id);

// AFTER:
const response = await apiFetch("/api/v1/deployments", { method: "POST", body: ... });
const data = await response.json() as { deployment_id: string };
const result = await streamDeployLogs(data.deployment_id);
```

**Rename:** `streamBuildLogs()` → `streamDeployLogs()`

**Stream endpoint:**
```typescript
// BEFORE:
const url = `${apiUrl}/api/v1/builds/${buildId}/logs/stream`;

// AFTER:
const url = `${apiUrl}/api/v1/deploy/${deploymentId}/logs/stream`;
```

Note: Use the existing `/api/v1/deploy/:id/logs/stream` SSE endpoint
that already exists and works. No need for a separate builds stream.

**Status fallback:**
```typescript
// BEFORE:
const statusResp = await apiFetch(`/api/v1/builds/${buildId}`);
const statusData = await statusResp.json();
return { status: statusData.build.status, error: statusData.build.error_message };

// AFTER:
const statusResp = await apiFetch(`/api/v1/deploy/${deploymentId}/status`);
const statusData = await statusResp.json();
return { status: statusData.status, error: statusData.error };
```

**User-facing messages:**
```
BEFORE: "Build triggered: abc12345"
AFTER:  "Deployment triggered: abc12345"

BEFORE: "Build succeeded"  /  "Build failed"
AFTER:  "Deployment live"  /  "Deployment failed"
```

### 4.2 cli/src/commands/status.ts

Already uses deployments from `/api/v1/projects/:id`. No change needed
other than removing any `builds` references from the response destructuring.

### 4.3 cli/src/commands/logs.ts

Already uses `/api/v1/deploy/:id/logs/stream`. No change needed.


