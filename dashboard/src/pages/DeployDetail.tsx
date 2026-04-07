import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  GitCommit,
  GitBranch,
  Copy,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import {
  fetchDeployLogs,
  fetchDeployStatus,
  getAuthHeaders,
  API_URL,
} from "@/api";
import type { LogEntry } from "@/api/types";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { toast } from "sonner";

const IN_PROGRESS_STATUSES = ["queued", "building", "deploying", "created"];

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-warning",
  warning: "text-warning",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

function formatTimestamp(ts: string): string | null {
  if (!ts) return null;
  try {
    // Backend sends "YYYY-MM-DD HH:MM:SS" (UTC, no T/Z)
    const normalized = ts.includes("T") ? ts : ts.replace(" ", "T");
    const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
    if (isNaN(d.getTime())) return null;
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return null;
  }
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr + "Z");
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

/* -- Linkify URLs in log messages -- */

const URL_RE = /(https?:\/\/[^\s)>]+)/g;

function LinkifiedMessage({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* -- Log Line -- */

function LogLine({
  entry,
  lineNumber,
  highlighted,
  onClickLine,
}: {
  entry: LogEntry;
  lineNumber: number;
  highlighted: boolean;
  onClickLine: (n: number) => void;
}) {
  const ts = formatTimestamp(entry.timestamp);
  return (
    <div
      id={`L${lineNumber}`}
      className={cn(
        "flex gap-2 pl-2 pr-3 py-px hover:bg-muted/30 border-l-2 border-transparent",
        highlighted && "bg-primary/5 border-l-primary"
      )}
    >
      <span
        className="text-muted-foreground/50 select-none cursor-pointer min-w-[2.5ch] text-right hover:text-primary"
        onClick={() => onClickLine(lineNumber)}
      >
        {lineNumber}
      </span>
      {ts && (
        <span className="text-muted-foreground/70 whitespace-nowrap">
          {ts}
        </span>
      )}
      <span className={cn("whitespace-nowrap", LEVEL_COLORS[entry.level])}>
        [{entry.level}]
      </span>
      <span className="text-foreground whitespace-pre-wrap break-all flex-1">
        <LinkifiedMessage text={entry.message} />
      </span>
    </div>
  );
}

/* -- Main Page -- */

export default function DeployDetail() {
  const { id: projectId, deployId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("queued");
  const [deployMeta, setDeployMeta] = useState<{
    canister_id?: string;
    url?: string;
    error?: string;
    commit_sha?: string;
    commit_message?: string;
    branch?: string;
    repo_full_name?: string;
    started_at?: string;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Read line from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#L")) setHighlightedLine(parseInt(hash.slice(2)));
  }, []);

  // Auto-scroll on new logs
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Fetch initial status and logs
  useEffect(() => {
    if (authLoading || !user || !deployId) return;

    let cancelled = false;

    async function load() {
      try {
        const [statusData, logData] = await Promise.all([
          fetchDeployStatus(deployId!),
          fetchDeployLogs(deployId!),
        ]);
        if (cancelled) return;
        setStatus(statusData.status);
        setDeployMeta({
          canister_id: statusData.canister_id,
          url: statusData.url,
          error: statusData.error,
          commit_sha: statusData.commit_sha,
          commit_message: statusData.commit_message,
          branch: statusData.branch,
          repo_full_name: statusData.repo_full_name,
          started_at: statusData.started_at,
        });
        setLogs(logData);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [deployId, user, authLoading]);

  // SSE streaming for in-progress deploys
  const connectSSE = useCallback(
    async (signal: AbortSignal) => {
      if (!deployId) return;

      const headers = getAuthHeaders();
      try {
        const response = await fetch(
          `${API_URL}/api/v1/deploy/${deployId}/logs/stream`,
          { headers, signal }
        );

        if (!response.ok || !response.body) return;

        setStreaming(true);
        setLogs([]); // SSE replays all logs — clear to avoid duplicates
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let currentEvent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice(6).trim();
            } else if (line.startsWith("data:")) {
              const data = line.slice(5).trim();
              if (currentEvent === "log") {
                try {
                  const entry: LogEntry = JSON.parse(data);
                  setLogs((prev) => [...prev, entry]);
                } catch {
                  // skip malformed
                }
              } else if (currentEvent === "status") {
                setStatus(data);
              } else if (currentEvent === "done") {
                setStreaming(false);
                try {
                  const finalStatus = await fetchDeployStatus(deployId);
                  setStatus(finalStatus.status);
                  setDeployMeta((prev) => ({
                    ...prev,
                    canister_id: finalStatus.canister_id,
                    url: finalStatus.url,
                    error: finalStatus.error,
                  }));
                } catch {
                  // ignore
                }
                return;
              }
            }
          }
        }
      } catch (e: unknown) {
        if (e instanceof DOMException && e.name === "AbortError") return;
      } finally {
        setStreaming(false);
      }
    },
    [deployId]
  );

  useEffect(() => {
    if (authLoading || !user || loading) return;
    if (!IN_PROGRESS_STATUSES.includes(status)) return;

    const controller = new AbortController();
    abortRef.current = controller;
    connectSSE(controller.signal);

    return () => {
      controller.abort();
      abortRef.current = null;
    };
  }, [status, loading, authLoading, user, connectSSE]);

  /* -- Render -- */

  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-3">{error}</p>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/projects/${projectId}`}>&larr; Back to Project</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Deploy <span className="font-mono text-muted-foreground">#{deployId?.slice(0, 8)}</span>
        </h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={status} />
          {streaming && (
            <Badge
              variant="outline"
              className="text-xs bg-success/10 text-success border-success/20"
            >
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse inline-block" />
              Streaming
            </Badge>
          )}
          {deployMeta.url && (
            <Button asChild size="sm">
              <a href={deployMeta.url} target="_blank" rel="noopener noreferrer">
                Visit <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <Card className="p-5 border-border/50">
        <div className="grid grid-cols-2 gap-y-4 gap-x-12 text-sm">
          {deployMeta.commit_sha && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Commit</span>
              <div className="flex items-center gap-2 mt-1">
                <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                {deployMeta.repo_full_name ? (
                  <a
                    href={`https://github.com/${deployMeta.repo_full_name}/commit/${deployMeta.commit_sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {deployMeta.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="font-mono text-xs">
                    {deployMeta.commit_sha.slice(0, 7)}
                  </span>
                )}
                {deployMeta.commit_message && (
                  <span className="text-muted-foreground truncate">
                    {deployMeta.commit_message}
                  </span>
                )}
              </div>
            </div>
          )}
          {deployMeta.branch && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Branch</span>
              <div className="flex items-center gap-2 mt-1">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {deployMeta.repo_full_name ? (
                  <a
                    href={`https://github.com/${deployMeta.repo_full_name}/tree/${deployMeta.branch}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {deployMeta.branch}
                  </a>
                ) : (
                  <span className="font-mono">{deployMeta.branch}</span>
                )}
              </div>
            </div>
          )}
          {deployMeta.started_at && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Started</span>
              <div className="mt-1">{timeAgo(deployMeta.started_at)}</div>
            </div>
          )}
          {deployMeta.canister_id && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Canister</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xs">
                  {deployMeta.canister_id}
                </span>
                <CopyButton text={deployMeta.canister_id} />
              </div>
            </div>
          )}
          {deployMeta.error && (
            <div className="col-span-2">
              <Alert variant="destructive" className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{deployMeta.error}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </Card>

      {/* Log Viewer */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Deploy Logs</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={() => {
                navigator.clipboard.writeText(
                  logs.map((l) => l.message).join("\n")
                );
                toast.success("Logs copied to clipboard");
              }}
            >
              <Copy className="h-3 w-3 mr-1.5" /> Copy
            </Button>
            <Button
              variant={autoScroll ? "secondary" : "ghost"}
              size="sm"
              className="text-xs"
              onClick={() => setAutoScroll(!autoScroll)}
            >
              Auto-scroll {autoScroll ? "on" : "off"}
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="bg-background rounded-lg border border-border/50 font-mono text-[13px] leading-relaxed overflow-y-auto min-h-[300px] py-2"
          style={{ maxHeight: "calc(100vh - 340px)" }}
        >
          {logs.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              {streaming ? (
                <>
                  <Spinner className="h-4 w-4 mr-2" />
                  Waiting for logs...
                </>
              ) : (
                "No logs available"
              )}
            </div>
          ) : (
            logs.map((entry, i) => (
              <LogLine
                key={i}
                entry={entry}
                lineNumber={i + 1}
                highlighted={highlightedLine === i + 1}
                onClickLine={(n) => {
                  window.location.hash = `#L${n}`;
                  setHighlightedLine(n);
                }}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
