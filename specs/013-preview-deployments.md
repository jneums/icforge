# ICForge — Preview Deployments

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4
**Depends on:** 008 (GitHub Actions deploy action)

---

## 1. Goal

Automatically deploy a preview environment for every pull request. Each PR gets its own set of canisters with a unique URL like `pr-42--my-dapp.icforge.dev`.

## 2. How It Works

```
Developer opens PR #42 on GitHub
    │
    ▼
GitHub Actions triggers deploy workflow (on: pull_request)
    │
    ▼
icforge deploy --preview --pr 42
    │
    ▼
Backend creates preview canisters (separate from production)
    │ Deploys wasm + assets to preview canisters
    ▼
Bot comments on PR:
  "🚀 Preview deployed: https://pr-42--my-dapp.icforge.dev"
    │
    ▼
PR merged/closed → preview canisters deleted (cycles reclaimed if possible)
```

### 2.1 Preview canister lifecycle

- **Created:** On first deploy for a PR
- **Updated:** On subsequent pushes to the PR branch
- **Deleted:** When PR is merged or closed (via webhook or GitHub Action post-step)

### 2.2 Cycles cost

Each preview creates new canisters (~1.3T cycles per canister). For projects with a frontend + backend, that's ~2.6T cycles per PR. This could get expensive.

**Mitigation strategies:**
- Only Pro/Team plans get preview deployments
- Limit concurrent previews (e.g., 5 per project on Pro, 20 on Team)
- Auto-delete previews after 7 days of inactivity
- Use a lightweight canister configuration (lower cycles allocation)

## 3. Data Model

### New table: `preview_deployments`

```sql
CREATE TABLE preview_deployments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  pr_number INTEGER NOT NULL,
  pr_branch TEXT NOT NULL,
  slug TEXT NOT NULL,  -- "pr-42--my-dapp"
  status TEXT NOT NULL DEFAULT 'active',  -- active, deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE preview_canisters (
  id TEXT PRIMARY KEY,
  preview_id TEXT NOT NULL REFERENCES preview_deployments(id),
  name TEXT NOT NULL,
  canister_id TEXT,
  canister_type TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

## 4. URL Scheme

Preview URLs follow: `pr-<number>--<project-slug>.icforge.dev`

The double dash `--` separates the PR prefix from the project slug (single dash is allowed in slugs).

The Cloudflare Worker (spec 002) needs to parse this:
```js
// "pr-42--my-dapp" → look up preview deployment
const previewMatch = slug.match(/^pr-(\d+)--(.+)$/);
if (previewMatch) {
  const [, prNumber, projectSlug] = previewMatch;
  entry = await env.ICFORGE_ROUTES.get(`preview:${projectSlug}:${prNumber}`, { type: "json" });
}
```

## 5. API Endpoints

```
POST /api/v1/deploy/preview
  Body: multipart (same as regular deploy + pr_number, pr_branch)
  Creates preview canisters if they don't exist, deploys to them

DELETE /api/v1/preview/:project_id/:pr_number
  Deletes preview canisters, reclaims cycles (best-effort)

GET /api/v1/preview/:project_id
  Lists active previews for a project
```

## 6. GitHub Integration

### PR comment

After deploying a preview, the GitHub Action posts a comment on the PR:

```markdown
### 🚀 ICForge Preview Deployment

| Canister | URL |
|----------|-----|
| frontend | [pr-42--my-dapp.icforge.dev](https://pr-42--my-dapp.icforge.dev) |
| backend  | `rrkah-fqaaa-aaaaa-aaaaq-cai` |

Deploy ID: `abc123` | [View Logs](https://app.icforge.dev/deploys/abc123)
```

### PR close webhook

When a PR is merged or closed, clean up:
- Option A: GitHub Action `on: pull_request: types: [closed]` step calls `icforge preview cleanup`
- Option B: GitHub webhook to ICForge backend triggers cleanup

**Decision: Option A** — keeps it in the Action, no webhook infrastructure needed.

## 7. Implementation Checklist

### Backend
- [ ] `preview_deployments` + `preview_canisters` tables + migration
- [ ] `POST /api/v1/deploy/preview` endpoint
- [ ] `DELETE /api/v1/preview/:project_id/:pr_number` endpoint
- [ ] `GET /api/v1/preview/:project_id` endpoint
- [ ] Preview canister creation (reuse existing deploy pipeline)
- [ ] Write preview KV entries to Cloudflare (`preview:slug:pr`)
- [ ] Cleanup: delete canisters, remove KV entries
- [ ] Auto-delete after 7 days inactivity (background job)

### Cloudflare Worker
- [ ] Parse `pr-N--slug` format
- [ ] Look up `preview:slug:N` in KV

### GitHub Action
- [ ] Add `--preview --pr ${{ github.event.pull_request.number }}` flag
- [ ] Post PR comment with preview URLs (use `actions/github-script`)
- [ ] Cleanup step on PR close

### CLI
- [ ] `icforge deploy --preview --pr <number>` flag
- [ ] `icforge preview list` — list active previews
- [ ] `icforge preview cleanup --pr <number>` — delete preview

## 8. Open Questions

1. **Cycles reclamation:** Can you delete a canister and get cycles back? IC supports `delete_canister` but cycles are lost. Consider stopping canisters instead (frozen but recoverable).
2. **Init args for previews:** Backend canisters may need different init args for preview (e.g., pointing to a test database). How does the user configure this?
3. **Environment-specific config:** Previews may need different environment variables than production. Support an `environments` section in icp.yaml?
