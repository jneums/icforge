# ICForge — Canister Metrics Dashboard

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.4
**Depends on:** 010 (Cycles monitoring provides the data collection infrastructure)

---

## 1. Goal

Visualize canister performance metrics (cycles consumption, memory usage, call counts, response times) in the web dashboard. Give users observability into their IC deployments.

## 2. What Metrics

### 2.1 Available from IC canister_status

The management canister's `canister_status` endpoint returns:
- **Cycles balance** — already collected by spec 010
- **Memory size** (bytes) — heap + stable memory
- **Module hash** — wasm module hash (useful for deploy verification)
- **Status** — running / stopping / stopped
- **Idle cycles burned per day** — base cost

### 2.2 Available from canister instrumentation (future)

If users add an ICForge SDK to their canister:
- **Call count** per method
- **Response time** per method
- **Trap/error rate**
- **Custom metrics** (user-defined counters/gauges)

For v0.4, focus on what's available without user code changes (canister_status data). SDK-based metrics are v0.5+.

### 2.3 Derived metrics

From periodic snapshots:
- **Cycles burn rate** — (balance[t-1] - balance[t]) / time_delta
- **Time until freeze** — balance / burn_rate
- **Memory growth rate** — (memory[t-1] - memory[t]) / time_delta
- **Deploy frequency** — deploys per week/month

## 3. Dashboard UI

### 3.1 Project overview cards

On the Projects list page, show key metrics per project:

```
┌─────────────────────────────────────────────┐
│ my-dapp                           ✓ healthy │
│                                             │
│ 🔋 5.2T cycles   📦 12.4 MB   🚀 3 deploys/wk │
│ ↓ 0.3T/day       ↑ 0.2 MB/wk                │
│                                             │
│ Canisters: backend (running) frontend (running) │
└─────────────────────────────────────────────┘
```

### 3.2 Canister detail charts

On ProjectDetail → click a canister → Metrics tab:

**Cycles balance over time** — line chart (30 days)
```
5T ┤                                     
   │ ╭─────╮                              
4T ┤ │     ╰──────╮                       
   │─╯            ╰──────╮  ← top-up     
3T ┤                      ╰╮ ╭───────     
   │                       ╰─╯            
2T ┤─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  warning  
   └──────────────────────────────────────
    Jan 1         Jan 15         Jan 30
```

**Memory usage over time** — line chart (30 days)

**Deploy history** — timeline with markers for each deploy, colored by outcome (success/fail)

### 3.3 Chart library

Use **Recharts** (already common with React) or **Chart.js** for charts. Lightweight, no heavy dependencies.

## 4. API Endpoints

```
GET /api/v1/canisters/:id/metrics
  Query params: ?period=7d|30d|90d
  Returns: {
    cycles: [{ balance, recorded_at }, ...],
    memory: [{ bytes, recorded_at }, ...],
    derived: {
      burn_rate_per_day: 300_000_000_000,
      time_until_freeze_days: 17.3,
      memory_growth_per_week: 204_800,
    }
  }

GET /api/v1/projects/:id/metrics/summary
  Returns: {
    total_cycles: 8_500_000_000_000,
    total_memory: 25_600_000,
    canisters_healthy: 2,
    canisters_warning: 0,
    deploys_this_week: 3,
    deploys_this_month: 12,
  }
```

## 5. Data Collection

This spec reuses the `cycles_snapshots` table from spec 010. Extend it to also store memory:

```sql
-- cycles_snapshots already has: cycles_balance, memory_size, status, recorded_at
-- No schema changes needed — memory_size is already collected
```

Increase snapshot frequency for metrics (optional):
- Default: every 6 hours (from spec 010)
- Pro/Team: every 1 hour (more granular charts)

### Data retention

- Free: 7 days of metric history
- Pro: 30 days
- Team: 90 days

Old snapshots are purged by a background cleanup job.

## 6. Implementation Checklist

### Backend
- [ ] `GET /api/v1/canisters/:id/metrics` endpoint
- [ ] `GET /api/v1/projects/:id/metrics/summary` endpoint
- [ ] Derived metrics calculation (burn rate, time-to-freeze, memory growth)
- [ ] Data retention cleanup job (prune old snapshots)
- [ ] Plan-based retention limits

### Dashboard
- [ ] Install Recharts (or Chart.js)
- [ ] Cycles balance chart component
- [ ] Memory usage chart component
- [ ] Deploy timeline component
- [ ] Project overview metric cards on Projects list
- [ ] Canister Metrics tab on ProjectDetail
- [ ] Period selector (7d / 30d / 90d)

### Data
- [ ] Verify cycles_snapshots includes memory_size (already in spec 010)
- [ ] Consider higher frequency polling for paid plans

## 7. Future (v0.5+)

- **Canister SDK** — drop-in library users add to their canister for method-level metrics
- **Alerting rules** — custom alerts (e.g., "alert if memory > 2GB")
- **Comparative metrics** — show metrics across multiple canisters on one chart
- **Cost estimation** — translate cycles burn rate to USD cost estimate
