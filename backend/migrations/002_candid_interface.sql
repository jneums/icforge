-- Add candid interface storage for backend canisters
ALTER TABLE canisters ADD COLUMN IF NOT EXISTS candid_interface TEXT;
