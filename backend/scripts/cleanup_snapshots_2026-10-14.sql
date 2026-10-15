-- One-off production cleanup for cycles_snapshots / deploy_logs.
-- Mirrors compute_poller::run_maintenance: 7-day retention, 60s resolution
-- for the last 48h, hourly beyond that, deploy logs kept 30 days.
--
-- Written for a disk that is already full:
--   * each statement autocommits, so a failure never rolls back earlier work
--   * the 184 MB secondary index is dropped first to free disk, and rebuilt last
--   * work_mem is raised for this session so the hourly-thinning sort stays in RAM
--
-- Run with:
--   psql "<connection string with :5432 and ?sslmode=require>" -f backend/scripts/cleanup_snapshots_2026-10-14.sql

\timing on
\set ON_ERROR_STOP on

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size_before;

SET work_mem = '128MB';

-- 0. Free disk immediately. The poller keeps inserting fine without this index;
--    the metrics endpoint filters on ic_canister_id and never used it anyway.
DROP INDEX IF EXISTS idx_cycles_snapshots_canister;

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size_after_index_drop;

-- 1. Expire snapshots older than 7 days (~3/4 of the table).
DELETE FROM cycles_snapshots
 WHERE recorded_at < to_char(now() at time zone 'utc' - interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');

-- 2. Thin snapshots older than 48h to one per canister per hour.
DELETE FROM cycles_snapshots s
 USING (
   SELECT id FROM (
     SELECT id,
            row_number() OVER (PARTITION BY canister_id, substr(recorded_at, 1, 13)
                               ORDER BY recorded_at) AS rn
     FROM cycles_snapshots
     WHERE recorded_at < to_char(now() at time zone 'utc' - interval '48 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
   ) ranked
   WHERE rn > 1
 ) extra
 WHERE s.id = extra.id;

-- 3. Expire deploy logs for deployments older than 30 days.
DELETE FROM deploy_logs
 WHERE deployment_id IN (
   SELECT id FROM deployments
   WHERE created_at < to_char(now() - interval '30 days', 'YYYY-MM-DD HH24:MI:SS')
 );

SELECT count(*) AS snapshots_remaining,
       min(recorded_at) AS oldest,
       count(DISTINCT canister_id) AS canisters
  FROM cycles_snapshots;

-- 4. Reclaim space. VACUUM FULL rewrites the table and primary key into new
--    files (~50 MB total after the deletes) and then drops the old 530 MB.
--    Exclusive lock for a few seconds; the poller just retries next minute.
VACUUM (FULL, ANALYZE) cycles_snapshots;

-- 5. Rebuild the secondary index on the now-small table.
CREATE INDEX idx_cycles_snapshots_canister ON cycles_snapshots(canister_id, recorded_at);

VACUUM (ANALYZE) deploy_logs;

SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size_after;
SELECT relname, n_live_tup, n_dead_tup,
       pg_size_pretty(pg_total_relation_size(relid)) AS total
  FROM pg_stat_user_tables
 WHERE relname IN ('cycles_snapshots', 'deploy_logs', 'canister_logs')
 ORDER BY pg_total_relation_size(relid) DESC;
