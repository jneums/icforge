import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ExternalLink,
  GitCommit,
  GitBranch,
  Clock,
  AlertCircle,
  Box,
  ChevronRight,
} from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useProjectHealth } from "@/hooks/use-canister-cycles";
import { useCanisterEnv } from "@/hooks/use-canister-env";
import { useCanisterControllers } from "@/hooks/use-canister-controllers";
import { useTabParam } from "@/hooks/use-tab-param";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/status-badge";
import { CopyButton } from "@/components/copy-button";
import { HealthBadge } from "@/components/health-badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { DeployStatusIcon } from "@/components/deploy-status-icon";
import { DeployList } from "@/components/deploy-list";
import { CanisterLogsPanel } from "@/components/canister-logs-panel";
import { EnvVarEditor } from "@/components/env-var-editor";
import { ControllersEditor } from "@/components/controllers-editor";
import { displayRecipe, healthFromCycles } from "@/lib/utils";
import { timeAgo, formatDuration, IN_PROGRESS_STATUSES } from "@/lib/format";
import type { Canister, Deployment, Project } from "@/api/types";

const PROJECT_TABS = ["overview", "deployments", "logs", "settings"];

function canisterUrl(project: Project, canister: Canister): string | null {
  return canister.canister_id
    ? `https://${project.slug}-${canister.name}.icforge.dev`
    : null;
}

/** The user-facing frontend URL: first deployed asset canister. */
function primaryUrl(project: Project): string | null {
  const asset = (project.canisters ?? []).find(
    (c) => c.canister_id && c.recipe?.includes("asset")
  );
  return asset ? canisterUrl(project, asset) : null;
}

/* ── Overview tab ────────────────────────────────────────────── */

function CanisterCard({
  canister,
  project,
  latestDeploy,
}: {
  canister: Canister;
  project: Project;
  latestDeploy?: Deployment;
}) {
  const navigate = useNavigate();
  const url = canisterUrl(project, canister);
  const health = healthFromCycles(canister.cycles_balance);

  return (
    <Card
      className="p-4 gap-0 border-border/50 hover:border-border hover:bg-card/80 transition-colors cursor-pointer group"
      onClick={() => navigate(`/projects/${project.id}/canisters/${canister.id}`)}
    >
      <div className="flex items-center gap-3 min-w-0">
        {latestDeploy ? (
          <DeployStatusIcon status={latestDeploy.status} />
        ) : (
          <Box className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-semibold truncate">{canister.name}</span>
        <Badge variant="outline" className="text-xs shrink-0">
          {displayRecipe(canister.recipe)}
        </Badge>
        {canister.canister_id && health !== "unknown" && (
          <HealthBadge health={health} />
        )}
        <ChevronRight className="h-4 w-4 ml-auto shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
        {url && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <ExternalLink className="h-3 w-3 shrink-0" />
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono hover:text-primary truncate"
            >
              {url.replace("https://", "")}
            </a>
          </div>
        )}
        {canister.canister_id && (
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Box className="h-3 w-3 shrink-0" />
            <span className="font-mono">{canister.canister_id}</span>
            <CopyButton text={canister.canister_id} />
          </div>
        )}
        {latestDeploy && (
          <div className="flex items-center gap-1.5 min-w-0">
            <GitCommit className="h-3 w-3 shrink-0" />
            {latestDeploy.commit_sha && (
              <span className="font-mono shrink-0">
                {latestDeploy.commit_sha.slice(0, 7)}
              </span>
            )}
            <span className="truncate">
              {latestDeploy.commit_message || "No message"}
            </span>
            <span className="ml-auto whitespace-nowrap shrink-0">
              {timeAgo(latestDeploy.created_at)}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}

function LatestPushCard({
  deploy,
  projectId,
  repoFullName,
}: {
  deploy: Deployment;
  projectId: string;
  repoFullName?: string;
}) {
  const isBuilding = IN_PROGRESS_STATUSES.includes(deploy.status);
  const commitUrl =
    repoFullName && deploy.commit_sha
      ? `https://github.com/${repoFullName}/commit/${deploy.commit_sha}`
      : null;

  return (
    <Card className="p-5 gap-0 border-border/50">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Latest Push
        </span>
        {isBuilding && <Spinner className="h-3 w-3" />}
        <Link
          to={`/projects/${projectId}/deploys/${deploy.id}`}
          className="ml-auto text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          View logs →
        </Link>
      </div>
      <p className="font-medium truncate">
        {deploy.commit_message || "No commit message"}
      </p>
      <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
        <GitCommit className="h-3 w-3" />
        {commitUrl ? (
          <a
            href={commitUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono hover:text-primary"
          >
            {deploy.commit_sha?.slice(0, 7) ?? "—"}
          </a>
        ) : (
          <span className="font-mono">
            {deploy.commit_sha?.slice(0, 7) ?? "—"}
          </span>
        )}
        <span className="text-muted-foreground/60">on</span>
        <span className="font-mono">{deploy.branch || "main"}</span>
        <span className="text-muted-foreground/40">&middot;</span>
        <Clock className="h-3 w-3" />
        <span>{timeAgo(deploy.created_at)}</span>
        {deploy.build_duration_ms != null && (
          <>
            <span className="text-muted-foreground/40">&middot;</span>
            <span>{formatDuration(deploy.build_duration_ms)}</span>
          </>
        )}
      </div>
    </Card>
  );
}

/* ── Canister picker (Logs / Settings tabs) ──────────────────── */

function CanisterPicker({
  canisters,
  selectedId,
  onSelect,
}: {
  canisters: Canister[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (canisters.length <= 1) return null;
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {canisters.map((c) => (
        <Button
          key={c.id}
          variant={c.id === selectedId ? "secondary" : "ghost"}
          size="sm"
          className="text-xs h-7"
          onClick={() => onSelect(c.id)}
        >
          <Box className="h-3 w-3 mr-1.5" />
          {c.name}
        </Button>
      ))}
    </div>
  );
}

/* ── Settings tab ────────────────────────────────────────────── */

function CanisterSettings({ canister }: { canister: Canister }) {
  const { data: envVars, isLoading: envLoading } = useCanisterEnv(
    canister.canister_id,
    !!canister.canister_id
  );
  const { data: controllersData, isLoading: controllersLoading } =
    useCanisterControllers(canister.canister_id, !!canister.canister_id);

  if (!canister.canister_id) {
    return (
      <Card className="p-8 text-center border-border/50">
        <p className="text-sm text-muted-foreground">
          Canister not deployed yet — settings become available after the first deploy.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-border/50 p-5 gap-0">
        <h3 className="text-sm font-semibold mb-3">Environment Variables</h3>
        {envLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <EnvVarEditor
            canisterId={canister.canister_id}
            envVars={envVars ?? []}
          />
        )}
      </Card>

      <Card className="border-border/50 p-5 gap-0">
        <h3 className="text-sm font-semibold mb-3">Controllers</h3>
        {controllersLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-64" />
          </div>
        ) : (
          <ControllersEditor
            canisterId={canister.canister_id}
            controllers={controllersData?.controllers ?? []}
            platformPrincipal={controllersData?.platform_principal ?? ""}
          />
        )}
      </Card>
    </div>
  );
}

/* ── Skeleton ────────────────────────────────────────────────── */

function ProjectDetailSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-7 w-48 mb-2" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  );
}

/* ── Main Page ───────────────────────────────────────────────── */

export default function ProjectDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useProject(id ?? "");
  const { data: healthData } = useProjectHealth(id);
  const [tab, setTab] = useTabParam("overview", PROJECT_TABS);
  const [selectedCanisterId, setSelectedCanisterId] = useState<string | null>(null);

  if (isLoading) return <ProjectDetailSkeleton />;

  if (error || !data?.project) {
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

  const { project, deployments = [] } = data;
  const latestDeploy = deployments[0];
  const latestStatus =
    latestDeploy?.status ?? project.canisters?.[0]?.status ?? "queued";
  const canisters = project.canisters ?? [];
  const deployedCanisters = canisters.filter((c) => c.canister_id);
  const liveUrl = primaryUrl(project);
  const repoFullName = latestDeploy?.repo_full_name ?? undefined;

  // Selected canister for Logs/Settings tabs (default: first deployed)
  const selectedCanister =
    deployedCanisters.find((c) => c.id === selectedCanisterId) ??
    deployedCanisters[0];

  return (
    <div className="space-y-6 min-w-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {project.name}
            </h1>
            <StatusBadge status={latestStatus} />
          </div>
          {repoFullName && (
            <a
              href={`https://github.com/${repoFullName}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-1.5 text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              <GitBranch className="h-3.5 w-3.5" />
              {repoFullName}
            </a>
          )}
        </div>
        {liveUrl && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs text-muted-foreground hidden sm:inline">
              {liveUrl.replace("https://", "")}
            </span>
            <Button asChild size="sm">
              <a href={liveUrl} target="_blank" rel="noopener noreferrer">
                Visit <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* Low Balance Banner */}
      {healthData?.topup_blocked && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <AlertDescription>
            Insufficient compute balance — some canisters can&apos;t be auto-topped up.{" "}
            <Link to="/billing" className="underline font-medium text-yellow-500 hover:text-yellow-400">
              Add credits
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="deployments">
            Deployments{deployments.length > 0 && ` (${deployments.length})`}
          </TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {latestDeploy && (
            <LatestPushCard
              deploy={latestDeploy}
              projectId={project.id}
              repoFullName={repoFullName}
            />
          )}
          {canisters.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No canisters created yet.
              </p>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {canisters.map((c) => (
                <CanisterCard
                  key={c.id}
                  canister={c}
                  project={project}
                  latestDeploy={deployments.find((d) => d.canister_name === c.name)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="deployments">
          <DeployList
            deployments={deployments}
            projectId={project.id}
            showCanister={canisters.length > 1}
            emptyMessage="No deployments yet. Push to your repo or run `icforge deploy` to get started."
          />
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          {!selectedCanister ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No deployed canisters yet — logs appear after your first deploy.
              </p>
            </Card>
          ) : (
            <>
              <CanisterPicker
                canisters={deployedCanisters}
                selectedId={selectedCanister.id}
                onSelect={setSelectedCanisterId}
              />
              <CanisterLogsPanel
                key={selectedCanister.id}
                canisterId={selectedCanister.canister_id!}
                projectId={project.id}
                height="calc(100vh - 400px)"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          {!selectedCanister ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No deployed canisters yet — settings become available after your first deploy.
              </p>
            </Card>
          ) : (
            <>
              <CanisterPicker
                canisters={deployedCanisters}
                selectedId={selectedCanister.id}
                onSelect={setSelectedCanisterId}
              />
              <CanisterSettings key={selectedCanister.id} canister={selectedCanister} />
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
