# ICForge — Architecture & Design Spec

**Status:** Active v0.3 (v0.1–v0.2.1 complete, v0.3 in progress)
**Authors:** Jesse Neumann
**Date:** 2026-04-02

---

## 1. Problem Statement

The Internet Computer (IC) has powerful on-chain hosting capabilities, but deploying to mainnet has a brutal onboarding cliff:

1. Install `icp-cli` and learn IC-specific concepts (principals, canisters, cycles)
2. Generate a cryptographic identity
3. Acquire ICP tokens (requires exchange account, KYC, transfer)
4. Convert ICP → cycles via the cycles ledger
5. Create canisters, deploy wasm, sync assets
6. Manually monitor cycles and top-up before canisters freeze

DFINITY's new AI skills (`dfinity/icskills`) make it easy to **build** IC apps with coding agents, but users hit a wall at deployment. The gap between "code works locally" and "live on mainnet" is where developers abandon IC.

**Fleek**, the only previous "Netlify for IC" product, **shut down IC hosting on Jan 31, 2026** and pivoted to AI. The market is wide open.

## 2. Vision

ICForge is a **PaaS for the Internet Computer**. Deploy to IC like you deploy to Netlify or Vercel:

```bash
npx icforge login     # OAuth in browser
npx icforge init      # Set up project
npx icforge deploy    # Ship it 🚀
# → https://myapp.icforge.dev is live
```

**No crypto wallet. No ICP tokens. No cycles management. Just deploy.**

## 3. Target Users

1. **Web developers using AI agents** — Built an IC app with Claude Code + icskills, need to ship it
2. **Web2 developers exploring IC** — Know React/Node, don't want to learn blockchain tooling
3. **Teams with existing IC projects** — Want managed hosting, CI/CD, and billing instead of DIY

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Developer Machine                         │
│                                                                  │
│  ┌────────────────────┐    ┌──────────────────────────────────┐  │
│  │  icforge CLI    │    │  Project Source                  │  │
│  │  (TypeScript/npm)  │    │  - icp.yaml                     │  │
│  │                    │    │  - src/ (Motoko, Rust, or JS)    │  │
│  │  Commands:         │    │  - icforge.json (project cfg) │  │
│  │  - login           │    └──────────────────────────────────┘  │
│  │  - init            │                                          │
│  │  - deploy ─────────┼──── Build locally (optional) ───────┐   │
│  │  - status          │                                      │   │
│  │  - logs            │    Upload .wasm + assets             │   │
│  └────────────────────┘                                      │   │
│                                                              │   │
└──────────────────────────────────────────────────────────────┼───┘
                                                               │
                            HTTPS API                          │
                                                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      ICForge Backend (Rust)                   │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │  Auth     │  │  Deploy  │  │  Billing │  │  Identity      │  │
│  │  Service  │  │  Pipeline│  │  Service │  │  Manager       │  │
│  │          │  │          │  │          │  │                │  │
│  │  OAuth2   │  │  Receive │  │  Stripe  │  │  Per-user IC   │  │
│  │  GitHub   │  │  wasm    │  │  subs    │  │  identity gen  │  │
│  │  Google   │  │  Install │  │  metering│  │  Key custody   │  │
│  │  tokens   │  │  Upgrade │  │  invoices│  │  Export flow   │  │
│  └──────────┘  │  Sync    │  └──────────┘  └────────────────┘  │
│                └────┬─────┘                                      │
│                     │                                            │
│  ┌─────────────────┐│  ┌──────────────────────────────────────┐  │
│  │  Cycles Pool    ││  │  Database (PostgreSQL)                │  │
│  │                 ││  │                                      │  │
│  │  Bulk ICP buy   ││  │  - Users & auth tokens               │  │
│  │  ICP → cycles   ├┘  │  - Projects & canister mappings      │  │
│  │  Auto top-up    │   │  - Deployments & logs                │  │
│  │  Balance track  │   │  - Billing records                   │  │
│  └────────┬────────┘   └──────────────────────────────────────┘  │
│           │                                                      │
└───────────┼──────────────────────────────────────────────────────┘
            │
            │  ic-agent (Rust crate)
            ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Internet Computer (Mainnet)                    │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Management   │  │  Cycles      │  │  User Canisters      │   │
│  │  Canister     │  │  Ledger      │  │                      │   │
│  │              │  │              │  │  - Frontend assets    │   │
│  │  create_can  │  │  mint cycles │  │  - Backend logic      │   │
│  │  install_code│  │  top_up      │  │  - <slug>.icp0.io     │   │
│  │  canister_   │  │  balance     │  │                      │   │
│  │    status    │  │              │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Component Details

### 5.1 CLI (`cli/` — TypeScript)

**Why TypeScript:** npm ecosystem = `npx icforge` just works. Familiar to target users. Fast iteration on UX.

**Commands:**

| Command | Description |
|---------|-------------|
| `icforge login` | Open browser for OAuth, save token locally |
| `icforge init` | Create `icforge.json`, detect framework, link project |
| `icforge deploy` | Build locally → upload artifacts → trigger deploy |
| `icforge status` | Show project status, canister info, cycles usage |
| `icforge logs` | Stream deployment and runtime logs |
| `icforge env` | Manage environment variables for canisters |
| `icforge whoami` | Show current user and linked project |
| `icforge link` | Link existing IC canister to ICForge |
| `icforge eject` | Transfer canister control to your own IC identity |

**Auth Flow:**
```
1. CLI starts local HTTP server on random port
2. Opens browser to: https://app.icforge.dev/auth?redirect=http://localhost:{port}/callback
3. User authenticates (GitHub OAuth or email)
4. Browser redirects to local server with auth code
5. CLI exchanges code for access + refresh tokens
6. Tokens saved to ~/.config/icforge/credentials.json
7. CLI confirms: "Logged in as jesse@example.com"
```

**Deploy Flow:**
```
1. Read .icforge for project ID
2. Read icp.yaml for canister definitions, build recipes, and config
3. For each canister (or subset specified in .icforge):
   a. Run build via icp-cli recipe (e.g., `icp build <name>`)
   b. Collect artifacts (.wasm, .did, asset files)
   c. Upload to ICForge API (multipart, chunked for large assets)
4. API returns deployment ID + status URL
5. CLI streams logs from status URL via SSE
6. On completion: print canister URL
```

**Config Philosophy: `icp.yaml` is the source of truth.**

ICForge reads canister definitions, build recipes, and project structure directly
from the developer's existing `icp.yaml`. No duplication. ICForge only stores a
thin link file for its own concerns:

**`.icforge` (project link file):**
```json
{
  "projectId": "proj_abc123"
}
```

**Optional fields in `.icforge`:**
```json
{
  "projectId": "proj_abc123",
  "canisters": ["frontend", "backend"],
  "subdomain": "myapp"
}
```

- `canisters` — whitelist of canisters to deploy (default: all from icp.yaml)
- `subdomain` — custom subdomain override for `<slug>.icforge.dev`

**icp.yaml (already exists — created by `icp new`):**
```yaml
canisters:
  - name: frontend
    recipe:
      type: "@dfinity/asset-canister@v1.0.0"
    source: dist/

  - name: backend
    recipe:
      type: "@dfinity/rust@v3.0.0"
      configuration:
        package: my-backend

environments:
  - name: ic
```

ICForge detects canister types from recipes: `asset-canister` → frontend,
`rust`/`motoko` → backend. Zero config needed from the developer beyond
`icforge init` to link their project.

### 5.2 Backend (`backend/` — Rust)

**Why Rust:**
- DFINITY's `ic-agent` crate is the first-party Rust SDK for IC interaction
- Axum is production-grade and async-native
- Same language as IC canisters (Rust backend devs = IC Rust devs)

**API Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/auth/login` | Initiate GitHub OAuth flow |
| GET | `/api/v1/auth/callback` | OAuth callback handler |
| GET | `/api/v1/auth/me` | Current user info |
| GET | `/api/v1/projects` | List user's projects |
| POST | `/api/v1/projects` | Create project |
| GET | `/api/v1/projects/:id` | Get project details (with canisters + latest deploy) |
| GET | `/api/v1/deploy/:id/status` | Deployment status |
| GET | `/api/v1/deploy/:id/logs` | Deployment logs (JSON) |
| GET | `/api/v1/deploy/:id/logs/stream` | Stream deployment logs (SSE) |
| GET | `/api/v1/cycles/balance` | Cycles balance for current user |
| GET | `/api/v1/canisters/:id/env` | Canister environment variables |
| GET | `/api/v1/tokens` | List API tokens |
| POST | `/api/v1/tokens` | Create API token |
| DELETE | `/api/v1/tokens/:id` | Delete API token |
| GET | `/api/v1/deployments` | List deployments (filterable by project) |
| POST | `/api/v1/deployments` | Trigger a deployment |
| GET | `/api/v1/deployments/:id` | Get deployment detail |
| GET | `/api/v1/github/installations` | List GitHub App installations |
| POST | `/api/v1/github/installations/claim` | Claim a GitHub installation |
| GET | `/api/v1/github/repos` | List repos from GitHub installations |
| GET | `/api/v1/github/repos/:id/config` | Fetch repo icp.yaml config |
| POST | `/api/v1/github/link` | Link a GitHub repo to a project |
| POST | `/api/v1/webhooks/github` | GitHub webhook handler (signature-verified, no auth) |

**Deploy Pipeline (server-side):**
```
1. Receive .wasm + .did + assets from CLI
2. Validate artifacts (wasm magic bytes, size limits)
3. Use platform IC identity (single identity for all deploys)
4. Check cycles pool balance, auto-top-up if needed
5. If new canister:
   a. Call management canister: create_canister()
   b. Record canister ID in database
6. Call management canister: install_code(wasm, mode=Install|Upgrade)
7. For asset canisters: sync assets via asset canister API
8. Verify deployment: canister_status()
9. Update database, emit logs via SSE
10. Return canister URL
```

### 5.3 Platform Identity Model

ICForge uses a **single platform IC identity** for all canister operations. Users do not have individual IC identities — ICForge abstracts away the IC layer entirely.

**How it works:**
- One Ed25519 identity configured via `IC_IDENTITY_PEM` environment variable
- This identity is the sole controller of all canisters created through ICForge
- Users interact with projects, not canisters or identities
- No per-user key generation, encryption, or custody

**Eject flow (escape hatch):**
- User provides their own IC principal (from `dfx`, `icp-cli`, or any IC wallet)
- ICForge adds their principal as controller of their project's canisters
- ICForge removes its own principal as controller
- User now has full self-custody — ICForge can no longer manage those canisters
- This is a one-way operation; re-linking requires `icforge link`

### 5.4 Cycles Pool

ICForge maintains a pool of cycles funded by bulk ICP purchases.

**Economics:**
- Buy ICP in bulk (OTC or exchange) at market rate
- Convert to cycles via cycles ledger
- 1T cycles ≈ $1.35 USD (pegged to XDR)
- Charge users monthly subscription that covers typical usage + margin

**Auto Top-up:**
- Background job monitors all managed canisters
- When cycles balance < threshold → top up from pool
- Threshold = 2x estimated monthly burn rate
- Alert user if burn rate exceeds plan limits

### 5.5 Dashboard (`dashboard/`)

**Tech:** React + Vite + TypeScript, shadcn/ui component library, Tailwind CSS v4

**Pages:**
- `/` — Landing page & marketing
- `/login` — OAuth flow (GitHub)
- `/projects` — Project list with deploy status cards
- `/projects/new` — Create new project (connect GitHub repo)
- `/projects/:id` — Project detail: latest push card, tabbed canisters + deploys
- `/projects/:id/deploys/:deployId` — Deploy logs (real-time SSE)
- `/settings` — Account info, API tokens
- `*` — 404 Not Found

## 6. Pricing Model (Draft)

| Plan | Price | Canisters | Cycles Budget | Features |
|------|-------|-----------|---------------|----------|
| **Free** | $0/mo | 1 frontend | 0.5T/mo (~$0.68) | Deploy, custom subdomain |
| **Dev** | $7/mo | 3 any type | 5T/mo (~$6.75) | CI/CD, custom domain, logs |
| **Pro** | $29/mo | 10 any type | 25T/mo (~$33.75) | Priority deploys, team access |
| **Enterprise** | Custom | Unlimited | Custom | SLA, dedicated support, SSO |

**Overage:** $1.50 per 1T cycles beyond plan allocation (at-cost + 11% margin).

**Key insight:** Frontend canisters cost almost nothing (~$1-5/year). The free tier is essentially free to operate. Backend canisters with heavy compute (HTTPS outcalls, polling) can burn $6/day — these users self-select into Pro/Enterprise.

## 7. CI/CD — Managed Build Pipeline

**GitHub App integration — zero-config deploys on every push.**

User clicks "Connect Repository" in the dashboard, installs the ICForge GitHub App, and selects repos. Every push to the production branch triggers a server-side build and deploy automatically.

**How it works:**
1. GitHub sends `push` webhook to ICForge API
2. Deployment record is enqueued in Postgres (`status = 'queued'`)
3. Deploy worker claims the job, clones the repo (via GitHub installation token)
4. Builds canisters using icp-cli recipes from `icp.yaml`
5. Deploys artifacts to IC via `icp deploy`
6. Posts commit status + check run back to GitHub

**Builds run server-side** in the ICForge build worker — no user CI configuration needed.
Users don't write workflow YAML or manage secrets. Connect repo → push → deployed.

**Preview Deployments (spec 013):**
- On PR open/update: build + deploy to preview canisters
- Comment on PR with preview URL
- On PR merge/close: cleanup preview canisters

**Manual deploys:** Still supported via CLI with API tokens for users who want CI control.

See: 008-github-app.md, 008-build-pipeline.md, 008-status-feedback.md

## 8. Custom Domains

**Subdomain (automatic):**
- Every project gets `<slug>.icforge.dev`
- ICForge runs a reverse proxy that maps subdomain → `<canister-id>.icp0.io`

**Custom domain (Dev+ plans):**
- User adds CNAME record: `app.example.com → custom.icforge.dev`
- ICForge provisions TLS certificate (Let's Encrypt)
- Proxy routes custom domain → canister

**IC native domains (future):**
- Register custom domain directly with IC boundary nodes
- Requires DNS TXT record with canister ID
- ICForge automates the 3-step IC domain registration process

## 9. Cloud Engine Vision (Future)

ICForge is built for **public subnets today**, but architected to support **ICP Cloud Engines tomorrow**.

### What Are Cloud Engines?

Cloud Engines (introduced in DFINITY's Mission 70 initiative, NNS Proposal 140888) are configurable, application-specific execution environments on ICP. Each Cloud Engine is a **private subnet** owned and controlled by a person, organization, or SNS DAO. Owners select the exact nodes powering their engine by geographic region, jurisdiction, and hardware provider — enabling sovereign, GDPR-compliant, multi-cloud-portable infrastructure.

Key properties:
- **Private subnet** — no co-hosting, no noisy neighbors
- **Node selection** — pick nodes by region (EU-only), jurisdiction (Swiss-only), or provider (Amazon, Google, sovereign hardware)
- **Configurable replication** — default 7x, adjustable for CDN-like query scaling
- **Elastic scaling** — add nodes to scale, no code changes
- **Multi-cloud portability** — migrate between infrastructure providers without interrupting running applications
- **80/20 economics** — 80% of revenue to node providers, 20% auto-buys and burns ICP

### How ICForge Fits

ICForge becomes the **deployment and management layer** that abstracts away infrastructure complexity — whether that infrastructure is a shared public subnet or the customer's own Cloud Engine:

```
Developer Experience (unchanged):
  icforge deploy          # same command, always

Infrastructure Target (configured once):
  Free/Dev  → public subnet (IC-selected, shared)
  Pro       → public subnet (user-selected region)
  Enterprise → customer's Cloud Engine (private, sovereign)
```

The developer doesn't think about infrastructure on every deploy. They configure their target once in the dashboard or `icforge.json`, and `icforge deploy` does the right thing.

### Architecture Seeds (planted now, built later)

Several current design decisions anticipate Cloud Engine support:

1. **Subnet selection (v0.3):** The `.icforge` config already plans for user-specified subnet targeting. This is the exact hook where Cloud Engine IDs plug in.

2. **Platform identity:** Cloud Engine owners control who can deploy to their engine. ICForge's platform identity gets authorized on the target engine — no per-user identity management needed.

3. **`.icforge` config extension (future):**
```json
{
  "projectId": "proj_abc123",
  "target": {
    "type": "cloud-engine",
    "engineId": "engine_xyz789",
    "region": "eu-west"
  }
}
```

4. **Billing model fork:** Public subnet deployments use ICForge's cycles pool (current model). Cloud Engine deployments bill differently — the engine owner funds cycles directly via the 80/20 node provider model. ICForge would charge a platform/management fee rather than reselling cycles.

### Strategic Position

**Today:** ICForge fills the gap Fleek left — simple PaaS for indie devs and AI-agent builders on public subnets.

**Tomorrow:** ICForge becomes the deployment UX layer for Cloud Engine operators — the "Netlify that targets your own sovereign cloud hardware." Nobody else can tell this story:

- Netlify/Vercel can't offer decentralized sovereign compute
- AWS can't offer tamper-proof infrastructure
- Raw ICP tooling can't offer `npx icforge deploy`

The progression is natural: start free on shared infra, graduate to your own Cloud Engine when the business demands it.

## 10. Security Considerations

- **Platform identity:** Single IC identity stored as environment variable on the backend; never exposed to users
- **Blast radius:** Platform identity controls all canisters, so backend security is critical — defense in depth with network isolation, secret management, and audit logging
- **Auth tokens:** Short-lived access tokens (1h) + long-lived refresh tokens (30d)
- **API:** Rate limiting, request size limits (wasm max 2MB per IC spec, assets chunked)
- **Audit log:** All deploy operations logged with timestamps and actor
- **Eject escape hatch:** Users can transfer canister control to their own principal and leave ICForge entirely

## 11. Tech Stack Summary

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| CLI | TypeScript, Commander | npm ecosystem, `npx` distribution |
| Backend API | Rust, Axum | ic-agent crate, async-native |
| Database | PostgreSQL | Render managed Postgres |
| Auth | OAuth2 (GitHub) | Familiar to developers |
| Billing | Stripe (planned) | Industry standard, subscription + metering |
| IC Agent | `ic-agent` Rust crate | First-party DFINITY SDK |
| Dashboard | React (Vite) on IC canister | Dogfood our own product |
| Backend Hosting | Render.com | Existing account, simple deploy |
| CI/CD | Managed build pipeline (GitHub App) | Server-side builds triggered by push webhook. See 008-github-app.md, 008-build-pipeline.md |
| Cycles Funding | cycles.express (initial) | Credit card → cycles, no exchange needed |

## 12. Milestones

### v0.1 — "Hello World Deploy" (MVP) ✅ COMPLETE
- [x] CLI: login, init, deploy commands working
- [x] Backend: OAuth, single platform identity deploy, single frontend canister deploy
- [x] Deploy a static HTML/JS site to IC mainnet via `icforge deploy`
- [x] Return `<canister-id>.icp0.io` URL

### v0.2 — "Real Projects" ✅ COMPLETE
- [x] Backend canister support (Rust + Motoko) — see 003
- [x] Multi-canister projects — see 004
- [x] GitHub App + managed build pipeline (server-side builds on push) — see 008-github-app, 008-build-pipeline
- [x] Deploy status + log streaming — see 005
- [x] Dashboard: project list, deploy history, deploy detail w/ SSE logs — see 006
- [x] Environment variable binding (PUBLIC_CANISTER_ID:* via update_settings → ic_env cookie)
- [x] `icforge.dev` subdomain routing — see 002
- [x] Dashboard production deploy (icforge.dev)

### v0.2.1 — "UX Polish" ✅ COMPLETE
- [x] Tailwind v4 + shadcn/ui setup — see 019/00 ✅
- [x] Design system cleanup (CSS tokens, typography, component primitives) — see 019/01 ✅
- [x] Sidebar navigation + breadcrumbs — see 019/02 ✅
- [x] Project list redesign (card rows, loading/empty states) — see 019/03 ✅
- [x] Project detail redesign (LatestPushCard, tabs, Visit button, vanity URL, build duration) — see 019/04 ✅
- [x] Deploy detail improvements (viewport log viewer, line numbers, build duration) — see 019/05 ✅
- [~] Settings page polish — see 019/06 (~95%: minor — no GitHub @username link)
- [x] Landing page refresh — see 019/07 ✅
- [x] Technical debt (protected routes, error boundary, 404, skeletons) — see 019/08 ✅
- [x] Data layer (api/ → hooks/ → components, TanStack Query, SSE stream hook, mutation hooks) — see 019/09 ✅

### v0.3 — "Production Ready"
- [ ] Stripe billing integration — see 007
- [ ] GitHub commit statuses + check runs on PRs — see 008-status-feedback
- [x] API tokens for machine-to-machine auth — see 008-status-feedback
- [ ] Custom domain support — see 009
- [ ] Cycles monitoring + auto top-up alerts — see 010
- [ ] Canister eject flow (transfer control to user's principal) — see 011
- [ ] Subnet selection (in icp.yaml or dashboard) — see 012
- [x] Unify build_jobs + deployments into single table — see 021 ✅
- [x] icp-cli migration — delegate build/deploy/sync to icp-cli — see 020 ✅

### v0.4 — "Growth"
- [ ] Preview deployments on PRs — see 013
- [ ] Team/org accounts — see 014
- [ ] Framework auto-detection and zero-config deploy — see 015
- [ ] `icforge link` for existing canisters — see 016
- [ ] Canister metrics dashboard (cycles burn rate, memory usage, call volume) — see 017
- [ ] Log aggregation — collect and persist canister logs beyond IC's ~20 line window — see 018

### v0.5 — "Cloud Engines"
- [ ] Cloud Engine targeting — deploy to a specific engine via `.icforge` config or dashboard
- [ ] Engine discovery — list available Cloud Engines the user has access to
- [ ] Engine-aware authorization — register ICForge platform identity with target engine
- [ ] Dual billing model — cycles pool for public subnets, platform fee for Cloud Engine deploys
- [ ] Region/jurisdiction display — show node geography and compliance metadata in dashboard
- [ ] Migration path — move existing project from public subnet to Cloud Engine without redeploying from scratch

## 13. Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Build location** | Server-side (ICForge build worker) | Managed Docker containers on Render. Clone repo via GitHub App, auto-detect framework, build + deploy. No user CI config needed. |
| **Dashboard framework** | React (Vite), hosted on IC canister | Dogfood our own product. No SSR needed for a dashboard. |
| **Backend hosting** | Render.com | Jesse has existing account. Simple Rust deploy. |
| **Cycles acquisition** | cycles.express (initial) | Credit card → cycles without needing an exchange. Evaluate bulk OTC later at scale. |
| **Breaking upgrades** | Let them fail, surface error to user | Motoko compiler already rejects incompatible upgrades. Rust is less strict but the IC management canister returns an error. Surface the error clearly in deploy logs. |
| **Subnet selection** | User-configurable in .icforge or dashboard | Optional field, defaults to IC-selected subnet. Power users can pin to specific subnets. Generalizes naturally to Cloud Engine targeting in v0.5. |
| **Rate limiting** | Defer to later | Not a priority until there's meaningful traffic. |
| **Canister metrics** | Yes, planned for v0.4 | Expose cycles burn rate, memory usage, call volume via dashboard. |

## 14. Open Questions

1. **Log aggregation architecture:** IC exposes ~20 lines of canister logs with a very short retention window. To provide useful logging, ICForge needs to poll/collect logs and store them. Options: (a) background job polling canister logs via `icp canister logs`, (b) users add a logging library that pushes to ICForge, (c) intercept logs at the boundary node level. Need to research IC logging APIs.
2. **cycles.express reliability:** Is it suitable for automated/programmatic purchases, or is it manual-only? Need to check if they have an API.
3. **Identity backup/recovery:** If ICForge goes down, users need their keys. Should we require email-based key escrow at signup?
4. **Free tier abuse:** How do we prevent spam canister creation on the free tier?
5. **Cloud Engine API surface:** DFINITY hasn't published Cloud Engine management APIs yet. ICForge's v0.5 depends on programmatic access to: engine creation/discovery, node selection, identity authorization, and billing integration. Need to track DFINITY's Cloud Engine SDK/API development.
6. **Cloud Engine billing model:** How does ICForge charge for Cloud Engine deploys? Options: (a) flat platform fee per project, (b) percentage of engine spend, (c) per-deploy fee. The cycles pool model doesn't apply since engine owners fund cycles directly via the 80/20 model.
7. **Caffeine overlap:** Caffeine.ai (DFINITY's AI coding platform) can build AND deploy to IC. If Caffeine's deploy story matures, how does ICForge differentiate? Likely answer: ICForge is the "production/CI/CD" path for serious projects vs. Caffeine's "vibe coding" path — but need to monitor this.
8. **Cloud Engine canister migration:** Can an existing canister on a public subnet be migrated to a Cloud Engine without losing state? If not, ICForge needs a migration workflow (deploy fresh + data export/import). Need to research IC canister migration primitives.
