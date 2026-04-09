-- Stripe billing: compute balances, transactions, cycles snapshots

-- Add stripe_customer_id to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;

-- Compute balances (one per user)
CREATE TABLE IF NOT EXISTS compute_balances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) UNIQUE,
  balance_cents INTEGER NOT NULL DEFAULT 0,
  auto_topup_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_topup_threshold_cents INTEGER DEFAULT 200,
  auto_topup_amount_cents INTEGER DEFAULT 1000,
  credits_expire_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Compute transactions (credits and debits)
CREATE TABLE IF NOT EXISTS compute_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,  -- 'credit' or 'debit'
  amount_cents INTEGER NOT NULL,
  category TEXT,       -- execution, builds, storage, bandwidth (for debits)
  source TEXT,         -- signup_bonus, purchase, auto_topup (for credits)
  stripe_payment_id TEXT,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_compute_tx_user ON compute_transactions(user_id, created_at);

-- Internal cycles snapshots (not user-facing)
CREATE TABLE IF NOT EXISTS cycles_snapshots (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,
  ic_canister_id TEXT NOT NULL,
  cycles_balance BIGINT NOT NULL,
  memory_size BIGINT NOT NULL,
  status TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cycles_snapshots_canister ON cycles_snapshots(canister_id, recorded_at);
