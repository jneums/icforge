import { useState, useEffect, useRef, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  GitCommit,
  GitBranch,
  Copy,
  AlertCircle,
  ExternalLink,
  Clock,
} from "lucide-react";
import type { LogEntry } from "@/api/types";
import { useAuth } from "@/hooks/use-auth";
import { useDeployStatus, useDeployLogs } from "@/hooks/use-deploy";
import { useDeployStream } from "@/hooks/use-deploy-stream";
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
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
  const ready = !authLoading && !!user && !!deployId;

  // TanStack Query hooks for initial data
  const {
    data: statusData,
    isLoading: statusLoading,
    error: statusError,
  } = useDeployStatus(deployId ?? "");
  const {
    data: initialLogs,
    isLoading: logsLoading,
  } = useDeployLogs(deployId ?? "");

  const status = statusData?.status ?? "queued";
  const isInProgress = IN_PROGRESS_STATUSES.includes(status);

  // SSE streaming for in-progress deploys
  const { logs: streamLogs, streaming } = useDeployStream(
    deployId,
    status,
    ready && !statusLoading
  );

  // Use stream logs when streaming, otherwise initial logs
  const logs = useMemo(
    () => (streamLogs.length > 0 ? streamLogs : initialLogs ?? []),
    [streamLogs, initialLogs]
  );

  // UI state
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  /* -- Render -- */

  const loading = authLoading || statusLoading || logsLoading;

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (statusError) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-3">
          {statusError instanceof Error ? statusError.message : String(statusError)}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/projects/${projectId}`}>&larr; Back to Project</Link>
        </Button>
      </div>
    );
  }

  const commitUrl =
    statusData?.repo_full_name && statusData?.commit_sha
      ? `https://github.com/${statusData.repo_full_name}/commit/${statusData.commit_sha}`
      : null;

  const branchUrl =
    statusData?.repo_full_name && statusData?.branch
      ? `https://github.com/${statusData.repo_full_name}/tree/${statusData.branch}`
      : null;

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
          {statusData?.url && (
            <Button asChild size="sm">
              <a href={statusData.url} target="_blank" rel="noopener noreferrer">
                Visit <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <Card className="p-5 border-border/50">
        <div className="grid grid-cols-2 gap-y-4 gap-x-12 text-sm">
          {statusData?.commit_sha && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Commit</span>
              <div className="flex items-center gap-2 mt-1">
                <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                {commitUrl ? (
                  <a
                    href={commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {statusData.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="font-mono text-xs">
                    {statusData.commit_sha.slice(0, 7)}
                  </span>
                )}
                {statusData.commit_message && (
                  <span className="text-muted-foreground truncate">
                    {statusData.commit_message}
                  </span>
                )}
              </div>
            </div>
          )}
          {statusData?.branch && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Branch</span>
              <div className="flex items-center gap-2 mt-1">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {branchUrl ? (
                  <a
                    href={branchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {statusData.branch}
                  </a>
                ) : (
                  <span className="font-mono">{statusData.branch}</span>
                )}
              </div>
            </div>
          )}
          {statusData?.started_at && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Started</span>
              <div className="mt-1">{timeAgo(statusData.started_at)}</div>
            </div>
          )}
          {statusData?.build_duration_ms != null && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Duration</span>
              <div className="flex items-center gap-2 mt-1">
                <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                <span>{formatDuration(statusData.build_duration_ms)}</span>
              </div>
            </div>
          )}
          {statusData?.canister_id && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Canister</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xs">
                  {statusData.canister_id}
                </span>
                <CopyButton text={statusData.canister_id} />
              </div>
            </div>
          )}
          {statusData?.error && (
            <div className="col-span-2">
              <Alert variant="destructive" className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{statusData.error}</AlertDescription>
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
              {streaming || isInProgress ? (
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
