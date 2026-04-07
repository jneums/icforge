import { useState, useEffect, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  GitCommit,
  GitBranch,
  Copy,
  AlertCircle,
} from "lucide-react";
import { fetchBuild } from "@/api";
import type { LogEntry, Build } from "@/api/types";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status-badge";
import { toast } from "sonner";

const IN_PROGRESS_STATUSES = ["pending", "queued", "building", "deploying", "created"];

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

export default function BuildDetail() {
  const { id: projectId, buildId } = useParams();
  const { user, loading: authLoading } = useAuth();
  const [build, setBuild] = useState<Build | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#L")) setHighlightedLine(parseInt(hash.slice(2)));
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  useEffect(() => {
    if (authLoading || !user || !buildId) return;

    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const data = await fetchBuild(buildId!);
        if (cancelled) return;
        setBuild(data.build);
        setLogs(data.logs);

        // Start polling if in progress
        if (IN_PROGRESS_STATUSES.includes(data.build.status)) {
          pollTimer = setInterval(async () => {
            try {
              const fresh = await fetchBuild(buildId!);
              if (!cancelled) {
                setBuild(fresh.build);
                setLogs(fresh.logs);
                // Stop polling once done
                if (!IN_PROGRESS_STATUSES.includes(fresh.build.status) && pollTimer) {
                  clearInterval(pollTimer);
                  pollTimer = null;
                }
              }
            } catch {
              // ignore poll errors
            }
          }, 3000);
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [buildId, user, authLoading]);

  // Stop polling once build is done
  const isInProgress = build ? IN_PROGRESS_STATUSES.includes(build.status) : false;

  if (authLoading || loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !build) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-3">{error ?? "Build not found"}</p>
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
          Build <span className="font-mono text-muted-foreground">#{build.id.slice(0, 8)}</span>
        </h1>
        <div className="flex items-center gap-3">
          <StatusBadge status={build.status} />
          {isInProgress && (
            <Badge
              variant="outline"
              className="text-xs bg-success/10 text-success border-success/20"
            >
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse inline-block" />
              In Progress
            </Badge>
          )}
        </div>
      </div>

      {/* Summary Card */}
      <Card className="p-5 border-border/50">
        <div className="grid grid-cols-2 gap-y-4 gap-x-12 text-sm">
          {build.canister_name && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Canister</span>
              <div className="mt-1 font-mono">{build.canister_name}</div>
            </div>
          )}
          {build.commit_sha && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Commit</span>
              <div className="flex items-center gap-2 mt-1">
                <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                {build.repo_full_name ? (
                  <a
                    href={`https://github.com/${build.repo_full_name}/commit/${build.commit_sha}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-xs text-primary hover:underline"
                  >
                    {build.commit_sha.slice(0, 7)}
                  </a>
                ) : (
                  <span className="font-mono text-xs">
                    {build.commit_sha.slice(0, 7)}
                  </span>
                )}
                {build.commit_message && (
                  <span className="text-muted-foreground truncate">
                    {build.commit_message}
                  </span>
                )}
              </div>
            </div>
          )}
          {build.branch && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Branch</span>
              <div className="flex items-center gap-2 mt-1">
                <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
                {build.repo_full_name ? (
                  <a
                    href={`https://github.com/${build.repo_full_name}/tree/${build.branch}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-primary hover:underline"
                  >
                    {build.branch}
                  </a>
                ) : (
                  <span className="font-mono">{build.branch}</span>
                )}
              </div>
            </div>
          )}
          <div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Trigger</span>
            <div className="mt-1">{build.trigger}</div>
          </div>
          {build.created_at && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground/70">Created</span>
              <div className="mt-1">{timeAgo(build.created_at)}</div>
            </div>
          )}
          {build.error_message && (
            <div className="col-span-2">
              <Alert variant="destructive" className="mt-2">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{build.error_message}</AlertDescription>
              </Alert>
            </div>
          )}
        </div>
      </Card>

      {/* Log Viewer */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Build Logs</h2>
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
              {isInProgress ? (
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
