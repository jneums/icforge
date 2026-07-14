import { CheckCircle2, XCircle, Ban, Loader2 } from "lucide-react";
import { StatusDot } from "@/components/status-dot";
import { deployOutcome } from "@/lib/format";

/** Icon for a deploy's status — one source of truth for the check/x/spinner logic. */
export function DeployStatusIcon({ status }: { status: string }) {
  switch (deployOutcome(status)) {
    case "succeeded":
      return <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />;
    case "failed":
      return <XCircle className="h-4 w-4 shrink-0 text-destructive" />;
    case "cancelled":
      return <Ban className="h-4 w-4 shrink-0 text-muted-foreground" />;
    case "in_progress":
      return <Loader2 className="h-4 w-4 shrink-0 text-warning animate-spin" />;
    default:
      return <StatusDot status={status} />;
  }
}
