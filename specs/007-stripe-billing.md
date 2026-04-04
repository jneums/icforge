# ICForge — Stripe Billing

**Status:** Draft v0.1
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Monetize ICForge with a tiered billing model. Users pay a monthly subscription for higher limits, and ICForge covers their cycles costs from the platform pool.

## 2. Pricing Model

### Tiers

| Plan | Price | Canisters | Deploys/mo | Cycles Pool | Support |
|------|-------|-----------|------------|-------------|---------|
| **Free** | $0 | 3 | 50 | 1T shared | Community |
| **Pro** | $20/mo | 25 | Unlimited | 10T dedicated | Email |
| **Team** | $50/mo | 100 | Unlimited | 50T dedicated | Priority |

Notes:
- "Cycles Pool" = how many cycles ICForge allocates from the platform pool per billing period
- If a user exhausts their pool, deploys are paused until next billing cycle (or they upgrade)
- Overages: option to enable pay-as-you-go at $1 per 1T cycles

### What users are paying for

Users are NOT buying cycles directly (that's what cycles.express is for). They're paying for:
1. **Managed deployment infrastructure** — the platform that automates IC deploys
2. **Cycles subsidy** — ICForge fronts the cycles from its pool
3. **Convenience** — no need to manage IC identities, acquire cycles, or deal with canister lifecycle

## 3. Stripe Integration

### 3.1 Products & Prices

Create in Stripe:
- Product: "ICForge Pro" → Price: $20/month (recurring)
- Product: "ICForge Team" → Price: $50/month (recurring)
- Free tier has no Stripe product (default)

### 3.2 Checkout Flow

```
User clicks "Upgrade" in dashboard
    │
    ▼
POST /api/v1/billing/checkout
    │ Creates Stripe Checkout Session
    ▼
Redirect to Stripe Checkout
    │ User enters card details
    ▼
Stripe webhook: checkout.session.completed
    │ Backend updates user plan
    ▼
Redirect back to dashboard
```

### 3.3 Webhook Events to Handle

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Set user plan to Pro/Team, record Stripe customer ID |
| `invoice.paid` | Renew plan, reset monthly cycles pool |
| `invoice.payment_failed` | Flag account, send warning, grace period (7 days) |
| `customer.subscription.deleted` | Downgrade to Free tier |
| `customer.subscription.updated` | Handle plan changes (upgrade/downgrade) |

### 3.4 API Endpoints

```
POST /api/v1/billing/checkout
  Body: { plan: "pro" | "team" }
  Returns: { checkout_url: "https://checkout.stripe.com/..." }

GET /api/v1/billing/portal
  Returns: { portal_url: "https://billing.stripe.com/..." }
  (Stripe Customer Portal for self-service plan management)

GET /api/v1/billing/usage
  Returns: {
    plan: "pro",
    cycles_used: 3_200_000_000_000,
    cycles_limit: 10_000_000_000_000,
    deploys_this_month: 42,
    deploys_limit: null,
    billing_period_end: "2025-02-15T00:00:00Z"
  }
```

### 3.5 Webhook Endpoint

```
POST /api/v1/billing/webhook
  (Stripe signature verification via STRIPE_WEBHOOK_SECRET)
```

## 4. Database Changes

### New table: `subscriptions`

```sql
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',  -- active, past_due, canceled
  cycles_used BIGINT NOT NULL DEFAULT 0,
  current_period_start TEXT,
  current_period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Users table changes

Add `stripe_customer_id TEXT` column to users table.

## 5. Enforcement

### Deploy-time checks

Before processing a deploy:
1. Check user's plan limits (canister count, deploys/month)
2. Check cycles pool balance (platform pool allocation for this user)
3. If over limit → reject with clear error message and upgrade link

### CLI error:

```
Error: Deploy limit reached (50/50 this month)

  Upgrade to Pro ($20/mo) for unlimited deploys:
  https://app.icforge.dev/settings/billing
```

## 6. Config / Environment

```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...
```

## 7. Implementation Checklist

### Backend
- [ ] Add `stripe` crate dependency (or use raw HTTP — Stripe's API is REST)
- [ ] Create `subscriptions` table migration
- [ ] Add `stripe_customer_id` to users table migration
- [ ] Implement `POST /api/v1/billing/checkout` — create Checkout Session
- [ ] Implement `GET /api/v1/billing/portal` — create Customer Portal session
- [ ] Implement `GET /api/v1/billing/usage` — return plan + usage stats
- [ ] Implement `POST /api/v1/billing/webhook` — handle Stripe events
- [ ] Add plan limit enforcement in deploy pipeline
- [ ] Track cycles usage per user per billing period
- [ ] Reset cycles_used on `invoice.paid`

### Dashboard
- [ ] Billing/Settings page with current plan display
- [ ] "Upgrade" button → Stripe Checkout redirect
- [ ] "Manage Billing" button → Stripe Customer Portal
- [ ] Usage bar (cycles used / limit, deploys used / limit)

### Stripe Setup
- [ ] Create Stripe account
- [ ] Create Products + Prices
- [ ] Configure webhook endpoint
- [ ] Set up Customer Portal branding

## 8. Open Questions

1. **Cycles pricing vs. subscription:** Should we offer a pure pay-as-you-go option (no subscription, just buy cycles at markup)? Simpler billing but less predictable revenue.
2. **Free tier abuse:** Rate limit canister creation on free tier (max 1 per day?). Monitor for spam.
3. **Cycle pool refill:** If a user exhausts their 10T pool mid-month, should they be able to buy a one-time top-up? Or just wait for renewal?
