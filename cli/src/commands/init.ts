import chalk from "chalk";
import {
  loadIcpManifest,
  loadICForgeConfig,
  saveICForgeConfig,
  classifyCanister,
  isIcProject,
} from "../config.js";
import { isAuthenticated } from "../auth.js";

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

  // 5. Show what we found
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
  // TODO: POST /api/v1/projects with canister info from manifest
  const projectId = `proj_${Date.now()}`; // placeholder until backend is wired

  // 7. Save .icforge link file
  await saveICForgeConfig({ projectId });

  console.log(chalk.green("✓"), "Project linked:", chalk.cyan(projectId));
  console.log(chalk.dim("  Config saved to .icforge"));
  console.log();
  console.log("Next: run", chalk.cyan("icforge deploy"), "to deploy to the Internet Computer.");
}
