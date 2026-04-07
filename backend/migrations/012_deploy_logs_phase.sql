-- Add phase column to deploy_logs (was in build_logs but not carried over in 011)
ALTER TABLE deploy_logs ADD COLUMN IF NOT EXISTS phase TEXT;

-- Index for faster log queries by deployment
CREATE INDEX IF NOT EXISTS idx_deploy_logs_deployment ON deploy_logs(deployment_id);
