# ICForge — Asset Sync Delegation to icp-cli

**Status:** Draft v0.1
**Parent:** 020-icp-cli-migration/README.md
**Milestone:** v0.3
**Depends on:** 02-deploy-delegation.md

---

## 1. Goal

Replace direct `ic_asset::sync()` calls with `icp sync` (via `icp deploy`). Keep CLI asset upload path — users don't have controller principals locally.

## 2. Server-Side Builds (GitHub App Path)

`icp deploy` handles asset sync automatically as the last step of the deploy lifecycle. No separate sync step needed. The recipe (e.g., `@dfinity/asset-canister@v2.1.0`) defines what to sync and where.

With .icp folder hydrated from DB, `icp deploy` injects `PUBLIC_CANISTER_ID:*` env vars and bakes the ic_env cookie correctly.

### Removed Code

- `ic_asset::sync()` calls in deploy.rs and build_worker.rs
- Manual env var baking before sync
- Asset canister wasm download
- ic_asset crate dependency

## 3. CLI Deploy Path (User Builds Locally)

Users still upload assets to the backend because:
- The platform identity (controller) is on the server, not locally
- Users don't have canister controller principals
- The server must run `icp deploy` / `icp sync` on their behalf

Flow stays similar:
1. User runs `icforge deploy` (triggers server-side build from current commit)
2. Server clones, hydrates .icp, runs `icp deploy`
3. icp-cli handles asset sync as part of the deploy lifecycle

The tarball upload path can be removed — all builds happen server-side now (see 04-cli-simplification).

## 4. Implementation Checklist

- [ ] Verify `icp deploy` handles asset sync correctly with hydrated .icp folder
- [ ] Verify ic_env cookie contains correct `PUBLIC_CANISTER_ID:*` values
- [ ] Remove `ic_asset::sync()` calls
- [ ] Remove tarball extraction logic from deploy.rs
- [ ] Remove ic_asset crate dependency
- [ ] Capture sync output in SSE logs
