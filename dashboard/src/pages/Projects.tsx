import { Link } from "react-router-dom";
import { useProjects } from "@/hooks/use-projects";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusDot } from "@/components/status-dot";
import { Folder, AlertCircle, GitCommit, Clock, Plus, Box } from "lucide-react";
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

function ProjectRow({ project }: { project: Project }) {
  const status = getProjectStatus(project);
  const latestDeploy = project.latest_deployment;
  const canisterNames = project.canisters?.map((c) => c.name) ?? [];

  return (
    <Link to={`/projects/${project.id}`} className="block group">
      <Card className="px-5 py-4 border-border/50 hover:border-border hover:bg-card/80 transition-all duration-150 cursor-pointer">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <StatusDot status={status} />
            <span className="font-semibold truncate">{project.name}</span>
          </div>
          {canisterNames.length > 0 && (
            <span className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground shrink-0 opacity-70 group-hover:opacity-100 transition-opacity">
              <Box className="h-3 w-3" />
              {canisterNames.join(" · ")}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 ml-5 text-xs text-muted-foreground">
          {latestDeploy ? (
            <>
              <span className="flex items-center gap-1.5 truncate">
                <GitCommit className="h-3 w-3 shrink-0" />
                {latestDeploy.commit_message}
              </span>
              <span className="flex items-center gap-1.5 shrink-0 ml-4">
                <Clock className="h-3 w-3" />
                {timeAgo(latestDeploy.started_at ?? latestDeploy.created_at)}
                {latestDeploy.branch && (
                  <span className="text-muted-foreground/60">
                    on <span className="font-mono">{latestDeploy.branch}</span>
                  </span>
                )}
              </span>
            </>
          ) : (
            <span className="italic text-muted-foreground/50">No deployments yet</span>
          )}
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
            </div>
            <Skeleton className="h-3 w-40" />
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

export default function Projects() {
  const { data: projects, isLoading, error, refetch } = useProjects();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
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

      {isLoading ? (
        <ProjectListSkeleton />
      ) : error ? (
        <ProjectListError error={error.message} onRetry={() => refetch()} />
      ) : !projects?.length ? (
        <ProjectListEmpty />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <ProjectRow key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
