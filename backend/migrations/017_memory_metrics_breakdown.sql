-- Add granular memory breakdown fields from IC MemoryMetrics
-- (canister_status.memory_metrics, contributed by CycleOps to IC protocol 2025)

ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS wasm_memory_size BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS stable_memory_size BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS global_memory_size BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS canister_history_size BIGINT;
ALTER TABLE cycles_snapshots ADD COLUMN IF NOT EXISTS snapshots_size BIGINT;
