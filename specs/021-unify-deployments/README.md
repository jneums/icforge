# 021 — Unify Build Jobs and Deployments

**Status:** ✅ Complete  
**Depends on:** 008-build-pipeline, 020-icp-cli-migration  
**Milestone:** v0.3

> **Completed:** Migration 011 applied — `build_jobs` table dropped, columns merged into
> `deployments`. `build_logs` merged into `deploy_logs`. Unified status flow
> (`queued → building → deploying → live | failed | cancelled`) is live.
> Dashboard, CLI, and worker all use the single `deployments` table.

## Problem

ICForge currently has two separate concepts for what Vercel/Render treat as one:

- **build_jobs** — the job queue (webhook/CLI/dashboard triggers)
- **deployments** — the result record (created only on success)

This causes real user-facing issues:

1. **Builds that fail never create a deployment** — so the deploy detail page can't show them
2. **Status mismatch bug** — CLI/dashboard insert `status='queued'` but the worker only claims `status='pending'`, so those builds stall forever
3. **Two log tables** — `build_logs` and `deploy_logs` with fallback logic between them
4. **Two detail pages** — BuildDetail (polling) and DeployDetail (SSE) with duplicated log viewers
5. **Confusing data model** — circular references (`deployments.build_job_id` ↔ `build_jobs.deployment_id`), both tables storing commit/branch/repo info

## Solution

Merge into a single **deployments** table that represents the full pipeline (clone → build → deploy → live), matching Vercel/Render's model. One log table. One detail page. One status flow.

## Documents

| File | Scope |
|------|-------|
| [01-database-migration.md](./01-database-migration.md) | Schema changes, data migration SQL |
| [02-backend-changes.md](./02-backend-changes.md) | Rust models, worker, routes, webhooks, deploy.rs |
| [03-dashboard-changes.md](./03-dashboard-changes.md) | React pages, API functions, types, routing |
| [04-cli-changes.md](./04-cli-changes.md) | TypeScript CLI endpoint updates |
| [05-rollout.md](./05-rollout.md) | Migration order, rollback plan, testing |

## Unified Status Flow

```
queued → building → deploying → live | failed | cancelled
```

- `queued` — job inserted, waiting for worker
- `building` — worker claimed, cloning + building
- `deploying` — `icp deploy` running, pushing to IC
- `live` — canister updated, KV written, done
- `failed` — error at any stage
- `cancelled` — superseded by newer push

## Scope

**In scope:** Merge tables, unify worker, single dashboard page, single CLI path  
**Out of scope:** SSE streaming for builds (keep polling for now, SSE is a follow-up)
