import { Badge } from "@/components/ui/badge";
import { Heart, AlertTriangle, AlertCircle, Snowflake } from "lucide-react";

type HealthLevel = "healthy" | "warning" | "critical" | "frozen" | "unknown";

const HEALTH_CONFIG: Record<HealthLevel, { label: string; className: string; icon: typeof Heart }> = {
  healthy:  { label: "Healthy",  className: "bg-success/15 text-success border-success/20",             icon: Heart },
  warning:  { label: "Low Cycles", className: "bg-warning/15 text-warning border-warning/20",           icon: AlertTriangle },
  critical: { label: "Critical",   className: "bg-destructive/15 text-destructive border-destructive/20", icon: AlertCircle },
  frozen:   { label: "Frozen",     className: "bg-destructive/15 text-destructive border-destructive/20", icon: Snowflake },
  unknown:  { label: "Unknown",    className: "bg-muted text-muted-foreground",                          icon: Heart },
};

export function HealthBadge({ health }: { health: HealthLevel }) {
  const config = HEALTH_CONFIG[health] ?? HEALTH_CONFIG.unknown;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`${config.className} gap-1`}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
}
