import { execSync } from "node:child_process";
import { readFileSync, existsSync, readdirSync, createReadStream, mkdirSync } from "node:fs";
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
  canister?: string;
}

// ============================================================
// Canister ID tracking — .icforge/canister_ids.json
// ============================================================

const CANISTER_IDS_DIR = ".icforge";
const CANISTER_IDS_FILE = ".icforge/canister_ids.json";

/** Load the canister_ids.json mapping (name → canister ID). */
function loadCanisterIds(dir: string = process.cwd()): Record<string, string> {
  const filePath = join(dir, CANISTER_IDS_FILE);
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    return {};
  }
}

/** Save the canister_ids.json mapping. */
async function saveCanisterIds(ids: Record<string, string>, dir: string = process.cwd()) {
  const dirPath = join(dir, CANISTER_IDS_DIR);
  mkdirSync(dirPath, { recursive: true });
  await writeFile(join(dir, CANISTER_IDS_FILE), JSON.stringify(ids, null, 2) + "\n");
}

// ============================================================
// Topological sort — deploy dependencies before dependents
// ============================================================

/**
 * Topological sort of canisters by their `dependencies` field.
 * Returns canisters in deploy order (dependencies first).
 * Throws if circular dependencies are detected.
 */
export function topoSortCanisters(canisters: IcpCanister[]): IcpCanister[] {
  const nameMap = new Map(canisters.map((c) => [c.name, c]));
  const visited = new Set<string>();
  const inStack = new Set<string>(); // cycle detection
  const sorted: IcpCanister[] = [];

  function visit(name: string, path: string[]) {
    if (inStack.has(name)) {
      const cycle = [...path.slice(path.indexOf(name)), name].join(" → ");
      throw new Error(`Circular dependency detected: ${cycle}`);
    }
    if (visited.has(name)) return;

    inStack.add(name);
    path.push(name);

    const canister = nameMap.get(name);
    if (canister?.dependencies) {
      for (const dep of canister.dependencies) {
        if (!nameMap.has(dep)) {
          throw new Error(`Canister "${name}" depends on "${dep}", which is not defined in icp.yaml`);
        }
        visit(dep, [...path]);
      }
    }

    inStack.delete(name);
    visited.add(name);
    sorted.push(canister!);
  }

  for (const c of canisters) {
    visit(c.name, []);
  }

  return sorted;
}

/**
 * Build environment variables with canister IDs for dependent builds.
 * Sets CANISTER_ID_<UPPER_NAME>=<id> for each known canister.
 */
function buildEnvWithCanisterIds(canisterIds: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, id] of Object.entries(canisterIds)) {
    const envKey = `CANISTER_ID_${name.toUpperCase().replace(/-/g, "_")}`;
    env[envKey] = id;
  }
  return env;
}

// ============================================================
// Deploy result tracking for summary table
// ============================================================

interface DeployResult {
  name: string;
  type: string;
  canisterId?: string;
  status: "live" | "failed" | "skipped";
  error?: string;
  url?: string;
}

/**
 * Try to run a shell command, returning true on success.
 * Merges extraEnv into the process environment.
 */
function tryExec(cmd: string, label: string, extraEnv?: Record<string, string>): boolean {
  try {
    console.log(chalk.dim(`  → ${label}`));
    execSync(cmd, {
      stdio: "inherit",
      cwd: process.cwd(),
      env: extraEnv ? { ...process.env, ...extraEnv } : process.env,
    });
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
 *   1. Explicit --wasm CLI flag
 *   2. Canister's `wasm` field from icp.yaml
 *   3. Rust target directory: target/wasm32-unknown-unknown/release/<name>.wasm
 *   4. .icp/cache/artifacts/<name> (icp-cli build output — may be gzipped)
 *   5. .icp/cache/ directory (other .wasm files)
 */
function findWasm(canisterName: string, explicitPath?: string, canisterWasmField?: string): string | null {
  // 1. Explicit --wasm CLI flag
  if (explicitPath) {
    const resolved = resolve(explicitPath);
    if (existsSync(resolved)) return resolved;
    console.log(chalk.red(`  ✗ Specified wasm file not found: ${resolved}`));
    return null;
  }

  // 2. Canister's `wasm` field from icp.yaml
  if (canisterWasmField) {
    const resolved = resolve(canisterWasmField);
    if (existsSync(resolved)) return resolved;
    console.log(chalk.yellow(`  ⚠ icp.yaml wasm path not found: ${resolved}`));
  }

  // 3. Rust target directory
  const rustWasm = join(process.cwd(), "target", "wasm32-unknown-unknown", "release", `${canisterName}.wasm`);
  if (existsSync(rustWasm)) {
    return rustWasm;
  }

  // 4. icp-cli artifact: .icp/cache/artifacts/<name> (gzipped wasm, no extension)
  const icpArtifact = join(process.cwd(), ".icp", "cache", "artifacts", canisterName);
  if (existsSync(icpArtifact)) {
    return icpArtifact;
  }

  // 5. .icp/cache/ directory (scan for .wasm files)
  const icpCacheDir = join(process.cwd(), ".icp", "cache");
  if (existsSync(icpCacheDir)) {
    const wasm = findWasmInDir(icpCacheDir, canisterName);
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
 * Build a canister.
 * If the canister has a `build` array in icp.yaml, run each command sequentially.
 * Otherwise, fall back to `icp build <name>`.
 * Injects CANISTER_ID_<NAME> env vars so builds can reference dependency IDs.
 */
function buildCanister(canister: IcpCanister, canisterIdEnv: Record<string, string>): boolean {
  // Use custom build commands from icp.yaml if provided
  if (canister.build && canister.build.length > 0) {
    for (const cmd of canister.build) {
      if (!tryExec(cmd, cmd, canisterIdEnv)) {
        console.log(chalk.red(`  ✗ Custom build command failed: ${cmd}`));
        console.log(chalk.dim("    Or use --skip-build and --wasm <path> to provide a pre-built artifact."));
        return false;
      }
    }
    return true;
  }

  // Fallback: use icp-cli
  if (tryExec(`icp build ${canister.name}`, `Building with icp-cli...`, canisterIdEnv)) {
    return true;
  }

  console.log(chalk.red("  ✗ Build failed. Is icp-cli installed?"));
  console.log(chalk.dim("    Install: npm install -g @icp-sdk/icp-cli"));
  console.log(chalk.dim("    Or use --skip-build and --wasm <path> to provide a pre-built artifact."));
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
  initArg?: string,
  candidPath?: string,
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

  // Attach init arg if provided
  if (initArg) {
    formData.append("init_arg", initArg);
  }

  // Attach candid interface if provided
  if (candidPath) {
    const resolvedCandid = resolve(candidPath);
    if (existsSync(resolvedCandid)) {
      const candidContent = readFileSync(resolvedCandid, "utf-8");
      formData.append("candid", candidContent);
    } else {
      console.log(chalk.yellow(`  ⚠ Candid file not found: ${resolvedCandid}`));
    }
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

  // 4. Topological sort — deploy dependencies before dependents
  let sorted: IcpCanister[];
  try {
    sorted = topoSortCanisters(manifest.canisters);
  } catch (err) {
    console.log(chalk.red(`\n✗ ${(err as Error).message}`));
    process.exit(1);
  }

  // 5. Filter by --canister flag or .icforge canisters list
  let toDeploy: IcpCanister[];
  if (options.canister) {
    const match = sorted.find((c) => c.name === options.canister);
    if (!match) {
      console.log(chalk.red(`Canister "${options.canister}" not found in icp.yaml.`));
      console.log(chalk.dim(`Available: ${sorted.map((c) => c.name).join(", ")}`));
      process.exit(1);
    }
    toDeploy = [match];
  } else if (config.canisters) {
    toDeploy = sorted.filter((c) => config.canisters!.includes(c.name));
  } else {
    toDeploy = sorted;
  }

  console.log(chalk.cyan("\n🚀 ICForge Deploy\n"));
  console.log(chalk.dim(`  Project: ${config.projectId}`));
  console.log(chalk.dim(`  Environment: ${options.env ?? "production"}`));
  console.log(chalk.dim(`  Canisters: ${toDeploy.map((c) => c.name).join(" → ")}  (deploy order)\n`));

  // 6. Load existing canister IDs (from previous deploys)
  const canisterIds = loadCanisterIds();
  const results: DeployResult[] = [];

  for (const canister of toDeploy) {
    const type = classifyCanister(canister);
    const icon = type === "frontend" ? "🌐" : "⚙️";

    console.log(`${icon} ${chalk.bold(canister.name)} ${chalk.dim(`(${type})`)}`);

    // Build env with all known canister IDs for dependency injection
    const canisterIdEnv = buildEnvWithCanisterIds(canisterIds);

    // Log injected IDs if this canister has dependencies
    if (canister.dependencies?.length) {
      const injected = canister.dependencies
        .filter((d) => canisterIds[d])
        .map((d) => `${d}=${canisterIds[d]}`);
      if (injected.length) {
        console.log(chalk.dim(`  → Injecting: ${injected.join(", ")}`));
      }
    }

    // Step 1: Build (unless --skip-build)
    if (!options.skipBuild) {
      const built = buildCanister(canister, canisterIdEnv);
      if (!built) {
        results.push({ name: canister.name, type, status: "failed", error: "Build failed" });
        console.log(chalk.red(`  ✗ Skipping ${canister.name} due to build failure\n`));
        // Abort remaining deploys on failure (dependencies may be broken)
        console.log(chalk.red("  ✗ Aborting remaining deploys."));
        break;
      }
      console.log(chalk.green("  ✓ Build complete"));
    } else {
      console.log(chalk.dim("  → Skipping build (--skip-build)"));
    }

    // Step 2: Find artifacts
    console.log(chalk.dim("  → Locating wasm artifact..."));
    const wasmPath = findWasm(canister.name, options.wasm, canister.wasm);
    if (!wasmPath) {
      results.push({ name: canister.name, type, status: "failed", error: "No wasm found" });
      console.log(chalk.red(`  ✗ No .wasm file found for ${canister.name}`));
      console.log(chalk.dim("    Checked: icp.yaml wasm field, target/wasm32-unknown-unknown/release/, .icp/cache/artifacts/, .icp/cache/"));
      console.log(chalk.dim("    Hint: use --wasm <path> to specify the artifact manually"));
      console.log();
      console.log(chalk.red("  ✗ Aborting remaining deploys."));
      break;
    }
    console.log(chalk.dim(`  → Found: ${wasmPath}`));

    // Step 3: For frontend canisters, create assets tarball from source dir
    //         Backend canisters skip asset packaging entirely
    let assetsTarball: string | null = null;
    const canisterType = classifyCanister(canister);
    if (canisterType === "frontend") {
      // Source dir: explicit `source` field, or `recipe.configuration.dir` for asset canisters
      const assetSourceDir = canister.source
        ?? (canister.recipe?.configuration?.dir as string | undefined)
        ?? null;
      if (assetSourceDir) {
        console.log(chalk.dim(`  → Packaging static assets from ${assetSourceDir}...`));
        assetsTarball = await createAssetsTarball(assetSourceDir, canister.name);
        if (assetsTarball) {
          console.log(chalk.green("  ✓ Assets packaged"));
        } else {
          console.log(chalk.yellow("  ⚠ No assets to upload — deploying WASM only"));
        }
      }
    } else {
      console.log(chalk.dim("  → Backend canister — skipping asset packaging"));
    }

    // Step 4: Resolve candid path relative to project root
    const candidPath = canister.candid ? resolve(canister.candid) : undefined;

    // Step 5: Upload to ICForge
    console.log(chalk.dim("  → Uploading artifact to ICForge..."));
    const deployment = await uploadArtifact(
      config.projectId,
      canister.name,
      wasmPath,
      assetsTarball,
      canister.init_arg,
      candidPath,
    );

    // Clean up local tarball
    if (assetsTarball) {
      try { execSync(`rm -f ${assetsTarball}`, { stdio: "pipe" }); } catch {}
    }

    if (!deployment) {
      results.push({ name: canister.name, type, status: "failed", error: "Upload failed" });
      console.log(chalk.red(`  ✗ Upload failed for ${canister.name}\n`));
      console.log(chalk.red("  ✗ Aborting remaining deploys."));
      break;
    }
    console.log(chalk.green(`  ✓ Uploaded`), chalk.dim(`(deployment: ${deployment.deploymentId})`));

    // Step 6: Poll for status
    const result = await pollDeployment(deployment.statusUrl, deployment.deploymentId);

    if (result.status === "live") {
      console.log(chalk.green(`  ✓ Deployed!`));
      if (result.canister_id) {
        console.log(chalk.dim(`    Canister ID: ${result.canister_id}`));
        // Track canister ID for subsequent builds + persist to disk
        canisterIds[canister.name] = result.canister_id;
        await saveCanisterIds(canisterIds);
      }
      if (result.url) {
        console.log(`    ${chalk.cyan(result.url)}`);
      }
      results.push({
        name: canister.name,
        type,
        status: "live",
        canisterId: result.canister_id,
        url: result.url,
      });
    } else {
      results.push({
        name: canister.name,
        type,
        status: "failed",
        error: result.error ?? "Unknown error",
      });
      console.log(chalk.red(`  ✗ Deployment failed`));
      if (result.error) {
        console.log(chalk.red(`    Error: ${result.error}`));
      }
      console.log();
      console.log(chalk.red("  ✗ Aborting remaining deploys."));
      break;
    }
    console.log();
  }

  // 7. Print summary table
  printSummaryTable(results, config.projectId, config.slug);
}

/**
 * Print a summary table of all deploy results.
 */
function printSummaryTable(results: DeployResult[], projectId: string, slug?: string) {
  if (results.length === 0) return;

  const allSucceeded = results.every((r) => r.status === "live");

  console.log(chalk.dim("─".repeat(72)));
  console.log(chalk.bold("\n  Deploy Summary\n"));

  // Calculate column widths
  const nameWidth = Math.max(8, ...results.map((r) => r.name.length)) + 2;
  const idWidth = Math.max(12, ...results.map((r) => (r.canisterId ?? "—").length)) + 2;

  // Header
  const header = `  ${"Name".padEnd(nameWidth)}${"Canister ID".padEnd(idWidth)}Status`;
  console.log(chalk.dim(header));
  console.log(chalk.dim(`  ${"─".repeat(nameWidth)}${"─".repeat(idWidth)}${"─".repeat(10)}`));

  // Rows
  for (const r of results) {
    const statusIcon = r.status === "live" ? chalk.green("✓ live")
      : r.status === "failed" ? chalk.red("✗ failed")
      : chalk.yellow("○ skipped");
    const id = r.canisterId ?? chalk.dim("—");
    console.log(`  ${r.name.padEnd(nameWidth)}${(r.canisterId ?? "—").padEnd(idWidth)}${statusIcon}`);
  }

  console.log();

  if (allSucceeded) {
    console.log(chalk.green("✅ All canisters deployed successfully!"));
    if (slug) {
      console.log(`\n  ${chalk.cyan(`https://${slug}.icforge.dev`)}`);
    }
    const dashboardUrl = process.env.ICFORGE_DASHBOARD_URL ?? "https://icforge.dev";
    console.log(chalk.dim(`\n  Dashboard: ${dashboardUrl}/projects/${projectId}`));
  } else {
    console.log(chalk.yellow("⚠️  Some canisters failed to deploy. Check the output above."));
    process.exit(1);
  }
}
