# ICForge — Build Pipeline

**Status:** Complete v0.2
**Parent:** 001-architecture.md
**Milestone:** v0.2
**Related:** 008-github-app.md, 008-status-feedback.md, 015-framework-auto-detection.md

---

## 1. Goal

Run builds server-side in isolated Docker containers. When a push webhook arrives (via 008-github-app), ICForge clones the repo, detects the framework, builds the canisters, and deploys the artifacts — no user CI configuration needed.

## 2. Architecture

```
GitHub push webhook
    │
    ▼
Webhook handler (008-github-app.md)
    │
    ▼
Enqueue build job → Postgres `build_jobs` table
    │
    ▼
Build Worker (Render background worker)
    │  Polls for pending jobs
    │
    ▼
Docker container (per build):
    1. Clone repo (installation token as git credential)
    2. Auto-detect framework (spec 015)
    3. Install deps + build
    4. Upload .wasm + assets to IC (existing deploy pipeline)
    │
    ▼
Update job status → notify GitHub (008-status-feedback.md)
```

## 3. Job Queue (Postgres)

No external queue (Redis, RabbitMQ). Postgres is already there. Use `SELECT ... FOR UPDATE SKIP LOCKED` for reliable job claiming.

### 3.1 Table: `build_jobs`

```sql
CREATE TABLE build_jobs (
    id TEXT PRIMARY KEY,                -- ulid
    project_id TEXT NOT NULL REFERENCES projects(id),
    deployment_id TEXT REFERENCES deployments(id),

    -- Git context
    commit_sha TEXT NOT NULL,
    branch TEXT NOT NULL,
    repo_full_name TEXT NOT NULL,
    installation_id BIGINT NOT NULL,

    -- Trigger context
    trigger TEXT NOT NULL,              -- 'push', 'pull_request', 'manual'
    pr_number INTEGER,                  -- null for production builds

    -- State
    status TEXT NOT NULL DEFAULT 'pending',
        -- pending → claimed → building → deploying → success | failed | cancelled
    claimed_at TEXT,
    started_at TEXT,
    completed_at TEXT,
    error_message TEXT,

    -- Metadata
    framework TEXT,                     -- detected framework (e.g., 'vite', 'rust')
    build_duration_ms INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX idx_build_jobs_status ON build_jobs(status);
CREATE INDEX idx_build_jobs_project ON build_jobs(project_id);
```

### 3.2 Job Claiming

The worker polls for jobs using an atomic claim query:

```rust
async fn claim_next_job(pool: &PgPool) -> Option<BuildJob> {
    sqlx::query_as!(BuildJob, r#"
        UPDATE build_jobs
        SET status = 'claimed', claimed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = (
            SELECT id FROM build_jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
    "#)
    .fetch_optional(pool)
    .await
    .ok()?
}
```

### 3.3 Concurrency

Start with 1 concurrent build (single worker process). Scale later by running multiple worker instances — `SKIP LOCKED` ensures no double-claiming.

Free tier: builds are queued (FIFO). Paid tiers: priority queue (add `priority` column, order by priority DESC then created_at ASC).

## 4. Build Worker

The build worker is a Render **Background Worker** — same codebase as the API server, different entrypoint.

```
# Render service config
Type: Background Worker
Command: cargo run --bin icforge-worker
```

### 4.1 Worker Loop

```rust
async fn worker_main(pool: PgPool, config: Config) {
    loop {
        match claim_next_job(&pool).await {
            Some(job) => {
                let result = execute_build(job, &pool, &config).await;
                match result {
                    Ok(_) => update_job_status(&pool, &job.id, "success").await,
                    Err(e) => update_job_status(&pool, &job.id, "failed", &e).await,
                }
            }
            None => {
                // No jobs available, sleep before polling again
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}
```

### 4.2 Build Execution (In-Process, No Docker Yet)

For v0.3, builds run directly in the worker process (not in Docker). This is simpler and sufficient for a Render background worker where each build is sequential.

Docker isolation is a v0.4 upgrade when we need multi-tenant security or move to Fly.io Machines.

```rust
async fn execute_build(job: BuildJob, pool: &PgPool, config: &Config) -> Result<()> {
    let work_dir = tempdir()?;

    // 1. Clone
    clone_repo(&job, work_dir.path(), config).await?;

    // 2. Detect framework
    let framework = detect_framework(work_dir.path()).await?;
    update_job_framework(pool, &job.id, &framework).await?;

    // 3. Build
    run_build(&framework, work_dir.path()).await?;

    // 4. Deploy (reuse existing deploy pipeline)
    deploy_artifacts(&job, work_dir.path(), pool, config).await?;

    Ok(())
}
```

## 5. Build Steps Detail

### 5.1 Clone

```rust
async fn clone_repo(job: &BuildJob, work_dir: &Path, config: &Config) -> Result<()> {
    let token = get_installation_token(config, job.installation_id).await?;

    // Shallow clone for speed (depth=1, single branch)
    let status = Command::new("git")
        .args([
            "clone",
            "--depth", "1",
            "--branch", &job.branch,
            &format!("https://x-access-token:{token}@github.com/{}", job.repo_full_name),
            ".",
        ])
        .current_dir(work_dir)
        .status()
        .await?;

    if !status.success() {
        return Err(anyhow!("git clone failed"));
    }
    Ok(())
}
```

### 5.2 Framework Detection

Reuse the detection logic from spec 015. Scan for:

| Signal | Framework | Build Command | Output |
|---|---|---|---|
| `vite.config.*` | Vite | `npm run build` | `dist/` |
| `next.config.*` | Next.js (static) | `npm run build && npm run export` | `out/` |
| `Cargo.toml` with `ic-cdk` | Rust canister | `cargo build --target wasm32-unknown-unknown --release` | `target/wasm32.../release/*.wasm` |
| `*.mo` files | Motoko | `moc` compile | `*.wasm` |
| `dfx.json` | dfx project | `dfx build` | `.dfx/local/canisters/` |
| `icp.yaml` | ICForge native | Follow recipes in icp.yaml | Per-recipe output |

**Priority:** `icp.yaml` > `dfx.json` > auto-detect

### 5.3 Build Execution

```rust
async fn run_build(framework: &Framework, work_dir: &Path) -> Result<()> {
    // Install dependencies
    match framework.package_manager {
        Some(PackageManager::Npm) => run_cmd("npm", &["ci"], work_dir).await?,
        Some(PackageManager::Pnpm) => run_cmd("pnpm", &["install", "--frozen-lockfile"], work_dir).await?,
        Some(PackageManager::Yarn) => run_cmd("yarn", &["install", "--frozen-lockfile"], work_dir).await?,
        Some(PackageManager::Bun) => run_cmd("bun", &["install", "--frozen-lockfile"], work_dir).await?,
        None => {},
    }

    // Run build
    for cmd in &framework.build_commands {
        run_cmd(&cmd.program, &cmd.args, work_dir).await?;
    }

    Ok(())
}
```

### 5.4 Deploy Artifacts

After build, reuse the existing deploy pipeline (same code path as `icforge deploy`):

1. Locate build output (`.wasm`, `dist/`, etc.)
2. If asset canister: sync assets to existing canister
3. If backend canister: install/upgrade code
4. Create a `deployment` record in the DB
5. Update project's `latest_deployment_id`

## 6. Build Environment

### 6.1 Pre-installed Tools (on worker image)

The Render background worker Dockerfile includes:

```dockerfile
FROM rust:1.88-slim

# IC SDK
RUN sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

# Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs

# Package managers
RUN npm install -g pnpm yarn bun

# Rust wasm target
RUN rustup target add wasm32-unknown-unknown

# IC tools
RUN cargo install ic-wasm

# Build essentials
RUN apt-get install -y build-essential pkg-config libssl-dev git cmake
```

### 6.2 Build Timeouts

| Tier | Timeout |
|---|---|
| Free | 5 minutes |
| Dev | 10 minutes |
| Pro | 20 minutes |

If a build exceeds the timeout, kill the process and mark the job as `failed` with a clear error message.

### 6.3 Build Logs

Every line of stdout/stderr from the build process is captured and stored:

```sql
CREATE TABLE build_logs (
    id TEXT PRIMARY KEY,
    build_job_id TEXT NOT NULL REFERENCES build_jobs(id),
    level TEXT NOT NULL DEFAULT 'info',  -- info, warn, error
    message TEXT NOT NULL,
    timestamp TEXT NOT NULL
);

CREATE INDEX idx_build_logs_job ON build_logs(build_job_id);
```

Logs are also published to the broadcast channel (spec 005) for real-time SSE streaming.

## 7. Error Handling

### 7.1 Retriable vs Fatal Errors

| Error | Type | Action |
|---|---|---|
| Git clone failed (network) | Retriable | Retry up to 3 times with backoff |
| `npm ci` failed | Fatal | Mark failed, show logs |
| `cargo build` failed | Fatal | Mark failed, show logs |
| Deploy failed (IC network) | Retriable | Retry up to 3 times |
| Timeout | Fatal | Kill process, mark failed |
| Out of memory | Fatal | Mark failed, suggest smaller build |

### 7.2 Retry Logic

```rust
const MAX_RETRIES: u32 = 3;

// In job claiming query, add:
// WHERE status = 'pending' AND retry_count < 3
// On retriable failure:
// UPDATE build_jobs SET status = 'pending', retry_count = retry_count + 1
```

Add to `build_jobs`:
```sql
ALTER TABLE build_jobs ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
```

## 8. Future: Docker Isolation (v0.4+)

When multi-tenant security matters or we move off Render:

```
Worker claims job
    │
    ▼
docker run --rm \
    --memory=2g \
    --cpus=2 \
    --network=none (after clone) \
    -v /tmp/build-xyz:/workspace \
    icforge/builder:latest \
    /build.sh
```

Benefits:
- Memory/CPU limits per build
- Network isolation (prevent exfiltration after clone)
- Clean filesystem per build
- Can run multiple builds concurrently

This is a drop-in upgrade — the build steps are the same, just wrapped in a container.

## 9. Implementation Checklist

### Backend
- [x] `build_jobs` table + migration
- [x] `build_logs` table + migration
- [x] Job enqueue function (called from webhook handlers)
- [x] Job claim query (`FOR UPDATE SKIP LOCKED`)
- [x] Build worker binary (`icforge-worker`)
- [x] Clone step (with installation token auth)
- [x] Framework detection (reuse spec 015 logic)
- [x] Build execution (npm/cargo/dfx)
- [x] Deploy step (reuse existing deploy pipeline)
- [x] Build timeout enforcement
- [x] Retry logic for transient failures
- [x] Log capture → DB + broadcast channel
- [ ] Deduplication: if a new push arrives while a build is pending, cancel the old one

### Infrastructure
- [x] Worker Dockerfile with IC SDK + Node + Rust
- [x] Render background worker service
- [x] Environment variables (shared with API server)

## 10. Open Questions

1. **Rust build caching:** Rust canister builds are slow (2-5 min). Can we cache `target/` between builds? With Render background workers, the filesystem is ephemeral. Options: persistent disk, S3 cache, or accept slow builds for now.
2. **Monorepo builds:** If `icp.yaml` defines multiple canisters, build all of them in one job? Or one job per canister? Start with: one job builds everything in the project.
3. **Custom build commands:** Users may need custom build steps. Support a `build.command` override in `icp.yaml` for v0.3, full build pipeline config later.
