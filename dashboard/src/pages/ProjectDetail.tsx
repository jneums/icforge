import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ExternalLink,
  GitCommit,
  Clock,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { useProject } from "@/hooks/use-project";
import { useCanisterEnv } from "@/hooks/use-canister-env";
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
import type { Canister, Deployment } from "@/api/types";

const IN_PROGRESS_STATUSES = ["pending", "building", "deploying", "created"];

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

/* -- Sub-components -- */

function CanisterCard({ canister, projectSlug }: { canister: Canister; projectSlug: string }) {
  const [open, setOpen] = useState(false);
  const { data: envVars, isLoading: envLoading } = useCanisterEnv(
    canister.canister_id,
    open
  );
  const subdomainUrl = canister.canister_id
    ? `https://${canister.name}.${projectSlug}.icforge.dev`
    : null;

  return (
    <Card className="p-4 border-border/50">
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold">{canister.name}</span>
        <Badge variant="outline" className="text-xs">
          {canister.type}
        </Badge>
        <StatusDot status={canister.status} />
        {canister.canister_id && (
          <>
            <span className="ml-auto font-mono text-xs text-muted-foreground">
              {canister.canister_id}
            </span>
            <CopyButton text={canister.canister_id} />
          </>
        )}
      </div>

      {subdomainUrl && (
        <div className="mt-2 flex items-center gap-1.5">
          <a
            href={subdomainUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-muted-foreground hover:text-primary inline-flex items-center gap-1"
          >
            {canister.name}.{projectSlug}.icforge.dev
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

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors cursor-pointer"
      onClick={() => navigate(`/projects/${projectId}/deploys/${deploy.id}`)}
    >
      <StatusDot status={deploy.status} pulse={inProgress} />
      <span className="text-sm truncate flex-1">
        {deploy.commit_message || "No message"}
      </span>
      {deploy.commit_sha && (
        <span className="font-mono text-xs text-muted-foreground">
          {deploy.commit_sha.slice(0, 7)}
        </span>
      )}
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {timeAgo(deploy.started_at)}
      </span>
    </div>
  );
}

function ProductionDeployCard({
  deploy,
  projectId,
}: {
  deploy: Deployment;
  projectId: string;
}) {
  const isBuilding = IN_PROGRESS_STATUSES.includes(deploy.status);

  return (
    <Link to={`/projects/${projectId}/deploys/${deploy.id}`}>
      <Card className="p-5 hover:border-border hover:bg-card/80 border-border/50 transition-all duration-150 cursor-pointer">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Production Deployment
          </span>
          {isBuilding && <Spinner className="h-3 w-3" />}
        </div>
        <p className="font-medium truncate">
          {deploy.commit_message || "No commit message"}
        </p>
        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
          <GitCommit className="h-3 w-3" />
          <span className="font-mono">
            {deploy.commit_sha?.slice(0, 7) ?? "—"}
          </span>
          <span className="text-muted-foreground/60">on</span>
          <span className="font-mono">{deploy.branch || "main"}</span>
          <span className="text-muted-foreground/40">&middot;</span>
          <Clock className="h-3 w-3" />
          <span>{timeAgo(deploy.started_at)}</span>
        </div>
      </Card>
    </Link>
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
    latestDeploy?.status ?? project.canisters?.[0]?.status ?? "pending";
  const canisters = project.canisters ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {project.name}
          </h1>
          <span className="text-sm font-mono text-muted-foreground">
            {project.slug}
          </span>
        </div>
        <StatusBadge status={latestStatus} />
      </div>

      {/* Production Deploy Card */}
      {latestDeploy && (
        <ProductionDeployCard deploy={latestDeploy} projectId={project.id} />
      )}

      {/* Tabs */}
      <Tabs defaultValue="deploys" className="pt-6">
        <TabsList>
          <TabsTrigger value="deploys">
            Deployments ({deployments.length})
          </TabsTrigger>
          <TabsTrigger value="canisters">
            Canisters ({canisters.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deploys">
          {deployments.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No deployments yet. Run{" "}
                <code className="font-mono bg-popover px-1.5 py-0.5 rounded text-xs">icforge deploy</code> to create
                your first deployment.
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

        <TabsContent value="canisters" className="space-y-3">
          {canisters.length === 0 ? (
            <Card className="p-8 text-center border-border/50">
              <p className="text-sm text-muted-foreground">
                No canisters created yet.
              </p>
            </Card>
          ) : (
            canisters.map((c) => <CanisterCard key={c.id} canister={c} projectSlug={project.slug} />)
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
