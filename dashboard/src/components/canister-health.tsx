import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBadge } from "@/components/health-badge";
import { useCanisterCompute } from "@/hooks/use-canister-cycles";
import type { Canister } from "@/api/types";
import type { ComputePeriod } from "@/api/canisters";
import { Flame, Timer, DollarSign } from "lucide-react";

const PERIOD_OPTIONS: { value: ComputePeriod; label: string }[] = [
  { value: "1h", label: "1H" },
  { value: "6h", label: "6H" },
  { value: "24h", label: "24H" },
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
];

function formatChartDate(dateStr: string, period: ComputePeriod): string {
  const d = new Date(dateStr);
  if (period === "1h" || period === "6h" || period === "24h") {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  if (period === "7d") {
    return d.toLocaleDateString("en-US", { weekday: "short", hour: "numeric" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Format cents as USD — e.g. 350 → "$3.50", 5 → "$0.05" */
function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Compact USD for chart axis — e.g. 1050 → "$10.50", 150 → "$1.50" */
function formatChartUsd(cents: number): string {
  if (cents >= 10000) return `$${(cents / 100).toFixed(0)}`;
  return `$${(cents / 100).toFixed(2)}`;
}

/** Format runway in human-friendly units */
function formatRunway(days: number | null): string {
  if (days == null) return "—";
  if (days > 365) return `${(days / 365).toFixed(1)}y`;
  if (days > 30) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days)}d`;
}

interface CanisterHealthPanelProps {
  canister: Canister;
}

export function CanisterHealthPanel({ canister }: CanisterHealthPanelProps) {
  const canisterId = canister.canister_id;
  const [period, setPeriod] = useState<ComputePeriod>("24h");
  const { data: compute, isLoading, error } = useCanisterCompute(canisterId, period);

  if (!canisterId) {
    return (
      <Card className="p-4 border-border/50">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="font-semibold">{canister.name}</span>
          <span>— No canister ID (not deployed yet)</span>
        </div>
      </Card>
    );
  }

  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-lg" />;
  }

  if (error || !compute) {
    return (
      <Card className="p-4 border-border/50">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span className="font-semibold">{canister.name}</span>
          <span>— Failed to load compute data</span>
        </div>
      </Card>
    );
  }

  // Prepare chart data — Y-axis is USD cents
  const chartData = compute.history.map((h) => ({
    date: formatChartDate(h.recorded_at, period),
    value: h.compute_value_cents,
  }));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">{canister.name}</CardTitle>
            <HealthBadge health={compute.health} />
          </div>
          <span className="font-mono text-xs text-muted-foreground">{canisterId}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Compute Value + Quick Stats */}
        <div className="grid grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Compute Value
            </div>
            <div className="text-xl font-bold">{formatUsd(compute.compute_value_cents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Flame className="h-3 w-3" /> Burn Rate
            </div>
            <div className="text-sm font-medium">
              {compute.burn_rate_cents_per_day != null
                ? `${formatUsd(compute.burn_rate_cents_per_day)}/day`
                : "—"}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
              <Timer className="h-3 w-3" /> Runway
            </div>
            <div className="text-sm font-medium">
              {formatRunway(compute.runway_days)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Top-ups</div>
            <div className="text-sm font-medium">{compute.topups.length} recorded</div>
          </div>
        </div>

        {/* Compute Value Chart */}
        {chartData.length > 1 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Compute Value Over Time</span>
              <div className="flex gap-1">
                {PERIOD_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setPeriod(opt.value)}
                    className={`px-2 py-0.5 text-xs rounded ${
                      period === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-muted/80"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tickFormatter={formatChartUsd}
                    tick={{ fontSize: 11 }}
                    className="text-muted-foreground"
                    width={60}
                  />
                  <Tooltip
                    formatter={(val) => [
                      typeof val === "number" ? formatUsd(val) : String(val ?? ""),
                      "Compute Value",
                    ]}
                    labelStyle={{ color: "var(--muted-foreground)" }}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {chartData.length <= 1 && (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-md">
            Not enough data for a chart yet — snapshots are taken every 60 seconds
          </div>
        )}

        {/* Recent top-ups */}
        {compute.topups.length > 0 && (
          <div className="pt-2 border-t border-border/30">
            <div className="text-xs font-semibold text-muted-foreground mb-2">Recent Top-ups</div>
            <div className="space-y-1.5">
              {compute.topups.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {t.source}
                    </Badge>
                    <span>{formatUsd(t.cost_cents)}</span>
                  </div>
                  <span className="text-muted-foreground">
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
