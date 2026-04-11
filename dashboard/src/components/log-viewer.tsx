import { useState, useRef, useEffect, useCallback } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import type { LogEntry } from "@/api/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Copy, Search, ArrowDown, ArrowUp, X } from "lucide-react";
import { toast } from "sonner";

/* ── Constants ──────────────────────────────────────────────── */

const LEVEL_COLORS: Record<string, string> = {
  error: "text-destructive",
  warn: "text-warning",
  warning: "text-warning",
  info: "text-muted-foreground",
  debug: "text-muted-foreground/60",
};

const FILTERABLE_LEVELS = ["error", "warn", "info", "debug"] as const;

/* ── Helpers ────────────────────────────────────────────────── */

function formatTimestamp(ts: string): string | null {
  if (!ts) return null;
  try {
    const normalized = ts.includes("T") ? ts : ts.replace(" ", "T");
    const d = new Date(normalized.endsWith("Z") ? normalized : normalized + "Z");
    if (isNaN(d.getTime())) return null;
    const h = String(d.getUTCHours()).padStart(2, "0");
    const m = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${h}:${m}:${s}`;
  } catch {
    return null;
  }
}

const URL_RE = /(https?:\/\/[^\s)>]+)/g;

function LinkifiedMessage({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  if (parts.length === 1) return <>{text}</>;
  return (
    <>
      {parts.map((part, i) =>
        URL_RE.test(part) ? (
          <a
            key={i}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {part}
          </a>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* ── LogLine ────────────────────────────────────────────────── */

function LogLine({
  entry,
  lineNumber,
  highlighted,
  onClickLine,
  searchTerm,
}: {
  entry: LogEntry;
  lineNumber: number;
  highlighted: boolean;
  onClickLine: (n: number) => void;
  searchTerm?: string;
}) {
  const ts = formatTimestamp(entry.timestamp);
  return (
    <div
      id={`L${lineNumber}`}
      className={cn(
        "flex gap-2 pl-2 pr-3 py-px hover:bg-muted/30 border-l-2 border-transparent",
        highlighted && "bg-primary/5 border-l-primary"
      )}
    >
      <span
        className="text-muted-foreground/50 select-none cursor-pointer min-w-[2.5ch] text-right hover:text-primary"
        onClick={() => onClickLine(lineNumber)}
      >
        {lineNumber}
      </span>
      {ts && (
        <span className="text-muted-foreground/70 whitespace-nowrap">
          {ts}
        </span>
      )}
      <span className={cn("whitespace-nowrap", LEVEL_COLORS[entry.level])}>
        [{entry.level}]
      </span>
      <span className="text-foreground whitespace-pre-wrap break-all flex-1">
        {searchTerm ? (
          <HighlightedMessage text={entry.message} term={searchTerm} />
        ) : (
          <LinkifiedMessage text={entry.message} />
        )}
      </span>
    </div>
  );
}

function HighlightedMessage({ text, term }: { text: string; term: string }) {
  if (!term) return <LinkifiedMessage text={text} />;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const parts = text.split(new RegExp(`(${escaped})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === term.toLowerCase() ? (
          <mark key={i} className="bg-primary/30 text-foreground rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/* ── LogViewer ──────────────────────────────────────────────── */

export interface LogViewerProps {
  /** Log entries to display (should be in chronological order) */
  logs: LogEntry[];
  /** Whether new logs are actively arriving */
  streaming?: boolean;
  /** Show spinner + "Waiting for logs..." when empty and loading */
  loading?: boolean;
  /** Empty state message when not loading */
  emptyMessage?: string;
  /** Show level filter buttons (default: true) */
  showFilters?: boolean;
  /** Show search bar (default: true) */
  showSearch?: boolean;
  /** CSS class for the outer container */
  className?: string;
  /** Height style override — defaults to calc(100vh - 340px) */
  height?: string;
  /** Called when user scrolls to the top — load older logs */
  onLoadMore?: () => void;
  /** Whether older pages are currently being fetched */
  loadingMore?: boolean;
  /** Whether there are more older pages to load */
  hasMore?: boolean;
}

export function LogViewer({
  logs,
  streaming = false,
  loading = false,
  emptyMessage = "No logs available",
  showFilters = true,
  showSearch = true,
  className,
  height,
  onLoadMore,
  loadingMore = false,
  hasMore = false,
}: LogViewerProps) {
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeFilters, setActiveFilters] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Read line highlight from URL hash on mount
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#L")) setHighlightedLine(parseInt(hash.slice(2)));
  }, []);

  // Auto-scroll to bottom when new logs arrive
  const atBottomRef = useRef(true);
  useEffect(() => {
    if (autoScroll && atBottomRef.current && filteredLogs.length > 0) {
      virtuosoRef.current?.scrollToIndex({
        index: filteredLogs.length - 1,
        behavior: "smooth",
      });
    }
  });

  // Keyboard shortcut: Ctrl/Cmd+F to open search
  useEffect(() => {
    if (!showSearch) return;
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 0);
      }
      if (e.key === "Escape") {
        setSearchOpen(false);
        setSearchTerm("");
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSearch]);

  // Filter logs by level and search
  const filteredLogs = logs.filter((entry) => {
    if (activeFilters.size > 0 && !activeFilters.has(entry.level)) {
      // "warn" and "warning" are equivalent
      if (!(entry.level === "warning" && activeFilters.has("warn"))) {
        return false;
      }
    }
    if (searchTerm) {
      return entry.message.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const toggleFilter = useCallback((level: string) => {
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(level)) {
        next.delete(level);
      } else {
        next.add(level);
      }
      return next;
    });
  }, []);

  const handleClickLine = useCallback((n: number) => {
    window.location.hash = `#L${n}`;
    setHighlightedLine(n);
  }, []);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(
      filteredLogs.map((l) => l.message).join("\n")
    );
    toast.success("Logs copied to clipboard");
  }, [filteredLogs]);

  // Count per level for badge numbers
  const levelCounts = logs.reduce<Record<string, number>>((acc, l) => {
    const key = l.level === "warning" ? "warn" : l.level;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const containerHeight = height ?? "calc(100vh - 340px)";

  // Trigger load-more when user scrolls to the very top
  const handleStartReached = useCallback(() => {
    if (onLoadMore && hasMore && !loadingMore) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, loadingMore]);

  return (
    <div className={className}>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {showFilters &&
            FILTERABLE_LEVELS.map((level) => {
              const count = levelCounts[level] ?? 0;
              const active = activeFilters.has(level);
              return (
                <Button
                  key={level}
                  variant={active ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "text-xs h-7 px-2",
                    active && LEVEL_COLORS[level]
                  )}
                  onClick={() => toggleFilter(level)}
                >
                  {level}
                  {count > 0 && (
                    <span className="ml-1 text-muted-foreground/70">
                      {count}
                    </span>
                  )}
                </Button>
              );
            })}
        </div>
        <div className="flex items-center gap-2">
          {searchOpen && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search logs..."
                className="h-7 w-48 pl-7 pr-7 text-xs font-mono"
              />
              {searchTerm && (
                <button
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {showSearch && !searchOpen && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => {
                setSearchOpen(true);
                setTimeout(() => searchInputRef.current?.focus(), 0);
              }}
            >
              <Search className="h-3 w-3 mr-1.5" /> Search
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={handleCopy}
          >
            <Copy className="h-3 w-3 mr-1.5" /> Copy
          </Button>
          <Button
            variant={autoScroll ? "secondary" : "ghost"}
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setAutoScroll(!autoScroll);
              if (!autoScroll && filteredLogs.length > 0) {
                virtuosoRef.current?.scrollToIndex({
                  index: filteredLogs.length - 1,
                  behavior: "smooth",
                });
              }
            }}
          >
            <ArrowDown className="h-3 w-3 mr-1" />
            {autoScroll ? "Following" : "Follow"}
          </Button>
          {streaming && (
            <Badge
              variant="outline"
              className="text-xs bg-success/10 text-success border-success/20 h-7"
            >
              <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse inline-block" />
              Live
            </Badge>
          )}
        </div>
      </div>

      {/* Search result count */}
      {searchTerm && (
        <div className="text-xs text-muted-foreground mb-2">
          {filteredLogs.length} {filteredLogs.length === 1 ? "match" : "matches"}
          {activeFilters.size > 0 && " (filtered)"}
        </div>
      )}

      {/* Log container */}
      <div
        className="bg-background rounded-lg border border-border/50 font-mono text-[13px] leading-relaxed overflow-hidden"
        style={{ height: containerHeight, minHeight: "300px" }}
      >
        {filteredLogs.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            {loading || streaming ? (
              <>
                <Spinner className="h-4 w-4 mr-2" />
                Waiting for logs...
              </>
            ) : searchTerm ? (
              "No matching logs"
            ) : (
              emptyMessage
            )}
          </div>
        ) : (
          <Virtuoso
            ref={virtuosoRef}
            data={filteredLogs}
            overscan={200}
            startReached={handleStartReached}
            firstItemIndex={Math.max(0, 1000000 - filteredLogs.length)}
            atBottomStateChange={(atBottom) => {
              atBottomRef.current = atBottom;
            }}
            followOutput={autoScroll ? "smooth" : false}
            components={{
              Header: () =>
                loadingMore ? (
                  <div className="flex items-center justify-center py-2 text-xs text-muted-foreground">
                    <Spinner className="h-3 w-3 mr-1.5" />
                    Loading older logs...
                  </div>
                ) : hasMore ? (
                  <div className="flex items-center justify-center py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs h-6"
                      onClick={onLoadMore}
                    >
                      <ArrowUp className="h-3 w-3 mr-1" />
                      Load older logs
                    </Button>
                  </div>
                ) : null,
            }}
            itemContent={(index, entry) => {
              const lineNumber = index - Math.max(0, 1000000 - filteredLogs.length) + 1;
              return (
                <LogLine
                  entry={entry}
                  lineNumber={lineNumber}
                  highlighted={highlightedLine === lineNumber}
                  onClickLine={handleClickLine}
                  searchTerm={searchTerm || undefined}
                />
              );
            }}
            className="py-2"
          />
        )}
      </div>
    </div>
  );
}
