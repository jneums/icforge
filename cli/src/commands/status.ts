import chalk from "chalk";
import ora from "ora";
import { loadICForgeConfig } from "../config.js";
import { isAuthenticated } from "../auth.js";
import { apiFetch } from "../api.js";

// ============================================================
// Relative time helper (no external dependency)
// ============================================================

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return dateStr;

  const diffMs = now - then;
  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;

  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

// ============================================================
// Status coloring
// ============================================================

function colorStatus(status: string): string {
  switch (status) {
    case "live":
    case "running":
      return chalk.green(status);
    case "failed":
    case "error":
      return chalk.red(status);
    case "deploying":
    case "building":
    case "pending":
    case "in_progress":
      return chalk.yellow(status);
    case "stopped":
      return chalk.dim(status);
    default:
      return chalk.white(status);
  }
}

// ============================================================
// Type definitions for API response
// ============================================================

interface Canister {
  id: string;
  project_id: string;
  name: string;
  recipe: string | null;
  type?: string; // deprecated, kept for backwards compat
  canister_id: string | null;
  status: string;
  cycles_balance?: number | null;
}

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

interface Project {
  id: string;
  name: string;
  slug: string;
  canisters: Canister[];
}

interface ProjectResponse {
  project: Project;
  deployments: Deployment[];
}

// ============================================================
// Command implementation
// ============================================================

export async function statusCommand(_options: Record<string, unknown> = {}) {
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

  const spinner = ora({ text: "Fetching project status...", prefixText: "  " }).start();

  try {
    const response = await apiFetch(`/api/v1/projects/${config.projectId}`);
    if (!response.ok) {
      spinner.fail("Failed to fetch project status");
      const text = await response.text();
      console.log(chalk.red(`  API error (${response.status}): ${text}`));
      process.exit(1);
    }

    const data = (await response.json()) as ProjectResponse;
    spinner.stop();

    const { project, deployments } = data;

    // ── Project header ──────────────────────────────────
    console.log();
    console.log(chalk.bold.cyan(`  ${project.name}`));
    console.log(chalk.dim(`  slug: ${project.slug}  •  id: ${project.id}`));
    console.log();

    // ── Canister table ──────────────────────────────────
    const canisters = project.canisters ?? [];
    if (canisters.length === 0) {
      console.log(chalk.dim("  No canisters registered yet."));
    } else {
      // Column headers
      const nameW = Math.max(8, ...canisters.map((c) => c.name.length)) + 2;
      const idW = Math.max(11, ...canisters.map((c) => (c.canister_id ?? "—").length)) + 2;
      const recipeW = Math.max(8, ...canisters.map((c) => (c.recipe ?? "custom").length)) + 2;
      const statusW = 12;

      const header =
        "  " +
        "Canister".padEnd(nameW) +
        "Canister ID".padEnd(idW) +
        "Status".padEnd(statusW) +
        "Recipe".padEnd(recipeW);

      console.log(chalk.bold(header));
      console.log(chalk.dim("  " + "─".repeat(nameW + idW + statusW + recipeW)));

      for (const c of canisters) {
        const line =
          "  " +
          c.name.padEnd(nameW) +
          (c.canister_id ?? "—").padEnd(idW) +
          colorStatus(c.status).padEnd(statusW + 10) + // extra for ANSI codes
          chalk.dim(c.recipe ?? "custom");
        console.log(line);
      }
    }

    console.log();

    // ── Latest deployments ──────────────────────────────
    if (!deployments || deployments.length === 0) {
      console.log(chalk.dim("  No deployments yet. Run ") + chalk.cyan("icforge deploy") + chalk.dim(" to get started."));
    } else {
      console.log(chalk.bold("  Recent Deployments"));
      console.log(chalk.dim("  " + "─".repeat(60)));

      // Show up to 5 most recent deployments
      const recent = deployments.slice(0, 5);
      for (const d of recent) {
        const when = d.started_at ? relativeTime(d.started_at) : "—";
        const sha = d.commit_sha ? d.commit_sha.slice(0, 7) : "—";
        const msg = d.commit_message
          ? d.commit_message.length > 50
            ? d.commit_message.slice(0, 47) + "..."
            : d.commit_message
          : "";

        console.log(
          `  ${colorStatus(d.status).padEnd(22)}` +
            `${chalk.dim(d.id.slice(0, 8))}  ` +
            `${chalk.yellow(sha)}  ` +
            `${d.canister_name}  ` +
            `${chalk.dim(when)}`
        );
        if (msg) {
          console.log(`  ${chalk.dim("  " + msg)}`);
        }
        if (d.error_message) {
          console.log(`  ${chalk.red("  ✗ " + d.error_message)}`);
        }
      }

      if (deployments.length > 5) {
        console.log(chalk.dim(`\n  ... and ${deployments.length - 5} more`));
      }
    }

    console.log();
  } catch (err) {
    spinner.fail("Failed to fetch project status");
    console.log(chalk.red(`  ${(err as Error).message}`));
    process.exit(1);
  }
}
