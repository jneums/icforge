# 05 — Deploy Detail

**Scope:** Improve the `/projects/:id/deploys/:deployId` page
**Priority:** P1
**Depends on:** 01-design-system, 02-navigation
**Estimated effort:** Small-Medium

---

## 1. Problem

The current DeployDetail page is actually the most polished page — it has SSE streaming, color-coded log levels, auto-scroll, and a streaming indicator. But it still needs alignment with the new design system and a few UX improvements.

Issues:
- Metadata is a flat grid — no clear hierarchy
- No way to link to a specific log line
- No build duration shown
- Status styling is inconsistent with other pages
- Log viewer max-height 500px is too short — should expand to fill available space

## 2. Target Layout

```
┌──────────────────────────────────────────────────────────────┐
│  ← Projects / my-dapp / Deploy #42                           │ breadcrumb
│──────────────────────────────────────────────────────────────│
│                                                              │
│  Deploy #42                              ● Building  ⦿ Live  │
│                                                              │
│  ┌─ Summary ─────────────────────────────────────────────── ┐│
│  │  Commit    abc1234  "Updated controllers"                ││
│  │  Branch    main                                          ││
│  │  Started   2 minutes ago                      Duration   ││
│  │  Canister  rrkah-fqaaa-aaaa...  📋            45s        ││
│  └──────────────────────────────────────────────────────────┘│
│                                                              │
│  ┌─ Build Logs ──────────────────────── Streaming ⦿ ────── ┐│
│  │  12:34:01  [info]  Cloning repository...                 ││
│  │  12:34:02  [info]  Running build command: npm run build  ││
│  │  12:34:05  [info]  Build output: 2.3MB                   ││
│  │  12:34:06  [info]  Uploading to asset canister...        ││
│  │  12:34:08  [info]  Committing batch...                   ││
│  │  12:34:09  [info]  ✓ Deploy complete                     ││
│  │                                                          ││
│  │                                                          ││
│  │                                                          ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## 3. Changes from Current

### 3.1 Status Header
- Move status to the page header line, next to deploy ID
- Use status dot + text (same component as everywhere else)
- Show "Live" streaming badge only when SSE is active

### 3.2 Summary Card
Replace the flat metadata grid with a proper summary card:
- Two-column key-value layout (Render-style)
- Commit SHA linked to GitHub (if repo info available)
- Branch name
- Start time (relative)
- Duration (calculated: end time - start time, or "in progress")
- Canister ID (monospace, with copy button)
- Error message (red, only shown if status is failed)

### 3.3 Log Viewer Improvements
- **Expand to fill viewport**: use `calc(100vh - header - summary - padding)` instead of fixed 500px
- **Line numbers**: show line numbers in gutter (muted, monospace)
- **Clickable timestamps**: clicking a timestamp updates URL hash (`#L42`), scrolls to that line, highlights it
- **Level filtering**: optional toggle buttons (info/warn/error) to filter log lines
- **Copy button**: copy all logs to clipboard
- **Auto-scroll toggle**: button to enable/disable auto-scroll to bottom (currently always on)

### 3.4 Error State
If deploy failed, show a prominent error banner above the logs:
```
┌─ Error ─────────────────────────────────────────────────────┐
│  ✕ Build failed: exit code 1                                │
│  Check the build logs below for details.                    │
└─────────────────────────────────────────────────────────────┘
```

## 4. Log Line Component

```tsx
function LogLine({ entry, lineNumber, highlighted }) {
  const levelColor = {
    error: 'var(--error)',
    warn: 'var(--warning)',
    info: 'var(--text-secondary)',
    debug: 'var(--text-muted)',
  };

  return (
    <div
      id={`L${lineNumber}`}
      className={`log-line ${highlighted ? 'log-line--highlighted' : ''}`}
    >
      <span className="log-line-number">{lineNumber}</span>
      <span className="log-line-time">{formatTime(entry.timestamp)}</span>
      <span className="log-line-level" style={{ color: levelColor[entry.level] }}>
        [{entry.level}]
      </span>
      <span className="log-line-message">{entry.message}</span>
    </div>
  );
}
```

## 5. CSS

```css
.log-viewer {
  background: var(--surface-inset);
  border: 1px solid var(--border-default);
  border-radius: 8px;
  font-family: var(--font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  overflow-y: auto;
  /* Fill remaining viewport height */
  min-height: 300px;
  max-height: calc(100vh - 320px);
}

.log-line {
  display: flex;
  gap: var(--space-3);
  padding: 1px var(--space-4);
  border-left: 3px solid transparent;
}

.log-line:hover {
  background: rgba(255, 255, 255, 0.02);
}

.log-line--highlighted {
  background: rgba(59, 130, 246, 0.1);
  border-left-color: var(--accent);
}

.log-line-number {
  color: var(--text-muted);
  min-width: 3ch;
  text-align: right;
  user-select: none;
  cursor: pointer;
}

.log-line-time {
  color: var(--text-muted);
  white-space: nowrap;
}

.log-line-message {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-all;
}
```

## 6. Checklist

- [ ] Refactor status display to use shared status dot + label
- [ ] Replace metadata grid with summary card (two-column key-value)
- [ ] Add build duration calculation
- [ ] Expand log viewer to fill viewport (dynamic height)
- [ ] Add line numbers to log entries
- [ ] Add clickable line numbers (URL hash + highlight)
- [ ] Add auto-scroll toggle button
- [ ] Add copy-all-logs button
- [ ] Add error banner for failed deploys
- [ ] Link commit SHA to GitHub when repo info available
- [ ] Add copy-to-clipboard for canister ID
- [ ] Migrate from inline styles to CSS classes
