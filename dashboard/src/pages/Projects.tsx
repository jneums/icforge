import { Link } from "react-router-dom";
import { useProjects } from "@/hooks/use-projects";
import { useBillingBalance } from "@/hooks/use-billing";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StatusDot } from "@/components/status-dot";
import { HealthBadge } from "@/components/health-badge";
import {
  Folder,
  AlertCircle,
  GitCommit,
  Clock,
  Plus,
  Box,
  CreditCard,
} from "lucide-react";
import { displayRecipe, healthFromCycles } from "@/lib/utils";
import type { Project } from "@/api/types";

function getProjectStatus(project: Project): string {
  if (!project.canisters?.length) return "queued";
  const statuses = project.canisters.map((c) => c.status);
  if (statuses.includes("running")) return "running";
  if (statuses.includes("created")) return "created";
  return statuses[0] ?? "queued";
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

function getProjectHealth(project: Project): "healthy" | "warning" | "critical" | "frozen" | "unknown" {
  const canisters = project.canisters ?? [];
  if (canisters.length === 0) return "unknown";
  const levels = canisters.map((c) => healthFromCycles(c.cycles_balance));
  const priority: Record<string, number> = { frozen: 0, critical: 1, warning: 2, unknown: 3, healthy: 4 };
  levels.sort((a, b) => (priority[a] ?? 5) - (priority[b] ?? 5));
  return levels[0];
}

/** Format cents as USD — e.g. 350 → "$3.50" */
function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Status label for display */
function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    running: "Live",
    deployed: "Live",
    live: "Live",
    succeeded: "Live",
    building: "Building",
    deploying: "Deploying",
    queued: "Queued",
    created: "Pending",
    failed: "Failed",
    error: "Error",
    cancelled: "Cancelled",
    stopped: "Stopped",
  };
  return labels[status] ?? status;
}

function ProjectCard({ project }: { project: Project }) {
  const status = getProjectStatus(project);
  const health = getProjectHealth(project);
  const latestDeploy = project.latest_deployment;
  const canisters = project.canisters ?? [];

  return (
    <Link to={`/projects/${project.id}`} className="block group">
      <Card className="px-5 py-4 border-border/50 hover:border-border hover:bg-card/80 transition-all duration-150 cursor-pointer">
        {/* Row 1: Name + Status */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <StatusDot status={status} pulse={status === "building" || status === "deploying"} />
            <span className="font-semibold truncate">{project.name}</span>
            <Badge variant="outline" className="text-[10px] font-normal shrink-0">
              {statusLabel(status)}
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {health !== "unknown" && health !== "healthy" && (
              <HealthBadge health={health} />
            )}
          </div>
        </div>

        {/* Row 2: Canisters */}
        {canisters.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mt-2.5 ml-5">
            {canisters.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/50 rounded-md px-2 py-0.5"
              >
                <Box className="h-3 w-3 shrink-0" />
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground/60">
                  {displayRecipe(c.recipe)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Row 3: Last deploy + live URL */}
        <div className="flex items-center justify-between mt-2.5 ml-5 text-xs text-muted-foreground">
          {latestDeploy ? (
            <span className="flex items-center gap-1.5 truncate">
              <GitCommit className="h-3 w-3 shrink-0" />
              <span className="truncate">{latestDeploy.commit_message}</span>
              {latestDeploy.branch && (
                <span className="text-muted-foreground/50 shrink-0">
                  on <span className="font-mono">{latestDeploy.branch}</span>
                </span>
              )}
            </span>
          ) : (
            <span className="italic text-muted-foreground/50">No deployments yet</span>
          )}
          <div className="flex items-center gap-3 shrink-0 ml-4">
            {latestDeploy && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {timeAgo(latestDeploy.started_at ?? latestDeploy.created_at)}
              </span>
            )}
          </div>
        </div>
      </Card>
    </Link>
  );
}

function ProjectListSkeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3].map((i) => (
        <Card key={i} className="px-5 py-4 border-border/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-2 w-2 rounded-full" />
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-4 w-12 rounded-md" />
            </div>
            <Skeleton className="h-5 w-20 rounded-full" />
          </div>
          <div className="flex gap-2 mt-2.5 ml-5">
            <Skeleton className="h-5 w-28 rounded-md" />
            <Skeleton className="h-5 w-32 rounded-md" />
          </div>
          <div className="flex justify-between mt-2.5 ml-5">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function ProjectListEmpty() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-full bg-muted p-4 mb-5">
        <Folder className="h-10 w-10 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">No projects yet</h2>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Deploy your first canister to the Internet Computer in minutes using the CLI.
      </p>
      <Card className="bg-popover border-border/50 p-5 font-mono text-sm text-left">
        <div className="text-muted-foreground/60">$ npm i -g @icforge/cli</div>
        <div className="text-muted-foreground/60">$ icforge init</div>
        <div>$ icforge deploy</div>
      </Card>
      <p className="text-sm text-muted-foreground mt-4">or</p>
      <Button asChild className="mt-2">
        <Link to="/projects/new">
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Import from GitHub
        </Link>
      </Button>
    </div>
  );
}

function ProjectListError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-5">
        <AlertCircle className="h-10 w-10 text-destructive" />
      </div>
      <h2 className="text-lg font-semibold mb-1">Failed to load projects</h2>
      <p className="text-sm text-muted-foreground mb-5">{error}</p>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

/** Low-balance threshold: show banner when under $1.00 */
const LOW_BALANCE_CENTS = 100;

export default function Projects() {
  const { data: projects, isLoading, error, refetch } = useProjects();
  const { data: billing } = useBillingBalance();

  const showLowBalance =
    billing != null && billing.compute_balance_cents < LOW_BALANCE_CENTS;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          {billing != null && (
            <Link to="/settings" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
              <CreditCard className="h-3.5 w-3.5" />
              {formatUsd(billing.compute_balance_cents)}
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          {!!projects?.length && (
            <span className="text-sm text-muted-foreground">
              {projects.length} project{projects.length !== 1 && "s"}
            </span>
          )}
          <Button asChild size="sm">
            <Link to="/projects/new">
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              New Project
            </Link>
          </Button>
        </div>
      </div>

      {showLowBalance && (
        <Alert className="border-yellow-500/50 bg-yellow-500/10">
          <AlertCircle className="h-4 w-4 text-yellow-500" />
          <AlertDescription>
            Your compute balance is low ({formatUsd(billing!.compute_balance_cents)}).
            Canisters may not be auto-topped up.{" "}
            <Link to="/settings" className="underline font-medium text-yellow-500 hover:text-yellow-400">
              Add credits
            </Link>
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <ProjectListSkeleton />
      ) : error ? (
        <ProjectListError error={error.message} onRetry={() => refetch()} />
      ) : !projects?.length ? (
        <ProjectListEmpty />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
