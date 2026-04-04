# ICForge — Deploy Status + Log Streaming

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.2

---

## 1. Goal

Implement the `icforge status` and `icforge logs` CLI commands, and upgrade deploy log delivery from polling to streaming.

## 2. Current State

- `icforge status` — prints "not yet implemented"
- `icforge logs` — prints "not yet implemented"
- Deploy logs exist in the DB (`deploy_logs` table), fetched via `GET /api/v1/deploy/:id/logs`
- The CLI already polls deploy status during `icforge deploy` (working)
- Dashboard `ProjectDetail` page shows deploy history

## 3. CLI Commands

### 3.1 `icforge status`

Shows the current state of the project and its canisters.

```
$ icforge status

  Project: my-dapp
  Slug:    my-dapp.icforge.dev

  ┌──────────┬────────────────────────────────────┬─────────┬─────────────┐
  │ Canister  │ ID                                 │ Status  │ Last Deploy │
  ├──────────┼────────────────────────────────────┼─────────┼─────────────┤
  │ backend  │ xh5m6-qyaaa-aaaaj-qrsla-cai       │ running │ 2h ago      │
  │ frontend │ abc12-defgh-aaaaj-qrslb-cai        │ running │ 2h ago      │
  └──────────┴────────────────────────────────────┴─────────┴─────────────┘

  Latest deploy: #7 (live) — "fix: header alignment" — 2h ago
```

**Data source:** `GET /api/v1/projects/:id` (already returns project + canisters + deployments)

**Implementation:** Read project ID from `.icforge` config, call the API, format and print.

### 3.2 `icforge logs`

Shows deploy logs for the most recent (or specified) deployment.

```
$ icforge logs

  Deploy #7 — canister: frontend — status: live
  
  [12:34:01] INFO  Starting deployment...
  [12:34:02] INFO  Upgrading canister: abc12-defgh-aaaaj-qrslb-cai
  [12:34:03] INFO  Installing code (upgrade)...
  [12:34:05] INFO  Code installed successfully
  [12:34:05] INFO  Syncing static assets...
  [12:34:08] INFO  Assets synced successfully
  [12:34:08] INFO  Live at https://abc12-defgh-aaaaj-qrslb-cai.icp0.io
```

Options:
```
icforge logs               # latest deployment
icforge logs --deploy <id> # specific deployment
icforge logs --follow      # stream logs in real-time (if deploy in progress)
```

**Data source:** `GET /api/v1/deploy/:id/logs` (already exists)

### 3.3 `icforge logs --follow` (streaming)

For in-progress deployments, stream logs as they happen. Two approaches:

| Approach | Pros | Cons |
|----------|------|------|
| **Polling** (current) | Simple, works everywhere | Latency (1-2s), wasted requests |
| **SSE (Server-Sent Events)** | Real-time, efficient, one-way (perfect for logs) | Slightly more complex server-side |
| **WebSocket** | Bidirectional | Overkill for read-only logs |

**Decision: SSE for v0.2.** It's the natural fit for log streaming — server pushes, client reads.

## 4. SSE Endpoint

### 4.1 New route

```
GET /api/v1/deploy/:id/logs/stream
Accept: text/event-stream
Authorization: Bearer <jwt>
```

Response (SSE format):
```
event: log
data: {"level":"info","message":"Starting deployment...","timestamp":"2025-01-15T12:34:01Z"}

event: log
data: {"level":"info","message":"Installing code (upgrade)...","timestamp":"2025-01-15T12:34:03Z"}

event: status
data: {"status":"live"}

event: done
data: {}
```

### 4.2 Backend implementation

Use Axum's `Sse` extractor with a `tokio::sync::broadcast` channel:

```rust
// In deploy.rs — run_deploy_pipeline() publishes to a broadcast channel
// In routes — SSE endpoint subscribes to the channel + replays existing logs

pub async fn deploy_logs_stream(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    // 1. Verify auth + ownership
    // 2. Fetch existing logs from DB (replay)
    // 3. Subscribe to broadcast channel for new logs
    // 4. Stream both as SSE events
    // 5. Send "done" event when deployment completes
}
```

### 4.3 Broadcast channel architecture

```
run_deploy_pipeline()
    │
    ├── insert_log() to DB (permanent storage)
    │
    └── tx.send(LogEvent) to broadcast channel (real-time)

SSE endpoint
    │
    ├── Fetch existing logs from DB (replay missed events)
    │
    └── rx.recv() from broadcast channel (new events)
```

The broadcast channel is keyed by deployment ID. Use a `DashMap<String, broadcast::Sender<LogEvent>>` on `AppState`. Channels are created when a deploy starts and cleaned up after completion + timeout.

## 5. Implementation Checklist

### CLI
- [x] Implement `icforge status` — fetch project, format table
- [x] Implement `icforge logs` — fetch deploy logs, format output
- [x] Implement `icforge logs --follow` — SSE client (native fetch + ReadableStream, no npm dep)
- [x] Add `--deploy <id>` flag to `icforge logs`
- [x] Color-code log levels (red for error, yellow for warn, default for info)

### Backend
- [x] Add `broadcast::Sender` map to `AppState` (DashMap<String, broadcast::Sender<LogEvent>>)
- [x] Publish log events to broadcast channel in `insert_log()`
- [x] Add SSE endpoint `GET /api/v1/deploy/:id/logs/stream`
- [x] Replay existing logs from DB on SSE connect
- [x] Send `done` event when deployment completes
- [x] Clean up broadcast channels after deploy + 60s timeout
- [x] Add route to `main.rs`

### Dashboard
- [ ] Use SSE for real-time deploy log display on ProjectDetail page (future enhancement)

## 6. Fallback

If SSE proves problematic (Render proxy issues, etc.), fall back to polling with a tighter interval (500ms). The CLI already does this during `icforge deploy` — just expose it via `icforge logs --follow`.
