import path from "node:path";
import chalk from "chalk";
import {
  loadIcpManifest,
  loadICForgeConfig,
  saveICForgeConfig,
  classifyCanister,
  isIcProject,
} from "../config.js";
import { isAuthenticated } from "../auth.js";
import { apiFetch } from "../api.js";
import { topoSortCanisters } from "./deploy.js";

export async function initCommand(options: Record<string, unknown> = {}) {
  // 1. Check auth
  if (!isAuthenticated()) {
    console.log(chalk.red("Not logged in."), "Run", chalk.cyan("icforge login"), "first.");
    process.exit(1);
  }

  // 2. Check for existing link
  const existing = await loadICForgeConfig();
  if (existing) {
    console.log(chalk.yellow("Already initialized."), `Project ID: ${chalk.cyan(existing.projectId)}`);
    console.log("Run", chalk.cyan("icforge deploy"), "to deploy.");
    return;
  }

  // 3. Check for icp.yaml
  if (!isIcProject()) {
    console.log(chalk.red("No icp.yaml found in current directory."));
    console.log("Initialize your IC project first with", chalk.cyan("icp new"), "or create an icp.yaml.");
    process.exit(1);
  }

  // 4. Parse icp.yaml
  const manifest = await loadIcpManifest();
  if (!manifest || !manifest.canisters?.length) {
    console.log(chalk.red("No canisters defined in icp.yaml."));
    process.exit(1);
  }

  // 5. Validate dependency graph (detect circular deps early)
  try {
    const sorted = topoSortCanisters(manifest.canisters);
    const hasDeps = manifest.canisters.some((c) => c.dependencies?.length);
    if (hasDeps) {
      console.log(chalk.dim(`  Deploy order: ${sorted.map((c) => c.name).join(" → ")}\n`));
    }
  } catch (err) {
    console.log(chalk.red(`\n✗ ${(err as Error).message}`));
    console.log(chalk.dim("  Fix the dependencies in icp.yaml and try again."));
    process.exit(1);
  }

  // 6. Show what we found
  console.log(chalk.cyan("\n☁️  ICForge Init\n"));
  console.log(chalk.dim("Reading icp.yaml...\n"));

  for (const canister of manifest.canisters) {
    const type = classifyCanister(canister);
    const icon = type === "frontend" ? "🌐" : "⚙️";
    const recipe = canister.recipe?.type ?? "custom build";
    console.log(`  ${icon} ${chalk.bold(canister.name)} — ${type} (${chalk.dim(recipe)})`);
  }

  console.log();

  // 6. Create project on ICForge backend
  const resp = await apiFetch('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: (options.name as string) || path.basename(process.cwd()),
      canisters: manifest.canisters.map(c => ({
        name: c.name,
        type: classifyCanister(c),
      })),
      subnet: undefined,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.log(chalk.red('Failed to create project:'), err);
    process.exit(1);
  }

  const body = await resp.json() as { project: { id: string; slug?: string } } | { id: string; slug?: string };
  // Handle both wrapped and unwrapped response shapes
  const projectData = 'project' in body ? body.project : body;
  const { id: projectId, slug } = projectData;

  // 7. Save .icforge link file
  await saveICForgeConfig({ projectId, slug: slug ?? undefined });

  console.log(chalk.green("✓"), "Project linked:", chalk.cyan(slug ?? projectId));
  if (slug) {
    console.log(chalk.dim(`  Vanity URL: https://${slug}.icforge.dev`));
  }
  console.log(chalk.dim("  Config saved to .icforge"));

  // 8. Auto-link GitHub repo if in a git repo with a GitHub remote
  try {
    const { execSync } = await import("child_process");
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    // Extract owner/repo from GitHub URL (HTTPS or SSH)
    const match = remoteUrl.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    if (match) {
      const fullName = match[1];
      // Fetch user's GitHub repos from the installation
      const reposResp = await apiFetch('/api/v1/github/repos');
      if (reposResp.ok) {
        const reposBody = await reposResp.json() as { repos: Array<{ id: string; full_name: string }> };
        const repos = reposBody.repos ?? [];
        const repoRecord = repos.find((r: { full_name: string }) => r.full_name === fullName);
        if (repoRecord) {
          const linkResp = await apiFetch('/api/v1/github/link', {
            method: 'POST',
            body: JSON.stringify({
              project_id: projectId,
              github_repo_id: repoRecord.id,
              production_branch: "main",
            }),
          });
          if (linkResp.ok) {
            console.log(chalk.green("✓"), "GitHub repo linked:", chalk.cyan(fullName));
            console.log(chalk.dim("  Pushes to main will auto-deploy."));
          }
        } else {
          console.log(chalk.dim(`  GitHub repo ${fullName} not found — install the ICForge app on it first.`));
        }
      }
    }
  } catch {
    // Not a git repo or no remote — skip silently
  }

  console.log();
  console.log("Next: run", chalk.cyan("icforge deploy"), "to deploy to the Internet Computer.");
}
