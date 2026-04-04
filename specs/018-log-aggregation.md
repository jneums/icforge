# ICForge — Log Aggregation

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4
**Depends on:** 003 (Backend canister support), 005 (Deploy log streaming)

---

## 1. Goal

Collect and display runtime logs from user canisters (not just deploy logs). Let developers debug their IC applications from the ICForge dashboard.

## 2. The Problem

IC canisters have no native logging infrastructure. `ic_cdk::println!` writes to the canister's debug log, but:
- Debug logs are only visible via `dfx canister logs` (requires controller access + dfx)
- Logs are ephemeral — cleared on canister upgrade
- No centralized log viewer
- No search, filter, or alerting

Developers coming from AWS/Vercel expect a logs tab. ICForge should provide one.

## 3. Architecture

### 3.1 Two log sources

**Source 1: Canister debug logs (available now)**

The IC management canister exposes `fetch_canister_logs` (added in late 2024). This returns recent debug log entries from `ic_cdk::println!` / `ic0.debug_print`.

```rust
// IC management canister API
fetch_canister_logs(canister_id) -> Vec<CanisterLogRecord>
// Each record: { idx, timestamp_nanos, content }
```

**Source 2: ICForge Logging SDK (future)**

A Rust/Motoko library users add to their canister that stores structured logs in stable memory and exposes them via a query endpoint. More reliable, structured, and persistent.

### Decision

**v0.4: Source 1 only (fetch_canister_logs).** Zero user code changes required. Just poll the management canister periodically and display in the dashboard.

**v0.5: Source 2 (SDK).** Opt-in structured logging with persistence across upgrades.

## 4. Data Collection

### 4.1 Log poller

Background task that periodically fetches logs for all managed canisters:

```
Every 5 minutes:
  For each canister where status = 'running':
    1. Call fetch_canister_logs(canister_id)
    2. Deduplicate by log index (idx)
    3. Store new entries in canister_logs table
```

### 4.2 Storage

```sql
CREATE TABLE canister_logs (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,       -- DB canister record ID
  ic_canister_id TEXT NOT NULL,    -- actual IC canister ID
  log_index BIGINT NOT NULL,       -- IC log record index
  level TEXT NOT NULL DEFAULT 'debug',  -- debug, info, warn, error (parsed from content)
  message TEXT NOT NULL,
  ic_timestamp BIGINT NOT NULL,    -- nanosecond timestamp from IC
  collected_at TEXT NOT NULL,      -- when we fetched it
  UNIQUE(ic_canister_id, log_index)
);

CREATE INDEX idx_canister_logs_canister ON canister_logs(canister_id, ic_timestamp DESC);
CREATE INDEX idx_canister_logs_level ON canister_logs(canister_id, level);
```

### 4.3 Log level parsing

IC debug logs are unstructured text. ICForge can infer log levels by pattern matching:

```
"ERROR: ..." or "[ERROR] ..." → error
"WARN: ..." or "[WARN] ..." → warn
"INFO: ..." or "[INFO] ..." → info
Everything else → debug
```

This is best-effort. The SDK (v0.5) will provide structured log levels.

### 4.4 Retention

- Free: 24 hours of logs
- Pro: 7 days
- Team: 30 days

Logs are cheap (text), but IC canisters are limited to 4KB of debug log buffer, so volume is naturally bounded.

## 5. API Endpoints

```
GET /api/v1/canisters/:id/logs
  Query params:
    ?limit=100         — entries per page (default 100)
    ?before=<timestamp> — pagination cursor
    ?level=error        — filter by level
    ?search=<text>      — full-text search in message
  Returns: {
    logs: [{ id, level, message, timestamp, canister_name }, ...],
    has_more: true,
    next_cursor: "1705312000000000000"
  }

GET /api/v1/canisters/:id/logs/stream
  SSE endpoint — streams new log entries in real-time
  (Same pattern as deploy log streaming in spec 005)
```

## 6. Dashboard UI

### 6.1 Logs tab on ProjectDetail

```
┌─ Logs ──────────────────────────────────────────────────────┐
│                                                              │
│ [All canisters ▾]  [All levels ▾]  [Search: _________ 🔍]  │
│                                                              │
│ 12:34:05.123  backend   INFO   Request received: /api/data  │
│ 12:34:05.456  backend   DEBUG  Cache hit for key: users_1   │
│ 12:34:06.789  backend   INFO   Response: 200 OK (3ms)       │
│ 12:34:07.012  backend   ERROR  Failed to parse input: ...   │
│ 12:34:08.345  backend   WARN   Memory usage at 85%          │
│                                                              │
│ [Load older logs]                                            │
└──────────────────────────────────────────────────────────────┘
```

Features:
- Filter by canister (dropdown)
- Filter by level (dropdown: all / error / warn / info / debug)
- Text search
- Auto-scroll for live mode
- Color-coded levels (red = error, yellow = warn, blue = info, gray = debug)
- Expandable log entries for long messages

### 6.2 CLI

```bash
icforge logs --runtime                    # runtime logs (not deploy logs)
icforge logs --runtime --canister backend
icforge logs --runtime --level error
icforge logs --runtime --follow           # live stream via SSE
```

## 7. IcClient Changes

Add a method to `IcClient`:

```rust
impl IcClient {
    pub async fn fetch_canister_logs(
        &self,
        canister_id: &str,
    ) -> Result<Vec<CanisterLogRecord>> {
        // Call management canister's fetch_canister_logs
        // Decode response
    }
}
```

## 8. Implementation Checklist

### Backend
- [ ] `canister_logs` table + migration
- [ ] `IcClient::fetch_canister_logs()` method
- [ ] Background log poller (every 5 min)
- [ ] Log level parsing from message content
- [ ] Deduplication by log index
- [ ] `GET /api/v1/canisters/:id/logs` endpoint with pagination + filters
- [ ] `GET /api/v1/canisters/:id/logs/stream` SSE endpoint
- [ ] Retention cleanup job (plan-based)

### Dashboard
- [ ] Logs tab on ProjectDetail
- [ ] Log viewer component with virtual scroll (for large log sets)
- [ ] Canister filter dropdown
- [ ] Level filter dropdown
- [ ] Text search input
- [ ] Live mode with auto-scroll
- [ ] Color-coded log levels
- [ ] "Load older" pagination

### CLI
- [ ] `icforge logs --runtime` flag to differentiate from deploy logs
- [ ] `--canister`, `--level` filters
- [ ] `--follow` for SSE streaming

## 9. Limitations

- **4KB buffer:** IC canisters have a 4KB debug log buffer. If the canister logs faster than ICForge polls, entries are lost. This is an IC platform limitation.
- **No structured data:** Debug logs are plain text. No JSON parsing, no key-value extraction. The SDK (v0.5) solves this.
- **Controller-only access:** `fetch_canister_logs` requires controller access. ICForge has this for managed/linked canisters, but read-only linked canisters (spec 016) won't have logs.

## 10. Future (v0.5)

- **ICForge Logging SDK** — `icforge-logger` Rust crate that provides:
  - Structured logging (level, module, key-value fields)
  - Stable memory persistence (survives upgrades)
  - Query endpoint for log retrieval (no management canister needed)
  - Log rotation and compression
- **Log-based alerting** — trigger alerts on error rate thresholds
- **Log export** — download logs as JSON/CSV
