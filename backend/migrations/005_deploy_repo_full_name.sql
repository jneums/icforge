-- Add repo_full_name to deployments so each deploy is self-contained.
-- Set for GitHub-triggered deploys; NULL for CLI deploys without repo context.
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS repo_full_name TEXT;
