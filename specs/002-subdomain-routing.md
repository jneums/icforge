# ICForge — Subdomain Routing

**Status:** Complete v0.2
**Parent:** 001-architecture.md (Section 8: Custom Domains)
**Milestone:** v0.2

---

## 1. Goal

Every ICForge project gets a vanity URL: `<slug>.icforge.dev`

The slug is derived from the project name at `icforge init` time and stored in the `projects.slug` column (already exists). Subdomain routing maps that slug to the project's canister on IC mainnet, transparently.

## 2. Approach: Cloudflare Worker + KV

A Cloudflare Worker running on `*.icforge.dev` handles all subdomain requests. It looks up the slug in Cloudflare KV to find the canister ID, then proxies the request to `<canister-id>.icp0.io`.

```
User browser
    │
    ▼
hello.icforge.dev
    │
    ▼  (wildcard DNS: *.icforge.dev → Cloudflare)
┌─────────────────────────────┐
│  Cloudflare Worker          │
│                             │
│  1. Extract subdomain slug  │
│  2. KV.get(slug)            │
│  3. Proxy to icp0.io        │
└─────────────┬───────────────┘
              │
              ▼
https://xh5m6-qyaaa-aaaaj-qrsla-cai.icp0.io
```

### Why Cloudflare Worker over alternatives

| Option | Verdict |
|--------|---------|
| Reverse proxy on Render | Adds latency, single region, free tier sleeps |
| Cloudflare Worker + KV | Global edge, sub-ms lookup, 100K req/day free, no Render load |
| IC boundary node custom domains | Best long-term, but complex to automate per-project. Revisit in v0.3+ |

## 3. DNS Setup

On Cloudflare DNS for `icforge.dev`:

```
*.icforge.dev  CNAME  icforge.dev  (proxied, orange cloud)
```

The Worker route catches `*.icforge.dev/*`. Requests to bare `icforge.dev` (no subdomain) pass through to the landing page (wherever that's hosted).

## 4. Cloudflare KV Namespace

**Namespace:** `ICFORGE_ROUTES`

**Key format:** slug (lowercase, hyphenated)
**Value format:** JSON

```json
{
  "canister_id": "xh5m6-qyaaa-aaaaj-qrsla-cai",
  "project_id": "820e1954-c6a0-4d4f-9012-efed25ee8127"
}
```

**TTL:** None (explicit, persistent). Entries are written/updated on deploy, deleted on project deletion.

## 5. Worker Logic

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    // Extract subdomain: "hello.icforge.dev" → "hello"
    const parts = host.split(".");
    if (parts.length < 3 || parts.slice(-2).join(".") !== "icforge.dev") {
      return new Response("Not found", { status: 404 });
    }
    const slug = parts.slice(0, -2).join(".");

    // Reserved slugs — pass through or redirect
    const reserved = ["www", "app", "api", "dashboard"];
    if (reserved.includes(slug)) {
      return fetch(request); // pass to origin
    }

    // Look up canister ID from KV
    const entry = await env.ICFORGE_ROUTES.get(slug, { type: "json" });
    if (!entry) {
      return new Response("Project not found", { status: 404 });
    }

    // Proxy to IC boundary node
    const icUrl = new URL(request.url);
    icUrl.hostname = `${entry.canister_id}.icp0.io`;
    icUrl.port = "";
    icUrl.protocol = "https:";

    const proxyRequest = new Request(icUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });

    // Forward the request, preserve response
    const response = await fetch(proxyRequest);

    // Clone response to add CORS/custom headers if needed
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  },
};
```

## 6. Backend Integration

### 6.1 KV Write on Deploy Success

After a successful deployment in `run_deploy_pipeline()` (deploy.rs), the backend writes the slug→canister mapping to Cloudflare KV.

**New config env vars:**
```
CLOUDFLARE_ACCOUNT_ID=<account-id>
CLOUDFLARE_API_TOKEN=<token-with-kv-write>
CLOUDFLARE_KV_NAMESPACE_ID=<namespace-id>
```

**API call** (at end of successful deploy):
```
PUT https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{slug}

Body: {"canister_id": "xh5m6-...", "project_id": "820e1954-..."}
```

This happens in the existing `run_deploy_pipeline()` after the "live" status update. It's best-effort — if the KV write fails, the deploy still succeeds (canister is live at `<id>.icp0.io`), and the slug mapping can be retried or manually fixed.

### 6.2 KV Delete on Project Deletion

When a project is deleted (not yet implemented), remove the KV entry:

```
DELETE https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{slug}
```

### 6.3 Slug Uniqueness

The `projects.slug` column should have a **unique constraint** (across all users). Two users cannot both have a project called "hello-world" — first come, first served. The `create_project` route already generates slugs; add a DB unique index and handle the conflict gracefully (suggest alternative slug).

## 7. Implementation Checklist

### Cloudflare setup (manual, one-time)
- [ ] Add `icforge.dev` to Cloudflare (if not already)
- [ ] Create KV namespace `ICFORGE_ROUTES`
- [ ] Deploy Worker with route `*.icforge.dev/*`
- [ ] Add wildcard DNS record `*.icforge.dev → icforge.dev` (proxied)
- [ ] Generate API token with KV write permissions

### Backend changes
- [ ] Add Cloudflare config env vars to `config.rs`
- [ ] Add `cloudflare_kv_write()` helper function (simple HTTP PUT with reqwest)
- [ ] Call KV write at end of `run_deploy_pipeline()` on success
- [ ] Add unique constraint on `projects.slug` column (migration)
- [ ] Handle slug conflict in `create_project` (return error or suggest alternative)
- [ ] Add Cloudflare env vars to Render

### CLI changes
- [ ] After deploy success, print `https://<slug>.icforge.dev` alongside the `icp0.io` URL
- [ ] `icforge status` should show the vanity URL

### Future (v0.3+)
- [ ] IC boundary node native custom domains (eliminate proxy)
- [ ] User custom domains (`app.example.com → CNAME <slug>.icforge.dev`)
- [ ] TLS provisioning for custom domains

## 8. Cost

Cloudflare Workers free tier:
- 100,000 requests/day
- KV: 100,000 reads/day, 1,000 writes/day
- More than enough for early traction. Paid plan ($5/mo) gives 10M requests/month.

## 9. Latency Impact

Cloudflare Worker adds ~1-5ms at the edge. The proxy `fetch()` to `icp0.io` uses Cloudflare's global network, which may actually be faster than a direct connection from some regions (Cloudflare has better peering than most ISPs to IC boundary nodes).

No measurable impact on user experience.
