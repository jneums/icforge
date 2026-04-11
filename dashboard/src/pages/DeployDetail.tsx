import { useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  GitCommit,
  GitBranch,
  AlertCircle,
  ExternalLink,
  Clock,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useDeployStatus, useDeployLogs } from "@/hooks/use-deploy";
import { useDeployStream } from "@/hooks/use-deploy-stream";
import { LogViewer } from "@/components/log-viewer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";

const IN_PROGRESS_STATUSES = ["queued", "building", "deploying", "created"];

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
        <h2 className="text-lg font-semibold mb-3">Deploy Logs</h2>
        <LogViewer
          logs={logs}
          streaming={streaming || isInProgress}
          loading={logsLoading}
          showFilters={false}
          height="calc(100vh - 340px)"
        />
      </div>
    </div>
  );
}
