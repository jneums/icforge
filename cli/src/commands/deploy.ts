import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, createReadStream } from "node:fs";
import { writeFile, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import chalk from "chalk";
import ora from "ora";
import {
  loadICForgeConfig,
  loadIcpManifest,
  classifyCanister,
  type IcpCanister,
} from "../config.js";
import { isAuthenticated, getToken } from "../auth.js";
import { getApiUrl, apiFetch } from "../api.js";

interface DeployOptions {
  skipBuild?: boolean;
  env?: string;
  wasm?: string;
}

/**
 * Try to run a shell command, returning true on success.
 */
function tryExec(cmd: string, label: string): boolean {
  try {
    console.log(chalk.dim(`  → ${label}`));
    execSync(cmd, { stdio: "inherit", cwd: process.cwd() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get git info for the current working directory.
 */
function getGitInfo(): { sha?: string; message?: string } {
  const result: { sha?: string; message?: string } = {};
  try {
    result.sha = execSync("git rev-parse HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // not a git repo or git not available
  }
  try {
    result.message = execSync("git log -1 --format=%s", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // not a git repo or git not available
  }
  return result;
}

/**
 * Find the .wasm artifact for a canister.
 * Search order:
 *   1. Explicit --wasm path
 *   2. .icp/cache/ directory (icp-cli projects)
 *   3. .dfx/local/canisters/{name}/ directory (dfx projects)
 */
function findWasm(canisterName: string, explicitPath?: string): string | null {
  // 1. Explicit path
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (existsSync(resolved)) return resolved;
    console.log(chalk.red(`  ✗ Specified wasm file not found: ${resolved}`));
    return null;
  }

  // 2. .icp/cache/ directory
  const icpCacheDir = join(process.cwd(), ".icp", "cache");
  if (existsSync(icpCacheDir)) {
    const wasm = findWasmInDir(icpCacheDir, canisterName);
    if (wasm) return wasm;
  }

  // 3. .dfx/local/canisters/{name}/
  const dfxDir = join(process.cwd(), ".dfx", "local", "canisters", canisterName);
  if (existsSync(dfxDir)) {
    const wasm = findWasmInDir(dfxDir, canisterName);
    if (wasm) return wasm;
  }

  return null;
}

/**
 * Find a .wasm file in a directory, preferring one matching the canister name.
 */
function findWasmInDir(dir: string, canisterName: string): string | null {
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".wasm"));
    if (files.length === 0) return null;

    // Prefer file matching canister name
    const match = files.find((f) => f.includes(canisterName));
    const chosen = match ?? files[0];
    return join(dir, chosen);
  } catch {
    return null;
  }
}

/**
 * Build a canister. Tries `icp build` first, then falls back to `dfx build`.
 */
function buildCanister(canister: IcpCanister): boolean {
  // Try icp-cli first
  if (tryExec(`icp build ${canister.name}`, `Building with icp-cli...`)) {
    return true;
  }
  console.log(chalk.dim("  → icp-cli not available, trying dfx..."));

  // Fallback to dfx
  if (tryExec(`dfx build ${canister.name}`, `Building with dfx...`)) {
    return true;
  }

  console.log(chalk.red("  ✗ Build failed. Neither icp nor dfx succeeded."));
  console.log(chalk.dim("    Use --skip-build and --wasm <path> to provide a pre-built artifact."));
  return false;
}

/**
 * Create a .tar.gz from a directory. Uses the `tar` command for simplicity.
 * Returns the path to the created tarball.
 */
async function createAssetsTarball(sourceDir: string, canisterName: string): Promise<string | null> {
  const resolvedSource = resolve(sourceDir);
  if (!existsSync(resolvedSource)) {
    console.log(chalk.yellow(`  ⚠ Source directory not found: ${resolvedSource}`));
    return null;
  }

  const tarballPath = join("/tmp", `icforge_assets_${canisterName}_${Date.now()}.tar.gz`);
  try {
    execSync(`tar -czf ${tarballPath} -C ${resolvedSource} .`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return tarballPath;
  } catch (e) {
    console.log(chalk.yellow(`  ⚠ Failed to create assets tarball: ${e}`));
    return null;
  }
}

/**
 * Upload a wasm artifact to the ICForge backend.
 */
async function uploadArtifact(
  projectId: string,
  canisterName: string,
  wasmPath: string,
  assetsTarballPath?: string | null,
): Promise<{ deploymentId: string; statusUrl: string } | null> {
  const token=getToken();
  const apiUrl = getApiUrl();

  const wasmBytes = readFileSync(wasmPath);
  const wasmBlob = new Blob([wasmBytes], { type: "application/wasm" });

  const formData = new FormData();
  formData.append("project_id", projectId);
  formData.append("canister_name", canisterName);
  formData.append("wasm", wasmBlob, `${canisterName}.wasm`);

  // Attach assets tarball if provided
  if (assetsTarballPath) {
    const assetsBytes = readFileSync(assetsTarballPath);
    const assetsBlob = new Blob([assetsBytes], { type: "application/gzip" });
    formData.append("assets", assetsBlob, "assets.tar.gz");
  }

  // Attach git info if available
  const git = getGitInfo();
  if (git.sha) formData.append("commit_sha", git.sha);
  if (git.message) formData.append("commit_message", git.message);

  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}/api/v1/deploy`, {
    method: "POST",
    headers,
    body: formData,
  });

  if (!response.ok) {
    const text = await response.text();
    console.log(chalk.red(`  ✗ Upload failed (${response.status}): ${text}`));
    return null;
  }

  const data = (await response.json()) as { deployment_id: string; status_url: string };
  return { deploymentId: data.deployment_id, statusUrl: data.status_url };
}

interface DeploymentStatus {
  deployment_id: string;
  status: string;
  url?: string;
  canister_id?: string;
  error?: string;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

/**
 * Poll deployment status until it reaches a terminal state.
 */
async function pollDeployment(
  statusUrl: string,
  deploymentId: string,
): Promise<DeploymentStatus> {
  const spinner = ora({
    text: "Deploying to the Internet Computer...",
    prefixText: "  ",
  }).start();

  let lastLogIndex = 0;

  while (true) {
    // Small delay between polls
    await new Promise((r) => setTimeout(r, 2000));

    try {
      // Fetch new logs
      const logsResponse = await apiFetch(`/api/v1/deploy/${deploymentId}/logs`);
      if (logsResponse.ok) {
        const logsData = (await logsResponse.json()) as { logs: LogEntry[] };
        const newLogs = logsData.logs.slice(lastLogIndex);

        for (const log of newLogs) {
          spinner.stop();
          const levelColor =
            log.level === "error" ? chalk.red :
            log.level === "warn" ? chalk.yellow :
            chalk.dim;
          console.log(`  ${levelColor(`[${log.level}]`)} ${log.message}`);
          spinner.start();
        }

        lastLogIndex = logsData.logs.length;
      }

      // Fetch status
      const statusResponse = await apiFetch(statusUrl);
      if (!statusResponse.ok) {
        spinner.text = `Waiting for deployment status... (${statusResponse.status})`;
        continue;
      }

      const status = (await statusResponse.json()) as DeploymentStatus;
      spinner.text = `Status: ${status.status}`;

      if (status.status === "live" || status.status === "failed") {
        spinner.stop();
        return status;
      }
    } catch (err) {
      // Network error — keep polling
      spinner.text = "Waiting for deployment status...";
    }
  }
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
  console.log(chalk.dim(`  Environment: ${options.env ?? "production"}`));
  console.log(chalk.dim(`  Canisters: ${toDeploy.map((c) => c.name).join(", ")}\n`));

  let allSucceeded = true;

  for (const canister of toDeploy) {
    const type = classifyCanister(canister);
    const icon = type === "frontend" ? "🌐" : "⚙️";

    console.log(`${icon} ${chalk.bold(canister.name)}`);

    // Step 1: Build (unless --skip-build)
    if (!options.skipBuild) {
      const built = buildCanister(canister);
      if (!built) {
        allSucceeded = false;
        console.log(chalk.red(`  ✗ Skipping ${canister.name} due to build failure\n`));
        continue;
      }
      console.log(chalk.green("  ✓ Build complete"));
    } else {
      console.log(chalk.dim("  → Skipping build (--skip-build)"));
    }

    // Step 2: Find artifacts
    console.log(chalk.dim("  → Locating wasm artifact..."));
    const wasmPath = findWasm(canister.name, options.wasm);
    if (!wasmPath) {
      allSucceeded = false;
      console.log(chalk.red(`  ✗ No .wasm file found for ${canister.name}`));
      console.log(chalk.dim("    Checked: .icp/cache/, .dfx/local/canisters/"));
      console.log(chalk.dim("    Hint: use --wasm <path> to specify the artifact manually"));
      console.log();
      continue;
    }
    console.log(chalk.dim(`  → Found: ${wasmPath}`));

    // Step 3: For frontend canisters, create assets tarball from source dir
    let assetsTarball: string | null = null;
    const canisterType = classifyCanister(canister);
    if (canisterType === "frontend" && canister.source) {
      console.log(chalk.dim(`  → Packaging static assets from ${canister.source}...`));
      assetsTarball = await createAssetsTarball(canister.source, canister.name);
      if (assetsTarball) {
        console.log(chalk.green("  ✓ Assets packaged"));
      } else {
        console.log(chalk.yellow("  ⚠ No assets to upload — deploying WASM only"));
      }
    }

    // Step 4: Upload to ICForge
    console.log(chalk.dim("  → Uploading artifact to ICForge..."));
    const deployment = await uploadArtifact(config.projectId, canister.name, wasmPath, assetsTarball);

    // Clean up local tarball
    if (assetsTarball) {
      try { execSync(`rm -f ${assetsTarball}`, { stdio: "pipe" }); } catch {}
    }

    if (!deployment) {
      allSucceeded = false;
      console.log(chalk.red(`  ✗ Upload failed for ${canister.name}\n`));
      continue;
    }
    console.log(chalk.green(`  ✓ Uploaded`), chalk.dim(`(deployment: ${deployment.deploymentId})`));

    // Step 4: Poll for status
    const result = await pollDeployment(deployment.statusUrl, deployment.deploymentId);

    if (result.status === "live") {
      console.log(chalk.green(`  ✓ Deployed!`));
      if (result.canister_id) {
        console.log(chalk.dim(`    Canister ID: ${result.canister_id}`));
      }
      if (result.url) {
        console.log(`    ${chalk.cyan(result.url)}`);
      }
    } else {
      allSucceeded = false;
      console.log(chalk.red(`  ✗ Deployment failed`));
      if (result.error) {
        console.log(chalk.red(`    Error: ${result.error}`));
      }
    }
    console.log();
  }

  if (allSucceeded) {
    console.log(chalk.green("✅ All canisters deployed successfully!"));
  } else {
    console.log(chalk.yellow("⚠️  Some canisters failed to deploy. Check the output above."));
    process.exit(1);
  }
}
