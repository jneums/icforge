-- Add canister_name to build_jobs for per-canister job model
-- Each canister gets its own build job (like Render.io services)
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS canister_name TEXT;

-- Index for efficient per-canister job lookups
CREATE INDEX IF NOT EXISTS idx_build_jobs_canister ON build_jobs(project_id, canister_name);
