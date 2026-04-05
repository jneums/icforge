# ICForge — Build Status Feedback + API Tokens

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3
**Related:** 008-github-app.md, 008-build-pipeline.md, 005-deploy-status-log-streaming.md

---

## 1. Goal

Close the feedback loop: show build status on GitHub commits/PRs, stream build logs to the dashboard in real-time, and provide API tokens for machine-to-machine auth (manual deploys, future CI integrations).

## 2. GitHub Status Feedback

### 2.1 Commit Statuses

Post status updates on the commit SHA at each stage of the build:

```
Build starts   → status: pending   "ICForge: Building..."
Build succeeds → status: success   "ICForge: Deployed to https://my-dapp.icforge.dev"
Build fails    → status: failure   "ICForge: Build failed — npm run build exited 1"
Build errors   → status: error     "ICForge: Internal error — please retry"
```

API call:
```
POST /repos/{owner}/{repo}/statuses/{sha}
Authorization: Bearer <installation-token>

{
    "state": "pending" | "success" | "failure" | "error",
    "target_url": "https://app.icforge.dev/builds/{build_id}",
    "description": "Building...",
    "context": "icforge"
}
```

### 2.2 Check Runs (Enhanced)

Check runs provide richer feedback than commit statuses — they show up in the "Checks" tab on PRs with full details.

```
POST /repos/{owner}/{repo}/check-runs
Authorization: Bearer <installation-token>

{
    "name": "ICForge Build",
    "head_sha": "<commit-sha>",
    "status": "in_progress",
    "started_at": "2025-01-15T12:00:00Z",
    "output": {
        "title": "Building my-dapp...",
        "summary": "Detected: Vite + Rust canister\nInstalling dependencies..."
    }
}
```

On completion, update with full details:
```
PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}

{
    "status": "completed",
    "conclusion": "success" | "failure",
    "completed_at": "2025-01-15T12:02:30Z",
    "output": {
        "title": "Deployed successfully",
        "summary": "Built in 2m 30s\n\n🔗 https://my-dapp.icforge.dev",
        "text": "<full build log output>"
    }
}
```

### 2.3 PR Comments (Preview Deployments)

When a preview build completes, comment on the PR:

```
POST /repos/{owner}/{repo}/issues/{pr_number}/comments
Authorization: Bearer <installation-token>

{
    "body": "### 🚀 ICForge Preview\n\n| Canister | URL |\n|---|---|\n| frontend | [pr-42--my-dapp.icforge.dev](https://pr-42--my-dapp.icforge.dev) |\n\nBuilt in 1m 45s from abc1234"
}
```

Update the same comment on subsequent pushes (find by marker text, edit instead of creating new).

### 2.4 Implementation

```rust
struct GitHubNotifier {
    client: reqwest::Client,
}

impl GitHubNotifier {
    async fn post_status(&self, token: &str, repo: &str, sha: &str, state: &str, description: &str, url: &str) -> Result<()> {
        self.client.post(format!("https://api.github.com/repos/{repo}/statuses/{sha}"))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "ICForge")
            .json(&serde_json::json!({
                "state": state,
                "target_url": url,
                "description": description,
                "context": "icforge"
            }))
            .send().await?;
        Ok(())
    }

    async fn create_check_run(&self, token: &str, repo: &str, sha: &str) -> Result<u64> { ... }
    async fn update_check_run(&self, token: &str, repo: &str, check_id: u64, ...) -> Result<()> { ... }
    async fn comment_on_pr(&self, token: &str, repo: &str, pr: u32, body: &str) -> Result<()> { ... }
}
```

Integrate with the build worker — at each stage transition, call the notifier:

```
Job claimed  → post_status("pending") + create_check_run()
Building     → update_check_run(status: "in_progress", summary: progress)
Deploy done  → post_status("success") + update_check_run(conclusion: "success")
Failed       → post_status("failure") + update_check_run(conclusion: "failure")
```

## 3. Build Log Streaming (Dashboard)

Extend the existing SSE infrastructure from spec 005.

### 3.1 How It Works

Spec 005 already defines:
- `DashMap<String, broadcast::Sender<LogEvent>>` on AppState
- SSE endpoint `GET /api/v1/deploy/:id/logs/stream`
- Log replay from DB + live broadcast

The build worker publishes to the same broadcast channel. The only change: build logs are now generated server-side (by the worker) instead of client-side (by the CLI during deploy).

### 3.2 New SSE Endpoint for Builds

```
GET /api/v1/builds/:build_id/logs/stream
Accept: text/event-stream
Authorization: Bearer <jwt or api_token>
```

Same SSE format as deploy logs:
```
event: log
data: {"level":"info","message":"Cloning repository...","timestamp":"...","phase":"clone"}

event: log
data: {"level":"info","message":"Installing dependencies...","timestamp":"...","phase":"build"}

event: status
data: {"status":"deploying","phase":"deploy"}

event: done
data: {"status":"success","duration_ms":150000,"url":"https://my-dapp.icforge.dev"}
```

Added: `phase` field (clone, detect, build, deploy) for UI progress indicators.

### 3.3 Dashboard Build View

New page: `/builds/:build_id`

```
┌──────────────────────────────────────────────────┐
│  Build #17 — my-dapp                             │
│  Commit: abc1234 "fix: header alignment"         │
│  Branch: main    Trigger: push                   │
│                                                  │
│  ● Clone ─── ● Detect ─── ● Build ─── ● Deploy  │
│                              ▲                   │
│                           (current)              │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ [12:00:01] Cloning jneums/my-dapp...       │  │
│  │ [12:00:02] Clone complete (depth=1)        │  │
│  │ [12:00:02] Detected: Vite (React)          │  │
│  │ [12:00:02] Package manager: pnpm           │  │
│  │ [12:00:03] Running: pnpm install           │  │
│  │ [12:00:08] Running: pnpm run build         │  │
│  │ [12:00:15] Build complete (dist/, 2.1 MB)  │  │
│  │ [12:00:15] Deploying to canister...        │  │
│  │ ▌ (streaming...)                           │  │
│  └────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 3.4 Project Build History

Add to existing project detail page:

```
GET /api/v1/projects/:id/builds
Returns: [{ id, commit_sha, branch, status, trigger, created_at, duration_ms }]
```

## 4. API Tokens

API tokens enable machine-to-machine auth — manual deploys from CI, scripts, or other tools. Carried over from old spec 008 since this is still needed.

### 4.1 Token Format

```
icf_tok_<random-32-chars>
```

Example: `icf_tok_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6`

### 4.2 Data Model

```sql
CREATE TABLE api_tokens (
    id TEXT PRIMARY KEY,                -- ulid
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,                 -- e.g., "github-actions", "deploy-script"
    token_hash TEXT NOT NULL,           -- SHA-256 hash of the full token
    last_used_at TEXT,
    expires_at TEXT,                    -- null = never expires
    created_at TEXT NOT NULL
);
```

### 4.3 API Endpoints

```
POST /api/v1/auth/tokens
  Body: { name: "my-token", expires_in_days: 365 }
  Returns: { token: "icf_tok_...", id, name, expires_at }
  (Full token returned ONCE — only the hash is stored)

GET /api/v1/auth/tokens
  Returns: [{ id, name, last_used_at, created_at, expires_at }]

DELETE /api/v1/auth/tokens/:id
  Revoke a token
```

### 4.4 Auth Middleware Update

The existing `AuthUser` extractor accepts `Bearer <jwt>`. Extend it:

```rust
async fn extract_auth(header: &str) -> Result<AuthUser> {
    if header.starts_with("icf_tok_") {
        // API token auth
        let hash = sha256(header);
        let token = sqlx::query!("SELECT user_id FROM api_tokens WHERE token_hash = ?", hash)
            .fetch_optional(&pool).await?
            .ok_or(AuthError::InvalidToken)?;
        // Update last_used_at
        Ok(AuthUser { user_id: token.user_id })
    } else {
        // JWT auth (existing path)
        verify_jwt(header)
    }
}
```

### 4.5 CLI + Dashboard

**CLI commands:**
```bash
icforge token create --name "deploy-script"
# → icf_tok_a1b2c3d4...  (copy this, it won't be shown again)

icforge token list
# → NAME            LAST USED    CREATED
#   deploy-script   2h ago       2025-01-15

icforge token revoke <id>

icforge deploy --token icf_tok_...
# → deploys using API token instead of OAuth
```

**Dashboard:** Token management on Settings page — create, view (masked), revoke.

## 5. Implementation Checklist

### Backend — GitHub Status
- [ ] `GitHubNotifier` struct with methods for statuses, check runs, PR comments
- [ ] Integrate notifier into build worker state transitions
- [ ] Idempotent PR comment updates (find existing comment, edit it)

### Backend — Build Log Streaming
- [ ] `GET /api/v1/builds/:id/logs/stream` SSE endpoint
- [ ] `GET /api/v1/projects/:id/builds` list endpoint
- [ ] Publish build logs to broadcast channel from worker
- [ ] Add `phase` field to log events

### Backend — API Tokens
- [ ] `api_tokens` table + migration
- [ ] Token CRUD endpoints (create, list, revoke)
- [ ] Extend auth middleware to accept `icf_tok_*` tokens
- [ ] SHA-256 hashing on create, lookup by hash

### CLI
- [ ] `icforge token create/list/revoke` commands
- [ ] `--token` flag on `icforge deploy`

### Dashboard
- [ ] Build detail page (`/builds/:id`) with SSE log streaming
- [ ] Build history on project detail page
- [ ] Progress stepper UI (clone → detect → build → deploy)
- [ ] Token management on Settings page

## 6. Open Questions

1. **Log retention:** How long to keep build logs? 30 days for free tier, 90 days for paid? Or just cap at last N builds per project?
2. **Notifications beyond GitHub:** Email/webhook on build failure? Overkill for now, but the notifier pattern makes it easy to add later.
