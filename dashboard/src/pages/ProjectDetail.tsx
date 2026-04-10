import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ExternalLink,
  GitCommit,
  Clock,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Ban,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useCanisterEnv } from "@/hooks/use-canister-env";
import { useProjectHealth } from "@/hooks/use-canister-cycles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { StatusBadge } from "@/components/status-badge";
import { StatusDot } from "@/components/status-dot";
import { CopyButton } from "@/components/copy-button";
import { HealthBadge } from "@/components/health-badge";
import { CanisterHealthPanel } from "@/components/canister-health";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { displayRecipe, healthFromCycles } from "@/lib/utils";
import type { Canister, Deployment } from "@/api/types";

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

/* -- Sub-components -- */

function CanisterCard({
  canister,
  projectSlug,
  projectId,
  latestDeploy,
}: {
  canister: Canister;
  projectSlug: string;
  projectId: string;
  latestDeploy?: Deployment;
}) {
  const [open, setOpen] = useState(false);
  const { data: envVars, isLoading: envLoading } = useCanisterEnv(
    canister.canister_id,
    open
  );
  const subdomainUrl = canister.canister_id
    ? `https://${projectSlug}-${canister.name}.icforge.dev`
    : null;

  const inProgress = latestDeploy && IN_PROGRESS_STATUSES.includes(latestDeploy.status);
  const succeeded = latestDeploy && (latestDeploy.status === "live" || latestDeploy.status === "succeeded" || latestDeploy.status === "deployed");
  const failed = latestDeploy && (latestDeploy.status === "failed" || latestDeploy.status === "error");
  const cancelled = latestDeploy?.status === "cancelled";

  return (
    <Card className="p-4 border-border/50">
      <div className="flex items-center gap-3">
        {succeeded ? (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
        ) : failed ? (
          <XCircle className="h-4 w-4 shrink-0 text-destructive" />
        ) : cancelled ? (
          <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : inProgress ? (
          <Loader2 className="h-4 w-4 shrink-0 text-warning animate-spin" />
        ) : (
          <StatusDot status={canister.status} />
        )}
        <span className="text-sm font-semibold">{canister.name}</span>
        <Badge variant="outline" className="text-xs">
          {displayRecipe(canister.recipe)}
        </Badge>
        {canister.canister_id && (
          <>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {canister.canister_id}
            </span>
            <CopyButton text={canister.canister_id} />
          </>
        )}
      </div>

      {latestDeploy && (
        <Link
          to={`/projects/${projectId}/deploys/${latestDeploy.id}`}
          className="mt-2 flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          {latestDeploy.commit_sha && (
            <>
              <GitCommit className="h-3 w-3" />
              <span className="font-mono">{latestDeploy.commit_sha.slice(0, 7)}</span>
            </>
          )}
          <span className="truncate">{latestDeploy.commit_message || "No message"}</span>
          <span className="ml-auto whitespace-nowrap">{timeAgo(latestDeploy.created_at)}</span>
        </Link>
      )}

        {canister.canister_id && canister.cycles_balance != null && (
          <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <HealthBadge health={healthFromCycles(canister.cycles_balance)} />
          </div>
        )}

        {subdomainUrl && (
        <div className="mt-2 flex items-center gap-1.5">
          <a
            href={subdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            {projectSlug}-{canister.name}.icforge.dev
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}

      {canister.canister_id && (
        <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground h-7 px-2"
            >
              {open ? (
                <ChevronDown className="h-3 w-3 mr-1" />
              ) : (
                <ChevronRight className="h-3 w-3 mr-1" />
              )}
              Environment Variables
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md bg-popover p-3 font-mono text-xs space-y-1">
              {envLoading && (
                <p className="text-muted-foreground">Loading...</p>
              )}
              {envVars && envVars.length === 0 && (
                <p className="text-muted-foreground">
                  No environment variables set
                </p>
              )}
              {envVars?.map((v) => (
                <div key={v.name} className="flex gap-2">
                  <span className="font-semibold text-foreground">
                    {v.name}
                  </span>
                  <span className="text-muted-foreground">=</span>
                  <span className="text-muted-foreground truncate">
                    {v.value}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

function DeployRow({
  deploy,
  projectId,
}: {
  deploy: Deployment;
  projectId: string;
}) {
  const navigate = useNavigate();
  const inProgress = IN_PROGRESS_STATUSES.includes(deploy.status);
  const succeeded = deploy.status === "live" || deploy.status === "succeeded" || deploy.status === "deployed";
  const failed = deploy.status === "failed" || deploy.status === "error";
  const cancelled = deploy.status === "cancelled";

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => navigate(`/projects/${projectId}/deploys/${deploy.id}`)}
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
      <Badge variant="outline" className="text-xs shrink-0">
        {deploy.canister_name}
      </Badge>
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
    </div>
  );
}



function LatestPushCard({
  deploy,
  repoFullName,
}: {
  deploy: Deployment;
  repoFullName?: string;
}) {
  const isBuilding = IN_PROGRESS_STATUSES.includes(deploy.status);
  const commitUrl =
    repoFullName && deploy.commit_sha
      ? `https://github.com/${repoFullName}/commit/${deploy.commit_sha}`
      : null;

  return (
    <Card className="p-5 border-border/50">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Latest Push
        </span>
        {isBuilding && <Spinner className="h-3 w-3" />}
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

/* -- Skeletons -- */

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

/* -- Main Page -- */

export default function ProjectDetail() {
  const { id } = useParams();
  const { data, isLoading, error } = useProject(id ?? "");
  const { data: healthData } = useProjectHealth(id);

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
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={latestStatus} />
        </div>
      </div>

      {/* Low Balance Banner */}
      {healthData?.topup_blocked && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <AlertDescription>
            Insufficient compute balance — some canisters can&apos;t be auto-topped up.{" "}
            <Link to="/settings" className="underline font-medium text-yellow-500 hover:text-yellow-400">
              Add credits
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Latest Push Card */}
      {latestDeploy && (
        <LatestPushCard deploy={latestDeploy} repoFullName={latestDeploy.repo_full_name ?? undefined} />
      )}

      {/* Tabs */}
      <Tabs defaultValue="canisters">
        <TabsList>
          <TabsTrigger value="canisters">
            Canisters ({canisters.length})
          </TabsTrigger>
          <TabsTrigger value="health">
            Health
          </TabsTrigger>
          <TabsTrigger value="deployments">
            Deployments ({deployments.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="canisters" className="space-y-3">
          {canisters.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No canisters created yet.
              </p>
            </Card>
          ) : (
            canisters.map((c) => (
              <CanisterCard
                key={c.id}
                canister={c}
                projectSlug={project.slug}
                projectId={project.id}
                latestDeploy={deployments.find((d) => d.canister_name === c.name)}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="health" className="space-y-3">
          {canisters.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No canisters to monitor yet.
              </p>
            </Card>
          ) : (
            canisters.map((c) => (
              <CanisterHealthPanel key={c.id} canister={c} />
            ))
          )}
        </TabsContent>

        <TabsContent value="deployments">
          {deployments.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No deployments yet. Successful builds will create deployments automatically.
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
      </Tabs>
    </div>
  );
}
