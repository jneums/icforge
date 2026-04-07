# ICForge — CLI Simplification

**Status:** Draft v0.1
**Parent:** 020-icp-cli-migration/README.md
**Milestone:** v0.3
**Depends on:** 01-build-delegation.md, 02-deploy-delegation.md, 03-asset-sync-delegation.md

---

## 1. Goal

Strip build/deploy execution from the icforge TS CLI. One unified pipeline: CLI and GitHub App both enqueue server-side build jobs.

## 2. CLI Deploy — Before vs After

### Before (deploy.ts — 657 lines)

1. Parse icp.yaml deeply (topo sort, build commands, wasm paths)
2. Build locally per canister
3. Find wasm artifacts
4. Tar up assets
5. Multipart upload wasm + assets to backend
6. Poll deploy status

### After

1. `POST /api/v1/builds` — trigger server-side build for current commit
2. Stream logs via SSE
3. Print summary

No local builds. No wasm discovery. No tarballs. No topo sort.

## 3. New Backend Endpoint

```
POST /api/v1/builds
{
  "project_id": "...",
  "commit_sha": "...",
  "branch": "...",
  "trigger": "cli"
}
```

Returns `{ "build_id": "..." }`. This is the same code path the GitHub App uses — webhook creates a build, CLI creates a build. Same job queue, same workers.

## 4. Commands After Migration

| Command | Change |
|---|---|
| `icforge init` | Keep |
| `icforge login` | Keep |
| `icforge deploy` | **Rewrite** — POST to trigger build, stream logs |
| `icforge status` | Keep |
| `icforge logs` | Keep |
| `icforge dev-auth` | Keep |

## 5. Local Dev Story

For local dev, use icp-cli directly:

```bash
icp deploy -e local
```

icforge CLI = hosted pipeline. icp-cli = local dev. Same icp.yaml.

## 6. Removed Code

- deploy.ts build execution (~500 lines)
- config.ts deep icp.yaml parsing (topo sort, build commands, wasm paths)
- Wasm artifact discovery
- Tarball creation + multipart upload

## 7. Implementation Checklist

- [ ] Add `POST /api/v1/builds` endpoint
- [ ] Rewrite deploy.ts — trigger + stream
- [ ] Remove local build, topo sort, tarball, multipart upload logic
- [ ] Simplify config.ts — only .icforge parsing needed
- [ ] Update CLI tests
