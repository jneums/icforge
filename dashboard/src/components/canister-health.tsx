import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBadge } from "@/components/health-badge";
import { useCanisterCompute } from "@/hooks/use-canister-cycles";
import type { Canister } from "@/api/types";
import type { ComputePeriod } from "@/api/canisters";
import { Flame, Timer, DollarSign, HardDrive, Activity } from "lucide-react";

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

/** Format bytes in human-friendly units */
function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val < 10 ? val.toFixed(2) : val < 100 ? val.toFixed(1) : Math.round(val)} ${units[i]}`;
}

/** Format bytes for chart axis — compact */
function formatChartBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}K`;
  return `${bytes}`;
}

/** Format large numbers compactly (e.g. 1.2M, 45.3K) */
function formatCompact(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/** Format bytes/day growth rate */
function formatGrowthRate(bytesPerDay: number | null): string {
  if (bytesPerDay == null) return "—";
  if (Math.abs(bytesPerDay) < 1) return "Stable";
  const sign = bytesPerDay > 0 ? "+" : "";
  return `${sign}${formatBytes(Math.abs(bytesPerDay))}/day`;
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

  // Memory chart data — Y-axis is bytes
  const memoryChartData = compute.history.map((h) => ({
    date: formatChartDate(h.recorded_at, period),
    total: h.memory_size,
    wasm: h.wasm_memory_size ?? undefined,
    stable: h.stable_memory_size ?? undefined,
  }));

  // Query calls chart data — show delta between consecutive snapshots
  // (query_num_calls is cumulative, so we diff to get calls-per-interval)
  const queryChartData = compute.history
    .map((h, i) => {
      if (i === 0) return null;
      const prev = compute.history[i - 1];
      const calls = (h.query_num_calls ?? 0) - (prev.query_num_calls ?? 0);
      return {
        date: formatChartDate(h.recorded_at, period),
        calls: Math.max(0, calls),
      };
    })
    .filter((d): d is { date: string; calls: number } => d !== null);

  // Query calls in selected period
  const firstSnap = compute.history[0];
  const lastSnap = compute.history[compute.history.length - 1];
  const queriesInPeriod =
    firstSnap && lastSnap && firstSnap.query_num_calls != null && lastSnap.query_num_calls != null
      ? lastSnap.query_num_calls - firstSnap.query_num_calls
      : null;

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

        {/* ─── Memory Usage Card ─── */}
        <div className="pt-3 border-t border-border/30">
          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <HardDrive className="h-3 w-3" /> Total Memory
              </div>
              <div className="text-xl font-bold">
                {formatBytes(compute.current_memory_size)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Growth Rate</div>
              <div className="text-sm font-medium">
                {formatGrowthRate(compute.memory_growth_bytes_per_day)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Heap (Wasm)</div>
              <div className="text-sm font-medium">
                {formatBytes(compute.wasm_memory_size)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Stable Memory</div>
              <div className="text-sm font-medium">
                {formatBytes(compute.stable_memory_size)}
              </div>
            </div>
          </div>

          {/* Wasm limit bar if available */}
          {compute.wasm_memory_limit != null && compute.wasm_memory_limit > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                <span>Memory usage vs limit</span>
                <span>
                  {formatBytes(compute.current_memory_size)} / {formatBytes(compute.wasm_memory_limit)}
                </span>
              </div>
              <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min(100, (compute.current_memory_size / compute.wasm_memory_limit) * 100)}%`,
                    backgroundColor:
                      compute.current_memory_size / compute.wasm_memory_limit > 0.9
                        ? "var(--destructive)"
                        : compute.current_memory_size / compute.wasm_memory_limit > 0.7
                          ? "var(--warning, #f59e0b)"
                          : "var(--primary)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Memory over time chart */}
          {memoryChartData.length > 1 && (
            <div>
              <span className="text-xs text-muted-foreground">Memory Over Time</span>
              <div className="h-40 mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={memoryChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tickFormatter={formatChartBytes}
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      width={55}
                    />
                    <Tooltip
                      formatter={(val, name) => [
                        formatBytes(Number(val)),
                        name === "total" ? "Total" : name === "wasm" ? "Heap" : "Stable",
                      ]}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="total"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.1}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="wasm"
                      stroke="#8b5cf6"
                      fill="#8b5cf6"
                      fillOpacity={0.08}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="stable"
                      stroke="#06b6d4"
                      fill="#06b6d4"
                      fillOpacity={0.08}
                      strokeWidth={1.5}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-4 mt-1 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: "var(--primary)" }} />
                  Total
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                  Heap
                </span>
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2 h-2 rounded-full bg-cyan-500" />
                  Stable
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ─── Query Calls Card ─── */}
        <div className="pt-3 border-t border-border/30">
          <div className="grid grid-cols-4 gap-4 mb-3">
            <div>
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Activity className="h-3 w-3" /> Total Calls
              </div>
              <div className="text-xl font-bold">
                {formatCompact(compute.query_num_calls)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">In Period</div>
              <div className="text-sm font-medium">
                {formatCompact(queriesInPeriod)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Calls/Day</div>
              <div className="text-sm font-medium">
                {formatCompact(compute.query_calls_per_day)}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Avg Instructions</div>
              <div className="text-sm font-medium">
                {compute.query_num_calls && compute.query_num_instructions && compute.query_num_calls > 0
                  ? formatCompact(Math.round(compute.query_num_instructions / compute.query_num_calls))
                  : "—"}
              </div>
            </div>
          </div>

          {/* Query calls over time chart */}
          {queryChartData.length > 1 && (
            <div>
              <span className="text-xs text-muted-foreground">Query Calls Over Time</span>
              <div className="h-40 mt-1">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={queryChartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/30" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                    />
                    <YAxis
                      tickFormatter={(v) => formatCompact(v)}
                      tick={{ fontSize: 11 }}
                      className="text-muted-foreground"
                      width={50}
                    />
                    <Tooltip
                      formatter={(val) => [formatCompact(Number(val)), "Calls"]}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                      contentStyle={{
                        backgroundColor: "var(--card)",
                        border: "1px solid var(--border)",
                        borderRadius: "6px",
                        fontSize: "12px",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="calls"
                      stroke="#10b981"
                      fill="#10b981"
                      fillOpacity={0.1}
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 3 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {queryChartData.length <= 1 && compute.query_num_calls == null && (
            <div className="h-16 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-md">
              No query call data available yet
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
