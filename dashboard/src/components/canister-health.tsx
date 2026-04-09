import { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { HealthBadge } from "@/components/health-badge";
import { useCanisterCycles, useCyclesSettings, useManualTopup } from "@/hooks/use-canister-cycles";
import { formatCycles, cyclesHealthLevel } from "@/lib/utils";
import type { Canister } from "@/api/types";
import { Zap, Shield, ArrowUpCircle } from "lucide-react";

const TRILLION = 1_000_000_000_000;

function formatChartDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatChartBalance(val: number): string {
  return `${(val / TRILLION).toFixed(1)}T`;
}

interface CanisterHealthPanelProps {
  canister: Canister;
}

export function CanisterHealthPanel({ canister }: CanisterHealthPanelProps) {
  const canisterId = canister.canister_id;
  const { data: cycles, isLoading, error } = useCanisterCycles(canisterId);
  const settingsMutation = useCyclesSettings(canisterId ?? "");
  const topupMutation = useManualTopup(canisterId ?? "");
  const [topupAmount, setTopupAmount] = useState(2_000_000_000_000); // 2T default

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

  if (error || !cycles) {
    return (
      <Card className="p-4 border-border/50">
        <div className="flex items-center gap-2 text-sm text-destructive">
          <span className="font-semibold">{canister.name}</span>
          <span>— Failed to load cycles data</span>
        </div>
      </Card>
    );
  }

  const health = cyclesHealthLevel(cycles.current_balance);

  // Prepare chart data
  const chartData = cycles.history.map((h) => ({
    date: formatChartDate(h.recorded_at),
    balance: h.balance,
    memory: h.memory_size,
  }));

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle className="text-base">{canister.name}</CardTitle>
            <HealthBadge health={health} />
          </div>
          <span className="font-mono text-xs text-muted-foreground">{canisterId}</span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Balance + Quick Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Cycles Balance</div>
            <div className="text-xl font-bold">{formatCycles(cycles.current_balance)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Alert Threshold</div>
            <div className="text-sm font-medium">{formatCycles(cycles.alert_threshold)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Top-ups</div>
            <div className="text-sm font-medium">{cycles.topups.length} recorded</div>
          </div>
        </div>

        {/* Cycles Chart */}
        {chartData.length > 1 && (
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
                  tickFormatter={formatChartBalance}
                  tick={{ fontSize: 11 }}
                  className="text-muted-foreground"
                  width={50}
                />
                <Tooltip
                  formatter={(val) => [typeof val === "number" ? formatCycles(val) : String(val ?? ""), "Cycles"]}
                  labelStyle={{ color: "var(--muted-foreground)" }}
                  contentStyle={{
                    backgroundColor: "var(--card)",
                    border: "1px solid var(--border)",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <ReferenceLine
                  y={2_000_000_000_000}
                  stroke="var(--warning)"
                  strokeDasharray="4 4"
                  label={{ value: "Warning", fill: "var(--warning)", fontSize: 10 }}
                />
                <ReferenceLine
                  y={500_000_000_000}
                  stroke="var(--destructive)"
                  strokeDasharray="4 4"
                  label={{ value: "Critical", fill: "var(--destructive)", fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {chartData.length <= 1 && (
          <div className="h-24 flex items-center justify-center text-sm text-muted-foreground border border-dashed border-border/50 rounded-md">
            Not enough data for a chart yet — snapshots are taken every 6 hours
          </div>
        )}

        {/* Controls: auto-topup toggle + manual topup */}
        <div className="flex items-center justify-between gap-4 pt-2 border-t border-border/30">
          <div className="flex items-center gap-3">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Auto top-up</span>
            <Button
              variant={cycles.auto_topup ? "default" : "outline"}
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                settingsMutation.mutate({ auto_topup: !cycles.auto_topup })
              }
              disabled={settingsMutation.isPending}
            >
              {cycles.auto_topup ? "Enabled" : "Disabled"}
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">Top up:</span>
            {[1, 2, 5].map((t) => (
              <Button
                key={t}
                variant={topupAmount === t * TRILLION ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => setTopupAmount(t * TRILLION)}
              >
                {t}T
              </Button>
            ))}
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => topupMutation.mutate(topupAmount)}
              disabled={topupMutation.isPending}
            >
              <ArrowUpCircle className="h-3 w-3" />
              {topupMutation.isPending ? "Sending…" : "Top Up"}
            </Button>
          </div>
        </div>

        {/* Recent top-ups */}
        {cycles.topups.length > 0 && (
          <div className="pt-2 border-t border-border/30">
            <div className="text-xs font-semibold text-muted-foreground mb-2">Recent Top-ups</div>
            <div className="space-y-1.5">
              {cycles.topups.slice(0, 5).map((t) => (
                <div key={t.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">
                      {t.source}
                    </Badge>
                    <span>{formatCycles(t.cycles_amount)} cycles</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <span>${(t.cost_cents / 100).toFixed(2)}</span>
                    <span>{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
