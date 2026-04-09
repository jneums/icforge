-- Extended cycles snapshots: capture full canister_status fields for burn-rate
-- and time-to-freeze analytics.

ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS idle_cycles_burned_per_day BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS reserved_cycles BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS reserved_cycles_limit BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS compute_allocation BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS memory_allocation BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS freezing_threshold BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS module_hash TEXT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS query_num_calls BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS query_num_instructions BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS query_request_payload_bytes BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS query_response_payload_bytes BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS wasm_memory_limit BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS wasm_memory_threshold BIGINT;
