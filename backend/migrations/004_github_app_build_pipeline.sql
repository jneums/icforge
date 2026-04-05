-- GitHub App installations
CREATE TABLE IF NOT EXISTS github_installations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    installation_id BIGINT NOT NULL UNIQUE,
    account_login TEXT NOT NULL,
    account_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Repos accessible via GitHub App installation
CREATE TABLE IF NOT EXISTS github_repos (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL REFERENCES github_installations(id),
    github_repo_id BIGINT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Link projects to GitHub repos
ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo_id TEXT REFERENCES github_repos(id);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS production_branch TEXT NOT NULL DEFAULT 'main';

-- API tokens for machine-to-machine auth
CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

-- Build jobs (Postgres-backed job queue)
CREATE TABLE IF NOT EXISTS build_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    deployment_id TEXT,

    -- Git context
    commit_sha TEXT NOT NULL,
    branch TEXT NOT NULL,
    repo_full_name TEXT NOT NULL,
    installation_id BIGINT NOT NULL,

    -- Trigger context
    trigger TEXT NOT NULL,
    pr_number INTEGER,

    -- State
    status TEXT NOT NULL DEFAULT 'pending',
    claimed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,

    -- Metadata
    framework TEXT,
    build_duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_build_jobs_status ON build_jobs(status);
CREATE INDEX IF NOT EXISTS idx_build_jobs_project ON build_jobs(project_id);

-- Build logs
CREATE TABLE IF NOT EXISTS build_logs (
    id SERIAL PRIMARY KEY,
    build_job_id TEXT NOT NULL REFERENCES build_jobs(id),
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    phase TEXT,
    timestamp TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE INDEX IF NOT EXISTS idx_build_logs_job ON build_logs(build_job_id);
