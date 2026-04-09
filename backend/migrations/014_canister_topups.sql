-- Canister top-up tracking + per-canister auto-topup settings

-- Top-up records (cycles transferred from platform pool to canister)
CREATE TABLE IF NOT EXISTS canister_topups (
  id TEXT PRIMARY KEY,
  canister_id TEXT NOT NULL,        -- DB canister record ID
  ic_canister_id TEXT NOT NULL,     -- actual IC canister principal
  user_id TEXT NOT NULL REFERENCES users(id),
  cycles_amount BIGINT NOT NULL,    -- cycles deposited
  cost_cents INTEGER NOT NULL,      -- USD cost debited from user
  source TEXT NOT NULL,             -- 'auto' or 'manual'
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canister_topups_canister ON canister_topups(canister_id, created_at);
CREATE INDEX IF NOT EXISTS idx_canister_topups_user ON canister_topups(user_id, created_at);

-- Per-canister auto-topup settings
ALTER TABLE canisters ADD COLUMN IF NOT EXISTS auto_topup BOOLEAN DEFAULT false;
ALTER TABLE canisters ADD COLUMN IF NOT EXISTS cycles_alert_threshold BIGINT DEFAULT 500000000000;
