import { execSync } from "node:child_process";
import chalk from "chalk";
import ora from "ora";
import { loadICForgeConfig } from "../config.js";
import { isAuthenticated } from "../auth.js";
import { getApiUrl, apiFetch } from "../api.js";

interface DeployOptions {
  canister?: string;
}

/**
 * Get git info for the current working directory.
 */
function getGitInfo(): { sha?: string; branch?: string; message?: string } {
  const result: { sha?: string; branch?: string; message?: string } = {};
  try {
    result.sha = execSync("git rev-parse HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    // not a git repo or git not available
  }
  try {
    result.branch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
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
 * Stream build logs via SSE until the build reaches a terminal state.
 * Returns the final build status.
 */
async function streamDeployLogs(deployId: string): Promise<{ status: string; error?: string }> {
  const apiUrl = getApiUrl();
  const { getToken } = await import("../auth.js");
  const token = await getToken();

  const url = `${apiUrl}/api/v1/deploy/${deployId}/logs/stream`;
  const headers: Record<string, string> = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  // Try SSE streaming first
  try {
    const response = await fetch(url, { headers });
    if (response.ok && response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = ""; // tracks the SSE "event:" field
      let finalStatus = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6).trim();

            if (currentEvent === "done") {
              // Terminal event — data is the final status (e.g. "live", "failed")
              finalStatus = data;
              return { status: finalStatus };
            } else if (currentEvent === "status") {
              // Status update — track it but keep streaming
              finalStatus = data;
            } else if (currentEvent === "log" || currentEvent === "") {
              // Log event — parse JSON and print
              try {
                const evt = JSON.parse(data) as { level: string; message: string };
                const levelColor =
                  evt.level === "error" ? chalk.red :
                  evt.level === "warn" ? chalk.yellow :
                  chalk.dim;
                console.log(`  ${levelColor(`[${evt.level}]`)} ${evt.message}`);
              } catch {
                // non-JSON SSE data, print as-is
                if (data) console.log(`  ${chalk.dim(data)}`);
              }
            }

            // Reset event type after processing data
            currentEvent = "";
          }
        }
      }

      // Stream ended without explicit "done" event — use last known status
      if (finalStatus) {
        return { status: finalStatus };
      }
    }
  } catch {
    // SSE not available — fall back to polling
  }

  // Fallback: poll build status
  const spinner = ora({ text: "Building...", prefixText: "  " }).start();
  let lastLogCount = 0;

  while (true) {
    await new Promise((r) => setTimeout(r, 2000));

    try {
      const deployResp = await apiFetch(`/api/v1/deployments/${deployId}`);
      if (!deployResp.ok) {
        spinner.text = `Waiting for build status... (${deployResp.status})`;
        continue;
      }

      const buildData = (await deployResp.json()) as {
        deployment: { status: string; error_message?: string };
        logs: Array<{ level: string; message: string }>;
      };

      // Print new logs
      const newLogs = buildData.logs.slice(lastLogCount);
      for (const log of newLogs) {
        spinner.stop();
        const levelColor =
          log.level === "error" ? chalk.red :
          log.level === "warn" ? chalk.yellow :
          chalk.dim;
        console.log(`  ${levelColor(`[${log.level}]`)} ${log.message}`);
        spinner.start();
      }
      lastLogCount = buildData.logs.length;

      spinner.text = `Status: ${buildData.deployment.status}`;

      if (["live", "failed", "cancelled"].includes(buildData.deployment.status)) {
        spinner.stop();
        return { status: buildData.deployment.status, error: buildData.deployment.error_message ?? undefined };
      }
    } catch {
      spinner.text = "Waiting for build status...";
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

  // 3. Get git info
  const git = getGitInfo();
  if (!git.sha) {
    console.log(chalk.red("Not a git repository."), "ICForge deploys from git commits.");
    process.exit(1);
  }

  console.log(chalk.cyan("\n\u{1F680} ICForge Deploy\n"));
  console.log(chalk.dim(`  Project: ${config.projectId}`));
  console.log(chalk.dim(`  Commit:  ${git.sha?.slice(0, 7)} ${git.message ?? ""}`));
  console.log(chalk.dim(`  Branch:  ${git.branch ?? "unknown"}`));
  if (options.canister) {
    console.log(chalk.dim(`  Canister: ${options.canister}`));
  }
  console.log();

  // 4. Trigger server-side build
  const spinner = ora({ text: "Triggering build...", prefixText: "  " }).start();

  const body: Record<string, string> = {
    project_id: config.projectId,
    commit_sha: git.sha!,
    branch: git.branch ?? "main",
    trigger: "cli",
  };
  if (options.canister) {
    body.canister_name = options.canister;
  }

  const response = await apiFetch("/api/v1/deployments", {
    method: "POST",
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    spinner.fail("Failed to trigger build");
    const text = await response.text();
    console.log(chalk.red(`  API error (${response.status}): ${text}`));
    process.exit(1);
  }

  const data = (await response.json()) as { deployment_id: string };
  spinner.succeed(`Deploy triggered: ${chalk.dim(data.deployment_id.slice(0, 8))}`);

  // 5. Stream build logs
  console.log();
  const result = await streamDeployLogs(data.deployment_id);

  // 6. Print summary
  console.log();
  if (result.status === "live") {
    console.log(chalk.green("  \u2713 Deploy complete!"));
    console.log(chalk.dim(`  View status: icforge status`));
  } else if (result.status === "failed") {
    console.log(chalk.red("  \u2717 Deploy failed"));
    if (result.error) {
      console.log(chalk.red(`  ${result.error}`));
    }
    process.exit(1);
  } else {
    console.log(chalk.yellow(`  Build status: ${result.status}`));
  }
  console.log();
}
