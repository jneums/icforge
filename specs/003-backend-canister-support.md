# ICForge — Backend Canister Support

**Status:** Mostly Complete v0.2
**Parent:** 001-architecture.md
**Milestone:** v0.2

---

## 1. Goal

Support deploying **backend canisters** (Rust and Motoko) in addition to the existing frontend/asset canister support. Users can define backend canisters in `icp.yaml` and deploy them with the same `icforge deploy` workflow.

## 2. Current State

- `icforge deploy` uploads a `.wasm` file and optional assets tarball
- The deploy pipeline calls `install_code` then optionally `ic_asset::sync`
- The CLI's `--skip-build` flag lets users upload pre-built wasm
- `icp.yaml` already supports `type: rust`, `type: motoko`, `type: assets` in canister definitions
- `CanisterRecord.canister_type` column exists in the DB

## 3. What Changes

### 3.1 The problem with backend canisters

Frontend (asset) canisters have a known wasm module — the IC's certified asset canister (`ic-certified-assets.wasm`). ICForge can bundle this or let the user supply it.

Backend canisters have **user-authored wasm**. The user must:
1. Write Rust/Motoko code
2. Compile it to wasm
3. Upload the wasm to ICForge

The compilation step is the key difference. ICForge has two options:

| Approach | Pros | Cons |
|----------|------|------|
| **Build locally, upload wasm** | Simple, no build infra, user controls toolchain | User needs Rust/Motoko SDK installed |
| **Build on server** | Zero local setup, reproducible | Needs build infrastructure, security concerns (running user code), slow |

**Decision: Build locally, upload wasm.** This is the Vercel/Netlify model — the CLI (or CI) handles the build, ICForge handles the deploy. Server-side builds are a v0.4+ consideration at earliest.

### 3.2 Deploy flow for backend canisters

```
User runs: icforge deploy

CLI:
  1. Read icp.yaml → find all canisters
  2. For each canister:
     a. If type=assets: build frontend (npm run build), package dist/ as tarball
     b. If type=rust: run `cargo build --target wasm32-unknown-unknown --release`, 
        then `ic-wasm optimize` (if available)
     c. If type=motoko: run `moc` compiler (if available)
     d. Upload wasm to backend
  3. Backend deploys each canister in dependency order
```

### 3.3 CLI build commands

The CLI should support build recipes in `icp.yaml`:

```yaml
canisters:
  - name: backend
    type: rust
    path: ./backend  # Cargo project root
    build: "cargo build --target wasm32-unknown-unknown --release"
    wasm: "./target/wasm32-unknown-unknown/release/backend.wasm"
    
  - name: frontend
    type: assets
    source: ./dist
    build: "npm run build"
```

The `build` field is optional — if omitted, ICForge uses sensible defaults:
- **Rust:** `cargo build --target wasm32-unknown-unknown --release` in the `path` directory
- **Motoko:** `moc --package ... -o <name>.wasm` (needs `moc` in PATH)
- **Assets:** No build step (user runs their own frontend build, or specifies `build`)

The `wasm` field points to the output wasm file. If omitted, ICForge looks in conventional locations.

### 3.4 Backend changes

Minimal. The deploy pipeline already accepts arbitrary wasm bytes and calls `install_code`. The only changes:

1. **Skip asset sync for non-asset canisters.** Currently `run_deploy_pipeline()` syncs assets if an asset tarball is present. Add a check: only sync assets if the canister type is `assets`.

2. **Init args for backend canisters.** Backend canisters may need Candid init arguments. Add an optional `init_arg` field to the deploy multipart payload, passed through to `install_code`'s `arg` parameter.

3. **Candid interface file.** Backend canisters should optionally upload their `.did` file alongside the wasm. Store it in the DB or a blob store so the dashboard can render it later.

### 3.5 Multipart payload changes

Current:
```
project_id, canister_name, wasm, assets (optional), commit_sha, commit_message
```

Add:
```
init_arg (optional) — hex-encoded Candid init argument bytes
candid (optional) — .did file contents as text
```

## 4. Implementation Checklist

### CLI
- [x] Parse `build` and `wasm` fields from `icp.yaml`
- [x] Run build command for Rust canisters before deploy
- [ ] Run build command for Motoko canisters before deploy
- [x] Detect wasm output path from conventional locations if `wasm` not specified
- [x] Support `--skip-build` to skip compilation (already exists, just verify)
- [ ] Upload `init_arg` if specified in icp.yaml
- [ ] Upload `.did` file if found

### Backend
- [ ] Accept `init_arg` in deploy multipart
- [ ] Accept `candid` in deploy multipart
- [x] Pass init args to `install_code`
- [ ] Store `.did` file content in canisters table (new column: `candid_interface TEXT`)
- [x] Skip asset sync for non-asset canister types
- [ ] Migration: add `candid_interface` column to canisters table

### Validation
- [x] Deploy a Rust backend canister to local replica
- [x] Deploy a Rust backend canister to mainnet
- [ ] Deploy a Motoko canister (if moc available)
- [x] Verify upgrade flow works (install_code with mode=upgrade)

## 5. Non-Goals (for now)

- Server-side compilation
- Automatic dependency resolution between canisters (see spec 004)
- Inter-canister call wiring
- Candid UI integration in dashboard
