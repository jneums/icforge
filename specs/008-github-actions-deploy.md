# ICForge — GitHub Actions Deploy Action

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Provide a GitHub Action that deploys to IC via ICForge on every push to main (or any configured trigger). This is the CI/CD path — no local CLI needed after initial setup.

## 2. User Experience

```yaml
# .github/workflows/deploy.yml
name: Deploy to IC
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: nicforge/deploy-action@v1
        with:
          token: ${{ secrets.ICFORGE_TOKEN }}
          # Optional overrides:
          # project-id: "..."
          # canister: "frontend"  # deploy specific canister
```

That's it. The action handles build + upload + status polling.

## 3. How It Works

The GitHub Action is a thin wrapper around the ICForge CLI:

```
1. Install icforge CLI (download binary or npm install)
2. Authenticate with ICFORGE_TOKEN
3. Read icp.yaml from repo
4. Build canisters (cargo build, npm run build, etc.)
5. POST /api/v1/deploy (upload wasm + assets)
6. Poll status until complete
7. Print result (canister URLs, deploy ID)
8. Exit 0 on success, exit 1 on failure
```

### 3.1 Authentication

Users generate an API token in the dashboard (Settings page) or via CLI:

```bash
icforge token create --name "github-actions"
# → icf_tok_a1b2c3d4...
```

The token is stored as a GitHub Actions secret (`ICFORGE_TOKEN`).

### 3.2 Token format

API tokens are separate from OAuth JWTs:
- Format: `icf_tok_<random-32-chars>`
- Stored hashed in DB (`api_tokens` table)
- Scoped to a user (inherits their permissions)
- Revocable from dashboard

### 3.3 Build environment

The action runs on `ubuntu-latest`. For Rust canisters, it needs:
- Rust toolchain + `wasm32-unknown-unknown` target
- Optional: `ic-wasm` for optimization

The action can either:
- **A:** Expect the user to set up their own toolchain (simpler, more flexible)
- **B:** Provide a pre-built Docker image with IC toolchain (faster, heavier)

**Decision: Option A for v0.3.** Users add standard `actions/setup-node` or `dtolnay/rust-toolchain` steps before the deploy action. The action only handles the deploy, not the build environment.

For users who want zero-config, provide an example workflow that includes toolchain setup.

## 4. API Token System

### New table: `api_tokens`

```sql
CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  last_used_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
```

### New endpoints

```
POST /api/v1/auth/tokens
  Body: { name: "github-actions", expires_in_days: 365 }
  Returns: { token: "icf_tok_a1b2c3...", id: "...", name: "..." }
  (Token is returned ONCE, only the hash is stored)

GET /api/v1/auth/tokens
  Returns: [{ id, name, last_used_at, created_at }]

DELETE /api/v1/auth/tokens/:id
  Revoke a token
```

### Auth middleware update

The existing `AuthUser` extractor accepts `Bearer <jwt>`. Extend it to also accept `Bearer icf_tok_...` — look up the token hash in `api_tokens`, resolve to user.

## 5. Action Implementation

The action is published to GitHub Marketplace as `icforge/deploy-action`.

### action.yml

```yaml
name: 'ICForge Deploy'
description: 'Deploy canisters to the Internet Computer via ICForge'
branding:
  icon: 'upload-cloud'
  color: 'purple'

inputs:
  token:
    description: 'ICForge API token'
    required: true
  project-id:
    description: 'Project ID (reads from .icforge if not specified)'
    required: false
  canister:
    description: 'Deploy specific canister (deploys all if not specified)'
    required: false
  skip-build:
    description: 'Skip build step (deploy pre-built artifacts)'
    required: false
    default: 'false'

outputs:
  deployment-id:
    description: 'The deployment ID'
  canister-urls:
    description: 'JSON map of canister names to URLs'

runs:
  using: 'node20'
  main: 'dist/index.js'
```

### Action logic (TypeScript)

```typescript
// 1. Read inputs
// 2. Install icforge CLI (npm install -g icforge)
// 3. icforge deploy --token $TOKEN [--canister $CANISTER] [--skip-build]
// 4. Parse output, set outputs
// 5. Add deployment summary to GitHub Actions job summary
```

## 6. Implementation Checklist

### Backend
- [ ] Create `api_tokens` table migration
- [ ] Implement token CRUD endpoints
- [ ] Extend auth middleware to accept API tokens
- [ ] Hash tokens with SHA-256 before storage

### CLI
- [ ] `icforge token create` command
- [ ] `icforge token list` command
- [ ] `icforge token revoke <id>` command
- [ ] Support `--token` flag on `icforge deploy` (skip OAuth, use API token)

### GitHub Action
- [ ] Create `icforge/deploy-action` repo
- [ ] Implement action in TypeScript (uses Node.js 20 runtime)
- [ ] Test with a sample project
- [ ] Publish to GitHub Marketplace

### Dashboard
- [ ] Token management UI on Settings page
- [ ] Create/revoke tokens

### Docs
- [ ] Example workflow for frontend-only project
- [ ] Example workflow for Rust backend + frontend
- [ ] Example workflow with caching (cargo, node_modules)
