import path from "node:path";
import chalk from "chalk";
import {
  extractCanisters,
  loadICForgeConfig,
  saveICForgeConfig,
  isIcProject,
  readExistingCanisterIds,
} from "../config.js";
import { isAuthenticated } from "../auth.js";
import { apiFetch } from "../api.js";

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

  // 4. Extract canister names + recipes from icp.yaml (minimal parsing)
  const canisters = await extractCanisters();
  if (!canisters || canisters.length === 0) {
    console.log(chalk.red("No canisters defined in icp.yaml."));
    process.exit(1);
  }

  // 4b. Check for existing canister IDs (BYOC — Bring Your Own Canister)
  const existingIds = await readExistingCanisterIds();

  // 5. Show what we found
  console.log(chalk.cyan("\n\u2601\uFE0F  ICForge Init\n"));
  console.log(chalk.dim("Reading icp.yaml...\n"));

  for (const canister of canisters) {
    const recipe = canister.recipe ?? "custom";
    const existingId = existingIds[canister.name];
    if (existingId) {
      console.log(`  \u{1F4E6} ${chalk.bold(canister.name)} (${chalk.dim(recipe)}) \u2192 ${chalk.yellow("BYOC")} ${chalk.dim(existingId)}`);
    } else {
      console.log(`  \u{1F4E6} ${chalk.bold(canister.name)} (${chalk.dim(recipe)})`);
    }
  }

  console.log();

  // 6. Create project on ICForge backend
  const resp = await apiFetch('/api/v1/projects', {
    method: 'POST',
    body: JSON.stringify({
      name: (options.name as string) || path.basename(process.cwd()),
      canisters: canisters.map(c => ({
        name: c.name,
        recipe: c.recipe ?? "custom",
        canister_id: existingIds[c.name] ?? undefined,
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
  const projectData = 'project' in body ? body.project : body;
  const { id: projectId, slug } = projectData;

  // 7. Save .icforge link file
  await saveICForgeConfig({ projectId, slug: slug ?? undefined });

  console.log(chalk.green("\u2713"), "Project linked:", chalk.cyan(slug ?? projectId));
  if (slug) {
    console.log(chalk.dim(`  Vanity URL: https://${slug}.icforge.dev`));
  }
  console.log(chalk.dim("  Config saved to .icforge"));

  // Show BYOC controller reminder if any canisters have existing IDs
  const byocNames = canisters.filter(c => existingIds[c.name]).map(c => c.name);
  if (byocNames.length > 0) {
    console.log();
    console.log(chalk.yellow("\u26A0\uFE0F  BYOC canisters detected. ICForge needs controller access to deploy."));
    console.log(chalk.dim("  Ensure the ICForge identity is added as a controller for each canister:"));
    for (const name of byocNames) {
      const cid = existingIds[name];
      console.log();
      console.log(chalk.dim(`    icp canister update-settings ${cid} \\`));
      console.log(chalk.dim(`      --add-controller <icforge-principal> \\`));
      console.log(chalk.dim(`      --network ic`));
    }
    console.log();
    console.log(chalk.dim("  The exact principal will be shown in deploy logs if missing."));
  }

  // 8. Auto-link GitHub repo if in a git repo with a GitHub remote
  try {
    const { execSync } = await import("child_process");
    const remoteUrl = execSync("git remote get-url origin", { encoding: "utf-8" }).trim();
    const match = remoteUrl.match(/github\.com[:/](.+?\/.+?)(?:\.git)?$/);
    if (match) {
      const fullName = match[1];
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
            console.log(chalk.green("\u2713"), "GitHub repo linked:", chalk.cyan(fullName));
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
