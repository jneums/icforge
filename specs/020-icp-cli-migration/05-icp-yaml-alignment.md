# ICForge — icp.yaml Config Alignment

**Status:** Draft v0.1
**Parent:** 020-icp-cli-migration/README.md
**Milestone:** v0.3

---

## 1. Goal

Stop deep-parsing icp.yaml. Let icp-cli own the config. icforge only extracts canister names and recipes for display.

## 2. What icforge Needs from icp.yaml

- **Canister names** — for DB records, dashboard display, subdomain KV entries
- **Recipe info** — for dashboard display (e.g., "rust@v3.1.0", "asset-canister@v2.1.0")

That's it. Build steps, sync steps, settings — all icp-cli's concern.

## 3. How to Extract

Option A — `icp project show --json` (expanded config with recipes resolved).
Option B — Minimal YAML read: top-level `canisters` array for names, peek at recipe type.

Recommend **Option A** when available (reliable, handles globs and external canister.yaml refs). Fall back to Option B for lightweight checks.

## 4. Support for canister.yaml Files

`icp new` generates projects with per-canister `canister.yaml` files:

```yaml
# icp.yaml
canisters:
  - backend     # references backend/canister.yaml
  - frontend    # references frontend/canister.yaml
```

icforge must handle this. Use `icp project show` to resolve the full config, or follow the string references to read `<name>/canister.yaml` files.

## 5. No Frontend/Backend Type Distinction

Drop the `canister_type` concept. Every canister gets:
- A subdomain via Cloudflare KV (`<canister-name>.<project-slug>.icforge.dev`)
- A dashboard entry showing its **recipe** (not a type label)

Recipe display format: strip the `@dfinity/` prefix and version suffix for UI.
`@dfinity/rust@v3.1.0` → "Rust" or "rust@v3.1.0"
`@dfinity/asset-canister@v2.1.0` → "Assets" or "asset-canister@v2.1.0"

## 6. The .icforge File

Stays as-is. icforge-specific project link:

```json
{ "projectId": "...", "slug": "..." }
```

Orthogonal to icp.yaml. icp-cli doesn't know about it. Clean separation.

## 7. Config Injection — Don't

Don't modify the user's icp.yaml. Use CLI flags instead:

```bash
icp deploy <name> -e ic --identity icforge
```

The user's config stays untouched. icforge controls environment and identity via flags.

## 8. Implementation Checklist

- [ ] Remove deep icp.yaml parsing from build_worker.rs
- [ ] Remove deep icp.yaml parsing from config.ts
- [ ] Add canister name + recipe extraction (via `icp project show` or minimal YAML)
- [ ] Support string references in canisters array (canister.yaml files)
- [ ] Replace `canister_type` field in DB/UI with `recipe` field
- [ ] Update dashboard to show recipe instead of "frontend"/"backend"
- [ ] Update Cloudflare KV writes — all canisters get subdomains regardless
