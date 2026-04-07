-- Drop the legacy CHECK constraint and make `type` nullable.
-- `recipe` is now the canonical field for canister kind.
-- Keep `type` column for backward compat but stop requiring it.

-- Drop the CHECK constraint (Postgres names it canisters_type_check by convention)
ALTER TABLE canisters DROP CONSTRAINT IF EXISTS canisters_type_check;

-- Make type nullable (no longer required)
ALTER TABLE canisters ALTER COLUMN type DROP NOT NULL;

-- Backfill recipe from type where recipe is still NULL
UPDATE canisters SET recipe = type WHERE recipe IS NULL AND type IS NOT NULL;

-- Set recipe NOT NULL with a default for any remaining NULLs
UPDATE canisters SET recipe = 'custom' WHERE recipe IS NULL;
ALTER TABLE canisters ALTER COLUMN recipe SET NOT NULL;
ALTER TABLE canisters ALTER COLUMN recipe SET DEFAULT 'custom';
