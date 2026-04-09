# ICForge — Stripe Billing

**Status:** Implemented v1.0
**Parent:** 001-architecture.md
**Milestone:** v0.3

---

## 1. Goal

Monetize ICForge with a prepaid compute credits model. Users buy credit packs via Stripe Checkout and spend them on deploys, hosting, and canister operations. ICForge covers IC cycles costs from the platform pool — users never see or manage cycles directly.

## 2. Pricing Model

### Prepaid Credit Packs

| Pack | Price | Credits |
|------|-------|---------|
| **Starter** | $5 | $5.00 |
| **Builder** | $10 | $10.00 |
| **Pro** | $25 | $25.00 |

Notes:
- Credits are denominated in USD cents internally (e.g. $5.00 = 500 cents)
- Credits never expire
- Free tier: users start with $0.00 balance (no free credits yet — TBD)
- Auto top-up available: when balance drops below a threshold, charge saved card automatically

### What users are paying for

Users are NOT buying IC cycles directly. They're paying for:
1. **Managed deployment infrastructure** — the platform that automates IC deploys
2. **Compute credits** — a clean USD abstraction over IC cycles costs
3. **Convenience** — no need to manage IC identities, acquire cycles, or deal with canister lifecycle

### Pricing mapping (internal)

ICForge converts compute credit debits to IC cycles costs behind the scenes. The user-facing pricing is per-operation:

| Operation | Credit Cost | Notes |
|-----------|-------------|-------|
| Deploy (build + install) | TBD | Based on canister size + compute |
| Hosting (per canister/month) | TBD | Based on cycles burn rate |
| Canister creation | TBD | One-time cost |

The platform buys cycles in bulk and marks them up to cover infrastructure costs + margin.

## 3. Stripe Integration

### 3.1 Checkout Flow

```
User clicks "Buy Credits" in dashboard
    │
    ▼
POST /api/v1/billing/checkout { pack: "starter" | "builder" | "pro" }
    │ Creates Stripe Checkout Session (mode: payment, not subscription)
    │ Sets setup_future_usage=off_session to save card
    ▼
Redirect to Stripe Checkout
    │ User enters card details
    ▼
Stripe webhook: checkout.session.completed
    │ Backend credits user's compute balance
    ▼
Redirect back to dashboard /billing?session_id=...
```

### 3.2 Auto Top-Up Flow

```
debit_balance() called (deploy charge, hosting, etc.)
    │
    ▼
Balance drops below auto_topup_threshold_cents?
    │ Yes + auto_topup_enabled
    ▼
maybe_auto_topup()
    │ Finds saved payment method on Stripe customer
    │ Creates PaymentIntent (off_session, confirm=true)
    ▼
Stripe webhook: payment_intent.succeeded
    │ metadata.source = "auto_topup"
    │ Backend credits user's compute balance
    ▼
If payment fails → webhook disables auto_topup_enabled
```

### 3.3 Webhook Events Handled

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Credit user's compute balance for the purchased pack |
| `payment_intent.succeeded` | Credit balance (for auto top-ups via metadata.source) |
| `payment_intent.payment_failed` | Disable auto-topup, log warning |

### 3.4 API Endpoints

```
POST /api/v1/billing/checkout
  Body: { pack: "starter" | "builder" | "pro" }
  Returns: { checkout_url: "https://checkout.stripe.com/..." }

GET /api/v1/billing/portal
  Returns: { portal_url: "https://billing.stripe.com/..." }
  (Stripe Customer Portal for payment method management)

GET /api/v1/billing/balance
  Returns: {
    balance_cents: 1500,
    auto_topup_enabled: true,
    auto_topup_threshold_cents: 200,
    auto_topup_amount_cents: 1000
  }

PUT /api/v1/billing/auto-topup
  Body: {
    enabled: true,
    threshold_cents: 200,
    amount_cents: 1000
  }

GET /api/v1/billing/transactions
  Query: ?limit=20&offset=0
  Returns: {
    transactions: [
      { id, type: "credit"|"debit", amount_cents, category, source, description, created_at }
    ],
    total: 42
  }

POST /api/v1/webhooks/stripe
  (Stripe signature verification via STRIPE_WEBHOOK_SECRET)
```

## 4. Database Schema

### Table: `compute_balances`

```sql
CREATE TABLE compute_balances (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance_cents INTEGER NOT NULL DEFAULT 0,
  auto_topup_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_topup_threshold_cents INTEGER,
  auto_topup_amount_cents INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### Table: `compute_transactions`

```sql
CREATE TABLE compute_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,           -- 'credit' or 'debit'
  amount_cents INTEGER NOT NULL,
  category TEXT NOT NULL,       -- 'purchase', 'auto_topup', 'deploy', 'hosting', etc.
  source TEXT NOT NULL,         -- 'stripe_checkout', 'auto_topup', 'deploy', etc.
  description TEXT,
  stripe_session_id TEXT,       -- for idempotency on credits
  stripe_payment_intent_id TEXT,
  created_at TEXT NOT NULL
);
```

### Users table

`stripe_customer_id TEXT` column on users table.

## 5. Enforcement

### Deploy-time checks (TODO)

Before processing a deploy:
1. Check user's compute credit balance
2. If balance < estimated deploy cost → reject with clear error
3. After deploy succeeds → debit_balance() with actual cost

### CLI error (planned):

```
Error: Insufficient compute credits ($0.00 balance)

  Buy credits to continue deploying:
  https://app.icforge.dev/billing
```

## 6. Config / Environment

```
STRIPE_SECRET_KEY=***
STRIPE_WEBHOOK_SECRET=***
```

## 7. Implementation Status

### Backend
- [x] `compute_balances` table + lazy init
- [x] `compute_transactions` table + ledger
- [x] `get_or_create_balance()` — auto-creates $0 balance
- [x] `credit_balance()` — add credits + record transaction
- [x] `debit_balance()` — deduct credits + trigger auto-topup
- [x] `maybe_auto_topup()` — off-session PaymentIntent with saved card
- [x] `POST /api/v1/billing/checkout` — Stripe Checkout (payment mode)
- [x] `GET /api/v1/billing/portal` — Stripe Customer Portal
- [x] `GET /api/v1/billing/balance` — credit balance + auto-topup settings
- [x] `PUT /api/v1/billing/auto-topup` — toggle auto-topup
- [x] `GET /api/v1/billing/transactions` — paginated history
- [x] `POST /api/v1/webhooks/stripe` — webhook handler with idempotency
- [x] `setup_future_usage=off_session` — saves card on first purchase
- [ ] Wire `debit_balance()` into deploy pipeline
- [ ] Wire `debit_balance()` into hosting usage metering
- [ ] Define per-operation pricing (deploy cost, hosting cost)

### Dashboard
- [x] Billing page — balance display, buy credits, transaction history
- [x] `api/billing.ts` — HTTP layer
- [x] `hooks/use-billing.ts` — TanStack Query hooks
- [ ] Auto-topup settings UI on billing page
- [ ] Low balance warning banner

### Stripe Setup
- [x] Stripe account created
- [x] Checkout Sessions configured (payment mode, not subscription)
- [x] Webhook endpoint configured
- [ ] Customer Portal branding

## 8. Design Decisions

1. **Prepaid credits over subscriptions.** Simpler for users, no recurring billing complexity. Users buy what they need. Can always add subscription tiers later as a "credits included per month" model.
2. **USD abstraction over cycles.** Users never see IC cycles. The platform handles cycles acquisition and management. This keeps the UX clean and avoids exposing blockchain internals.
3. **Auto top-up via saved cards.** First Checkout purchase saves the card (setup_future_usage). Auto top-up creates off-session PaymentIntents. Failed charges auto-disable the feature.
