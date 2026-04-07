# ICForge — Build Delegation to icp-cli

**Status:** Draft v0.1
**Parent:** 020-icp-cli-migration/README.md
**Milestone:** v0.3
**Depends on:** 05-icp-yaml-alignment.md

---

## 1. Goal

Replace custom framework detection and build execution in `build_worker.rs` with `icp build`. One build job per canister.

## 2. What Changes

### Before (build_worker.rs today)

1. Clone repo
2. `detect_framework()` — custom heuristics
3. Branch per framework type: cargo, npm, moc, etc.
4. Hunt for wasm output in various locations
5. Download asset canister wasm.gz from dfinity CDN
6. One monolithic build per project (all canisters)

### After

1. Clone repo
2. Require icp.yaml (no fallback detection)
3. Pre-provision canisters if needed (see 02-deploy-delegation)
4. Hydrate `.icp/data/mappings/` from DB (canister IDs must exist for env var injection)
5. Run `icp deploy <canister-name>` — one job per canister
6. icp-cli handles recipe execution, wasm output, everything

### Removed Code

- `detect_framework()` and all framework-specific build branches
- Asset canister wasm download logic
- Custom wasm path discovery
- Manual `CANISTER_ID_<NAME>` env var injection during build
- Multi-canister orchestration within a single job

### Kept

- Job queue polling + claiming (Postgres FOR UPDATE SKIP LOCKED)
- Git clone + checkout
- Log capture → deploy_logs table
- GitHub status/check run posting

## 3. Per-Canister Job Model

Like Render.io services. When a push arrives:

1. Parse icp.yaml to discover canister names
2. Pre-provision any new canisters (create on IC, save IDs to DB)
3. Enqueue one `build_job` row per canister
4. Each worker claims and builds one canister independently

Benefits: parallel builds, independent failure/retry, clearer logs per canister.

GitHub commit status: one check run per canister (e.g., "icforge/backend", "icforge/frontend").

## 4. .icp Folder Hydration

Before `icp deploy`, the worker must write canister IDs into the `.icp/data/mappings/` directory so icp-cli can inject `PUBLIC_CANISTER_ID:<name>` env vars during build.

```
.icp/data/mappings/ic/<canister-name>  →  <canister-id>
```

The exact file format needs to be verified against icp-cli's expectations. This is the bridge between icforge's DB (source of truth) and icp-cli's config discovery.

## 5. Build Command

```bash
icp deploy <canister-name> \
  --project-root-override /builds/<job-id> \
  -e ic \
  --identity icforge
```

We use `icp deploy` (not `icp build`) because it runs the full lifecycle: build → create → install → sync. One command per canister, one job per canister.

## 6. Identity Setup

Import the platform identity once per build container boot:

```bash
echo "$IC_IDENTITY_PEM" | icp identity import icforge --pem-file /dev/stdin
icp identity default icforge
```

## 7. Implementation Checklist

- [ ] Add icp-cli to build Docker image (pinned version)
- [ ] Import platform identity on container startup
- [ ] Change job enqueuing: one build_job per canister (not per project)
- [ ] Add canister pre-provisioning step before job enqueuing
- [ ] Add .icp folder hydration step in worker before `icp deploy`
- [ ] Replace `execute_build()` with `icp deploy <name>` subprocess
- [ ] Pipe icp-cli stdout/stderr to build log capture
- [ ] Post one GitHub check run per canister
- [ ] Remove `detect_framework()`, `download_asset_canister_wasm()`, wasm scanning
- [ ] Update build_worker tests
