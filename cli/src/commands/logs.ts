import chalk from "chalk";
import ora from "ora";
import { loadICForgeConfig } from "../config.js";
import { isAuthenticated } from "../auth.js";
import { apiFetch, getApiUrl } from "../api.js";
import { getToken } from "../auth.js";

// ============================================================
// Type definitions
// ============================================================

interface Deployment {
  id: string;
  project_id: string;
  canister_name: string;
  status: string;
  commit_sha: string | null;
  commit_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
}

interface ProjectResponse {
  project: {
    id: string;
    name: string;
    slug: string;
    canisters: unknown[];
  };
  deployments: Deployment[];
}

interface LogsOptions {
  deploy?: string;
  follow?: boolean;
}

// ============================================================
// Log formatting helpers
// ============================================================

function colorLevel(level: string): string {
  switch (level.toLowerCase()) {
    case "error":
      return chalk.red.bold("[ERROR]");
    case "warn":
    case "warning":
      return chalk.yellow("[WARN] ");
    case "info":
      return chalk.blue("[INFO] ");
    case "debug":
      return chalk.dim("[DEBUG]");
    default:
      return chalk.dim(`[${level.toUpperCase()}]`);
  }
}

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    return chalk.dim(
      d.toLocaleTimeString("en-US", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    );
  } catch {
    return chalk.dim(ts);
  }
}

function printLogEntry(entry: LogEntry): void {
  console.log(`  ${formatTimestamp(entry.timestamp)} ${colorLevel(entry.level)} ${entry.message}`);
}

function colorStatus(status: string): string {
  switch (status) {
    case "live":
      return chalk.green(status);
    case "failed":
    case "error":
      return chalk.red(status);
    case "deploying":
    case "building":
    case "queued":
    case "in_progress":
      return chalk.yellow(status);
    default:
      return chalk.white(status);
  }
}

function isTerminalStatus(status: string): boolean {
  return status === "live" || status === "failed" || status === "error";
}

// ============================================================
// SSE stream parser using native fetch + ReadableStream
// ============================================================

async function streamLogs(deploymentId: string): Promise<void> {
  const apiUrl = getApiUrl();
  const token = getToken();

  const headers: Record<string, string> = {
    Accept: "text/event-stream",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${apiUrl}/api/v1/deploy/${deploymentId}/logs/stream`, {
    headers,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SSE connection failed (${response.status}): ${text}`);
  }

  if (!response.body) {
    throw new Error("No response body for SSE stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  // SSE parsing state
  let currentEvent = "";
  let currentData = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          currentData = line.slice(5).trim();
        } else if (line === "") {
          // Empty line = end of SSE message, dispatch
          if (currentEvent && currentData) {
            if (currentEvent === "log") {
              try {
                const parsed = JSON.parse(currentData) as LogEntry;
                printLogEntry(parsed);
              } catch {
                // Non-JSON log data, print raw
                console.log(chalk.dim(`  ${currentData}`));
              }
            } else if (currentEvent === "status") {
              // Status data may be a raw string or JSON
              let status = currentData;
              try { const p = JSON.parse(currentData); status = p.status ?? p; } catch {}
              console.log(chalk.dim(`  ── Status: ${colorStatus(String(status))} ──`));
            } else if (currentEvent === "done") {
              // Stream complete
              return;
            }
          }
          // Reset for next event
          currentEvent = "";
          currentData = "";
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ============================================================
// Command implementation
// ============================================================

export async function logsCommand(options: LogsOptions = {}) {
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

  let deploymentId = options.deploy;
  let deployment: Deployment | undefined;

  // 3. Resolve deployment ID
  if (!deploymentId) {
    // Find latest deployment from project
    const spinner = ora({ text: "Fetching latest deployment...", prefixText: "  " }).start();
    try {
      const response = await apiFetch(`/api/v1/projects/${config.projectId}`);
      if (!response.ok) {
        spinner.fail("Failed to fetch project info");
        const text = await response.text();
        console.log(chalk.red(`  API error (${response.status}): ${text}`));
        process.exit(1);
      }

      const data = (await response.json()) as ProjectResponse;
      if (!data.deployments || data.deployments.length === 0) {
        spinner.fail("No deployments found");
        console.log(chalk.dim("  Run ") + chalk.cyan("icforge deploy") + chalk.dim(" to create one."));
        process.exit(1);
      }

      deployment = data.deployments[0];
      deploymentId = deployment.id;
      spinner.stop();
    } catch (err) {
      spinner.fail("Failed to fetch project info");
      console.log(chalk.red(`  ${(err as Error).message}`));
      process.exit(1);
    }
  }

  // 4. If we don't have deployment metadata yet, fetch status to get it
  if (!deployment) {
    try {
      const statusResp = await apiFetch(`/api/v1/deploy/${deploymentId}/status`);
      if (statusResp.ok) {
        const statusData = (await statusResp.json()) as {
          deployment_id: string;
          status: string;
          url?: string;
          canister_id?: string;
          error?: string;
        };
        // Create a minimal deployment object from status
        deployment = {
          id: statusData.deployment_id,
          project_id: config.projectId,
          canister_name: "—",
          status: statusData.status,
          commit_sha: null,
          commit_message: null,
          started_at: null,
          completed_at: null,
          error_message: statusData.error ?? null,
        };
      }
    } catch {
      // We'll still try to fetch logs even if status fails
    }
  }

  // 5. Print deploy header
  console.log();
  console.log(chalk.bold.cyan("  Deployment Logs"));
  console.log(chalk.dim("  " + "─".repeat(50)));
  if (deployment) {
    const sha = deployment.commit_sha ? deployment.commit_sha.slice(0, 7) : "—";
    console.log(
      `  Deploy: ${chalk.dim(deploymentId!.slice(0, 8) + "...")}  ` +
        `Canister: ${deployment.canister_name}  ` +
        `Status: ${colorStatus(deployment.status)}  ` +
        `Commit: ${chalk.yellow(sha)}`
    );
    if (deployment.commit_message) {
      console.log(chalk.dim(`  ${deployment.commit_message}`));
    }
  } else {
    console.log(`  Deploy: ${chalk.dim(deploymentId!)}`);
  }
  console.log(chalk.dim("  " + "─".repeat(50)));
  console.log();

  // 6. Determine if we should stream or fetch static logs
  const deployStatus = deployment?.status ?? "";
  const isComplete = isTerminalStatus(deployStatus);
  const shouldStream = options.follow && !isComplete;

  if (shouldStream) {
    // SSE streaming mode
    console.log(chalk.dim("  Streaming logs (Ctrl+C to exit)..."));
    console.log();
    try {
      await streamLogs(deploymentId!);
      console.log();
      console.log(chalk.dim("  ── Stream ended ──"));
    } catch (err) {
      console.log(chalk.red(`  Stream error: ${(err as Error).message}`));
      process.exit(1);
    }
  } else {
    // Static logs mode
    if (options.follow && isComplete) {
      console.log(chalk.dim(`  Deployment already ${deployStatus}, showing static logs.\n`));
    }

    try {
      const logsResp = await apiFetch(`/api/v1/deploy/${deploymentId}/logs`);
      if (!logsResp.ok) {
        const text = await logsResp.text();
        console.log(chalk.red(`  Failed to fetch logs (${logsResp.status}): ${text}`));
        process.exit(1);
      }

      const logsData = (await logsResp.json()) as { logs: LogEntry[] };
      if (!logsData.logs || logsData.logs.length === 0) {
        console.log(chalk.dim("  No logs available yet."));
      } else {
        for (const entry of logsData.logs) {
          printLogEntry(entry);
        }
      }
    } catch (err) {
      console.log(chalk.red(`  Failed to fetch logs: ${(err as Error).message}`));
      process.exit(1);
    }
  }

  console.log();
}
