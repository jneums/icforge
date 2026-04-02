# ICForge — Architecture & Design Spec

**Status:** Draft v0.1
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
│  │  Cycles Pool    ││  │  Database (SQLite → Postgres)        │  │
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
│  │  install_code│  │  top_up      │  │  - <slug>.ic0.app     │   │
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
| `icforge export-keys` | Export custodial identity (escape hatch) |

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
- Custodial key management demands memory safety
- Axum is production-grade and async-native
- Same language as IC canisters (Rust backend devs = IC Rust devs)

**API Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/auth/callback` | OAuth callback handler |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| GET | `/api/v1/user` | Current user info |
| POST | `/api/v1/projects` | Create project |
| GET | `/api/v1/projects` | List user's projects |
| GET | `/api/v1/projects/:id` | Get project details |
| POST | `/api/v1/deploy` | Upload artifacts + trigger deploy |
| GET | `/api/v1/deploy/:id/status` | Deployment status |
| GET | `/api/v1/deploy/:id/logs` | Stream deployment logs (SSE) |
| POST | `/api/v1/billing/subscribe` | Create Stripe subscription |
| GET | `/api/v1/billing/usage` | Cycles usage & cost breakdown |
| POST | `/api/v1/identity/export` | Export user's IC private key |

**Deploy Pipeline (server-side):**
```
1. Receive .wasm + .did + assets from CLI
2. Validate artifacts (wasm magic bytes, size limits)
3. Look up user's custodial IC identity
4. Check cycles balance, auto-top-up if needed
5. If new canister:
   a. Call management canister: create_canister()
   b. Record canister ID in database
6. Call management canister: install_code(wasm, mode=Install|Upgrade)
7. For asset canisters: sync assets via asset canister API
8. Verify deployment: canister_status()
9. Update database, emit logs via SSE
10. Return canister URL
```

### 5.3 Identity Manager

Each ICForge user gets a **custodial IC identity** generated server-side.

**Key Management:**
- Identity = Ed25519 keypair (same as icp-cli generates)
- Private keys encrypted at rest (AES-256-GCM, key from HSM/KMS in production)
- One identity per user account
- ICForge's principal is set as controller of all user canisters
- User's principal is added as secondary controller (enables future self-custody)

**Export Flow:**
- User requests key export via CLI or dashboard
- Require re-authentication (password or OAuth re-consent)
- Generate PEM file compatible with `icp identity import`
- After export, user can add their own controller and remove ICForge's

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

**Tech:** TBD — Next.js or SvelteKit

**Pages:**
- `/` — Landing page & marketing
- `/login` — OAuth flow
- `/projects` — Project list with deploy status
- `/projects/:id` — Project detail: canisters, deploys, settings
- `/projects/:id/deployments/:deployId` — Deploy logs (real-time)
- `/billing` — Subscription, usage, payment methods
- `/settings` — Account, identity export, API keys

## 6. Pricing Model (Draft)

| Plan | Price | Canisters | Cycles Budget | Features |
|------|-------|-----------|---------------|----------|
| **Free** | $0/mo | 1 frontend | 0.5T/mo (~$0.68) | Deploy, custom subdomain |
| **Dev** | $7/mo | 3 any type | 5T/mo (~$6.75) | CI/CD, custom domain, logs |
| **Pro** | $29/mo | 10 any type | 25T/mo (~$33.75) | Priority deploys, team access |
| **Enterprise** | Custom | Unlimited | Custom | SLA, dedicated support, SSO |

**Overage:** $1.50 per 1T cycles beyond plan allocation (at-cost + 11% margin).

**Key insight:** Frontend canisters cost almost nothing (~$1-5/year). The free tier is essentially free to operate. Backend canisters with heavy compute (HTTPS outcalls, polling) can burn $6/day — these users self-select into Pro/Enterprise.

## 7. CI/CD — GitHub Actions Integration

**GitHub Action: `icforge/deploy-action`**

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
      - uses: icforge/deploy-action@v1
        with:
          project-id: ${{ secrets.ATLASCLOUD_PROJECT_ID }}
          token: ${{ secrets.ATLASCLOUD_TOKEN }}
```

**How it works:**
1. Action installs `icp-cli` and project dependencies
2. Authenticates with ICForge via service token (not OAuth — machine-to-machine)
3. Runs `icp build` to compile canisters (using icp.yaml recipes)
4. Uploads .wasm + .did + asset artifacts to ICForge API
5. Streams deploy logs in GitHub Actions output
6. Fails the workflow if deploy fails

**Build in CI:** All builds happen in GitHub Actions using `icp-cli` directly.
The action installs the IC SDK, runs `icp build`, and uploads artifacts to ICForge.
No proprietary build system needed — we piggyback on icp-cli's recipe system.

**Preview Deployments (future):**
- On PR open/update: deploy to a preview canister
- Comment on PR with preview URL
- On PR merge: promote to production canister
- On PR close: delete preview canister

## 8. Custom Domains

**Subdomain (automatic):**
- Every project gets `<slug>.icforge.dev`
- ICForge runs a reverse proxy that maps subdomain → `<canister-id>.ic0.app`

**Custom domain (Dev+ plans):**
- User adds CNAME record: `app.example.com → custom.icforge.dev`
- ICForge provisions TLS certificate (Let's Encrypt)
- Proxy routes custom domain → canister

**IC native domains (future):**
- Register custom domain directly with IC boundary nodes
- Requires DNS TXT record with canister ID
- ICForge automates the 3-step IC domain registration process

## 9. Security Considerations

- **Key custody:** Private keys encrypted at rest, accessed only during deploy operations
- **Blast radius:** Each user has isolated identity — compromise of one user doesn't affect others
- **Auth tokens:** Short-lived access tokens (1h) + long-lived refresh tokens (30d)
- **API:** Rate limiting, request size limits (wasm max 2MB per IC spec, assets chunked)
- **Audit log:** All deploy operations logged with timestamps and actor
- **Export escape hatch:** Users can always export keys and take full ownership

## 10. Tech Stack Summary

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| CLI | TypeScript, Commander | npm ecosystem, `npx` distribution |
| Backend API | Rust, Axum | ic-agent crate, memory safety for keys |
| Database | SQLite → PostgreSQL | Start simple, migrate when needed |
| Auth | OAuth2 (GitHub, Google) | Familiar to developers |
| Billing | Stripe | Industry standard, subscription + metering |
| IC Agent | `ic-agent` Rust crate | First-party DFINITY SDK |
| Dashboard | React (Vite) on IC canister | Dogfood our own product |
| Backend Hosting | Render.com | Existing account, simple deploy |
| CI/CD | GitHub Actions + `icp-cli` | Builds use IC SDK directly |
| Cycles Funding | cycles.express (initial) | Credit card → cycles, no exchange needed |

## 11. Milestones

### v0.1 — "Hello World Deploy" (MVP)
- [ ] CLI: login, init, deploy commands working
- [ ] Backend: OAuth, identity generation, single frontend canister deploy
- [ ] Deploy a static HTML/JS site to IC mainnet via `icforge deploy`
- [ ] Return `<canister-id>.ic0.app` URL

### v0.2 — "Real Projects"
- [ ] Backend canister support (Rust + Motoko)
- [ ] Multi-canister projects
- [ ] `icforge.dev` subdomain routing
- [ ] Deploy status + log streaming
- [ ] Dashboard: project list, deploy history

### v0.3 — "Production Ready"
- [ ] Stripe billing integration
- [ ] GitHub Actions deploy action (builds with `icp-cli` in CI)
- [ ] Custom domain support
- [ ] Cycles monitoring + auto top-up alerts
- [ ] Identity export flow
- [ ] Subnet selection (in .icforge or dashboard)

### v0.4 — "Growth"
- [ ] Preview deployments on PRs
- [ ] Team/org accounts
- [ ] Framework auto-detection and zero-config deploy
- [ ] `icforge link` for existing canisters
- [ ] Canister metrics dashboard (cycles burn rate, memory usage, call volume)
- [ ] Log aggregation — collect and persist canister logs beyond IC's ~20 line window

## 12. Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Build location** | GitHub Actions with `icp-cli` | No proprietary build infra needed. `icp build` in CI using recipes from icp.yaml. CLI can also build locally for `icforge deploy`. |
| **Dashboard framework** | React (Vite), hosted on IC canister | Dogfood our own product. No SSR needed for a dashboard. |
| **Backend hosting** | Render.com | Jesse has existing account. Simple Rust deploy. |
| **Cycles acquisition** | cycles.express (initial) | Credit card → cycles without needing an exchange. Evaluate bulk OTC later at scale. |
| **Breaking upgrades** | Let them fail, surface error to user | Motoko compiler already rejects incompatible upgrades. Rust is less strict but the IC management canister returns an error. Surface the error clearly in deploy logs. |
| **Subnet selection** | User-configurable in .icforge or dashboard | Optional field, defaults to IC-selected subnet. Power users can pin to specific subnets. |
| **Rate limiting** | Defer to later | Not a priority until there's meaningful traffic. |
| **Canister metrics** | Yes, planned for v0.4 | Expose cycles burn rate, memory usage, call volume via dashboard. |

## 13. Open Questions

1. **Log aggregation architecture:** IC exposes ~20 lines of canister logs with a very short retention window. To provide useful logging, ICForge needs to poll/collect logs and store them. Options: (a) background job polling canister logs via `icp canister logs`, (b) users add a logging library that pushes to ICForge, (c) intercept logs at the boundary node level. Need to research IC logging APIs.
2. **cycles.express reliability:** Is it suitable for automated/programmatic purchases, or is it manual-only? Need to check if they have an API.
3. **Identity backup/recovery:** If ICForge goes down, users need their keys. Should we require email-based key escrow at signup?
4. **Free tier abuse:** How do we prevent spam canister creation on the free tier?
