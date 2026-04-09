# ICForge — Compute Monitoring + Canister Health

**Status:** Draft v1.0
**Parent:** 001-architecture.md, 007-stripe-billing.md
**Milestone:** v0.3

---

## 1. Goal

Monitor canister health and compute usage across the platform. Automatically top up canisters from the platform cycles pool and debit users' compute credit balances. Users see compute costs in USD — never IC cycles.

## 2. Why This Matters

Canisters that run out of cycles get frozen and eventually deleted. ICForge manages this entirely — users should never think about cycles. The platform must:

1. Keep canisters alive by monitoring and topping them up automatically
2. Track compute costs and debit users' credit balances accordingly
3. Alert users when their compute balance is running low (not canister cycles — that's our problem)

## 3. Architecture

### 3.1 Background Poller

A background task on the backend that periodically checks canister health:

```
Every 6 hours:
  For each canister in DB where status = 'running':
    1. Call canister_status() via IC management canister
    2. Record cycles balance + memory usage in snapshots table
    3. If cycles < platform threshold → top up from platform pool
    4. Calculate compute cost for the period → debit user's credit balance
```

### 3.2 Platform Thresholds (Internal — Never Exposed to Users)

| Level | Threshold | Platform Action |
|-------|-----------|-----------------|
| **Healthy** | > 2T cycles | No action |
| **Low** | 0.5T – 2T | Auto top-up from platform pool |
| **Critical** | < 0.5T | Urgent top-up + internal alert |
| **Frozen** | 0 | Canister frozen by IC — attempt recovery |

These are operational thresholds for the platform team, not user-facing.

### 3.3 Canister Top-Up (Platform-Side)

When a canister needs cycles:
1. Platform calls `IcClient::top_up_canister()` with cycles from the platform pool
2. Record the top-up amount in `canister_topups` table
3. Convert cycles cost to USD using platform pricing rate
4. Call `debit_balance()` on the user's compute credits

The user sees: "Hosting — canister backend (my-dapp): -$0.12" in their transaction history.

### 3.4 Compute Cost Calculation

The platform converts IC cycles to USD compute credits at a fixed rate with margin:

```
Platform cycles cost: ~$1.32 per 1T cycles (IC rate)
ICForge markup: TBD (covers infra + margin)
User-facing rate: TBD per canister/month based on usage
```

Pricing categories:
- **Hosting**: ongoing cycles burn for running canisters (metered per period)
- **Deploy**: one-time compute cost for build + install
- **Storage**: memory usage component (if we want to break it out)

All show up as simple USD line items in the user's transaction history.

## 4. Data Model

### New table: `canister_snapshots`

```sql
CREATE TABLE canister_snapshots (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,        -- DB canister record ID
  ic_canister_id TEXT NOT NULL,     -- actual IC canister ID
  cycles_balance BIGINT NOT NULL,
  memory_size BIGINT NOT NULL,
  status TEXT NOT NULL,             -- running, stopping, stopped
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_canister_snapshots_lookup
  ON canister_snapshots(canister_id, recorded_at);
```

### New table: `canister_topups`

```sql
CREATE TABLE canister_topups (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  cycles_amount BIGINT NOT NULL,    -- IC cycles transferred
  credit_cost_cents INTEGER NOT NULL, -- USD cost debited from user
  source TEXT NOT NULL,             -- 'auto' or 'manual_platform'
  created_at TEXT NOT NULL
);
```

Note: `canister_topups` tracks the platform-side cycles transfer. The user-facing
debit appears in `compute_transactions` (from spec 007) with category = 'hosting'.

## 5. API Endpoints

### Platform health (internal / admin)

```
GET /api/v1/cycles/balance
  (Already exists — returns platform IC cycles pool balance)
```

### User-facing compute usage

```
GET /api/v1/billing/usage
  Returns: {
    balance_cents: 1500,
    current_period: {
      start: "2025-02-01T00:00:00Z",
      end: "2025-03-01T00:00:00Z",
      hosting_cost_cents: 340,
      deploy_cost_cents: 120,
      total_cost_cents: 460
    },
    canisters: [
      {
        name: "backend",
        project: "my-dapp",
        status: "healthy",
        monthly_cost_cents: 12
      }
    ]
  }
```

Users see compute costs per canister in USD. They never see cycles numbers.

### Canister health (user-facing, abstracted)

```
GET /api/v1/projects/:id/health
  Returns: {
    status: "healthy",           -- healthy, degraded, stopped
    canisters: [
      { name: "backend", status: "running", last_checked: "..." },
      { name: "frontend", status: "running", last_checked: "..." }
    ]
  }
```

No cycles numbers exposed. Just health status.

## 6. User Alerts

### Low Compute Balance (Email)

```
Subject: Your ICForge compute balance is running low

Your compute balance is $1.50. Based on current usage, this covers
approximately 12 more days of hosting.

[Buy Credits] [Manage Auto Top-Up]
```

### Low Compute Balance (Dashboard)

Banner on dashboard: "Low balance — $1.50 remaining. Buy credits to keep your apps running."

### Canister Health Issues (Dashboard Only)

If a canister enters a degraded state (platform couldn't top it up, etc.),
show on project detail: "⚠️ Canister health issue — contact support"

This should be rare since the platform handles cycles automatically.

## 7. Implementation Checklist

### Backend
- [ ] Background poller task (tokio interval, runs every 6h)
- [ ] `canister_snapshots` table + migration
- [ ] `canister_topups` table + migration
- [ ] Snapshot recording logic (query IC, store results)
- [ ] Auto top-up logic (platform pool → canister, debit user credits)
- [ ] `GET /api/v1/billing/usage` — compute usage breakdown
- [ ] `GET /api/v1/projects/:id/health` — canister health status
- [ ] Define compute pricing rates (cycles → USD conversion + margin)
- [ ] Wire `debit_balance()` into the poller for hosting charges
- [ ] Email alert integration for low compute balance (Resend)

### Dashboard
- [ ] Compute usage section on Billing page (cost breakdown per canister)
- [ ] Health status indicators on project cards
- [ ] Health detail on project detail page
- [ ] Low balance warning banner

### CLI
- [ ] `icforge status` shows canister health (not cycles)

## 8. Design Decisions

1. **Users never see cycles.** All compute costs are in USD. The platform handles cycles acquisition, monitoring, and top-ups internally.
2. **No per-canister billing controls.** Users don't toggle auto-topup per canister — the platform keeps all their canisters alive as long as they have compute credits. Simpler UX.
3. **Platform absorbs cycles volatility.** If IC cycles pricing changes, the platform adjusts its internal rates. Users see stable USD pricing.
4. **Health, not metrics.** Users see "healthy/degraded/stopped" — not cycles charts. We're a PaaS, not an infrastructure dashboard.
