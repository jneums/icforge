# 05 — Rollout Plan

## Migration Order

Do this in one PR with careful ordering:

### Step 1: Database migration (011_unify_deployments.sql)
- Add new columns to deployments
- Migrate build_jobs data into deployments
- Migrate build_logs into deploy_logs
- Add indexes
- Does NOT drop old tables yet (backward safe)

### Step 2: Backend code changes
Order within this step matters:

1. **models.rs** — Update DeploymentRecord, remove BuildJob/BuildLog
2. **build_worker.rs → deploy_worker.rs** — Rename, update all SQL
3. **webhooks.rs** — INSERT INTO deployments instead of build_jobs
4. **routes.rs** — Rename handlers, update SQL, simplify get_project response
5. **deploy.rs** — Remove build_logs fallback
6. **main.rs** — Update routes and module name

### Step 3: Dashboard changes
1. **types.ts** — Remove Build, update Deployment
2. **deploys.ts** — Remove fetchBuild, add fetchDeployment
3. **projects.ts** — Remove builds from return type
4. **use-project.ts** — Remove builds check
5. **ProjectDetail.tsx** — Remove BuildRow + Builds tab
6. **App.tsx** — Remove BuildDetail route, add redirect
7. **Delete BuildDetail.tsx**
8. **DeployDetail.tsx** — Add trigger to summary card
9. **status-badge.tsx / status-dot.tsx** — Add deploying status

### Step 4: CLI changes
1. **deploy.ts** — Switch endpoints, rename functions
2. No changes to status.ts or logs.ts

### Step 5: Cleanup migration (012_drop_build_tables.sql)
- Ship in a SEPARATE follow-up PR after confirming production is stable
- DROP TABLE build_logs, DROP TABLE build_jobs
- ALTER TABLE deployments DROP COLUMN build_job_id

## Testing

Before merging:
- [ ] Fresh DB: run all migrations, verify deployments table has correct schema
- [ ] Existing DB: run migration on a copy of production, verify data migrated
- [ ] Webhook push: triggers deployment, worker picks it up, status flows to live
- [ ] Dashboard trigger (link repo): deployment created with status=queued, worker picks it up
- [ ] CLI trigger: `icforge deploy` creates deployment, streams logs, shows live
- [ ] Failed deploy: error_message populated, dashboard shows error on detail page
- [ ] Cancel on new push: pending deployments cancelled when newer push arrives
- [ ] Project detail: single Deployments tab, all entries clickable
- [ ] Deploy detail: shows full pipeline logs from clone through deploy

## Rollback

If something goes wrong:
1. The old tables still exist (migration 012 hasn't run yet)
2. Revert the code PR — the old code reads from build_jobs/build_logs
3. New deployments created during the broken window exist in both tables
   (migration 011 doesn't remove data, and the old deploy.rs had fallback logic)

## Files Changed Summary

| Layer | Files Changed | Files Deleted | Files Renamed |
|-------|--------------|---------------|---------------|
| Backend | 6 (models, routes, deploy, webhooks, main, Cargo.toml) | 0 | 1 (build_worker → deploy_worker) |
| Migrations | 2 new (011, 012) | 0 | 0 |
| Dashboard | 8 (types, deploys, projects, use-project, ProjectDetail, DeployDetail, App, status components) | 1 (BuildDetail.tsx) | 0 |
| CLI | 1 (deploy.ts) | 0 | 0 |
| **Total** | **17** | **1** | **1** |
