import { useParams, Link } from "react-router-dom";
import { useProject } from "@/hooks/use-project";
import { useCanisterEnv } from "@/hooks/use-canister-env";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
} from "lucide-react";
import { displayRecipe, healthFromCycles } from "@/lib/utils";
import type { Deployment } from "@/api/types";

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
          <TabsTrigger value="deployments">
            Deployments ({deployments.length})
          </TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-3">
          <CanisterHealthPanel canister={canister} />
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
            ) : envVars && envVars.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No environment variables set.
              </p>
            ) : (
              <div className="font-mono text-sm space-y-1.5">
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
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
