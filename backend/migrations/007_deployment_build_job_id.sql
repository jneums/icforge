-- Link deployments back to the build job that created them (for log retrieval)
ALTER TABLE deployments ADD COLUMN IF NOT EXISTS build_job_id TEXT REFERENCES build_jobs(id);
