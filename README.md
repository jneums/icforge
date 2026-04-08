# ☁️ ICForge

> **Test PR** — Created via AI sandbox (Alice) from the agent environment.

**Deploy to the Internet Computer like Netlify/Vercel.**

ICForge abstracts away IC identity management, cycles, and canister operations so you can deploy with a single command. No crypto wallet needed.

```bash
npx icforge login    # Authenticate via browser
npx icforge init     # Initialize your project
npx icforge deploy   # Ship it 🚀
```

## Why?

The Internet Computer has powerful on-chain hosting, but deploying to mainnet requires:
- Generating cryptographic identities
- Purchasing ICP tokens on an exchange
- Converting ICP to cycles
- Managing canister lifecycle and top-ups

**ICForge handles all of this.** Pay with a credit card, deploy with a CLI command.

## Architecture

| Component | Stack | Purpose |
|-----------|-------|---------|
| `cli/` | TypeScript | CLI tool (`npx icforge`) |
| `backend/` | Rust (Axum) | API server, IC agent, deploy pipeline |
| `dashboard/` | TBD (Next.js/SvelteKit) | Web UI for project management |
| `shared/` | TypeScript | Shared types between CLI & dashboard |

## Development

```bash
# Install dependencies (CLI + shared)
npm install

# Run CLI in dev mode
npm -w cli run dev -- init

# Run backend
cd backend && cargo run

# Run dashboard
npm -w dashboard run dev
```

## Status

🚧 **Early development** — not yet functional.

## License

MIT
