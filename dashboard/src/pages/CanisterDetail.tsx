import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import { useProject } from "@/hooks/use-project";
import { useCanisterEnv, useSetCanisterEnv } from "@/hooks/use-canister-env";
import { useCanisterLogs, flattenLogPages, useLogSettings, useUpdateLogSettings } from "@/hooks/use-canister-logs";
import { useCanisterLogStream } from "@/hooks/use-canister-log-stream";
import { LogViewer } from "@/components/log-viewer";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusDot } from "@/components/status-dot";
import { CopyButton } from "@/components/copy-button";
import { HealthBadge } from "@/components/health-badge";
import { CanisterHealthPanel } from "@/components/canister-health";
import {
  ExternalLink,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  Plus,
  Trash2,
  Radio,
  History,
} from "lucide-react";
import { displayRecipe, healthFromCycles } from "@/lib/utils";
import type { Deployment } from "@/api/types";
import type { EnvironmentVariable } from "@/api/types";
import type { LogPeriod } from "@/api/canister-logs";

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

function DeployRow({
  deploy,
  projectId,
}: {
  deploy: Deployment;
  projectId: string;
}) {
  const inProgress = IN_PROGRESS_STATUSES.includes(deploy.status);
  const succeeded =
    deploy.status === "live" ||
    deploy.status === "succeeded" ||
    deploy.status === "deployed";
  const failed = deploy.status === "failed" || deploy.status === "error";
  const cancelled = deploy.status === "cancelled";

  return (
    <Link
      to={`/projects/${projectId}/deploys/${deploy.id}`}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
    >
      {succeeded ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : failed ? (
        <XCircle className="h-4 w-4 shrink-0 text-destructive" />
      ) : cancelled ? (
        <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : inProgress ? (
        <Loader2 className="h-4 w-4 shrink-0 text-warning animate-spin" />
      ) : (
        <StatusDot status={deploy.status} pulse={inProgress} />
      )}
      <span className="text-sm truncate flex-1">
        {deploy.commit_message || "No message"}
      </span>
      {deploy.commit_sha && (
        <span className="font-mono text-xs text-muted-foreground">
          {deploy.commit_sha.slice(0, 7)}
        </span>
      )}
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(deploy.created_at)}
      </span>
    </Link>
  );
}

function CanisterDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

interface EnvVarRow {
  key: string;
  name: string;
  value: string;
}

function envVarsToRows(vars: EnvironmentVariable[]): EnvVarRow[] {
  return vars.map((v, i) => ({
    key: `existing-${i}-${v.name}`,
    name: v.name,
    value: v.value,
  }));
}

function rowsEqual(
  rows: EnvVarRow[],
  original: EnvironmentVariable[]
): boolean {
  const filtered = rows.filter((r) => r.name.trim() !== "");
  if (filtered.length !== original.length) return false;
  return filtered.every(
    (r, i) => r.name === original[i].name && r.value === original[i].value
  );
}

function EnvVarEditor({
  canisterId,
  envVars,
}: {
  canisterId: string;
  envVars: EnvironmentVariable[];
}) {
  const [rows, setRows] = useState<EnvVarRow[]>(() => envVarsToRows(envVars));
  const [nextKey, setNextKey] = useState(0);
  const mutation = useSetCanisterEnv(canisterId);

  // Sync rows when remote data changes (after save or refetch)
  useEffect(() => {
    if (!mutation.isPending) {
      setRows(envVarsToRows(envVars));
    }
  }, [envVars, mutation.isPending]);

  const isDirty = !rowsEqual(rows, envVars);

  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `new-${nextKey}`, name: "", value: "" },
    ]);
    setNextKey((k) => k + 1);
  }

  function removeRow(key: string) {
    setRows((prev) => prev.filter((r) => r.key !== key));
  }

  function updateRow(key: string, field: "name" | "value", val: string) {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, [field]: val } : r))
    );
  }

  function handleSave() {
    // Filter out empty-name rows before saving
    const toSave: EnvironmentVariable[] = rows
      .filter((r) => r.name.trim() !== "")
      .map((r) => ({ name: r.name.trim(), value: r.value }));
    mutation.mutate(toSave);
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No environment variables set.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center gap-2">
              <Input
                className="font-mono text-sm flex-1"
                placeholder="NAME"
                value={row.name}
                onChange={(e) => updateRow(row.key, "name", e.target.value)}
              />
              <span className="text-muted-foreground text-sm">=</span>
              <Input
                className="font-mono text-sm flex-[2]"
                placeholder="value"
                value={row.value}
                onChange={(e) => updateRow(row.key, "value", e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeRow(row.key)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Add Variable
        </Button>
        {isDirty && (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={mutation.isPending}
          >
            {mutation.isPending && (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            )}
            Save Changes
          </Button>
        )}
      </div>

      {mutation.isError && (
        <p className="text-sm text-destructive">
          Failed to save: {mutation.error?.message ?? "Unknown error"}
        </p>
      )}
      {mutation.isSuccess && !isDirty && (
        <p className="text-sm text-success">Environment variables saved.</p>
      )}
    </div>
  );
}

/* ── Canister Logs Tab ────────────────────────────────────────── */

const LOG_PERIODS: { label: string; value: LogPeriod }[] = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

const RETENTION_OPTIONS: { label: string; value: number }[] = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
];

function CanisterLogsTab({
  canisterId,
  projectId,
}: {
  canisterId: string;
  projectId: string;
}) {
  const [period, setPeriod] = useState<LogPeriod>("24h");
  const [liveMode, setLiveMode] = useState(false);

  // Historical logs with infinite scroll (non-live)
  const {
    data: logsData,
    isLoading: logsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCanisterLogs(liveMode ? null : canisterId, { period, limit: 500 });

  // Live streaming
  const { logs: streamLogs, streaming } = useCanisterLogStream(
    canisterId,
    liveMode
  );

  // Log settings (retention)
  const { data: settings } = useLogSettings(projectId);
  const updateSettings = useUpdateLogSettings(projectId);

  // Merge: in live mode use stream logs, otherwise flatten infinite query pages
  const logs = useMemo(() => {
    if (liveMode) return streamLogs;
    return flattenLogPages(logsData?.pages);
  }, [liveMode, streamLogs, logsData]);

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <Button
            variant={liveMode ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setLiveMode(!liveMode)}
          >
            <Radio className="h-3 w-3 mr-1.5" />
            {liveMode ? "Live" : "Go Live"}
          </Button>

          {/* Period selector (only in history mode) */}
          {!liveMode && (
            <div className="flex items-center gap-1 ml-2">
              <History className="h-3 w-3 text-muted-foreground" />
              {LOG_PERIODS.map((p) => (
                <Button
                  key={p.value}
                  variant={period === p.value ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Retention settings */}
        {settings && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Retention:</span>
            <select
              className="bg-muted border border-border rounded px-2 py-0.5 text-xs"
              value={settings.log_retention_hours}
              onChange={(e) => updateSettings.mutate(Number(e.target.value))}
              disabled={updateSettings.isPending}
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {settings.log_count > 0 && (
              <span className="text-muted-foreground/60">
                ({settings.log_count.toLocaleString()} entries)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Log viewer */}
      <LogViewer
        logs={logs}
        streaming={streaming}
        loading={logsLoading}
        emptyMessage="No canister logs yet. Logs appear when your canister prints to stdout/stderr."
        height="calc(100vh - 420px)"
        onLoadMore={() => fetchNextPage()}
        loadingMore={isFetchingNextPage}
        hasMore={hasNextPage ?? false}
      />
    </div>
  );
}

export default function CanisterDetail() {
  const { id, canisterId } = useParams();
  const { data, isLoading, error } = useProject(id ?? "");

  const project = data?.project;
  const canister = project?.canisters?.find((c) => c.id === canisterId);
  const deployments = (data?.deployments ?? []).filter(
    (d) => d.canister_name === canister?.name
  );
  const { data: envVars, isLoading: envLoading } = useCanisterEnv(
    canister?.canister_id ?? null,
    !!canister?.canister_id
  );

  if (isLoading) return <CanisterDetailSkeleton />;

  if (error || !project) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-3">
          {error?.message ?? "Project not found"}
        </p>
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects">&larr; Back to Projects</Link>
        </Button>
      </div>
    );
  }

  if (!canister) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-destructive mb-3">Canister not found</p>
        <Button variant="outline" size="sm" asChild>
          <Link to={`/projects/${id}`}>&larr; Back to {project.name}</Link>
        </Button>
      </div>
    );
  }

  const subdomainUrl = canister.canister_id
    ? `https://${project.slug}-${canister.name}.icforge.dev`
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {canister.name}
          </h1>
          <div className="flex items-center gap-3 mt-1.5 text-sm text-muted-foreground">
            <Badge variant="outline" className="text-xs">
              {displayRecipe(canister.recipe)}
            </Badge>
            {canister.canister_id && (
              <div className="flex items-center gap-1.5">
                <span className="font-mono text-xs">
                  {canister.canister_id}
                </span>
                <CopyButton text={canister.canister_id} />
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canister.canister_id &&
            canister.cycles_balance != null && (
              <HealthBadge health={healthFromCycles(canister.cycles_balance)} />
            )}
          <StatusDot status={canister.status} />
          {subdomainUrl && (
            <a
              href={subdomainUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
            >
              {project.slug}-{canister.name}.icforge.dev
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="health">
        <TabsList>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="deployments">
            Deployments ({deployments.length})
          </TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-3">
          <CanisterHealthPanel canister={canister} />
        </TabsContent>

        <TabsContent value="logs">
          <CanisterLogsTab canisterId={canister.canister_id!} projectId={id!} />
        </TabsContent>

        <TabsContent value="deployments">
          {deployments.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No deployments for this canister yet.
              </p>
            </Card>
          ) : (
            <Card className="divide-y divide-border/50 border-border/50 overflow-hidden">
              {deployments.map((d) => (
                <DeployRow key={d.id} deploy={d} projectId={project.id} />
              ))}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="env">
          <Card className="border-border/50 p-5">
            {!canister.canister_id ? (
              <p className="text-sm text-muted-foreground">
                Canister not deployed yet — no environment variables available.
              </p>
            ) : envLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-40" />
              </div>
            ) : (
              <EnvVarEditor
                canisterId={canister.canister_id}
                envVars={envVars ?? []}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
