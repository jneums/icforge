-- ICForge PostgreSQL schema

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    github_id BIGINT UNIQUE NOT NULL,
    email TEXT,
    name TEXT,
    avatar_url TEXT,
    ic_identity_pem TEXT,
    ic_principal TEXT,
    plan TEXT NOT NULL DEFAULT 'free',
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    custom_domain TEXT,
    subnet_id TEXT,
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE(user_id, slug)
);

CREATE TABLE IF NOT EXISTS canisters (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('frontend', 'backend')),
    canister_id TEXT,
    subnet_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    cycles_balance BIGINT,
    created_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    updated_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    UNIQUE(project_id, name)
);

CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    canister_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    commit_sha TEXT,
    commit_message TEXT,
    branch TEXT,
    error_message TEXT,
    started_at TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS deploy_logs (
    id SERIAL PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES deployments(id),
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
);
