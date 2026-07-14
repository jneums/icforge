import { useState, useMemo } from "react";
import {
  useCanisterLogs,
  flattenLogPages,
  useLogSettings,
  useUpdateLogSettings,
} from "@/hooks/use-canister-logs";
import { useCanisterLogStream } from "@/hooks/use-canister-log-stream";
import { LogViewer } from "@/components/log-viewer";
import { Button } from "@/components/ui/button";
import { Radio, History } from "lucide-react";
import type { LogPeriod } from "@/api/canister-logs";

const LOG_PERIODS: { label: string; value: LogPeriod }[] = [
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
];

const RETENTION_OPTIONS: { label: string; value: number }[] = [
  { label: "1 hour", value: 1 },
  { label: "24 hours", value: 24 },
  { label: "7 days", value: 168 },
  { label: "30 days", value: 720 },
];

export function CanisterLogsPanel({
  canisterId,
  projectId,
  height = "calc(100vh - 420px)",
}: {
  canisterId: string;
  projectId: string;
  height?: string;
}) {
  const [period, setPeriod] = useState<LogPeriod>("24h");
  const [liveMode, setLiveMode] = useState(false);

  // Historical logs with infinite scroll (non-live)
  const {
    data: logsData,
    isLoading: logsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useCanisterLogs(liveMode ? null : canisterId, { period, limit: 500 });

  // Live streaming
  const { logs: streamLogs, streaming } = useCanisterLogStream(
    canisterId,
    liveMode
  );

  // Log settings (retention)
  const { data: settings } = useLogSettings(projectId);
  const updateSettings = useUpdateLogSettings(projectId);

  // Merge: in live mode use stream logs, otherwise flatten infinite query pages
  const logs = useMemo(() => {
    if (liveMode) return streamLogs;
    return flattenLogPages(logsData?.pages);
  }, [liveMode, streamLogs, logsData]);

  return (
    <div className="space-y-4">
      {/* Controls bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <Button
            variant={liveMode ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => setLiveMode(!liveMode)}
          >
            <Radio className="h-3 w-3 mr-1.5" />
            {liveMode ? "Live" : "Go Live"}
          </Button>

          {/* Period selector (only in history mode) */}
          {!liveMode && (
            <div className="flex items-center gap-1 ml-2">
              <History className="h-3 w-3 text-muted-foreground" />
              {LOG_PERIODS.map((p) => (
                <Button
                  key={p.value}
                  variant={period === p.value ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          )}
        </div>

        {/* Retention settings */}
        {settings && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Retention:</span>
            <select
              className="bg-muted border border-border rounded px-2 py-0.5 text-xs"
              value={settings.log_retention_hours}
              onChange={(e) => updateSettings.mutate(Number(e.target.value))}
              disabled={updateSettings.isPending}
            >
              {RETENTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {settings.log_count > 0 && (
              <span className="text-muted-foreground/60">
                ({settings.log_count.toLocaleString()} entries)
              </span>
            )}
          </div>
        )}
      </div>

      {/* Log viewer */}
      <LogViewer
        logs={logs}
        streaming={streaming}
        loading={logsLoading}
        emptyMessage="No canister logs yet. Logs appear when your canister prints to stdout/stderr."
        height={height}
        onLoadMore={() => fetchNextPage()}
        loadingMore={isFetchingNextPage}
        hasMore={hasNextPage ?? false}
      />
    </div>
  );
}
