# ICForge — Cycles Monitoring + Auto Top-Up

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Monitor cycles balance on all user canisters and alert when running low. Optionally auto top-up from the platform cycles pool.

## 2. Why This Matters

Canisters that run out of cycles get frozen and eventually deleted. Users who deploy and forget will lose their apps. ICForge should prevent this for managed canisters.

## 3. Architecture

### 3.1 Background poller

A background task on the backend that periodically checks canister cycles balances:

```
Every 6 hours:
  For each canister in DB where status = 'running':
    1. Call canister_status() via IC management canister
    2. Record cycles balance in DB
    3. If balance < threshold → trigger alert
    4. If auto top-up enabled → top up from pool
```

### 3.2 Thresholds

| Level | Threshold | Action |
|-------|-----------|--------|
| **Healthy** | > 2T cycles | None |
| **Warning** | 0.5T – 2T | Email alert + dashboard badge |
| **Critical** | < 0.5T | Email alert + auto top-up (if enabled) |
| **Frozen** | 0 | Canister is frozen by IC, alert user |

### 3.3 Auto top-up

When enabled, ICForge automatically transfers cycles from the platform pool to the canister:

1. Check user's plan allows auto top-up (Pro/Team only)
2. Check user hasn't exhausted their cycles pool allocation
3. Call `IcClient::top_up_canister()` (already implemented) with 2T cycles
4. Record the top-up in the DB
5. Deduct from user's cycles pool allocation

Users can enable/disable auto top-up per canister in the dashboard.

## 4. Data Model

### New table: `cycles_snapshots`

```sql
CREATE TABLE cycles_snapshots (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,  -- DB canister record ID
  ic_canister_id TEXT NOT NULL,  -- actual IC canister ID
  cycles_balance BIGINT NOT NULL,
  memory_size BIGINT NOT NULL,
  status TEXT NOT NULL,  -- running, stopping, stopped
  recorded_at TEXT NOT NULL
);

CREATE INDEX idx_cycles_snapshots_canister ON cycles_snapshots(canister_id, recorded_at);
```

### New table: `cycles_topups`

```sql
CREATE TABLE cycles_topups (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  source TEXT NOT NULL,  -- 'auto' or 'manual'
  created_at TEXT NOT NULL
);
```

### Canisters table updates

```sql
ALTER TABLE canisters ADD COLUMN auto_topup BOOLEAN DEFAULT false;
ALTER TABLE canisters ADD COLUMN cycles_alert_threshold BIGINT DEFAULT 500000000000;  -- 0.5T
```

## 5. API Endpoints

```
GET /api/v1/canisters/:id/cycles
  Returns: {
    current_balance: 3_500_000_000_000,
    history: [{ balance, recorded_at }, ...],  -- last 30 days
    auto_topup: true,
    alert_threshold: 500_000_000_000,
    status: "healthy"
  }

PUT /api/v1/canisters/:id/cycles/settings
  Body: { auto_topup: true, alert_threshold: 1_000_000_000_000 }

POST /api/v1/canisters/:id/cycles/topup
  Body: { amount: 2_000_000_000_000 }
  (Manual top-up from user's pool allocation)

GET /api/v1/cycles/balance
  (Already exists — returns platform pool balance)
```

## 6. Alerts

### Email alerts

Send via a transactional email service (Resend, Postmark, or SES):

```
Subject: ⚠️ Low cycles on canister "backend" (my-dapp)

Your canister "backend" (xh5m6-qyaaa-aaaaj-qrsla-cai) has 
450B cycles remaining. It will freeze when it reaches 0.

Auto top-up is [enabled/disabled].

[View in Dashboard] [Top Up Now]
```

### Dashboard alerts

Badge on project card: "⚠️ Low Cycles" when any canister is in warning/critical state.

## 7. Implementation Checklist

### Backend
- [ ] Background poller task (tokio interval, runs every 6h)
- [ ] `cycles_snapshots` table + migration
- [ ] `cycles_topups` table + migration
- [ ] Canister table updates (auto_topup, alert_threshold) + migration
- [ ] `GET /api/v1/canisters/:id/cycles` endpoint
- [ ] `PUT /api/v1/canisters/:id/cycles/settings` endpoint
- [ ] `POST /api/v1/canisters/:id/cycles/topup` endpoint
- [ ] Auto top-up logic (check plan, check pool, call top_up_canister)
- [ ] Email alert integration (pick a service: Resend recommended)
- [ ] Deduct top-up amounts from user's plan allocation

### Dashboard
- [ ] Cycles chart on ProjectDetail (sparkline or line chart of balance over time)
- [ ] Auto top-up toggle per canister
- [ ] Alert threshold setting
- [ ] Manual top-up button
- [ ] Low cycles badge on Projects list

### CLI
- [ ] `icforge status` shows cycles balance per canister (already planned in spec 005)
- [ ] `icforge cycles topup <canister> <amount>` command

## 8. Open Questions

1. **Polling frequency:** 6 hours is a balance between freshness and IC query costs. Adjust based on usage patterns — high-traffic canisters burn cycles faster.
2. **Email service:** Resend is cheapest and simplest for transactional email. Free tier: 3000 emails/month. Good enough for alerts.
3. **Cycles pool accounting:** Need to carefully track how much of a user's pool allocation has been used for top-ups vs. canister creation. This ties into the billing spec (007).
