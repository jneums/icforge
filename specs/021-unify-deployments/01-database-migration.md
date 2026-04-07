# 01 — Database Migration

## Current State

Two tables with overlapping columns:

**build_jobs** (job queue, 20+ columns):
- id, project_id, deployment_id, canister_name
- commit_sha, commit_message, branch, repo_full_name
- installation_id, trigger, pr_number
- status (pending/queued/building/success/failed/cancelled)
- claimed_at, started_at, completed_at, error_message
- retry_count, framework, build_duration_ms, created_at, updated_at

**deployments** (result record, 12 columns):
- id, project_id, canister_name
- status (queued/building/succeeded/live/failed)
- commit_sha, commit_message, branch, repo_full_name
- error_message, started_at, completed_at, build_job_id

**build_logs** → references build_jobs.id  
**deploy_logs** → references deployments.id

## Target State

Single **deployments** table that covers the full pipeline:

```sql
-- Migration 011: Unify build_jobs into deployments
-- Step 1: Add missing columns to deployments

ALTER TABLE deployments ADD COLUMN IF NOT EXISTS installation_id BIGINT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS trigger TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS pr_number INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS claimed_at TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_duration_ms INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS created_at TEXT
    NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS updated_at TEXT
    NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
```

## Step 2: Migrate build_jobs data into deployments

For every build_job that doesn't already have a corresponding deployment:

```sql
-- Insert build_jobs that never created a deployment (failed/cancelled/stalled)
INSERT INTO deployments (
    id, project_id, canister_name, status, commit_sha, commit_message,
    branch, repo_full_name, error_message, started_at, completed_at,
    installation_id, trigger, pr_number, claimed_at, retry_count,
    build_duration_ms, created_at, updated_at
)
SELECT
    bj.id, bj.project_id,
    COALESCE(bj.canister_name, 'unknown'),
    CASE bj.status
        WHEN 'success' THEN 'live'
        WHEN 'pending' THEN 'queued'
        ELSE bj.status
    END,
    bj.commit_sha, bj.commit_message, bj.branch, bj.repo_full_name,
    bj.error_message,
    COALESCE(bj.started_at, bj.created_at),
    bj.completed_at,
    bj.installation_id, bj.trigger, bj.pr_number, bj.claimed_at,
    bj.retry_count, bj.build_duration_ms, bj.created_at, bj.updated_at
FROM build_jobs bj
WHERE NOT EXISTS (
    SELECT 1 FROM deployments d WHERE d.build_job_id = bj.id
);

-- Update existing deployments with data from their linked build_jobs
UPDATE deployments d SET
    installation_id = bj.installation_id,
    trigger = bj.trigger,
    pr_number = bj.pr_number,
    claimed_at = bj.claimed_at,
    retry_count = bj.retry_count,
    build_duration_ms = bj.build_duration_ms,
    created_at = bj.created_at,
    updated_at = bj.updated_at
FROM build_jobs bj
WHERE d.build_job_id = bj.id;
```

## Step 3: Unify logs

```sql
-- Migrate build_logs into deploy_logs
-- Map build_job_id → deployment_id
INSERT INTO deploy_logs (deployment_id, level, message, timestamp)
SELECT
    COALESCE(d.id, bl.build_job_id) AS deployment_id,
    bl.level,
    bl.message,
    bl.timestamp
FROM build_logs bl
LEFT JOIN deployments d ON d.build_job_id = bl.build_job_id
WHERE NOT EXISTS (
    SELECT 1 FROM deploy_logs dl
    WHERE dl.deployment_id = COALESCE(d.id, bl.build_job_id)
    AND dl.message = bl.message
    AND dl.timestamp = bl.timestamp
);

-- For build_jobs migrated directly (no linked deployment),
-- their id IS the deployment id now, so bl.build_job_id = d.id
```

## Step 4: Add indexes, drop old tables

```sql
-- Add job-queue indexes on deployments
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_canister
    ON deployments(project_id, canister_name);

-- Drop legacy columns and tables (in a SEPARATE migration for safety)
-- Migration 012:
ALTER TABLE deployments DROP COLUMN IF EXISTS build_job_id;
DROP TABLE IF EXISTS build_logs;
DROP TABLE IF EXISTS build_jobs;
```

## Final deployments schema

```
deployments
├── id TEXT PK
├── project_id TEXT FK → projects
├── canister_name TEXT NOT NULL
├── status TEXT NOT NULL DEFAULT 'queued'
│   (queued | building | deploying | live | failed | cancelled)
├── commit_sha TEXT
├── commit_message TEXT
├── branch TEXT
├── repo_full_name TEXT
├── installation_id BIGINT
├── trigger TEXT (push | pull_request | cli | dashboard)
├── pr_number INTEGER
├── error_message TEXT
├── claimed_at TEXT
├── started_at TEXT
├── completed_at TEXT
├── retry_count INTEGER DEFAULT 0
├── build_duration_ms INTEGER
├── created_at TEXT
└── updated_at TEXT
```

## Status Mapping

| Old build_jobs status | Old deployments status | New unified status |
|----------------------|----------------------|-------------------|
| pending              | —                    | queued            |
| queued               | queued               | queued            |
| building             | building             | building          |
| —                    | —                    | deploying (new)   |
| success              | succeeded            | live              |
| failed               | failed               | failed            |
| cancelled            | —                    | cancelled         |
