# 02 — Backend Changes

## Overview

7 Rust files change. The core idea: **deployments IS the job queue now**.
The worker claims from deployments, writes to deploy_logs, updates deployments.

## File-by-file changes

### 2.1 models.rs

**Remove:** `BuildJob`, `BuildLog`, `TriggerBuildRequest`  
**Rename:** `DeploymentRecord` stays as-is but gains new fields  
**Add:** `TriggerDeployRequest` (replaces TriggerBuildRequest)

```rust
// REMOVE these structs entirely:
// - BuildJob
// - BuildLog

// UPDATE DeploymentRecord — add fields from BuildJob:
pub struct DeploymentRecord {
    pub id: String,
    pub project_id: String,
    pub canister_name: String,
    pub status: String,
    pub commit_sha: Option<String>,
    pub commit_message: Option<String>,
    pub branch: Option<String>,
    pub repo_full_name: Option<String>,
    pub error_message: Option<String>,
    pub started_at: Option<String>,    // was NOT NULL, make optional
    pub completed_at: Option<String>,
    // NEW fields (from BuildJob):
    pub installation_id: Option<i64>,
    pub trigger: Option<String>,
    pub pr_number: Option<i32>,
    pub claimed_at: Option<String>,
    pub retry_count: i32,
    pub build_duration_ms: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}
// DROP: build_job_id (no longer needed)

// RENAME TriggerBuildRequest → TriggerDeployRequest
pub struct TriggerDeployRequest {
    pub project_id: String,
    pub commit_sha: String,
    pub branch: String,
    pub commit_message: Option<String>,
    pub canister_name: Option<String>,
    pub trigger: Option<String>,
}
```

### 2.2 build_worker.rs → deploy_worker.rs

**Rename file** to `deploy_worker.rs`.

Key changes to the worker loop:

```
BEFORE (claim from build_jobs):
  UPDATE build_jobs SET status='building'
  WHERE id = (SELECT id FROM build_jobs WHERE status='pending' ...)

AFTER (claim from deployments):
  UPDATE deployments SET status='building', claimed_at=NOW()
  WHERE id = (SELECT id FROM deployments WHERE status='queued' ...)
```

Note: This also fixes the pending/queued mismatch bug — everything
inserts as `queued`, worker claims `queued`.

Status transitions in the worker:

```
claimed:    status='building'
deploying:  status='deploying'  (new — set when icp deploy starts)
success:    status='live'       (was: create separate deployment record)
failure:    status='failed'
```

**Remove from execute_build:**
- The `INSERT INTO deployments` block at the end (lines ~489-501)
- The deployment record is no longer a separate thing — the row already exists

**Change log writes:**
```
BEFORE: INSERT INTO build_logs (build_job_id, level, message, phase)
AFTER:  INSERT INTO deploy_logs (deployment_id, level, message)
```

Drop the `phase` column concept — it was never used in the UI.

**SSE broadcast channel:**
The worker already has access to `AppState.log_channels`. Currently unused
by the build worker (only deploy.rs reads from channels). Wire it up:

```rust
// After each log line is written to DB, also broadcast:
if let Some(tx) = state.log_channels.get(&deployment.id) {
    let _ = tx.send(LogEvent { level, message, timestamp });
}
```

This enables real-time SSE streaming for deployments triggered by
webhooks/CLI/dashboard — not just the legacy CLI deploy path.

### 2.3 webhooks.rs

All `INSERT INTO build_jobs` → `INSERT INTO deployments`.

**handle_push (4 SQL statements):**
```
BEFORE: UPDATE build_jobs SET status='cancelled' WHERE ... AND status='pending'
AFTER:  UPDATE deployments SET status='cancelled' WHERE ... AND status='queued'

BEFORE: INSERT INTO build_jobs (id, ..., status) VALUES (..., 'pending')
AFTER:  INSERT INTO deployments (id, ..., status, trigger) VALUES (..., 'queued', 'push')
```

Same for per-canister fan-out INSERT.

**handle_pull_request (4 SQL statements):**
Same pattern. Change table name, status values, column names.

### 2.4 routes.rs

**Rename handlers:**
- `trigger_build` → `trigger_deploy`
- `list_builds` → `list_deployments` (or keep both with redirect)
- `get_build` → `get_deployment`

**trigger_deploy:**
```
BEFORE: INSERT INTO build_jobs (..., status) VALUES (..., 'queued')
AFTER:  INSERT INTO deployments (..., status) VALUES (..., 'queued')
```

**get_project:**
```
BEFORE: Returns { project, deployments[], builds[] }
AFTER:  Returns { project, deployments[] }
```

Remove the `builds` query entirely — deployments IS the list now.

**get_deployment (was get_build):**
```
BEFORE: SELECT * FROM build_jobs ... + SELECT * FROM build_logs ...
AFTER:  SELECT * FROM deployments ... + SELECT * FROM deploy_logs ...
```

Return shape: `{ deployment, logs }` (was `{ build, logs }`).

**list_deployments (was list_builds):**
```
BEFORE: SELECT bj.* FROM build_jobs bj JOIN projects p ...
AFTER:  SELECT d.* FROM deployments d JOIN projects p ...
```

**link_repo:**
Same pattern — INSERT INTO deployments instead of build_jobs.

### 2.5 deploy.rs

**Simplify dramatically.** The fallback logic (deploy_logs → build_logs
via build_job_id) is eliminated — there's only deploy_logs now.

```
BEFORE:
  1. Query deploy_logs WHERE deployment_id = $1
  2. If empty, check deployment.build_job_id
  3. If set, query build_logs WHERE build_job_id = $1
  4. Map BuildLog → DeployLogEntry

AFTER:
  1. Query deploy_logs WHERE deployment_id = $1
  Done.
```

Remove: `BuildLog` imports, build_logs queries, build_job_id fallback logic.

**deploy_status:** No structural change, just remove build_job_id from response.

**deploy_logs_stream (SSE):** No structural change. The broadcast channel
key is already deployment_id. Now the worker broadcasts to it directly.

### 2.6 main.rs

**Route changes:**
```rust
// REMOVE:
.route("/api/v1/builds", get(routes::list_builds))
.route("/api/v1/builds", post(routes::trigger_build))
.route("/api/v1/builds/{build_id}", get(routes::get_build))

// ADD:
.route("/api/v1/deployments", get(routes::list_deployments))
.route("/api/v1/deployments", post(routes::trigger_deploy))
.route("/api/v1/deployments/{deploy_id}", get(routes::get_deployment))
```

**Module rename:**
```rust
// mod build_worker;  →  mod deploy_worker;
mod deploy_worker;

// spawn call:
deploy_worker::spawn_worker(pool, config);
```

### 2.7 Cargo.toml

No dependency changes. Just file renames.
