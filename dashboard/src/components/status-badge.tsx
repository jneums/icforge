import { Badge } from "@/components/ui/badge"

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  deployed: { label: "Deployed", className: "bg-success/15 text-success border-success/20" },
  running:  { label: "Running",  className: "bg-success/15 text-success border-success/20" },
  live:     { label: "Live",     className: "bg-success/15 text-success border-success/20" },
  building: { label: "Building", className: "bg-warning/15 text-warning border-warning/20" },
  queued:   { label: "Queued",   className: "bg-warning/15 text-warning border-warning/20" },
  deploying:{ label: "Deploying",className: "bg-warning/15 text-warning border-warning/20" },
  created:  { label: "Created",  className: "bg-warning/15 text-warning border-warning/20" },
  failed:   { label: "Failed",   className: "bg-destructive/15 text-destructive border-destructive/20" },
  cancelled:{ label: "Cancelled",className: "bg-muted text-muted-foreground" },
  stopped:  { label: "Stopped",  className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: "bg-muted text-muted-foreground" };
  return <Badge variant="outline" className={config.className}>{config.label}</Badge>;
}
