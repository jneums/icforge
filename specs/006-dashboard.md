# ICForge — Dashboard

**Status:** Mostly Complete v0.2
**Parent:** 001-architecture.md
**Milestone:** v0.2

---

## 1. Goal

Complete the web dashboard at `dashboard.icforge.dev` (or `app.icforge.dev`) so users can view projects, deployments, and canister status without the CLI.

## 2. Current State

The dashboard scaffold already exists with:
- **React + Vite + TypeScript** — built, `dist/` committed
- **Auth context** — `AuthProvider` with GitHub OAuth flow
- **Pages:**
  - `Landing` — marketing/intro page
  - `Login` — GitHub OAuth redirect
  - `Projects` — lists user's projects with status badges ✅
  - `ProjectDetail` — shows canisters table + deploy history table ✅
- **Components:** `Header` with nav
- **API client** — `fetchProjects()`, `fetchProject()` already wired

The dashboard is surprisingly functional already. The main gaps are:
1. Not deployed anywhere yet
2. No real-time deploy status
3. No canister detail view
4. No settings/account page

## 3. Hosting

### Option A: Deploy dashboard to IC (dogfood)

Deploy the dashboard as an asset canister on IC, served at a custom domain. This dogfoods ICForge itself.

### Option B: Render static site

Simple static site deploy on Render alongside the backend.

**Decision: Option A (IC canister) for launch.** It's the ultimate dogfood — ICForge's own dashboard deployed by ICForge. Use Render as a fallback if IC hosting causes issues.

**Domain:** `app.icforge.dev` pointing to the dashboard canister.

## 4. Pages to Build

### 4.1 Project Detail — Enhanced

Current page works but needs:
- [x] **Live deploy status** — if a deploy is in progress, show real-time logs (SSE from spec 005)
- [x] **Canister links** — click canister ID to open `<id>.icp0.io` in new tab
- [x] **Vanity URL** — show `<slug>.icforge.dev` link when subdomain routing is active
- [ ] **Redeploy button** — trigger a new deploy from the dashboard (stretch goal, requires backend to store wasm or trigger CI)

### 4.2 Deploy Detail Page (new)

`/projects/:id/deploys/:deployId`

Shows full deploy log for a specific deployment:
- Deploy metadata (commit, canister, status, duration)
- Full log output with timestamps and level coloring
- If in-progress: live-streaming logs via SSE

### 4.3 Account/Settings Page (new)

`/settings`

- GitHub profile info (avatar, name, email)
- IC principal (read-only)
- API token management (generate/revoke tokens for CI)
- Plan info (free tier, usage)
- Eject button (v0.3, links to spec 011)

### 4.4 Landing Page — Polish

The existing landing page needs:
- [x] Clear value prop: "Deploy to the Internet Computer in 60 seconds"
- [x] Code snippet showing the `icforge` workflow
- [ ] Link to docs (when they exist) — deferred
- [x] "Get Started" → Login flow

## 5. API Integration

### Existing endpoints (already wired)
- `GET /api/v1/auth/me` — user profile
- `GET /api/v1/projects` — project list
- `GET /api/v1/projects/:id` — project detail with canisters + deploys

### Needed endpoints
- `GET /api/v1/deploy/:id/logs` — deploy logs (exists, wire to Deploy Detail page)
- `GET /api/v1/deploy/:id/logs/stream` — SSE stream (from spec 005)
- `GET /api/v1/cycles/balance` — show in settings or project detail

## 6. Auth Flow (dashboard)

Current flow:
1. User clicks "Login" → redirected to `GET /api/v1/auth/login`
2. Backend redirects to GitHub OAuth
3. GitHub redirects back to `GET /api/v1/auth/callback`
4. Backend issues JWT, redirects to dashboard with `?token=<jwt>` query param
5. Dashboard stores JWT in localStorage, uses for API calls

This works. The callback redirect URL needs to point to the dashboard's domain (currently probably `localhost`). Update the backend's `FRONTEND_URL` config to `https://app.icforge.dev`.

## 7. Implementation Checklist

### Deployment
- [x] Dashboard deployed on Render with CI/CD (existing setup)
- [ ] ~~Deploy dashboard to IC as asset canister~~ (deferred — dogfood later if needed)
- [ ] Set up `app.icforge.dev` DNS → Render static site (or IC canister later)
- [ ] Configure `FRONTEND_URL` on backend to point to dashboard domain
- [ ] Verify OAuth callback flow works end-to-end

### New pages
- [x] Deploy Detail page (`/projects/:id/deploys/:deployId`) with SSE log streaming
- [x] Settings page (`/settings`) with profile, plan, placeholder API tokens + eject
- [x] Wire SSE log streaming to Deploy Detail page (fetch+ReadableStream with auth)

### Enhancements
- [x] Add canister ID → icp0.io links on ProjectDetail
- [x] Add vanity URL display on ProjectDetail
- [x] Polish Landing page with value prop and getting-started snippet
- [ ] Mobile responsive pass (tables → cards on small screens)
- [ ] Dark mode toggle (or respect system preference)

### API client
- [x] Add `fetchDeployLogs(deployId)` to api.ts
- [x] Add SSE client helper for log streaming (getAuthHeaders + API_URL exports)
- [x] Add `fetchCyclesBalance()` to api.ts
