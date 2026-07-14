import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DeployStatusIcon } from "@/components/deploy-status-icon";
import { timeAgo, formatDuration } from "@/lib/format";
import type { Deployment } from "@/api/types";

function DeployRow({
  deploy,
  projectId,
  showCanister,
}: {
  deploy: Deployment;
  projectId: string;
  showCanister: boolean;
}) {
  return (
    <Link
      to={`/projects/${projectId}/deploys/${deploy.id}`}
      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors"
    >
      <DeployStatusIcon status={deploy.status} />
      <span className="text-sm truncate flex-1 min-w-0">
        {deploy.commit_message || "No message"}
      </span>
      {showCanister && deploy.canister_name && (
        <Badge variant="outline" className="text-xs shrink-0 hidden sm:inline-flex">
          {deploy.canister_name}
        </Badge>
      )}
      {deploy.branch && (
        <span className="font-mono text-xs text-muted-foreground hidden md:inline shrink-0">
          {deploy.branch}
        </span>
      )}
      {deploy.commit_sha && (
        <span className="font-mono text-xs text-muted-foreground shrink-0">
          {deploy.commit_sha.slice(0, 7)}
        </span>
      )}
      {deploy.build_duration_ms != null && (
        <span className="text-xs text-muted-foreground hidden md:inline w-14 text-right shrink-0">
          {formatDuration(deploy.build_duration_ms)}
        </span>
      )}
      <span className="text-xs text-muted-foreground whitespace-nowrap w-16 text-right shrink-0">
        {timeAgo(deploy.created_at)}
      </span>
    </Link>
  );
}

export function DeployList({
  deployments,
  projectId,
  showCanister = false,
  emptyMessage = "No deployments yet.",
}: {
  deployments: Deployment[];
  projectId: string;
  showCanister?: boolean;
  emptyMessage?: string;
}) {
  if (deployments.length === 0) {
    return (
      <Card className="p-8 text-center border-border/50">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </Card>
    );
  }
  return (
    <Card className="divide-y divide-border/50 border-border/50 overflow-hidden gap-0 py-0">
      {deployments.map((d) => (
        <DeployRow
          key={d.id}
          deploy={d}
          projectId={projectId}
          showCanister={showCanister}
        />
      ))}
    </Card>
  );
}
