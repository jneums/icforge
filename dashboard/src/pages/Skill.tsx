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

        <h1>ICForge: Agent Skill</h1>
        <p className="lead">
          ICForge deploys Internet Computer canisters automatically when you push
          to a GitHub repo. As an AI agent, you just write code and push — ICForge
          handles building, deploying, and managing canisters on the IC.
        </p>

        <blockquote>
          <strong>Your role:</strong> Write code, commit, push to main.
          <br />
          <strong>ICForge's role:</strong> Build, deploy, manage cycles, route subdomains.
          <br />
          <strong>Human setup (one-time):</strong> Install the ICForge GitHub App on the repo.
        </blockquote>

        <hr />

        <h2>How It Works</h2>
        <ol>
          <li>
            <strong>Human installs the ICForge GitHub App</strong> on the repo
            and links it to a project via the{" "}
            <a href="https://icforge.dev" target="_blank" rel="noopener noreferrer">
              ICForge dashboard
            </a>
          </li>
          <li>
            <strong>You push code to main</strong> — ICForge receives a webhook
            and triggers a build
          </li>
          <li>
            <strong>ICForge builds and deploys</strong> — compiles canisters
            using <code>icp deploy</code>, provisions cycles, and routes a
            subdomain at{" "}
            <code>{"<project>-<canister>"}.icforge.dev</code>
          </li>
          <li>
            <strong>Every subsequent push</strong> to main triggers an
            automatic redeploy
          </li>
        </ol>

        <hr />

        <h2>What You Need to Know</h2>

        <h3>Project Structure</h3>
        <p>
          ICForge requires an <code>icp-cli</code> project with an{" "}
          <code>icp.yaml</code> in the repo root:
        </p>
        <pre><code>{`my-project/
├── icp.yaml                          # Required — defines canisters
├── backend/
│   ├── canister.yaml                 # Per-canister config (recipe, type)
│   └── src/main.mo                   # Canister source (Motoko or Rust)
└── frontend/
    ├── canister.yaml
    └── dist/                         # Built assets (synced to asset canister)`}</code></pre>

        <h3>icp.yaml Format</h3>
        <pre><code>{`# Bare string entries (recipe details in <name>/canister.yaml):
canisters:
  - backend
  - frontend

# Or inline objects:
canisters:
  - name: backend
    recipe:
      type: "@dfinity/motoko@v4.1.0"
      configuration:
        main: src/main.mo
  - name: frontend
    recipe:
      type: "@dfinity/asset-canister@v2.1.0"
      configuration:
        dir: dist`}</code></pre>

        <h3>Scaffolding a New Project</h3>
        <p>
          If you need to create a new IC project from scratch, use{" "}
          <code>icp new</code>:
        </p>
        <pre><code>{`# Motoko backend + React frontend
icp new my-project --subfolder hello-world \\
  -d backend_type=motoko -d frontend_type=react \\
  -d network_type=Default -s

# Rust backend + React frontend
icp new my-project --subfolder hello-world \\
  -d backend_type=rust -d frontend_type=react \\
  -d network_type=Default -s`}</code></pre>
        <p>
          The <code>-s</code> (silent) flag is required when running from a
          non-interactive context like an agent.
        </p>

        <hr />

        <h2>BYOC (Bring Your Own Canister)</h2>
        <p>
          If the repo already has deployed canisters with IDs in{" "}
          <code>.icp/data/mappings/ic.ids.json</code>, ICForge detects them
          automatically on first deploy. No provisioning charge — ICForge
          adopts the existing canisters.
        </p>
        <h3>ic.ids.json Format</h3>
        <pre><code>{`{
  "backend": "slffn-cqaaa-aaaak-qyqoa-cai",
  "frontend": "q56ew-saaaa-aaaaj-qrszq-cai"
}`}</code></pre>
        <p>
          The human needs to add ICForge as a controller of each BYOC canister.
          If this step is missing, the deploy will fail with an error showing
          the exact command to run:
        </p>
        <pre><code>{`icp canister update-settings <canister-id> \\
  --add-controller <icforge-principal> \\
  --network ic`}</code></pre>

        <hr />

        <h2>Deploy Lifecycle</h2>
        <p>
          When you push to main, ICForge runs this pipeline for each canister:
        </p>
        <pre><code>{`git push origin main
  → ICForge receives webhook
  → Clones repo (shallow, single branch)
  → Validates icp.yaml exists
  → Pre-flight billing check
  → Pre-provision canisters (or adopt BYOC from ic.ids.json)
  → Verify controller access (canister_status)
  → Hydrate sibling canister IDs
  → icp deploy <canister> -e ic
  → Update subdomain routing (<project>-<canister>.icforge.dev)
  → Debit build time ($0.01/min)`}</code></pre>

        <hr />

        <h2>What ICForge Manages For You</h2>
        <table>
          <thead>
            <tr>
              <th>Service</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Auto-deploy</td><td>Every push to the production branch triggers a build</td></tr>
            <tr><td>Canister provisioning</td><td>Creates canisters on IC if they don't exist (~$7 per canister)</td></tr>
            <tr><td>Cycles management</td><td>Monitors canister cycles, auto tops up before they run out</td></tr>
            <tr><td>Subdomain routing</td><td><code>{"<project>-<canister>"}.icforge.dev</code> → canister on IC</td></tr>
            <tr><td>Build logs</td><td>Real-time streaming via SSE in the dashboard</td></tr>
            <tr><td>Runtime logs</td><td>Canister logs collected from IC management canister</td></tr>
            <tr><td>Environment variables</td><td>Set via dashboard, injected at build + runtime</td></tr>
            <tr><td>GitHub status checks</td><td>Commit statuses and check runs on each deploy</td></tr>
          </tbody>
        </table>

        <hr />

        <h2>Common Deploy Errors</h2>
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
              <td>No icp.yaml found</td>
              <td>Repo missing icp-cli manifest</td>
              <td>Add icp.yaml to repo root</td>
            </tr>
            <tr>
              <td>ICForge is not a controller</td>
              <td>BYOC canister without ICForge as controller</td>
              <td>Human runs the <code>icp canister update-settings</code> command from the error</td>
            </tr>
            <tr>
              <td>Insufficient compute balance</td>
              <td>Account balance too low</td>
              <td>Human adds credits at icforge.dev/billing</td>
            </tr>
          </tbody>
        </table>

        <hr />

        <h2>Free Tier</h2>
        <table>
          <thead>
            <tr>
              <th>Resource</th>
              <th>Included</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Signup bonus</td><td>$25 compute credits</td></tr>
            <tr><td>Build time</td><td>$0.01/min</td></tr>
            <tr><td>Canister provisioning</td><td>~$7 per canister (4T cycles)</td></tr>
            <tr><td>Cycles auto top-up</td><td>Always on, billed from balance</td></tr>
            <tr><td>Log retention</td><td>24 hours (free), up to 30 days (paid)</td></tr>
          </tbody>
        </table>

        <hr />

        <h2>Quick Start for Agents</h2>
        <p>
          If the human has already set up ICForge on the repo, your workflow is
          just normal git:
        </p>
        <pre><code>{`# Make your changes
git add .
git commit -m "feat: add new endpoint"
git push origin main

# ICForge automatically builds and deploys
# Check deploy status at icforge.dev or via GitHub commit status`}</code></pre>
        <p>
          That's it. No CLI tools, no auth tokens, no deploy commands. Just push
          and ICForge handles the rest.
        </p>

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
