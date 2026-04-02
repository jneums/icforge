import chalk from "chalk";
import {
  loadICForgeConfig,
  loadIcpManifest,
  classifyCanister,
} from "../config.js";
import { isAuthenticated } from "../auth.js";

interface DeployOptions {
  skipBuild?: boolean;
  env?: string;
}

export async function deployCommand(options: DeployOptions = {}) {
  // 1. Check auth
  if (!isAuthenticated()) {
    console.log(chalk.red("Not logged in."), "Run", chalk.cyan("icforge login"), "first.");
    process.exit(1);
  }

  // 2. Check project link
  const config = await loadICForgeConfig();
  if (!config) {
    console.log(chalk.red("Not initialized."), "Run", chalk.cyan("icforge init"), "first.");
    process.exit(1);
  }

  // 3. Read icp.yaml
  const manifest = await loadIcpManifest();
  if (!manifest || !manifest.canisters?.length) {
    console.log(chalk.red("No canisters found in icp.yaml."));
    process.exit(1);
  }

  // 4. Determine which canisters to deploy
  const toDeploy = config.canisters
    ? manifest.canisters.filter((c) => config.canisters!.includes(c.name))
    : manifest.canisters;

  console.log(chalk.cyan("\n🚀 ICForge Deploy\n"));
  console.log(chalk.dim(`  Project: ${config.projectId}`));
  console.log(chalk.dim(`  Canisters: ${toDeploy.map((c) => c.name).join(", ")}\n`));

  for (const canister of toDeploy) {
    const type = classifyCanister(canister);
    const icon = type === "frontend" ? "🌐" : "⚙️";

    console.log(`${icon} ${chalk.bold(canister.name)}`);

    // Step 1: Build (unless --skip-build)
    if (!options.skipBuild) {
      console.log(chalk.dim("  → Building..."));
      // TODO: run build command from icp.yaml recipe
      // For now: shell out to `icp build <canister.name>`
    }

    // Step 2: Collect artifacts
    console.log(chalk.dim("  → Collecting artifacts..."));
    // TODO: find .wasm, .did, and asset files based on canister type/recipe

    // Step 3: Upload to ICForge
    console.log(chalk.dim("  → Uploading..."));
    // TODO: POST /api/v1/deploy with artifacts

    // Step 4: Stream status
    console.log(chalk.dim("  → Deploying to IC..."));
    // TODO: SSE stream from /api/v1/deploy/:id/logs

    console.log(chalk.green("  ✓ Deployed"), chalk.dim("(placeholder)\n"));
  }

  console.log(chalk.green("Done!"), "Your project is live.");
  // TODO: print actual canister URLs
}
