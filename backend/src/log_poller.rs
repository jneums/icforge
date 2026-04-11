//! Background poller: fetches runtime canister logs from the IC management canister
//! every 30 seconds, deduplicates by log index, parses log levels, and stores in
//! the canister_logs table.
//!
//! Retention is per-project (projects.log_retention_hours column, default 24h).
//! Users can increase retention at the cost of more storage.

use sqlx::PgPool;
use tokio::time::{interval, Duration};

use crate::config::AppConfig;
use crate::ic_client::IcClient;
use crate::models::CanisterRecord;

/// Poll interval: 30 seconds — fast enough for near-realtime debugging.
const POLL_INTERVAL_SECS: u64 = 30;

/// Parse a log level from unstructured message text.
///
/// Recognizes patterns like:
///   "[ERROR] ..." or "ERROR: ..."  -> "error"
///   "[WARN] ..."  or "WARN: ..."   -> "warn"
///   "[INFO] ..."  or "INFO: ..."   -> "info"
///   "panicked at" or "trap: ..."   -> "error"
///   Everything else                -> "debug"
pub fn parse_log_level(message: &str) -> &'static str {
    let trimmed = message.trim_start();

    // Check for bracketed format: [ERROR], [WARN], etc.
    if trimmed.starts_with('[') {
        let upper = trimmed.to_uppercase();
        if upper.starts_with("[ERROR]") {
            return "error";
        }
        if upper.starts_with("[WARN]") || upper.starts_with("[WARNING]") {
            return "warn";
        }
        if upper.starts_with("[INFO]") {
            return "info";
        }
        if upper.starts_with("[DEBUG]") {
            return "debug";
        }
        if upper.starts_with("[TRACE]") {
            return "debug";
        }
    }

    // Check for prefix format: ERROR:, WARN:, etc.
    let upper = trimmed.to_uppercase();
    if upper.starts_with("ERROR:") || upper.starts_with("ERROR ") {
        return "error";
    }
    if upper.starts_with("WARN:") || upper.starts_with("WARN ") || upper.starts_with("WARNING:") {
        return "warn";
    }
    if upper.starts_with("INFO:") || upper.starts_with("INFO ") {
        return "info";
    }

    // Common Rust panic/trap patterns
    if trimmed.starts_with("panicked at") || trimmed.starts_with("trap:") {
        return "error";
    }

    "debug"
}

/// Spawn the background log poller. Runs every 30 seconds.
pub fn spawn_log_poller(db: PgPool, config: AppConfig) {
    tokio::spawn(async move {
        // Wait 30s after boot to let the app settle
        tokio::time::sleep(Duration::from_secs(30)).await;

        let mut tick = interval(Duration::from_secs(POLL_INTERVAL_SECS));

        loop {
            tick.tick().await;

            if let Err(e) = run_log_collection(&db, &config).await {
                tracing::error!("Log poller error: {e}");
            }

            // Retention cleanup every tick (fast — just a DELETE with index)
            if let Err(e) = run_retention_cleanup(&db).await {
                tracing::warn!("Log retention cleanup error: {e}");
            }
        }
    });
}

async fn run_log_collection(
    db: &PgPool,
    config: &AppConfig,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let pem = match &config.ic_identity_pem {
        Some(p) => p,
        None => {
            // Not an error in dev mode — just skip silently
            return Ok(());
        }
    };

    let ic = IcClient::new(pem, &config.ic_url)
        .await
        .map_err(|e| format!("Failed to create IcClient: {e}"))?;

    // Fetch all canisters with an IC canister ID that are running
    let canisters: Vec<CanisterRecord> = sqlx::query_as(
        "SELECT * FROM canisters WHERE canister_id IS NOT NULL AND status = 'running'",
    )
    .fetch_all(db)
    .await?;

    if canisters.is_empty() {
        return Ok(());
    }

    let mut total_new = 0u64;
    for canister in &canisters {
        let ic_id = match &canister.canister_id {
            Some(id) => id.as_str(),
            None => continue,
        };

        match collect_canister_logs(db, &ic, canister, ic_id).await {
            Ok(new_count) => {
                if new_count > 0 {
                    tracing::info!(
                        canister_id = ic_id,
                        canister_name = canister.name,
                        new_logs = new_count,
                        "Collected new log entries"
                    );
                }
                total_new += new_count;
            }
            Err(e) => {
                tracing::warn!(
                    canister_id = ic_id,
                    canister_name = canister.name,
                    "Failed to fetch canister logs: {e}"
                );
            }
        }
    }

    if total_new > 0 {
        tracing::info!("Log poller: collected {total_new} new log entries");
    }
    Ok(())
}

async fn collect_canister_logs(
    db: &PgPool,
    ic: &IcClient,
    canister: &CanisterRecord,
    ic_id: &str,
) -> Result<u64, Box<dyn std::error::Error + Send + Sync>> {
    // Fetch logs from IC management canister
    let log_records = ic
        .fetch_canister_logs(ic_id)
        .await
        .map_err(|e| format!("fetch_canister_logs for {ic_id}: {e}"))?;

    if log_records.is_empty() {
        return Ok(0);
    }

    // Find the highest log_index we already have for this IC canister
    let max_existing: Option<(Option<i64>,)> = sqlx::query_as(
        "SELECT MAX(log_index) FROM canister_logs WHERE ic_canister_id = $1",
    )
    .bind(ic_id)
    .fetch_optional(db)
    .await?;

    let max_idx = max_existing
        .and_then(|(v,)| v)
        .unwrap_or(-1);

    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    let mut new_count = 0u64;

    for record in &log_records {
        // Deduplicate: skip entries we already have
        if (record.idx as i64) <= max_idx {
            continue;
        }

        // Decode content bytes to UTF-8 string (IC debug logs are text)
        let message = String::from_utf8_lossy(&record.content).to_string();
        let level = parse_log_level(&message);
        let log_id = uuid::Uuid::new_v4().to_string();

        // INSERT with ON CONFLICT DO NOTHING for safety
        let result = sqlx::query(
            r#"INSERT INTO canister_logs (id, canister_id, ic_canister_id, log_index, level, message, ic_timestamp, collected_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (ic_canister_id, log_index) DO NOTHING"#,
        )
        .bind(&log_id)
        .bind(&canister.id)
        .bind(ic_id)
        .bind(record.idx as i64)
        .bind(level)
        .bind(&message)
        .bind(record.timestamp_nanos as i64)
        .bind(&now)
        .execute(db)
        .await?;

        if result.rows_affected() > 0 {
            new_count += 1;
        }
    }

    Ok(new_count)
}

/// Delete canister logs older than each project's configured retention period.
///
/// Each project has its own `log_retention_hours` (default 24).
/// We group by distinct retention hours to minimize queries.
async fn run_retention_cleanup(
    db: &PgPool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Get distinct retention periods currently in use
    let retention_tiers: Vec<(i32,)> = sqlx::query_as(
        "SELECT DISTINCT COALESCE(log_retention_hours, 24) FROM projects",
    )
    .fetch_all(db)
    .await?;

    for (hours,) in &retention_tiers {
        let cutoff_nanos = (chrono::Utc::now() - chrono::Duration::hours(*hours as i64))
            .timestamp_nanos_opt()
            .unwrap_or(0);

        let deleted = sqlx::query(
            r#"DELETE FROM canister_logs
               WHERE ic_timestamp < $1
                 AND canister_id IN (
                     SELECT c.id FROM canisters c
                     JOIN projects p ON c.project_id = p.id
                     WHERE COALESCE(p.log_retention_hours, 24) = $2
                 )"#,
        )
        .bind(cutoff_nanos)
        .bind(*hours)
        .execute(db)
        .await?;

        if deleted.rows_affected() > 0 {
            tracing::info!(
                retention_hours = hours,
                deleted = deleted.rows_affected(),
                "Log retention: cleaned up expired entries"
            );
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_log_level_bracketed() {
        assert_eq!(parse_log_level("[ERROR] something broke"), "error");
        assert_eq!(parse_log_level("[WARN] low memory"), "warn");
        assert_eq!(parse_log_level("[WARNING] deprecated"), "warn");
        assert_eq!(parse_log_level("[INFO] started"), "info");
        assert_eq!(parse_log_level("[DEBUG] internal"), "debug");
        assert_eq!(parse_log_level("[TRACE] very verbose"), "debug");
    }

    #[test]
    fn test_parse_log_level_prefix() {
        assert_eq!(parse_log_level("ERROR: crash"), "error");
        assert_eq!(parse_log_level("WARN: heads up"), "warn");
        assert_eq!(parse_log_level("WARNING: old api"), "warn");
        assert_eq!(parse_log_level("INFO: request received"), "info");
    }

    #[test]
    fn test_parse_log_level_panic() {
        assert_eq!(parse_log_level("panicked at 'index out of bounds'"), "error");
        assert_eq!(parse_log_level("trap: unreachable"), "error");
    }

    #[test]
    fn test_parse_log_level_default() {
        assert_eq!(parse_log_level("some random log message"), "debug");
        assert_eq!(parse_log_level("hello world"), "debug");
        assert_eq!(parse_log_level(""), "debug");
    }

    #[test]
    fn test_parse_log_level_case_insensitive() {
        assert_eq!(parse_log_level("[error] lowercase"), "error");
        assert_eq!(parse_log_level("[Error] mixed"), "error");
        assert_eq!(parse_log_level("error: something"), "error");
    }
}
