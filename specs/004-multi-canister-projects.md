# ICForge — Multi-Canister Projects

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.2

---

## 1. Goal

Support projects with multiple canisters that are deployed together as a unit. A typical IC dapp has a frontend asset canister + one or more backend canisters. ICForge should deploy all of them in a single `icforge deploy` invocation and manage their lifecycle together.

## 2. Current State

- The DB schema already supports multiple canisters per project (`canisters` table has `project_id` FK)
- `icp.yaml` already lists multiple canisters
- `icforge init` already sends all canisters to the `create_project` endpoint
- **BUT** `icforge deploy` currently deploys a single canister per invocation (hardcoded to the first canister)
- The deploy endpoint accepts `canister_name` to identify which canister to deploy

## 3. Design

### 3.1 Deployment model: atomic project deploys

When a user runs `icforge deploy`, ALL canisters in the project are built and deployed:

```
icforge deploy
  ├── Build backend canister (Rust/Motoko)
  ├── Build frontend canister (assets)
  ├── Upload all wasm/asset bundles to backend
  └── Backend deploys all canisters (with dependency ordering)
```

The deploy is **project-level**, not canister-level. This matches what users expect — "deploy my app" not "deploy canister #3".

### 3.2 Deploy API changes

**Option A: Multiple sequential deploy calls**
CLI makes one `POST /api/v1/deploy` per canister. Simple, but no atomicity.

**Option B: Single batch deploy endpoint**
New endpoint `POST /api/v1/deploy/batch` that accepts all canisters at once.

**Decision: Option A (sequential) for v0.2.** Simpler to implement, and atomicity isn't critical yet — if canister 2/3 fails, canister 1 is still live (which is fine, it was live before too). The CLI handles the orchestration.

### 3.3 Dependency ordering

Canisters may depend on each other. The frontend often needs to know the backend's canister ID (for API calls). Ordering matters:

1. Deploy backend canisters first → get their canister IDs
2. Inject canister IDs into frontend build (environment variables or config)
3. Build and deploy frontend canister

`icp.yaml` supports this via a `dependencies` field:

```yaml
canisters:
  - name: backend
    type: rust
    path: ./backend

  - name: frontend
    type: assets
    source: ./dist
    build: "npm run build"
    dependencies:
      - backend  # deployed before frontend
```

The CLI builds a dependency graph (topological sort) and deploys in order. Circular dependencies are rejected at `init` time.

### 3.4 Canister ID injection

After deploying backend canisters, the CLI needs to make their canister IDs available to subsequent builds. Options:

1. **Environment variables:** Set `CANISTER_ID_BACKEND=xh5m6-...` before running the frontend build command
2. **JSON file:** Write `.icforge/canister_ids.json` that the frontend can import
3. **Both:** Write the JSON file AND set env vars

**Decision: Both.** The JSON file is the primary mechanism (can be imported at build time), env vars are a convenience.

```json
// .icforge/canister_ids.json (auto-generated, gitignored)
{
  "backend": "xh5m6-qyaaa-aaaaj-qrsla-cai",
  "frontend": "abc12-defgh-aaaaj-qrslb-cai"
}
```

### 3.5 CLI flow

```
icforge deploy:
  1. Read icp.yaml
  2. Topological sort canisters by dependencies
  3. For each canister (in order):
     a. Run build command (if any)
     b. POST /api/v1/deploy with wasm + assets
     c. Poll status until complete
     d. If success: record canister_id in .icforge/canister_ids.json
     e. If fail: abort remaining deploys, report error
  4. Print summary table:
     ┌─────────┬────────────────────────────────────┬────────┐
     │ Name    │ Canister ID                        │ Status │
     ├─────────┼────────────────────────────────────┼────────┤
     │ backend │ xh5m6-qyaaa-aaaaj-qrsla-cai       │ ✓ live │
     │ frontend│ abc12-defgh-aaaaj-qrslb-cai        │ ✓ live │
     └─────────┴────────────────────────────────────┴────────┘
```

### 3.6 Selective deploys

Users should be able to deploy a single canister:

```bash
icforge deploy --canister backend    # deploy only the backend canister
icforge deploy --canister frontend   # deploy only the frontend canister
icforge deploy                       # deploy all (default)
```

## 4. Implementation Checklist

### CLI
- [ ] Refactor `deploy` command to iterate over all canisters
- [ ] Implement topological sort on canister dependencies
- [ ] Write `.icforge/canister_ids.json` after each canister deploy
- [ ] Set `CANISTER_ID_<NAME>` env vars for build commands
- [ ] Add `--canister <name>` flag for selective deploys
- [ ] Print summary table after all deploys complete
- [ ] Add `.icforge/canister_ids.json` to `.gitignore` template

### Backend
- [ ] No changes needed — existing per-canister deploy endpoint works
- [ ] Consider: return canister_id in deploy status response (verify it's there)

### icp.yaml
- [ ] Document `dependencies` field
- [ ] Validate no circular dependencies in `icforge init`

## 5. Future (not v0.2)

- Atomic rollback (if canister 2 fails, roll back canister 1)
- Parallel deploys for independent canisters
- Inter-canister call wiring (auto-generate Candid bindings)
