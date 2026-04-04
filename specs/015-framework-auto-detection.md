# ICForge — Framework Auto-Detection

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4

---

## 1. Goal

Automatically detect the user's project type and generate a sensible `icp.yaml` during `icforge init`, minimizing manual configuration. Similar to how Vercel auto-detects Next.js/Vite/etc.

## 2. Detection Signals

### Frontend frameworks

| Signal | Framework | Build Command | Output Dir |
|--------|-----------|---------------|------------|
| `vite.config.ts` / `vite.config.js` | Vite | `npm run build` | `dist/` |
| `next.config.js` / `next.config.ts` | Next.js (static export) | `next build && next export` | `out/` |
| `nuxt.config.ts` | Nuxt (static) | `nuxt generate` | `.output/public/` |
| `svelte.config.js` + `@sveltejs/adapter-static` | SvelteKit | `npm run build` | `build/` |
| `angular.json` | Angular | `ng build` | `dist/<project>/` |
| `gatsby-config.js` | Gatsby | `gatsby build` | `public/` |
| `index.html` (root, no framework) | Static HTML | — | `.` |

### Backend (IC-specific)

| Signal | Type | Build Command | Wasm Location |
|--------|------|---------------|---------------|
| `Cargo.toml` with `crate-type = ["cdylib"]` | Rust canister | `cargo build --target wasm32-unknown-unknown --release` | `target/wasm32-unknown-unknown/release/<name>.wasm` |
| `Cargo.toml` with `ic-cdk` dependency | Rust canister | (same) | (same) |
| `*.mo` files + `mops.toml` | Motoko | `moc` compilation | `<name>.wasm` |
| `dfx.json` | Existing dfx project | Parse dfx.json for canister definitions | Varies |

### Package manager

| Signal | Package Manager | Install Command |
|--------|----------------|-----------------|
| `pnpm-lock.yaml` | pnpm | `pnpm install` |
| `yarn.lock` | yarn | `yarn install` |
| `package-lock.json` | npm | `npm install` |
| `bun.lockb` | bun | `bun install` |

## 3. Detection Algorithm

```
icforge init:
  1. Scan current directory for signal files
  2. Detect package manager
  3. Detect frontend framework → generate asset canister config
  4. Detect Rust/Motoko canisters → generate backend canister configs
  5. Check for dfx.json → import existing canister definitions
  6. Generate icp.yaml with detected configuration
  7. Show user what was detected, ask for confirmation
```

### Priority rules

- If `dfx.json` exists, parse it and convert to `icp.yaml` format (migration path from dfx)
- Multiple canisters can coexist (Rust backend + Vite frontend)
- If nothing is detected, generate a minimal `icp.yaml` with a single asset canister

## 4. dfx.json Import

For projects already using `dfx`, ICForge should import canister definitions:

```json
// dfx.json
{
  "canisters": {
    "backend": {
      "type": "rust",
      "candid": "backend/backend.did",
      "package": "backend"
    },
    "frontend": {
      "type": "assets",
      "source": ["dist/"]
    }
  }
}
```

Converts to:

```yaml
# icp.yaml (auto-generated from dfx.json)
canisters:
  - name: backend
    type: rust
    path: ./backend
    build: "cargo build --target wasm32-unknown-unknown --release"
    wasm: "./target/wasm32-unknown-unknown/release/backend.wasm"

  - name: frontend
    type: assets
    source: ./dist
    build: "npm run build"
```

## 5. CLI Output

```
$ icforge init

  Detecting project structure...

  ✓ Frontend: Vite (React) — dist/
  ✓ Backend:  Rust canister — backend/
  ✓ Package manager: pnpm

  Generated icp.yaml:

    canisters:
      - name: backend
        type: rust
        path: ./backend
        build: "cargo build --target wasm32-unknown-unknown --release"
      - name: frontend
        type: assets
        source: ./dist
        build: "pnpm run build"
        dependencies:
          - backend

  Project name: my-dapp
  
  ? Does this look right? (Y/n) 
```

## 6. Implementation Checklist

### CLI (Rust)
- [ ] File-based framework detection (scan for config files)
- [ ] Package manager detection
- [ ] Rust canister detection (parse Cargo.toml for cdylib/ic-cdk)
- [ ] Motoko detection (*.mo files + mops.toml)
- [ ] dfx.json import/conversion
- [ ] Build command inference per framework
- [ ] Output directory inference per framework
- [ ] Interactive confirmation prompt
- [ ] `--yes` flag to skip confirmation
- [ ] Fallback: minimal asset canister if nothing detected

### Testing
- [ ] Test with Vite project
- [ ] Test with Next.js static export
- [ ] Test with Rust canister project
- [ ] Test with mixed frontend + backend
- [ ] Test with existing dfx.json
- [ ] Test with bare HTML project

## 7. Future

- Monorepo support (detect multiple packages in a workspace)
- Auto-detect inter-canister dependencies from import statements
- Server-side rendering frameworks (Next.js SSR → needs compute canister, not just assets)
