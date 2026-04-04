# ICForge — Custom Domains

**Status:** Draft v0.1
**Parent:** 001-architecture.md, 002-subdomain-routing.md
**Milestone:** v0.3
**Depends on:** 002 (subdomain routing via Cloudflare)

---

## 1. Goal

Users can point their own domain (`app.example.com`) to their ICForge project, with automatic TLS provisioning.

## 2. How It Works

```
User's DNS:
  app.example.com  CNAME  my-dapp.icforge.dev

Request flow:
  app.example.com → Cloudflare (proxy) → my-dapp.icforge.dev → canister
```

Because `*.icforge.dev` is already on Cloudflare (spec 002), custom domains that CNAME to `<slug>.icforge.dev` will automatically route through the same Worker.

### TLS

Cloudflare handles TLS automatically for proxied domains. The user's custom domain gets a Cloudflare-issued certificate (via Universal SSL or Advanced Certificate Manager). No cert provisioning on our side.

**Catch:** The user must have their domain's DNS proxied through Cloudflare for this to work seamlessly. If they don't use Cloudflare, they need to either:
- A) Add their domain to Cloudflare (free tier works)
- B) Use a CNAME with Cloudflare's SaaS SSL (Cloudflare for SaaS) — ICForge provisions certs on their behalf

**Decision: Require CNAME to `<slug>.icforge.dev` for v0.3.** Users who already use Cloudflare get automatic TLS. Users who don't can still CNAME, but TLS depends on their DNS provider's behavior. Cloudflare for SaaS is a v0.4 enhancement.

## 3. Configuration

### Dashboard

Settings → Custom Domain:
```
┌──────────────────────────────────────────┐
│ Custom Domain                             │
│                                          │
│ Domain: [ app.example.com          ]     │
│                                          │
│ DNS Configuration:                       │
│ Add a CNAME record:                      │
│   app.example.com → my-dapp.icforge.dev  │
│                                          │
│ Status: ✓ Verified                       │
│                                          │
│ [Save]  [Remove]                         │
└──────────────────────────────────────────┘
```

### CLI

```bash
icforge domain set app.example.com
icforge domain verify    # checks DNS resolution
icforge domain remove
```

### icp.yaml

```yaml
# Optional — can also be set via dashboard/CLI
domain: app.example.com
```

## 4. Verification

Before activating a custom domain, ICForge verifies the user owns it:

1. **DNS CNAME check:** Verify `app.example.com` has a CNAME to `<slug>.icforge.dev`
2. **TXT record check (optional):** User adds `_icforge.app.example.com TXT icforge-verify=<project-id>` for extra verification

For v0.3, CNAME verification is sufficient. If the CNAME points to the right slug, the user controls the domain.

## 5. Worker Changes

The Cloudflare Worker (from spec 002) needs to handle custom domains:

```js
// Current: extract slug from subdomain
// New: also check if the host is a custom domain

// Look up by custom domain first
let entry = await env.ICFORGE_ROUTES.get(`domain:${host}`, { type: "json" });

if (!entry) {
  // Fall back to subdomain lookup
  const slug = extractSlug(host);
  entry = await env.ICFORGE_ROUTES.get(slug, { type: "json" });
}
```

### KV entries for custom domains

When a custom domain is added:
```
Key: domain:app.example.com
Value: { "canister_id": "xh5m6-...", "project_id": "...", "slug": "my-dapp" }
```

## 6. API Endpoints

```
PUT /api/v1/projects/:id/domain
  Body: { domain: "app.example.com" }
  Action: Validate domain, add to Cloudflare KV, update DB
  Returns: { status: "pending_verification" | "verified", domain: "..." }

GET /api/v1/projects/:id/domain
  Returns: { domain: "app.example.com", status: "verified", dns_target: "my-dapp.icforge.dev" }

DELETE /api/v1/projects/:id/domain
  Action: Remove from Cloudflare KV, clear DB
```

## 7. Database Changes

The `projects` table already has a `custom_domain` column. Add:

```sql
ALTER TABLE projects ADD COLUMN domain_status TEXT DEFAULT NULL;
-- Values: NULL, 'pending', 'verified', 'failed'
```

## 8. Implementation Checklist

### Backend
- [ ] `PUT /api/v1/projects/:id/domain` — set custom domain
- [ ] `GET /api/v1/projects/:id/domain` — check domain status
- [ ] `DELETE /api/v1/projects/:id/domain` — remove custom domain
- [ ] DNS verification (CNAME resolution check)
- [ ] Write `domain:<hostname>` entry to Cloudflare KV
- [ ] Migration: add `domain_status` column

### Cloudflare Worker
- [ ] Add custom domain lookup (`domain:` prefix in KV)
- [ ] Fallback to slug-based lookup

### CLI
- [ ] `icforge domain set <domain>` command
- [ ] `icforge domain verify` command
- [ ] `icforge domain remove` command

### Dashboard
- [ ] Custom domain configuration UI on ProjectDetail settings
- [ ] DNS instructions display
- [ ] Verification status indicator

## 9. Future (v0.4+)

- Cloudflare for SaaS integration — provision TLS certs for custom domains automatically
- Wildcard custom domains
- IC boundary node native custom domains (eliminate Cloudflare proxy entirely)
