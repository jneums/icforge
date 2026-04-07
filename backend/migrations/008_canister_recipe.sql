-- Replace canister_type with recipe field
-- recipe stores the icp-cli recipe string (e.g. "rust@v3.1.0", "asset-canister@v2.1.0")
ALTER TABLE canisters ADD COLUMN IF NOT EXISTS recipe TEXT;

-- Migrate existing type values to recipe
UPDATE canisters SET recipe = type WHERE recipe IS NULL;
