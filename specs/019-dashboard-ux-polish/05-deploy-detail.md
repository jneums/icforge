# 05 — Deploy Detail

**Scope:** Improve the `/projects/:id/deploys/:deployId` page
**Priority:** P1
**Depends on:** 00-setup, 01-design-system, 02-navigation
**Estimated effort:** Small-Medium

---

## 1. Problem

The current DeployDetail page is the most polished page — SSE streaming, color-coded log levels, auto-scroll, streaming indicator all work. But it needs alignment with the new design system:

- Metadata is a flat grid with no clear hierarchy
- No way to link to a specific log line
- No build duration
- Log viewer max-height 500px is too short — should fill the viewport
- Inline styles instead of Tailwind

## 2. Target Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Deploy #{shortId}                       ● Building  ⦿ Live  │
│                                                              │
│  ┌─ Summary ────────────────────────────────────────────────┐│
│  │  Commit    abc1234  "Updated controllers"                ││
│  │  Branch    main                                          ││
│  │  Started   2 minutes ago                     Duration    ││
│  │  Canister  rrkah-fqaaa-aaaa...  📋           45s         ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Build Logs ──────────────────────── Streaming ⦿ ───────┐│
│  │  1  12:34:01  [info]   Cloning repository...             ││
│  │  2  12:34:02  [info]   Running build: npm run build      ││
│  │  3  12:34:05  [warn]   Deprecation warning...            ││
│  │  4  12:34:06  [info]   Uploading to asset canister...    ││
│  │  5  12:34:08  [info]   ✓ Deploy complete                 ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## 3. Page Header

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-2xl font-semibold tracking-tight">
    Deploy #{deploy.id.slice(0, 8)}
  </h1>
  <div className="flex items-center gap-3">
    <StatusBadge status={deploy.status} />
    {isStreaming && (
      <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20">
        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-success animate-pulse inline-block" />
        Streaming
      </Badge>
    )}
  </div>
</div>
```

## 4. Summary Card

Using shadcn `<Card>` with a two-column key-value layout:

```tsx
<Card className="p-4 mt-4">
  <div className="grid grid-cols-2 gap-y-3 gap-x-8 text-sm">
    <div>
      <span className="text-xs text-muted-foreground">Commit</span>
      <div className="flex items-center gap-2 mt-0.5">
        <GitCommit className="h-3 w-3 text-muted-foreground" />
        <span className="font-mono text-xs">{deploy.commit_sha?.slice(0, 7)}</span>
        <span className="text-muted-foreground truncate">{deploy.commit_message}</span>
      </div>
    </div>
    <div>
      <span className="text-xs text-muted-foreground">Branch</span>
      <div className="flex items-center gap-2 mt-0.5">
        <GitBranch className="h-3 w-3 text-muted-foreground" />
        <span>{deploy.branch || 'main'}</span>
      </div>
    </div>
    <div>
      <span className="text-xs text-muted-foreground">Started</span>
      <div className="mt-0.5">{timeAgo(deploy.created_at)}</div>
    </div>
    <div>
      <span className="text-xs text-muted-foreground">Duration</span>
      <div className="mt-0.5">{deploy.duration ? formatDuration(deploy.duration) : 'In progress...'}</div>
    </div>
    <div className="col-span-2">
      <span className="text-xs text-muted-foreground">Canister</span>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="font-mono text-xs">{deploy.canister_id}</span>
        <CopyButton text={deploy.canister_id} />
      </div>
    </div>
    {deploy.error && (
      <div className="col-span-2">
        <Alert variant="destructive" className="mt-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{deploy.error}</AlertDescription>
        </Alert>
      </div>
    )}
  </div>
</Card>
```

## 5. Log Viewer

Using shadcn `<ScrollArea>` for the container, Tailwind for everything else:

```tsx
import { ScrollArea } from "@/components/ui/scroll-area"

function LogViewer({ logs, isStreaming }) {
  const scrollRef = useRef(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [highlightedLine, setHighlightedLine] = useState(null);

  // Auto-scroll on new logs
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Read line from URL hash
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith('#L')) setHighlightedLine(parseInt(hash.slice(2)));
  }, []);

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold">Build Logs</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(logs.map(l => l.message).join('\n'));
              toast.success('Logs copied to clipboard');
            }}
          >
            <Copy className="h-3 w-3 mr-1" /> Copy
          </Button>
          <Button
            variant={autoScroll ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setAutoScroll(!autoScroll)}
          >
            Auto-scroll {autoScroll ? 'on' : 'off'}
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="bg-popover rounded-lg border font-mono text-[13px] leading-relaxed overflow-y-auto min-h-[300px]"
        style={{ maxHeight: 'calc(100vh - 360px)' }}
      >
        {logs.map((entry, i) => (
          <LogLine
            key={i}
            entry={entry}
            lineNumber={i + 1}
            highlighted={highlightedLine === i + 1}
            onClickLine={(n) => {
              window.location.hash = `#L${n}`;
              setHighlightedLine(n);
            }}
          />
        ))}
        {isStreaming && logs.length === 0 && (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Spinner className="h-4 w-4 mr-2" />
            Waiting for logs...
          </div>
        )}
      </div>
    </div>
  );
}
```

### Log Line Component

```tsx
const LEVEL_COLORS = {
  error: 'text-destructive',
  warn: 'text-warning',
  info: 'text-muted-foreground',
  debug: 'text-muted-foreground/60',
};

function LogLine({ entry, lineNumber, highlighted, onClickLine }) {
  return (
    <div
      id={`L${lineNumber}`}
      className={cn(
        "flex gap-3 px-4 py-px hover:bg-muted/30 border-l-2 border-transparent",
        highlighted && "bg-primary/5 border-l-primary"
      )}
    >
      <span
        className="text-muted-foreground/50 select-none cursor-pointer min-w-[3ch] text-right hover:text-primary"
        onClick={() => onClickLine(lineNumber)}
      >
        {lineNumber}
      </span>
      <span className="text-muted-foreground/70 whitespace-nowrap">
        {formatTime(entry.timestamp)}
      </span>
      <span className={cn("whitespace-nowrap", LEVEL_COLORS[entry.level])}>
        [{entry.level}]
      </span>
      <span className="text-foreground whitespace-pre-wrap break-all flex-1">
        {entry.message}
      </span>
    </div>
  );
}
```

## 6. Checklist

- [x] Rewrite page header with `<StatusBadge>` + streaming indicator
- [x] Replace metadata grid with `<Card>` summary (two-column key-value)
- [x] Add build duration display (build_duration_ms from deploy status API)
- [x] Add error `<Alert>` for failed deploys
- [x] Replace log container with viewport-filling div (dynamic max-height)
- [x] Add line numbers with click-to-highlight (URL hash)
- [x] Add auto-scroll toggle button
- [x] Add copy-all-logs button using Sonner toast
- [x] Add `<CopyButton>` for canister ID
- [x] Add `<Spinner>` for "waiting for logs" state
- [x] Link commit SHA to GitHub when repo info available
- [x] Delete all inline style objects
- [x] Migrate SSE streaming logic (kept, restyled output)
- [x] Visit button when deploy URL is available
- [x] Level-colored log lines (error/warn/info/debug)
- [x] Linkified URLs in log messages
