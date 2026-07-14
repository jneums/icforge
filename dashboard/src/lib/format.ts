/** Shared formatting + deploy status helpers (previously duplicated per-page). */

export const IN_PROGRESS_STATUSES = ["queued", "building", "deploying", "created"];

export type DeployOutcome = "succeeded" | "failed" | "cancelled" | "in_progress" | "unknown";

/** Collapse the various backend deploy status strings into one vocabulary. */
export function deployOutcome(status: string | undefined | null): DeployOutcome {
  if (!status) return "unknown";
  if (status === "live" || status === "succeeded" || status === "deployed") return "succeeded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "cancelled") return "cancelled";
  if (IN_PROGRESS_STATUSES.includes(status)) return "in_progress";
  return "unknown";
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
