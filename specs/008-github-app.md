# ICForge — GitHub App Integration

**Status:** Mostly Complete v0.2
**Parent:** 001-architecture.md
**Milestone:** v0.2
**Related:** 008-build-pipeline.md, 008-status-feedback.md

---

## 1. Goal

Replace the GitHub Actions deploy wrapper (old 008) with a first-party GitHub App that gives ICForge direct access to user repos. This is the foundation for managed builds — ICForge clones, builds, and deploys on every push, like Netlify/Vercel.

## 2. Why a GitHub App

| | GitHub Action (old model) | GitHub App (new model) |
|---|---|---|
| Build infra | User's CI minutes | ICForge-managed containers |
| Setup | User writes workflow YAML | One-click "Connect Repo" |
| Status feedback | Action output only | Commit statuses + check runs on PRs |
| Repo access | Via API token in secrets | Scoped installation token (auto-refreshed) |
| Webhook events | None (action triggers on push) | push, pull_request, installation |
| User experience | Developer-oriented | Product-oriented |

## 3. GitHub App Registration

Register at `github.com/settings/apps/new`:

```
App name:           ICForge
Homepage URL:       https://icforge.dev
Callback URL:       https://api.icforge.dev/api/v1/github/callback
Setup URL:          https://app.icforge.dev/github/setup
Webhook URL:        https://api.icforge.dev/api/v1/github/webhooks
Webhook secret:     <random-secret>
```

### 3.1 Permissions

| Permission | Access | Why |
|---|---|---|
| Contents | Read | Clone repo for builds |
| Checks | Write | Create check runs on commits |
| Commit statuses | Write | Post build status on commits |
| Pull requests | Write | Comment preview URLs on PRs |
| Metadata | Read | Required by GitHub |

### 3.2 Webhook Events

Subscribe to:
- `push` — trigger production builds (main branch)
- `pull_request` (opened, synchronize, closed) — trigger preview builds, cleanup
- `installation` (created, deleted) — track app installs/uninstalls
- `installation_repositories` (added, removed) — track repo selection changes

## 4. Auth Flow

GitHub Apps use a two-step auth model:

```
1. App-level auth (JWT)
   - Sign JWT with app's private key (RS256)
   - Identifies ICForge as the app
   - Used to: list installations, create installation tokens

2. Installation-level auth (installation access token)
   - POST /app/installations/:id/access_tokens (with JWT)
   - Returns a token scoped to the repos the user granted
   - Expires in 1 hour, auto-refresh as needed
   - Used to: clone repos, create check runs, post statuses
```

### 4.1 JWT Generation (Rust)

```rust
use jsonwebtoken::{encode, EncodingKey, Header, Algorithm};

fn github_app_jwt(app_id: &str, private_key_pem: &[u8]) -> String {
    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "iat": now - 60,       // issued at (clock skew buffer)
        "exp": now + (10 * 60), // expires in 10 minutes
        "iss": app_id,
    });
    encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &EncodingKey::from_rsa_pem(private_key_pem).unwrap(),
    ).unwrap()
}
```

### 4.2 Installation Token Exchange

```rust
async fn get_installation_token(
    app_jwt: &str,
    installation_id: u64,
) -> Result<String> {
    let resp = reqwest::Client::new()
        .post(format!(
            "https://api.github.com/app/installations/{installation_id}/access_tokens"
        ))
        .header("Authorization", format!("Bearer {app_jwt}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "ICForge")
        .send()
        .await?;
    let body: serde_json::Value = resp.json().await?;
    Ok(body["token"].as_str().unwrap().to_string())
}
```

## 5. Installation Flow (User Experience)

```
User clicks "Connect Repository" in ICForge dashboard
    │
    ▼
Redirected to: github.com/apps/icforge/installations/new
    │  User selects org/account, picks repos (or "All repositories")
    │
    ▼
GitHub sends `installation.created` webhook to ICForge
    │  Payload contains: installation_id, account, repositories[]
    │
    ▼
ICForge stores installation in DB
    │
    ▼
GitHub redirects to Setup URL: app.icforge.dev/github/setup?installation_id=123
    │
    ▼
Dashboard shows: "Select a repository to create a project"
    │  User picks a repo → ICForge creates a project linked to that repo
    │
    ▼
First push to main triggers a build automatically
```

### 5.1 Reconnecting / Adding Repos

If the user already has the app installed and wants to add more repos:
- Dashboard link goes to `github.com/apps/icforge/installations/:id` (manage page)
- GitHub sends `installation_repositories.added` webhook
- New repos appear as available in the dashboard

## 6. Data Model

### New table: `github_installations`

```sql
CREATE TABLE github_installations (
    id TEXT PRIMARY KEY,                    -- ulid
    user_id TEXT NOT NULL REFERENCES users(id),
    installation_id BIGINT NOT NULL UNIQUE, -- GitHub's installation ID
    account_login TEXT NOT NULL,            -- GitHub username or org
    account_type TEXT NOT NULL,             -- 'User' or 'Organization'
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

### New table: `github_repos`

```sql
CREATE TABLE github_repos (
    id TEXT PRIMARY KEY,                    -- ulid
    installation_id TEXT NOT NULL REFERENCES github_installations(id),
    github_repo_id BIGINT NOT NULL UNIQUE,  -- GitHub's repo ID
    full_name TEXT NOT NULL,                -- e.g. "jneums/my-dapp"
    default_branch TEXT NOT NULL DEFAULT 'main',
    created_at TEXT NOT NULL
);
```

### Updated: `projects` table

Add columns:
```sql
ALTER TABLE projects ADD COLUMN github_repo_id TEXT REFERENCES github_repos(id);
ALTER TABLE projects ADD COLUMN production_branch TEXT NOT NULL DEFAULT 'main';
```

## 7. Webhook Receiver

### 7.1 Endpoint

```
POST /api/v1/github/webhooks
Headers:
  X-GitHub-Event: push | pull_request | installation | ...
  X-Hub-Signature-256: sha256=<hmac>
  X-GitHub-Delivery: <uuid>
```

### 7.2 Signature Verification

Every webhook must be verified against the webhook secret:

```rust
use hmac::{Hmac, Mac};
use sha2::Sha256;

fn verify_webhook(secret: &[u8], payload: &[u8], signature: &str) -> bool {
    let sig = signature.strip_prefix("sha256=").unwrap_or("");
    let mut mac = Hmac::<Sha256>::new_from_slice(secret).unwrap();
    mac.update(payload);
    let expected = hex::encode(mac.finalize().into_bytes());
    sig == expected
}
```

### 7.3 Event Routing

```rust
async fn handle_webhook(event_type: &str, payload: Value) -> Result<()> {
    match event_type {
        "push" => handle_push(payload).await,
        "pull_request" => handle_pull_request(payload).await,
        "installation" => handle_installation(payload).await,
        "installation_repositories" => handle_repos_changed(payload).await,
        _ => Ok(()),  // ignore unknown events
    }
}
```

### 7.4 Push Event Handler

```
Receive push event
    │
    ├── Extract: repo full_name, branch, head commit SHA
    │
    ├── Look up project by github_repo_id + branch == production_branch
    │   (ignore pushes to non-production branches)
    │
    ├── Get installation_id for this repo
    │
    └── Enqueue build job (see 008-build-pipeline.md)
        {
            project_id, commit_sha, branch, repo_full_name,
            installation_id, trigger: "push"
        }
```

### 7.5 Pull Request Event Handler

```
Receive pull_request event
    │
    ├── action == "opened" or "synchronize"
    │   └── Enqueue preview build job (trigger: "pull_request")
    │       { ...same fields + pr_number, pr_branch }
    │
    ├── action == "closed"
    │   └── Enqueue preview cleanup job
    │       { project_id, pr_number }
    │
    └── Other actions → ignore
```

## 8. Environment Variables

The backend needs these new env vars:

```
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<base64-encoded PEM>
GITHUB_WEBHOOK_SECRET=<random-secret>
```

## 9. Implementation Checklist

### Backend
- [x] Add `jsonwebtoken` + `hmac` + `sha2` crates
- [x] GitHub JWT generation utility
- [x] Installation token exchange utility (with 1hr cache)
- [x] Webhook endpoint with signature verification
- [x] Event routing (push, pull_request, installation, installation_repositories)
- [x] Push handler → enqueue build job
- [ ] Pull request handler → enqueue preview/cleanup job
- [x] Installation handler → store/remove installation
- [x] `github_installations` table + migration
- [x] `github_repos` table + migration
- [x] Add `github_repo_id` + `production_branch` to projects

### Dashboard
- [x] "Connect Repository" button → redirect to GitHub App install
- [x] Setup page (`/github/setup`) → repo picker → create project
- [ ] Show connected repo on project settings
- [ ] "Disconnect" button (removes link, doesn't uninstall app)

### GitHub App
- [x] Register app on GitHub (dev + production)
- [x] Generate and store private key securely
- [x] Configure webhook URL and secret

## 10. Open Questions

1. **Multi-project per repo:** Should one repo map to multiple ICForge projects? (e.g., monorepo with frontend + backend as separate projects) For now: 1 repo = 1 project.
2. **Org installs:** When an org installs the app, which ICForge user owns it? The user who initiated the install. Team/org support comes later (spec 014).
3. **Private repos:** Installation tokens automatically grant access to private repos the user selected. No extra auth needed.
