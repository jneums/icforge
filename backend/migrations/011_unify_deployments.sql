-- 011: Unify build_jobs into deployments
-- Deployments becomes the single table for the full pipeline (clone → build → deploy → live)

-- Step 1: Add columns from build_jobs to deployments
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS installation_id BIGINT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS trigger TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS pr_number INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS claimed_at TEXT;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_duration_ms INTEGER;
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS');

-- Make started_at nullable (was NOT NULL with default — new deployments start as queued with no started_at)
ALTER TABLE deployments ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE deployments ALTER COLUMN started_at DROP DEFAULT;

-- Step 2: Migrate build_jobs data that never created a deployment
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

-- Step 3: Backfill new columns on existing deployments from their linked build_jobs
UPDATE deployments d SET
    installation_id = bj.installation_id,
    trigger = bj.trigger,
    pr_number = bj.pr_number,
    claimed_at = bj.claimed_at,
    retry_count = bj.retry_count,
    build_duration_ms = bj.build_duration_ms,
    created_at = COALESCE(d.created_at, bj.created_at),
    updated_at = COALESCE(d.updated_at, bj.updated_at)
FROM build_jobs bj
WHERE d.build_job_id = bj.id;

-- Step 4: Migrate build_logs into deploy_logs
-- For builds that created a deployment, use the deployment.id
-- For builds migrated directly, their build_job id IS now the deployment id
INSERT INTO deploy_logs (deployment_id, level, message, timestamp)
SELECT
    COALESCE(d_linked.id, bl.build_job_id) AS deployment_id,
    bl.level,
    bl.message,
    bl.timestamp
FROM build_logs bl
LEFT JOIN deployments d_linked ON d_linked.build_job_id = bl.build_job_id
ON CONFLICT DO NOTHING;

-- Step 5: Add indexes for job queue operations on deployments
CREATE INDEX IF NOT EXISTS idx_deployments_status ON deployments(status);
CREATE INDEX IF NOT EXISTS idx_deployments_project ON deployments(project_id);
CREATE INDEX IF NOT EXISTS idx_deployments_canister ON deployments(project_id, canister_name);

-- Step 6: Drop old tables and columns (no backward compat needed)
ALTER TABLE deployments DROP COLUMN IF EXISTS build_job_id;
DROP TABLE IF EXISTS build_logs;
DROP TABLE IF EXISTS build_jobs;
