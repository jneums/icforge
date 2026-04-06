-- Add commit_message to build_jobs so webhook-triggered builds carry the git commit message
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS commit_message TEXT;
