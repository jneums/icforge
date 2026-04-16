import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

export default function Skill() {
  const apiUrl = import.meta.env.VITE_API_URL ?? "";
  const loginHref = `${apiUrl}/api/v1/auth/login?redirect=${encodeURIComponent(window.location.origin + "/login")}`;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b">
        <Link to="/" className="flex items-center gap-2">
          <span className="text-lg">⬡</span>
          <span className="font-semibold">ICForge</span>
        </Link>
        <Button asChild variant="outline" size="sm">
          <a href={loginHref}>Login with GitHub</a>
        </Button>
      </header>

      {/* Skill Content */}
      <article className="max-w-3xl mx-auto px-6 py-12 prose prose-sm prose-invert dark:prose-invert">
        <Link
          to="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground no-underline mb-8"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to ICForge
        </Link>

        <h1>ICForge: Agent Deployment Guide</h1>
        <p className="lead">
          Deploy and manage Internet Computer canisters with git push. One CLI
          command to connect your project, then every push to main builds and
          deploys automatically.
        </p>

        <blockquote>
          <strong>Base URL:</strong> <code>{apiUrl || "https://icforge-backend.onrender.com"}</code>
          <br />
          <strong>Dashboard:</strong> <code>https://icforge.dev</code>
          <br />
          <strong>CLI:</strong> <code>npm install -g @nicforge/cli</code>
        </blockquote>

        <hr />

        <h2>Free Tier</h2>
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Limit</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Signup bonus</td><td>$25 compute credits</td></tr>
            <tr><td>Canister provisioning</td><td>~$7 per canister (4T cycles)</td></tr>
            <tr><td>Build time</td><td>$0.01/min</td></tr>
            <tr><td>Auto top-up</td><td>Always on (keeps canisters above 3T cycles)</td></tr>
            <tr><td>Logs</td><td>24h retention (free), up to 30d (paid)</td></tr>
            <tr><td>Subdomains</td><td><code>{"<project>-<canister>"}.icforge.dev</code></td></tr>
          </tbody>
        </table>

        <hr />

        <h2>1. Prerequisites</h2>
        <p>
          Your project must be an <code>icp-cli</code> project with an{" "}
          <code>icp.yaml</code> in the root. If you don't have one yet:
        </p>
        <pre><code>{`# Create a new IC project (Motoko + React)
icp new my-project --subfolder hello-world \\
  -d backend_type=motoko -d frontend_type=react \\
  -d network_type=Default -s

# Or Rust + React
icp new my-project --subfolder hello-world \\
  -d backend_type=rust -d frontend_type=react \\
  -d network_type=Default -s`}</code></pre>

        <hr />

        <h2>2. Sign Up & Install CLI</h2>
        <pre><code>{`# Install the ICForge CLI
npm install -g @nicforge/cli

# Login via GitHub OAuth (opens browser)
icforge login`}</code></pre>

        <hr />

        <h2>3. Initialize Project</h2>
        <p>
          Run from your project root (where <code>icp.yaml</code> lives):
        </p>
        <pre><code>{`cd my-project
icforge init`}</code></pre>
        <p>
          This reads your <code>icp.yaml</code>, creates a project on ICForge,
          and saves a <code>.icforge</code> link file.
        </p>

        <h3>BYOC (Bring Your Own Canister)</h3>
        <p>
          If your project already has deployed canisters (IDs in{" "}
          <code>.icp/data/mappings/ic.ids.json</code>), ICForge detects them
          automatically. No provisioning charge — ICForge adopts your existing
          canisters. You just need to add ICForge as a controller:
        </p>
        <pre><code>{`icp canister update-settings <canister-id> \\
  --add-controller <icforge-principal> \\
  --network ic`}</code></pre>
        <p>
          The exact ICForge principal is shown in deploy logs if it's missing.
        </p>

        <hr />

        <h2>4. Deploy</h2>

        <h3>Option A: CLI Deploy</h3>
        <pre><code>{`icforge deploy`}</code></pre>

        <h3>Option B: Git Push (Auto-Deploy)</h3>
        <p>
          Link your GitHub repo and every push to your production branch triggers
          a build automatically:
        </p>
        <ol>
          <li>
            Install the{" "}
            <a
              href="https://github.com/apps/icforge"
              target="_blank"
              rel="noopener noreferrer"
            >
              ICForge GitHub App
            </a>{" "}
            on your repo
          </li>
          <li>Link the repo in the ICForge dashboard or during <code>icforge init</code></li>
          <li>Push to main — ICForge builds and deploys automatically</li>
        </ol>

        <hr />

        <h2>5. API Reference</h2>
        <p>
          All API endpoints require a JWT token from GitHub OAuth login. Use the
          CLI's <code>icforge login</code> flow, or call the auth endpoints
          directly.
        </p>

        <h3>Authentication</h3>
        <pre><code>{`# Start GitHub OAuth flow (redirects to GitHub)
GET /api/v1/auth/login?redirect=<callback_url>

# After OAuth, get user info
GET /api/v1/auth/me
Authorization: Bearer <jwt>`}</code></pre>

        <h3>Projects</h3>
        <pre><code>{`# List projects
GET /api/v1/projects
Authorization: Bearer <jwt>

# Create project
POST /api/v1/projects
Authorization: Bearer <jwt>
Content-Type: application/json
{
  "name": "my-project",
  "canisters": [
    { "name": "backend", "recipe": "@dfinity/rust@v3.1.0" },
    { "name": "frontend", "recipe": "@dfinity/asset-canister@v2.1.0" }
  ]
}

# Get project details
GET /api/v1/projects/:id
Authorization: Bearer <jwt>`}</code></pre>

        <h3>Deployments</h3>
        <pre><code>{`# Trigger a deploy
POST /api/v1/deployments
Authorization: Bearer <jwt>
Content-Type: application/json
{
  "project_id": "<project-id>",
  "commit_sha": "<sha>",
  "branch": "main",
  "trigger": "cli"
}

# Get deploy status
GET /api/v1/deploy/:id/status
Authorization: Bearer <jwt>

# Stream deploy logs (SSE)
GET /api/v1/deploy/:id/logs/stream
Authorization: Bearer <jwt>`}</code></pre>

        <h3>Canister Management</h3>
        <pre><code>{`# Get canister environment variables
GET /api/v1/canisters/:canister_id/env
Authorization: Bearer <jwt>

# Set environment variables
PUT /api/v1/canisters/:canister_id/env
Authorization: Bearer <jwt>
Content-Type: application/json
{ "variables": [{ "name": "MY_VAR", "value": "hello" }] }

# Get canister controllers
GET /api/v1/canisters/:canister_id/controllers
Authorization: Bearer <jwt>

# Get cycles + health info
GET /api/v1/canisters/:canister_id/cycles
Authorization: Bearer <jwt>

# Manual top-up
POST /api/v1/canisters/:canister_id/topup
Authorization: Bearer <jwt>
Content-Type: application/json
{ "amount": 2000000000000 }

# Canister runtime logs
GET /api/v1/canisters/:canister_id/logs?level=error&limit=100
Authorization: Bearer <jwt>

# Stream canister logs (SSE)
GET /api/v1/canisters/:canister_id/logs/stream
Authorization: Bearer <jwt>`}</code></pre>

        <h3>Billing</h3>
        <pre><code>{`# Check compute balance
GET /api/v1/billing/balance
Authorization: Bearer <jwt>

# View transaction history
GET /api/v1/billing/transactions
Authorization: Bearer <jwt>

# Create Stripe checkout session (add credits)
POST /api/v1/billing/checkout
Authorization: Bearer <jwt>
Content-Type: application/json
{ "amount": 10 }`}</code></pre>

        <hr />

        <h2>6. Deploy Lifecycle</h2>
        <pre><code>{`Push / CLI deploy
  → Clone repo
  → Validate icp.yaml
  → Pre-flight billing check
  → Setup icp-cli identity
  → Pre-provision canisters (or adopt BYOC from ic.ids.json)
  → Verify controller access
  → Hydrate .icp/data/mappings/ic.ids.json from DB
  → icp deploy <canister> -e ic
  → Update Cloudflare KV subdomain routing
  → Debit build time`}</code></pre>

        <hr />

        <h2>7. Error Handling</h2>
        <table>
          <thead>
            <tr>
              <th>Error</th>
              <th>Cause</th>
              <th>Fix</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Insufficient compute balance</td>
              <td>Balance too low for build or provisioning</td>
              <td>Add credits at /billing</td>
            </tr>
            <tr>
              <td>ICForge is not a controller</td>
              <td>BYOC canister without ICForge as controller</td>
              <td>Run the <code>icp canister update-settings</code> command from the error message</td>
            </tr>
            <tr>
              <td>No icp.yaml found</td>
              <td>Repo missing icp-cli manifest</td>
              <td>Create icp.yaml with canister definitions</td>
            </tr>
            <tr>
              <td>No canister record</td>
              <td>Canister not registered in ICForge project</td>
              <td>Re-run <code>icforge init</code> or add canister via dashboard</td>
            </tr>
          </tbody>
        </table>

        <hr />

        <h2>8. Project Structure</h2>
        <pre><code>{`my-project/
├── icp.yaml                          # icp-cli manifest (required)
├── .icforge                          # ICForge project link (created by icforge init)
├── .icp/data/mappings/ic.ids.json    # Canister IDs (BYOC or created by icp-cli)
├── backend/
│   ├── canister.yaml                 # Per-canister recipe config
│   └── src/main.mo                   # Canister source
└── frontend/
    ├── canister.yaml
    └── dist/                         # Built assets (synced to asset canister)`}</code></pre>

        <hr />

        <div className="text-center mt-12">
          <Button asChild size="lg">
            <a href={loginHref}>
              Get Started with GitHub →
            </a>
          </Button>
          <p className="text-sm text-muted-foreground mt-3">
            $25 free compute credits · No credit card required
          </p>
        </div>
      </article>

      {/* Footer */}
      <footer className="text-center py-6 text-xs text-muted-foreground border-t">
        © {new Date().getFullYear()} ICForge · Built on the Internet Computer
      </footer>
    </div>
  );
}
