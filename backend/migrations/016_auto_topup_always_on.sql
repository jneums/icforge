-- Remove per-canister auto_topup flag — auto top-up is always on.
-- The column is no longer referenced in code.
ALTER TABLE canisters DROP COLUMN IF EXISTS auto_topup;
