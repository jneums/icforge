# ICForge — icp-cli Migration

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Stop reimplementing IC toolchain logic. Delegate build, deploy, and asset sync to [icp-cli](https://cli.internetcomputer.org/0.2) and reduce icforge to what makes it unique: PaaS orchestration, GitHub integration, billing, and multi-tenancy.

## 2. Why

icforge currently duplicates significant icp-cli functionality:

| Concern | icforge today | icp-cli equivalent |
|---|---|---|
| Framework detection | Custom heuristics in build_worker.rs | Recipe system (`@dfinity/rust`, `@dfinity/asset-canister`) |
| Build execution | Shell subprocesses per framework | `icp build` |
| Canister creation | Direct ic-agent calls to mgmt/cycles ledger | `icp canister create` |
| Code install | Direct install_code via ic-agent | `icp canister install` / `icp deploy` |
| Asset sync | ic_asset::sync() + manual env var baking | `icp sync` (handles ic_env cookie) |
| Env var injection | Custom update_settings calls | Automatic during `icp deploy` |
| Topo sort | Custom in CLI deploy.ts | Handled by `icp deploy` |
| Wasm discovery | Multi-path search heuristic | `$ICP_WASM_OUTPUT_PATH` convention |

Maintaining this duplicated logic is a liability — every icp-cli update could break our assumptions. Delegating means we get improvements for free.

## 3. What Stays in icforge

- **GitHub App** — webhook handling, installation management, PR comments
- **Job queue** — Postgres-backed build job scheduling + deduplication (one job per canister)
- **Canister pre-provisioning** — create canisters + store IDs in DB before build jobs run
- **Multi-tenancy** — platform identity, per-user project isolation
- **Billing** — Stripe integration, plan enforcement, cycles accounting
- **Dashboard** — deploy status, logs, project management, recipe display
- **Subdomain routing** — Cloudflare KV mapping for *.icforge.dev (all canisters, not just frontends)
- **SSE log streaming** — real-time deploy feedback
- **API tokens** — authentication for CLI and CI

## 3a. Key Decisions

1. **icp.yaml required.** No fallback framework detection. icp.yaml is the standard for IC projects.
2. **No fallback build path.** If icp-cli doesn't support a recipe, icforge doesn't either.
3. **One job per canister.** Each canister gets its own build job, like Render.io services. Not one monolithic job per project.
4. **DB is authoritative for canister IDs.** icp-cli's `.icp/data/mappings/` is ephemeral build state. The DB is the source of truth.
5. **Use `icp deploy` (all-in-one).** Simpler than orchestrating create/install/sync individually.
6. **Pre-provision canisters before builds.** Create canisters and save IDs to DB so they're available for env var injection during build. Hydrate `.icp/` folder from DB before each build so icp-cli knows the IDs.
7. **No frontend/backend canister types.** Every canister gets a subdomain. Dashboard shows the recipe (e.g., `rust@v3.1.0`, `asset-canister@v2.1.0`) instead of a type label.
8. **Support canister.yaml glob discovery.** icp-cli's `icp new` generates per-canister `canister.yaml` files — we must support that pattern.

## 4. Migration Phases

**Phase 1: Build delegation** (01-build-delegation.md)
Replace framework detection + build commands with `icp build`.

**Phase 2: Deploy delegation** (02-deploy-delegation.md)
Replace ic-agent canister creation/install with `icp deploy`.

**Phase 3: Asset sync delegation** (03-asset-sync-delegation.md)
Replace ic_asset::sync() with `icp sync`.

**Phase 4: CLI simplification** (04-cli-simplification.md)
Strip local build/deploy logic from the TS CLI.

**Phase 5: Config alignment** (05-icp-yaml-alignment.md)
Ensure icp.yaml compatibility, drop custom parsing.

Phases 1-3 target the backend (build_worker.rs, deploy.rs, ic_client.rs).
Phase 4 targets the CLI (deploy.ts, config.ts).
Phase 5 is cross-cutting.

## 5. Prerequisite

icp-cli must be installed in the build environment. Add to Docker build image:

```
npm install -g @icp-sdk/icp-cli @icp-sdk/ic-wasm
```

## 6. Risk

- **icp-cli identity model** — icp-cli manages its own identity store. icforge uses a single platform PEM. We need `--identity` flag or `icp identity import` per build.
- **Output capture** — icforge streams logs via SSE. We need to capture icp-cli stdout/stderr in real time, not just exit codes.
- **Error mapping** — icp-cli error messages need to be parsed or wrapped for user-facing display.
- **Version pinning** — must pin icp-cli version in build images to avoid surprise breakage.
- **.icp folder hydration** — canister IDs from DB must be written into `.icp/data/mappings/` before each build so icp-cli can inject `PUBLIC_CANISTER_ID:*` env vars correctly.

## 7. Sub-Specs

- [01-build-delegation.md](01-build-delegation.md)
- [02-deploy-delegation.md](02-deploy-delegation.md)
- [03-asset-sync-delegation.md](03-asset-sync-delegation.md)
- [04-cli-simplification.md](04-cli-simplification.md)
- [05-icp-yaml-alignment.md](05-icp-yaml-alignment.md)
