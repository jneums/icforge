use std::sync::Arc;
use std::time::Instant;

use dashmap::DashMap;
use tokio::sync::broadcast;

use crate::billing;
use crate::config::AppConfig;
use crate::db::DbPool;
use crate::exchange_rate::ExchangeRateCache;
use crate::github::{self, GitHubNotifier};
use crate::models::DeploymentRecord;
use crate::LogEvent;

/// Canister creation fee on IC: 0.5T cycles, deducted by the cycles ledger
/// from the amount sent. See: https://docs.internetcomputer.org/building-apps/essentials/gas-cost
///
/// Total cycles sent to the cycles ledger per canister provision: flat 4T.
/// The ledger deducts the 0.5T creation fee, leaving the canister with 3.5T.
/// Auto-topup kicks in below 3T, topping up the difference to 4T.
const PROVISION_CYCLES: u128 = 4_000_000_000_000; // 4T cycles

/// Shared map of per-deployment broadcast channels for SSE log streaming.
pub type LogChannels = Arc<DashMap<String, broadcast::Sender<LogEvent>>>;

/// Spawn the background deploy worker that polls for queued jobs.
pub fn spawn_worker(pool: DbPool, config: AppConfig, log_channels: LogChannels, rate_cache: ExchangeRateCache) {
    tokio::spawn(async move {
        tracing::info!("Deploy worker started — polling for jobs every 5s");
        let notifier = GitHubNotifier::new();

        loop {
            match claim_and_run(&pool, &config, &notifier, &log_channels, &rate_cache).await {
                Ok(true) => {
                    // Processed a job — immediately check for more
                    continue;
                }
                Ok(false) => {
                    // No jobs — wait before polling again
                }
                Err(e) => {
                    tracing::error!("Deploy worker error: {e}");
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

/// Try to claim one queued job and execute it. Returns true if a job was processed.
async fn claim_and_run(
    pool: &DbPool,
    config: &AppConfig,
    notifier: &GitHubNotifier,
    log_channels: &LogChannels,
    rate_cache: &ExchangeRateCache,
) -> Result<bool, String> {
    // Atomic claim: grab the oldest queued job with FOR UPDATE SKIP LOCKED
    let job: Option<DeploymentRecord> = sqlx::query_as(
        r#"
        UPDATE deployments
        SET status = 'building',
            claimed_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
            updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
        WHERE id = (
            SELECT id FROM deployments
            WHERE status = 'queued'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING *
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| format!("Failed to claim job: {e}"))?;

    let job = match job {
        Some(j) => j,
        None => return Ok(false),
    };

    tracing::info!(
        job_id = %job.id,
        repo = %job.repo_full_name.as_deref().unwrap_or("unknown"),
        "Claimed deployment job"
    );

    // Get installation token for GitHub API access + cloning
    let installation_id = job.installation_id
        .ok_or_else(|| "BUG: deployment has no installation_id".to_string())?;
    let token=github::get_installation_token(config, installation_id)
        .await
        .map_err(|e| format!("Failed to get installation token: {e}"))?;

    // Per-canister check name for GitHub statuses + check runs
    let canister_name_ref = &job.canister_name;
    let check_name = format!("icforge/{canister_name_ref}");
    let repo = job.repo_full_name.as_deref().unwrap_or("");
    let sha = job.commit_sha.as_deref().unwrap_or("");

    // Post pending commit status
    let deploy_url = format!("{}/deploys/{}", config.frontend_url, job.id);
    let short_sha = &sha[..sha.len().min(7)];
    let _ = notifier
        .post_commit_status(
            &token,
            repo,
            sha,
            "pending",
            "Deployment queued",
            &deploy_url,
            &check_name,
        )
        .await;

    // Create check run
    let check_run_id = notifier
        .create_check_run(
            &token,
            repo,
            sha,
            &check_name,
            &format!(
                "Building {} @ {}...",
                canister_name_ref,
                short_sha
            ),
        )
        .await
        .ok();

    // Create a broadcast channel for real-time log streaming via SSE
    let (tx, _) = broadcast::channel::<LogEvent>(256);
    log_channels.insert(job.id.clone(), tx.clone());

    // Run the actual build
    let start = Instant::now();
    let result = execute_deploy(pool, config, &job, &token, &tx, rate_cache).await;
    let duration_ms = start.elapsed().as_millis() as i32;

    match result {
        Ok(()) => {
            // Mark success
            sqlx::query(
                r#"
                UPDATE deployments
                SET status = 'live',
                    completed_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                    build_duration_ms = $2,
                    updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                WHERE id = $1
                "#,
            )
            .bind(&job.id)
            .bind(duration_ms)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to update job status: {e}"))?;

            // Update GitHub status
            let _ = notifier
                .post_commit_status(
                    &token,
                    repo,
                    sha,
                    "success",
                    &format!("Deployed in {:.1}s", duration_ms as f64 / 1000.0),
                    &deploy_url,
                    &check_name,
                )
                .await;

            if let Some(check_id) = check_run_id {
                let _ = notifier
                    .update_check_run(
                        &token,
                        repo,
                        check_id,
                        "success",
                        "Deployment succeeded",
                        &format!(
                            "Deployed `{}` in {:.1}s",
                            short_sha,
                            duration_ms as f64 / 1000.0
                        ),
                    )
                    .await;
            }

            // Comment on PR if this is a PR deploy
            if let Some(pr_number) = job.pr_number {
                let comment = format!(
                    "### 🚀 ICForge Preview\n\n\
                     **Status:** ✅ Deployed\n\
                     **Commit:** `{}`\n\
                     **Duration:** {:.1}s\n\n\
                     [View Deployment]({})",
                    short_sha,
                    duration_ms as f64 / 1000.0,
                    deploy_url,
                );
                let _ = notifier
                    .comment_on_pr(&token, repo, pr_number, &comment)
                    .await;
            }

            tracing::info!(
                job_id = %job.id,
                duration_ms = duration_ms,
                "Deployment succeeded"
            );
        }
        Err(err) => {
            // Mark failure
            sqlx::query(
                r#"
                UPDATE deployments
                SET status = 'failed',
                    error_message = $2,
                    completed_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
                    build_duration_ms = $3,
                    updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                WHERE id = $1
                "#,
            )
            .bind(&job.id)
            .bind(&err)
            .bind(duration_ms)
            .execute(pool)
            .await
            .map_err(|e| format!("Failed to update job status: {e}"))?;

            let _ = notifier
                .post_commit_status(
                    &token,
                    repo,
                    sha,
                    "failure",
                    &format!("Deploy failed: {}", truncate(&err, 80)),
                    &deploy_url,
                    &check_name,
                )
                .await;

            if let Some(check_id) = check_run_id {
                let _ = notifier
                    .update_check_run(
                        &token,
                        repo,
                        check_id,
                        "failure",
                        "Deployment failed",
                        &format!("```\n{}\n```", &err),
                    )
                    .await;
            }

            if let Some(pr_number) = job.pr_number {
                let comment = format!(
                    "### 🚀 ICForge Preview\n\n\
                     **Status:** ❌ Failed\n\
                     **Commit:** `{}`\n\n\
                     ```\n{}\n```\n\n\
                     [View Deployment]({})",
                    short_sha,
                    &err,
                    deploy_url,
                );
                let _ = notifier
                    .comment_on_pr(&token, repo, pr_number, &comment)
                    .await;
            }

            tracing::warn!(
                job_id = %job.id,
                error = %err,
                "Deployment failed"
            );
        }
    }

    // Clean up broadcast channel — SSE subscribers see channel close
    log_channels.remove(&job.id);

    Ok(true)
}

/// Execute the build: clone, setup icp-cli identity, hydrate .icp mappings, run `icp deploy`.
async fn execute_deploy(
    pool: &DbPool,
    config: &AppConfig,
    job: &DeploymentRecord,
    token: &str,
    tx: &broadcast::Sender<LogEvent>,
    rate_cache: &ExchangeRateCache,
) -> Result<(), String> {
    let build_start = Instant::now();
    let work_dir = format!("/tmp/icforge-deploys/{}", job.id);

    // Phase: clone
    log_deploy(pool, &job.id, "info", "clone", "Cloning repository...", tx).await;

    let clone_url = format!(
        "https://x-access-token:{token}@github.com/{}.git",
        job.repo_full_name.as_deref().unwrap_or("")
    );

    run_cmd(
        &work_dir,
        &[
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            job.branch.as_deref().unwrap_or("main"),
            &clone_url,
            &work_dir,
        ],
    )
    .await?;
    run_cmd(&work_dir, &["git", "checkout", job.commit_sha.as_deref().unwrap_or("HEAD")]).await?;

    log_deploy(pool, &job.id, "info", "clone", "Repository cloned", tx).await;

    // Require icp.yaml — no fallback framework detection
    let icp_yaml_path = format!("{work_dir}/icp.yaml");
    if !tokio::fs::metadata(&icp_yaml_path).await.is_ok() {
        return Err("No icp.yaml found in repository root. ICForge requires icp-cli projects.".into());
    }

    // Fetch project slug and owner for per-canister subdomain routing + billing
    let (project_slug, project_user_id): (String, String) = sqlx::query_as(
        "SELECT slug, user_id FROM projects WHERE id = $1",
    )
    .bind(&job.project_id)
    .fetch_one(pool)
    .await
    .map_err(|e| format!("Failed to fetch project: {e}"))?;

    // --- Pre-flight billing check: require minimum balance for build ---
    let min_build_cents = config.build_cost_cents_per_min; // 1 minute minimum
    let bal = billing::get_or_create_balance(pool, &project_user_id)
        .await
        .map_err(|e| format!("Failed to check billing balance: {e}"))?;
    if bal.balance_cents < min_build_cents {
        let msg = format!(
            "Insufficient compute balance to start build. \
             Current balance: {}¢ (${}). Minimum required: {}¢ (${}). \
             Please add credits at Settings → Billing.",
            bal.balance_cents,
            bal.balance_cents as f64 / 100.0,
            min_build_cents,
            min_build_cents as f64 / 100.0,
        );
        log_deploy(pool, &job.id, "error", "billing", &msg, tx).await;
        return Err(msg);
    }

    // Phase: setup icp-cli identity
    log_deploy(pool, &job.id, "info", "setup", "Setting up icp-cli identity...", tx).await;

    let ic_pem = config
        .ic_identity_pem
        .as_deref()
        .ok_or_else(|| "IC_IDENTITY_PEM not configured — cannot deploy".to_string())?;

    // Write PEM to temp file for icp identity import
    let pem_path = format!("{work_dir}/.icforge-identity.pem");
    tokio::fs::write(&pem_path, ic_pem)
        .await
        .map_err(|e| format!("Failed to write identity PEM: {e}"))?;

    run_cmd(
        &work_dir,
        &["icp", "identity", "import", "icforge", "--from-pem", &pem_path, "--storage", "plaintext"],
    )
    .await
    .or_else(|e| {
        // Identity may already exist from a previous build
        if e.contains("already exists") {
            Ok(String::new())
        } else {
            Err(e)
        }
    })?;
    run_cmd(&work_dir, &["icp", "identity", "default", "icforge"]).await?;

    // Clean up PEM file immediately
    let _ = tokio::fs::remove_file(&pem_path).await;

    log_deploy(pool, &job.id, "info", "setup", "Identity configured", tx).await;

    // Every job targets exactly one canister — webhook fan-out guarantees this
    let canister_name = &job.canister_name;

    log_deploy(
        pool,
        &job.id,
        "info",
        "deploy",
        &format!("Deploying canister '{canister_name}'..."),
        tx,
    )
    .await;

    // Phase: pre-provision — ensure canister has ID in DB
    log_deploy(pool, &job.id, "info", "provision", &format!("Pre-provisioning canister '{canister_name}'..."), tx).await;

    {
        let canister_row = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT id, canister_id FROM canisters WHERE project_id = $1 AND name = $2",
        )
        .bind(&job.project_id)
        .bind(canister_name)
        .fetch_optional(pool)
        .await
        .map_err(|e| format!("DB error looking up canister {canister_name}: {e}"))?;

        match canister_row {
            Some((_db_id, Some(cid))) => {
                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Canister '{canister_name}' already provisioned: {cid}"),
                    tx,
                )
                .await;
            }
            Some((db_id, None)) => {
                // DB record exists but no canister ID — create on IC via icp-cli.
                // This is the FIRST provision of this canister — charge the user.

                // --- Compute provisioning cost ---
                let provision_cost_cents = rate_cache
                    .cycles_to_credit_cents(PROVISION_CYCLES, config.compute_margin)
                    .await;

                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "billing",
                    &format!(
                        "Provisioning canister '{canister_name}' — estimated cost: ${:.2}",
                        provision_cost_cents as f64 / 100.0,
                    ),
                    tx,
                )
                .await;

                // --- Debit user BEFORE creating canister (fail-fast if insufficient) ---
                let stripe_key = config.stripe_secret_key.as_deref();
                if let Err(_e) = billing::debit_balance(
                    pool,
                    stripe_key,
                    &project_user_id,
                    provision_cost_cents,
                    "provision",
                    &format!(
                        "Canister '{}' provisioning — ${:.2}",
                        canister_name,
                        provision_cost_cents as f64 / 100.0,
                    ),
                )
                .await
                {
                    let msg = format!(
                        "Insufficient compute balance to provision canister '{}'. \
                         Required: {}¢ (~${:.2}). Please add credits at Settings → Billing.",
                        canister_name,
                        provision_cost_cents,
                        provision_cost_cents as f64 / 100.0,
                    );
                    log_deploy(pool, &job.id, "error", "billing", &msg, tx).await;
                    return Err(msg);
                }

                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "billing",
                    &format!("Debited {}¢ from compute balance for canister '{canister_name}'", provision_cost_cents),
                    tx,
                )
                .await;

                // --- Create canister on IC ---
                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Creating canister '{canister_name}' on IC..."),
                    tx,
                )
                .await;

                let create_result = run_cmd(
                    &work_dir,
                    &[
                        "icp", "canister", "create", canister_name,
                        "-e", "ic",
                        "--identity", "icforge",
                        "--cycles", &PROVISION_CYCLES.to_string(),
                    ],
                )
                .await;

                let output = match create_result {
                    Ok(out) => out,
                    Err(e) => {
                        // Canister creation failed — refund the user
                        let refund_desc = format!(
                            "Refund: canister '{}' provisioning failed",
                            canister_name,
                        );
                        log_deploy(
                            pool,
                            &job.id,
                            "warn",
                            "billing",
                            &format!("Canister creation failed — refunding {}¢ to user", provision_cost_cents),
                            tx,
                        )
                        .await;
                        if let Err(refund_err) = billing::credit_balance(
                            pool,
                            &project_user_id,
                            provision_cost_cents,
                            "refund",
                            None,
                            &refund_desc,
                        )
                        .await
                        {
                            tracing::error!(
                                user_id = %project_user_id,
                                amount_cents = provision_cost_cents,
                                error = %refund_err,
                                "CRITICAL: Failed to refund provisioning cost after canister creation failure"
                            );
                        }
                        return Err(format!("Failed to create canister '{canister_name}': {e}"));
                    }
                };

                // Parse canister ID from icp-cli output
                let cid = parse_canister_id_from_output(&output)
                    .ok_or_else(|| format!("Could not parse canister ID from icp output for '{canister_name}': {output}"))?;

                let _ = sqlx::query(
                    "UPDATE canisters SET canister_id = $1, status = 'created', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $2",
                )
                .bind(&cid)
                .bind(&db_id)
                .execute(pool)
                .await;

                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Created canister '{canister_name}': {cid}"),
                    tx,
                )
                .await;
            }
            None => {
                return Err(format!("No canister record for '{canister_name}' in project — cannot deploy"));
            }
        }
    }

    // Phase: hydrate .icp/data/mappings/ — write ALL canister IDs from DB
    // so icp-cli discovers sibling canisters and injects PUBLIC_CANISTER_ID:* env vars
    log_deploy(pool, &job.id, "info", "hydrate", "Hydrating .icp mappings from DB...", tx).await;

    let all_canisters = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT name, canister_id FROM canisters WHERE project_id = $1",
    )
    .bind(&job.project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error fetching canisters for hydration: {e}"))?;

    let mappings_dir = format!("{work_dir}/.icp/data/mappings");
    tokio::fs::create_dir_all(&mappings_dir)
        .await
        .map_err(|e| format!("Failed to create .icp mappings dir: {e}"))?;

    // icp-cli expects a single JSON file: .icp/data/mappings/ic.ids.json
    // Format: { "canister_name": "canister-id", ... }
    let mut ids_map = serde_json::Map::new();
    for (name, cid) in &all_canisters {
        if let Some(canister_id) = cid {
            ids_map.insert(name.clone(), serde_json::Value::String(canister_id.clone()));
        }
    }

    let ids_json = serde_json::to_string_pretty(&serde_json::Value::Object(ids_map))
        .map_err(|e| format!("Failed to serialize canister IDs: {e}"))?;
    let ids_path = format!("{mappings_dir}/ic.ids.json");
    tokio::fs::write(&ids_path, &ids_json)
        .await
        .map_err(|e| format!("Failed to write ic.ids.json: {e}"))?;

    log_deploy(
        pool,
        &job.id,
        "info",
        "hydrate",
        &format!(
            "Wrote {} canister IDs to .icp/data/mappings/ic.ids.json",
            all_canisters.iter().filter(|(_, c)| c.is_some()).count()
        ),
        tx,
    )
    .await;

    // Phase: deploy — run `icp deploy <canister_name>`
    let _output = run_cmd_streaming(
        pool,
        &job.id,
        &work_dir,
        &["icp", "deploy", canister_name, "-e", "ic", "--identity", "icforge"],
        tx,
    )
    .await
    .map_err(|e| format!("icp deploy failed for '{canister_name}': {e}"))?;

    // Update canister status in DB
    let _ = sqlx::query(
        "UPDATE canisters SET status = 'running', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE project_id = $1 AND name = $2",
    )
    .bind(&job.project_id)
    .bind(canister_name)
    .execute(pool)
    .await;

    // Fetch canister_id from DB for KV write + log
    let canister_id: Option<String> = sqlx::query_scalar(
        "SELECT canister_id FROM canisters WHERE project_id = $1 AND name = $2",
    )
    .bind(&job.project_id)
    .bind(canister_name)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    if let Some(ref cid) = canister_id {
        log_deploy(
            pool,
            &job.id,
            "info",
            "deploy",
            &format!("✅ Canister '{canister_name}' deployed to {cid}"),
            tx,
        )
        .await;

        // Write per-canister subdomain mapping to Cloudflare KV (best-effort)
        let canister_slug = format!("{project_slug}-{canister_name}");
        if let Err(e) =
            crate::cloudflare::kv_write(config, &canister_slug, cid, &job.project_id).await
        {
            tracing::warn!(
                deployment_id = %job.id,
                slug = %canister_slug,
                error = %e,
                "Failed to write Cloudflare KV subdomain mapping (non-fatal)"
            );
        }
    } else {
        log_deploy(
            pool,
            &job.id,
            "info",
            "deploy",
            &format!("✅ Canister '{canister_name}' deployed (no canister ID in DB yet)"),
            tx,
        )
        .await;
    }

    // --- Debit build time ---
    let build_duration_secs = build_start.elapsed().as_secs_f64();
    let build_minutes = build_duration_secs / 60.0;
    // Round up to nearest 0.1 minute so even short builds have a minimum charge
    let billable_minutes = (build_minutes * 10.0).ceil() / 10.0;
    let build_cost_cents = (billable_minutes * config.build_cost_cents_per_min as f64).ceil() as i32;

    if build_cost_cents > 0 {
        let stripe_key = config.stripe_secret_key.as_deref();
        match billing::debit_balance(
            pool,
            stripe_key,
            &project_user_id,
            build_cost_cents,
            "builds",
            &format!(
                "Build '{}' ({:.1}s, {:.1} min @ {}¢/min)",
                job.canister_name,
                build_duration_secs,
                billable_minutes,
                config.build_cost_cents_per_min,
            ),
        )
        .await
        {
            Ok(()) => {
                log_deploy(
                    pool,
                    &job.id,
                    "info",
                    "billing",
                    &format!(
                        "Build cost: {}¢ ({:.1}s, {:.1} min @ {}¢/min)",
                        build_cost_cents,
                        build_duration_secs,
                        billable_minutes,
                        config.build_cost_cents_per_min,
                    ),
                    tx,
                )
                .await;
            }
            Err(e) => {
                // Build already succeeded — log but don't fail the deploy
                tracing::warn!(
                    user_id = %project_user_id,
                    build_cost_cents = build_cost_cents,
                    error = %e,
                    "Failed to debit build cost (deploy succeeded anyway)"
                );
            }
        }
    }

    // Cleanup
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    log_deploy(pool, &job.id, "info", "complete", "Deployment complete", tx).await;
    Ok(())
}

/// Parse a canister ID (principal) from icp-cli command output.
/// Handles patterns like:
///   - `Created canister backend with ID 7ue4f-wyaaa-aaaad-aghwq-cai`
///   - `canister_id: xxxxx-xxxxx-...`
///   - `Canister ID: xxxxx-xxxxx-...`
///   - A bare principal on its own line
fn parse_canister_id_from_output(output: &str) -> Option<String> {
    // Principal regex: 5+ groups of alphanumeric separated by dashes (e.g. xxxxx-xxxxx-xxxxx-xxxxx-cai)
    let is_principal = |s: &str| -> bool {
        let parts: Vec<&str> = s.split('-').collect();
        parts.len() >= 3
            && s.len() >= 25
            && s.len() <= 63
            && s.chars().all(|c| c.is_alphanumeric() || c == '-')
    };

    for line in output.lines() {
        let trimmed = line.trim();

        // "Created canister <name> with ID <principal>"
        if let Some(idx) = trimmed.find("with ID ") {
            let candidate = trimmed[idx + 8..].trim().trim_matches('"');
            if is_principal(candidate) {
                return Some(candidate.to_string());
            }
        }

        // "canister_id: <principal>" or "Canister ID: <principal>"
        if let Some(rest) = trimmed
            .strip_prefix("canister_id:")
            .or_else(|| trimmed.strip_prefix("Canister ID:"))
        {
            let id = rest.trim().trim_matches('"');
            if !id.is_empty() && is_principal(id) {
                return Some(id.to_string());
            }
        }
    }

    // Fallback: scan for any principal-shaped token on any line
    for line in output.lines() {
        for word in line.split_whitespace() {
            let candidate = word.trim_matches(|c: char| !c.is_alphanumeric() && c != '-');
            if is_principal(candidate) {
                return Some(candidate.to_string());
            }
        }
    }

    None
}

/// Run a command and stream its output as deploy log lines.
async fn run_cmd_streaming(
    pool: &DbPool,
    deployment_id: &str,
    work_dir: &str,
    args: &[&str],
    tx: &broadcast::Sender<LogEvent>,
) -> Result<String, String> {
    use tokio::io::{AsyncBufReadExt, BufReader};
    use tokio::process::Command;

    let _ = tokio::fs::create_dir_all(work_dir).await;

    let mut child = Command::new(args[0])
        .args(&args[1..])
        .current_dir(work_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {e}", args[0]))?;

    // Read stdout and stderr CONCURRENTLY to avoid pipe deadlock.
    // If we read them sequentially, the child can fill the stderr pipe buffer
    // while we're blocked reading stdout (or vice versa), causing a deadlock.
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let pool_clone = pool.clone();
    let tx_clone = tx.clone();
    let dep_id = deployment_id.to_string();
    let stdout_handle = tokio::spawn(async move {
        let mut lines_out = Vec::new();
        if let Some(stdout) = stdout {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log_deploy(&pool_clone, &dep_id, "info", "deploy", &format!("  | {line}"), &tx_clone).await;
                lines_out.push(line);
            }
        }
        lines_out
    });

    let pool_clone2 = pool.clone();
    let tx_clone2 = tx.clone();
    let dep_id2 = deployment_id.to_string();
    let stderr_handle = tokio::spawn(async move {
        let mut lines_err = Vec::new();
        if let Some(stderr) = stderr {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                log_deploy(&pool_clone2, &dep_id2, "warn", "deploy", &format!("  | {line}"), &tx_clone2).await;
                lines_err.push(line);
            }
        }
        lines_err
    });

    let (stdout_lines, stderr_lines) = tokio::try_join!(stdout_handle, stderr_handle)
        .map_err(|e| format!("Task join error: {e}"))?;

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for {}: {e}", args[0]))?;

    let stderr_output = stderr_lines.join("\n");
    if !status.success() {
        return Err(format!(
            "Command `{}` failed (exit {}):\n{stderr_output}",
            args.join(" "),
            status.code().unwrap_or(-1)
        ));
    }

    let mut all_output = stdout_lines.join("\n");
    if !all_output.is_empty() {
        all_output.push('\n');
    }
    all_output.push_str(&stderr_output);
    Ok(all_output)
}


async fn log_deploy(pool: &DbPool, deployment_id: &str, level: &str, phase: &str, message: &str, tx: &broadcast::Sender<LogEvent>) {
    tracing::info!(deployment_id = deployment_id, phase = phase, "{}", message);

    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Write to DB
    let _ = sqlx::query(
        "INSERT INTO deploy_logs (deployment_id, level, message, phase) VALUES ($1, $2, $3, $4)",
    )
    .bind(deployment_id)
    .bind(level)
    .bind(message)
    .bind(phase)
    .execute(pool)
    .await;

    // Broadcast to SSE subscribers (ignore error = no active subscribers)
    let _ = tx.send(LogEvent {
        level: level.to_string(),
        message: message.to_string(),
        timestamp,
    });
}

async fn run_cmd(work_dir: &str, args: &[&str]) -> Result<String, String> {
    use tokio::process::Command;

    // Ensure work dir exists for clone
    let _ = tokio::fs::create_dir_all(work_dir).await;

    let output = Command::new(args[0])
        .args(&args[1..])
        .current_dir(work_dir)
        .output()
        .await
        .map_err(|e| format!("Failed to run {}: {e}", args[0]))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();

    if !output.status.success() {
        return Err(format!(
            "Command `{}` failed (exit {}):\n{stderr}",
            args.join(" "),
            output.status.code().unwrap_or(-1)
        ));
    }

    Ok(format!("{stdout}{stderr}"))
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}