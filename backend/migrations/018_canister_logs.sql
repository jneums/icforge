-- Runtime canister logs (fetched from IC management canister's fetch_canister_logs)
CREATE TABLE IF NOT EXISTS canister_logs (
    id TEXT PRIMARY KEY,
    canister_id TEXT NOT NULL,           -- DB canister record ID (FK to canisters.id)
    ic_canister_id TEXT NOT NULL,        -- actual IC canister ID (e.g. "xh5m6-qyaaa-...")
    log_index BIGINT NOT NULL,           -- IC log record index (monotonic per canister)
    level TEXT NOT NULL DEFAULT 'debug', -- debug, info, warn, error (parsed from content)
    message TEXT NOT NULL,
    ic_timestamp BIGINT NOT NULL,        -- nanosecond timestamp from IC
    collected_at TEXT NOT NULL,          -- ISO 8601 when we fetched it
    UNIQUE(ic_canister_id, log_index)
);

CREATE INDEX IF NOT EXISTS idx_canister_logs_canister ON canister_logs(canister_id, ic_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_canister_logs_level ON canister_logs(canister_id, level);
CREATE INDEX IF NOT EXISTS idx_canister_logs_ic_canister ON canister_logs(ic_canister_id, log_index);

-- Per-project log retention setting (hours). Users toggle this in project settings.
-- Longer retention = more storage. Default 24h.
-- Allowed values: 1, 24, 168 (7d), 720 (30d)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS log_retention_hours INTEGER NOT NULL DEFAULT 24;
