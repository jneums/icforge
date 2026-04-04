/**
 * ICForge Subdomain Router — Cloudflare Worker
 *
 * Routes <slug>.icforge.dev → <canister-id>.ic0.app
 * Slug-to-canister mapping stored in Cloudflare KV (ICFORGE_ROUTES).
 *
 * KV value format: { "canister_id": "xh5m6-...", "project_id": "820e1954-..." }
 */

const RESERVED_SLUGS = new Set(["www", "app", "api", "dashboard", "docs", "blog", "status"]);
const IC_DOMAIN = "ic0.app";
const BASE_DOMAIN = "icforge.dev";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname;

    // Extract subdomain: "hello.icforge.dev" → "hello"
    const parts = host.split(".");
    const baseParts = BASE_DOMAIN.split(".");
    if (parts.length <= baseParts.length) {
      // Bare domain — pass through to origin
      return fetch(request);
    }

    const slug = parts.slice(0, parts.length - baseParts.length).join(".");

    // Reserved slugs — pass through to origin
    if (RESERVED_SLUGS.has(slug)) {
      return fetch(request);
    }

    // Look up canister ID from KV
    const entry = await env.ICFORGE_ROUTES.get(slug, { type: "json" });
    if (!entry || !entry.canister_id) {
      return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Not Found — ICForge</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff">
  <div style="text-align:center">
    <h1 style="font-size:3rem;margin-bottom:0.5rem">404</h1>
    <p style="color:#888">Project <strong>${slug}</strong> not found on ICForge.</p>
    <p style="margin-top:2rem"><a href="https://icforge.dev" style="color:#60a5fa">← icforge.dev</a></p>
  </div>
</body>
</html>`,
        {
          status: 404,
          headers: { "Content-Type": "text/html;charset=UTF-8" },
        }
      );
    }

    // Proxy to IC boundary node
    const icUrl = new URL(request.url);
    icUrl.hostname = `${entry.canister_id}.${IC_DOMAIN}`;
    icUrl.port = "";
    icUrl.protocol = "https:";

    const proxyRequest = new Request(icUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "follow",
    });

    const response = await fetch(proxyRequest);

    // Return response with CORS headers for API calls
    const newHeaders = new Headers(response.headers);
    newHeaders.set("X-ICForge-Slug", slug);
    newHeaders.set("X-ICForge-Canister", entry.canister_id);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  },
};
