//! Background poller: checks canister cycles balances every 60 seconds,
//! records snapshots, and auto-tops-up low canisters.

use sqlx::PgPool;
use tokio::time::{interval, Duration};

use candid::Nat;

use crate::billing;
use crate::config::AppConfig;
use crate::exchange_rate::ExchangeRateCache;
use crate::ic_client::IcClient;
use crate::models::CanisterRecord;

/// Convert a candid Nat to i64, clamping to i64::MAX on overflow.
fn nat_to_i64(n: &Nat) -> i64 {
    i64::try_from(n.0.clone()).unwrap_or(i64::MAX)
}

/// Cycles thresholds (in cycles, not USD).
pub const THRESHOLD_HEALTHY: u128 = 4_000_000_000_000; // 4T — target level
pub const THRESHOLD_WARNING: u128 = 3_000_000_000_000; // 3T — low watermark

/// Spawn the background poller task. Runs every 60 seconds.
pub fn spawn_poller(db: PgPool, config: AppConfig, rate_cache: ExchangeRateCache) {
    tokio::spawn(async move {
        // Wait 30s after boot to let everything settle
        tokio::time::sleep(Duration::from_secs(30)).await;

        let mut tick = interval(Duration::from_secs(60)); // 60 seconds

        loop {
            tick.tick().await;
            tracing::info!("Compute poller: starting cycles check");

            if let Err(e) = run_poll_cycle(&db, &config, &rate_cache).await {
                tracing::error!("Compute poller error: {e}");
            }

            // Retention: delete snapshots older than 30 days
            let cutoff = (chrono::Utc::now() - chrono::Duration::days(30))
                .format("%Y-%m-%dT%H:%M:%SZ")
                .to_string();
            if let Err(e) = sqlx::query("DELETE FROM cycles_snapshots WHERE recorded_at < $1")
                .bind(&cutoff)
                .execute(&db)
                .await
            {
                tracing::warn!("Snapshot retention cleanup error: {e}");
            }
        }
    });
}

async fn run_poll_cycle(
    db: &PgPool,
    config: &AppConfig,
    rate_cache: &ExchangeRateCache,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Build an IcClient (needs identity PEM)
    let pem = match &config.ic_identity_pem {
        Some(p) => p,
        None => {
            tracing::warn!("Compute poller: IC_IDENTITY_PEM not set, skipping");
            return Ok(());
        }
    };

    let ic = IcClient::new(pem, &config.ic_url)
        .await
        .map_err(|e| format!("Failed to create IcClient: {e}"))?;

    // Fetch all canisters with an IC canister ID that are running
    let canisters: Vec<CanisterRecord> = sqlx::query_as(
        "SELECT * FROM canisters WHERE canister_id IS NOT NULL AND status IN ('running', 'stopped')",
    )
    .fetch_all(db)
    .await?;

    tracing::info!(
        "Compute poller: checking {} canisters",
        canisters.len()
    );

    for canister in &canisters {
        let ic_id = match &canister.canister_id {
            Some(id) => id.as_str(),
            None => continue,
        };

        match poll_single_canister(db, config, &ic, canister, ic_id, rate_cache).await {
            Ok(()) => {}
            Err(e) => {
                tracing::warn!(
                    canister_id = ic_id,
                    canister_name = canister.name,
                    "Failed to poll canister: {e}"
                );
            }
        }
    }

    Ok(())
}

async fn poll_single_canister(
    db: &PgPool,
    config: &AppConfig,
    ic: &IcClient,
    canister: &CanisterRecord,
    ic_id: &str,
    rate_cache: &ExchangeRateCache,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Query canister status from IC
    let status = ic
        .canister_status(ic_id)
        .await
        .map_err(|e| format!("canister_status failed for {ic_id}: {e}"))?;

    let cycles_balance: i64 = i64::try_from(status.cycles.0.clone()).unwrap_or(i64::MAX);
    let memory_size: i64 = i64::try_from(status.memory_size.0.clone()).unwrap_or(0);
    let status_str = format!("{:?}", status.status).to_lowercase();

    // Extract extended fields
    let idle_burned: i64 = nat_to_i64(&status.idle_cycles_burned_per_day);
    let reserved: i64 = nat_to_i64(&status.reserved_cycles);
    let reserved_limit: i64 = nat_to_i64(&status.settings.reserved_cycles_limit);
    let compute_alloc: i64 = nat_to_i64(&status.settings.compute_allocation);
    let memory_alloc: i64 = nat_to_i64(&status.settings.memory_allocation);
    let freezing_thresh: i64 = nat_to_i64(&status.settings.freezing_threshold);
    let module_hash_hex: Option<String> = status.module_hash.as_ref().map(|h| hex::encode(h));
    let q_calls: i64 = nat_to_i64(&status.query_stats.num_calls_total);
    let q_instr: i64 = nat_to_i64(&status.query_stats.num_instructions_total);
    let q_req_bytes: i64 = nat_to_i64(&status.query_stats.request_payload_bytes_total);
    let q_resp_bytes: i64 = nat_to_i64(&status.query_stats.response_payload_bytes_total);
    let wasm_mem_limit: i64 = nat_to_i64(&status.settings.wasm_memory_limit);
    let wasm_mem_thresh: i64 = nat_to_i64(&status.settings.wasm_memory_threshold);

    // Memory breakdown from MemoryMetrics (IC protocol 2025)
    let (mm_wasm, mm_stable, mm_global, mm_history, mm_snapshots) =
        match &status.memory_metrics {
            Some(mm) => (
                Some(nat_to_i64(&mm.wasm_memory_size)),
                Some(nat_to_i64(&mm.stable_memory_size)),
                Some(nat_to_i64(&mm.global_memory_size)),
                Some(nat_to_i64(&mm.canister_history_size)),
                Some(nat_to_i64(&mm.snapshots_size)),
            ),
            None => (None, None, None, None, None),
        };

    // Record snapshot
    let snap_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    sqlx::query(
        r#"INSERT INTO cycles_snapshots (
               id, canister_id, ic_canister_id, cycles_balance, memory_size, status, recorded_at,
               idle_cycles_burned_per_day, reserved_cycles, reserved_cycles_limit,
               compute_allocation, memory_allocation, freezing_threshold, module_hash,
               query_num_calls, query_num_instructions,
               query_request_payload_bytes, query_response_payload_bytes,
               wasm_memory_limit, wasm_memory_threshold,
               wasm_memory_size, stable_memory_size, global_memory_size,
               canister_history_size, snapshots_size
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25)"#,
    )
    .bind(&snap_id)
    .bind(&canister.id)
    .bind(ic_id)
    .bind(cycles_balance)
    .bind(memory_size)
    .bind(&status_str)
    .bind(&now)
    .bind(idle_burned)
    .bind(reserved)
    .bind(reserved_limit)
    .bind(compute_alloc)
    .bind(memory_alloc)
    .bind(freezing_thresh)
    .bind(&module_hash_hex)
    .bind(q_calls)
    .bind(q_instr)
    .bind(q_req_bytes)
    .bind(q_resp_bytes)
    .bind(wasm_mem_limit)
    .bind(wasm_mem_thresh)
    .bind(mm_wasm)
    .bind(mm_stable)
    .bind(mm_global)
    .bind(mm_history)
    .bind(mm_snapshots)
    .execute(db)
    .await?;

    // Update the canister's cached cycles_balance
    sqlx::query("UPDATE canisters SET cycles_balance = $1, updated_at = $2 WHERE id = $3")
        .bind(cycles_balance)
        .bind(&now)
        .bind(&canister.id)
        .execute(db)
        .await?;

    let bal: u128 = u128::try_from(status.cycles.0.clone()).unwrap_or(0);

    // Check thresholds and auto-top-up
    if bal < THRESHOLD_WARNING {
        let level = if bal == 0 { "frozen" } else { "critical" };
        tracing::warn!(
            canister_id = ic_id,
            cycles = %bal,
            level,
            "Canister cycles low"
        );

        // Top up the difference to bring canister back to THRESHOLD_HEALTHY
        let topup_amount = THRESHOLD_HEALTHY - bal;
        if let Err(e) = auto_topup_canister(db, config, ic, canister, ic_id, rate_cache, topup_amount).await {
            tracing::error!(
                canister_id = ic_id,
                "Auto top-up failed: {e}"
            );
        }
    } else if bal < THRESHOLD_HEALTHY {
        tracing::info!(
            canister_id = ic_id,
            cycles = bal,
            "Canister cycles in warning range"
        );
    }

    Ok(())
}

/// Ensure the `icforge` icp-cli identity exists (imported from PEM).
/// This is idempotent — if the identity already exists, import will fail
/// gracefully and we just move on.
pub async fn ensure_icp_identity(pem: &str) -> Result<(), String> {
    use tokio::process::Command;

    // Write PEM to a temp file
    let pem_path = "/tmp/icforge-poller-identity.pem";
    tokio::fs::write(pem_path, pem)
        .await
        .map_err(|e| format!("Failed to write PEM temp file: {e}"))?;

    // Try to import — ignore errors (identity may already exist)
    let _ = Command::new("icp")
        .args(["identity", "import", "icforge", "--from-pem", pem_path, "--storage", "plaintext"])
        .output()
        .await;

    // Clean up temp file
    let _ = tokio::fs::remove_file(pem_path).await;

    Ok(())
}

/// Deposit cycles into a canister using `icp canister top-up` CLI.
/// This uses the cycles ledger withdraw flow (the correct off-chain method),
/// unlike the management canister's deposit_cycles which is canister-to-canister only.
pub async fn deposit_cycles_via_cli(ic_id: &str, amount: u128) -> Result<(), String> {
    use tokio::process::Command;

    let amount_str = amount.to_string();

    let output = Command::new("icp")
        .args([
            "canister", "top-up", ic_id,
            "--amount", &amount_str,
            "-n", "ic",
            "--identity", "icforge",
        ])
        .output()
        .await
        .map_err(|e| format!("Failed to run `icp canister top-up`: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("icp canister top-up failed (exit {}): {stderr}",
            output.status.code().unwrap_or(-1)));
    }

    Ok(())
}

async fn auto_topup_canister(
    db: &PgPool,
    config: &AppConfig,
    _ic: &IcClient,
    canister: &CanisterRecord,
    ic_id: &str,
    rate_cache: &ExchangeRateCache,
    topup_amount: u128,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Find the project owner
    let user_id: String = sqlx::query_scalar(
        "SELECT p.user_id FROM projects p WHERE p.id = $1",
    )
    .bind(&canister.project_id)
    .fetch_one(db)
    .await?;

    // Calculate cost in cents (with margin) using live XDR→USD rate
    let cost_cents = rate_cache
        .cycles_to_credit_cents(topup_amount, config.compute_margin)
        .await;

    // Check user has enough balance
    let balance = billing::get_or_create_balance(db, &user_id)
        .await
        .map_err(|e| format!("get_or_create_balance failed: {e}"))?;
    if balance.balance_cents < cost_cents {
        tracing::warn!(
            user_id,
            balance_cents = balance.balance_cents,
            cost_cents,
            "Auto top-up skipped — insufficient balance"
        );
        return Ok(());
    }

    // Ensure icp-cli identity is available
    if let Some(pem) = &config.ic_identity_pem {
        ensure_icp_identity(pem).await?;
    } else {
        return Err("IC_IDENTITY_PEM not set — cannot top up".into());
    }

    // Deposit cycles FIRST — only debit the user if this succeeds.
    // This prevents the money-drain loop where the user gets charged
    // but cycles never land on the canister.
    deposit_cycles_via_cli(ic_id, topup_amount).await?;

    // Cycles deposited successfully — now debit the user's balance
    billing::debit_balance(
        db,
        config.stripe_secret_key.as_deref(),
        &user_id,
        cost_cents,
        "execution",
        &format!(
            "Auto top-up {} ({}) — ${:.2}",
            canister.name, ic_id,
            cost_cents as f64 / 100.0
        ),
    )
    .await
    .map_err(|e| format!("debit_balance failed: {e}"))?;

    // Record the top-up
    let topup_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now()
        .format("%Y-%m-%dT%H:%M:%SZ")
        .to_string();

    sqlx::query(
        r#"INSERT INTO canister_topups (id, canister_id, ic_canister_id, user_id, cycles_amount, cost_cents, source, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7)"#,
    )
    .bind(&topup_id)
    .bind(&canister.id)
    .bind(ic_id)
    .bind(&user_id)
    .bind(topup_amount as i64)
    .bind(cost_cents)
    .bind(&now)
    .execute(db)
    .await?;

    tracing::info!(
        canister_id = ic_id,
        user_id,
        cost_cents,
        topup_cycles = %topup_amount,
        "Auto top-up completed"
    );

    Ok(())
}
