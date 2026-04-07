import { cn } from "@/lib/utils"

const DOT_COLORS: Record<string, string> = {
  deployed: "bg-success", running: "bg-success", live: "bg-success", succeeded: "bg-success",
  building: "bg-warning", queued: "bg-warning", deploying: "bg-warning", created: "bg-warning",
  failed: "bg-destructive", error: "bg-destructive",
  cancelled: "bg-muted-foreground", stopped: "bg-muted-foreground",
};

export function StatusDot({ status, pulse = false }: { status: string; pulse?: boolean }) {
  const color = DOT_COLORS[status] ?? "bg-muted-foreground";
  return (
    <span className={cn(
      "inline-block h-2 w-2 rounded-full shrink-0",
      color,
      pulse && "animate-pulse"
    )} />
  );
}
