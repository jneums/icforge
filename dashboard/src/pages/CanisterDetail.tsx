import { useParams, Link } from "react-router-dom";
import { useProject } from "@/hooks/use-project";
import { useCanisterEnv } from "@/hooks/use-canister-env";
import { useCanisterControllers } from "@/hooks/use-canister-controllers";
import { useTabParam } from "@/hooks/use-tab-param";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusDot } from "@/components/status-dot";
import { CopyButton } from "@/components/copy-button";
import { HealthBadge } from "@/components/health-badge";
import { CanisterHealthPanel } from "@/components/canister-health";
import { CanisterLogsPanel } from "@/components/canister-logs-panel";
import { EnvVarEditor } from "@/components/env-var-editor";
import { ControllersEditor } from "@/components/controllers-editor";
import { DeployList } from "@/components/deploy-list";
import { ExternalLink } from "lucide-react";
import { displayRecipe, healthFromCycles } from "@/lib/utils";

const CANISTER_TABS = ["health", "logs", "deployments", "env", "controllers"];

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
  const [tab, setTab] = useTabParam("health", CANISTER_TABS);

  const project = data?.project;
  const canister = project?.canisters?.find((c) => c.id === canisterId);
  const deployments = (data?.deployments ?? []).filter(
    (d) => d.canister_name === canister?.name
  );
  const { data: envVars, isLoading: envLoading } = useCanisterEnv(
    canister?.canister_id ?? null,
    !!canister?.canister_id
  );
  const { data: controllersData, isLoading: controllersLoading } = useCanisterControllers(
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
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight truncate">
              {canister.name}
            </h1>
            <StatusDot status={canister.status} />
            {canister.canister_id && canister.cycles_balance != null && (
              <HealthBadge health={healthFromCycles(canister.cycles_balance)} />
            )}
          </div>
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
        {subdomainUrl && (
          <div className="flex items-center gap-2 shrink-0">
            <span className="font-mono text-xs text-muted-foreground hidden sm:inline">
              {project.slug}-{canister.name}.icforge.dev
            </span>
            <Button asChild size="sm" variant="outline">
              <a href={subdomainUrl} target="_blank" rel="noopener noreferrer">
                Visit <ExternalLink className="h-3.5 w-3.5 ml-1" />
              </a>
            </Button>
          </div>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="deployments">
            Deployments ({deployments.length})
          </TabsTrigger>
          <TabsTrigger value="env">Environment</TabsTrigger>
          <TabsTrigger value="controllers">Controllers</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-3">
          <CanisterHealthPanel canister={canister} />
        </TabsContent>

        <TabsContent value="logs">
          <CanisterLogsPanel canisterId={canister.canister_id!} projectId={id!} />
        </TabsContent>

        <TabsContent value="deployments">
          <DeployList
            deployments={deployments}
            projectId={project.id}
            emptyMessage="No deployments for this canister yet."
          />
        </TabsContent>

        <TabsContent value="env">
          <Card className="border-border/50 p-5 gap-0">
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

        <TabsContent value="controllers">
          <Card className="border-border/50 p-5 gap-0">
            {!canister.canister_id ? (
              <p className="text-sm text-muted-foreground">
                Canister not deployed yet — no controllers available.
              </p>
            ) : controllersLoading ? (
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
