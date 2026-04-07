# ICForge — Deploy Delegation to icp-cli

**Status:** Draft v0.1
**Parent:** 020-icp-cli-migration/README.md
**Milestone:** v0.3
**Depends on:** 01-build-delegation.md

---

## 1. Goal

Replace direct ic-agent calls for canister creation, code installation, and settings updates with `icp deploy`. DB stays authoritative for canister IDs.

## 2. Pre-Provisioning (Before Build Jobs)

When a build is triggered (push or CLI), before enqueuing per-canister jobs:

1. Parse icp.yaml → extract canister names
2. For each canister not yet in DB:
   - `icp canister create <name> -e ic --identity icforge`
   - Parse canister ID from output
   - Save to `canister_records` table
3. Enqueue per-canister build jobs (canister IDs now available)

This ensures IDs exist before any build runs, so `PUBLIC_CANISTER_ID:<name>` env vars can be injected during build.

## 3. .icp Folder Hydration

Each build worker must write ALL project canister IDs from DB into `.icp/data/mappings/` before running `icp deploy`. This is how icp-cli discovers existing canisters and injects cross-canister env vars.

```
# For each canister in the project:
.icp/data/mappings/ic/<canister-name> → <canister-id>
```

Without this, icp-cli would try to create new canisters instead of deploying to existing ones.

## 4. Deploy Command

```bash
icp deploy <canister-name> -e ic --identity icforge
```

This runs the full lifecycle: build → install → sync. One command handles everything the worker previously did with multiple ic-agent calls.

## 5. What Gets Removed

- `IcClient` struct and all methods (ic_client.rs)
- Direct ic-agent dependency for deploy operations
- Manual cycles ledger calls for canister creation
- Custom install_code encoding
- Manual update_settings for env vars

## 6. Canister ID Tracking

**DB is authoritative.** After pre-provisioning or first deploy, canister IDs live in Postgres. The `.icp/` folder is ephemeral — hydrated from DB per build, discarded after.

Dashboard, API, subdomain routing all read from DB. icp-cli's local mappings are throwaway.

## 7. Cycles Management

`icp canister create` handles initial cycles. For top-ups:

```bash
icp canister top-up <name> --cycles 1T -e ic --identity icforge
```

Track spend for billing by querying balances before/after or parsing output.

## 8. Identity

Single platform identity used for all operations. Imported once per container:

```bash
echo "$IC_IDENTITY_PEM" | icp identity import icforge --pem-file /dev/stdin
```

Every command uses `--identity icforge`. This preserves the platform model — users never need IC identities.

## 9. Implementation Checklist

- [ ] Add pre-provisioning step: parse icp.yaml, create missing canisters, save IDs to DB
- [ ] Add .icp folder hydration: write all project canister IDs from DB before build
- [ ] Replace deploy pipeline with `icp deploy <name>` subprocess
- [ ] Capture icp-cli output for SSE streaming
- [ ] Remove ic_client.rs (or reduce to cycles balance queries for billing)
- [ ] Remove ic-agent/ic-asset crate dependencies from deploy path
- [ ] Update deploy status tracking to work with per-canister jobs
