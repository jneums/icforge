use std::time::Instant;

use crate::config::AppConfig;
use crate::db::DbPool;
use crate::github::{self, GitHubNotifier};
use crate::ic_client::{EnvironmentVariable, IcClient};
use crate::models::BuildJob;

/// Default asset canister wasm version (dfinity SDK tag)
const DEFAULT_ASSET_CANISTER_VERSION: &str = "0.30.2";

/// Parsed canister config from canister.yaml
#[derive(Debug)]
struct CanisterConfig {
    name: String,
    recipe_type: Option<String>,   // e.g. "asset-canister", "rust"
    asset_dir: Option<String>,     // e.g. "dist", "build"
    asset_version: Option<String>, // SDK version for asset canister wasm
    build_commands: Vec<String>,   // e.g. ["npm install", "npm run build"]
    wasm_path: Option<String>,     // explicit wasm path
}

/// Spawn the background build worker that polls for pending jobs.
pub fn spawn_worker(pool: DbPool, config: AppConfig) {
    tokio::spawn(async move {
        tracing::info!("Build worker started — polling for jobs every 5s");
        let notifier = GitHubNotifier::new();

        loop {
            match claim_and_run(&pool, &config, &notifier).await {
                Ok(true) => {
                    // Processed a job — immediately check for more
                    continue;
                }
                Ok(false) => {
                    // No jobs — wait before polling again
                }
                Err(e) => {
                    tracing::error!("Build worker error: {e}");
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        }
    });
}

/// Try to claim one pending job and execute it. Returns true if a job was processed.
async fn claim_and_run(
    pool: &DbPool,
    config: &AppConfig,
    notifier: &GitHubNotifier,
) -> Result<bool, String> {
    // Atomic claim: grab the oldest pending job with FOR UPDATE SKIP LOCKED
    let job: Option<BuildJob> = sqlx::query_as(
        r#"
        UPDATE build_jobs
        SET status = 'building',
            claimed_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'),
            updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
        WHERE id = (
            SELECT id FROM build_jobs
            WHERE status = 'pending'
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
        repo = %job.repo_full_name,
        sha = &job.commit_sha[..7.min(job.commit_sha.len())],
        "Claimed build job"
    );

    // Get installation token for GitHub API access + cloning
    let token = github::get_installation_token(config, job.installation_id)
        .await
        .map_err(|e| format!("Failed to get installation token: {e}"))?;

    // Post pending commit status
    let build_url = format!("{}/builds/{}", config.frontend_url, job.id);
    let _ = notifier
        .post_commit_status(
            &token,
            &job.repo_full_name,
            &job.commit_sha,
            "pending",
            "Build queued",
            &build_url,
        )
        .await;

    // Create check run
    let check_run_id = notifier
        .create_check_run(
            &token,
            &job.repo_full_name,
            &job.commit_sha,
            &format!(
                "Building {}...",
                &job.commit_sha[..7.min(job.commit_sha.len())]
            ),
        )
        .await
        .ok();

    // Run the actual build
    let start = Instant::now();
    let result = execute_build(pool, config, &job, &token).await;
    let duration_ms = start.elapsed().as_millis() as i32;

    match result {
        Ok(()) => {
            // Mark success
            sqlx::query(
                r#"
                UPDATE build_jobs
                SET status = 'success',
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
                    &job.repo_full_name,
                    &job.commit_sha,
                    "success",
                    &format!("Deployed in {:.1}s", duration_ms as f64 / 1000.0),
                    &build_url,
                )
                .await;

            if let Some(check_id) = check_run_id {
                let _ = notifier
                    .update_check_run(
                        &token,
                        &job.repo_full_name,
                        check_id,
                        "success",
                        "Build succeeded",
                        &format!(
                            "Deployed `{}` in {:.1}s",
                            &job.commit_sha[..7.min(job.commit_sha.len())],
                            duration_ms as f64 / 1000.0
                        ),
                    )
                    .await;
            }

            // Comment on PR if this is a PR build
            if let Some(pr_number) = job.pr_number {
                let comment = format!(
                    "### 🚀 ICForge Preview\n\n\
                     **Status:** ✅ Deployed\n\
                     **Commit:** `{}`\n\
                     **Duration:** {:.1}s\n\n\
                     [View Build]({})",
                    &job.commit_sha[..7.min(job.commit_sha.len())],
                    duration_ms as f64 / 1000.0,
                    build_url,
                );
                let _ = notifier
                    .comment_on_pr(&token, &job.repo_full_name, pr_number, &comment)
                    .await;
            }

            tracing::info!(
                job_id = %job.id,
                duration_ms = duration_ms,
                "Build succeeded"
            );
        }
        Err(err) => {
            // Mark failure
            sqlx::query(
                r#"
                UPDATE build_jobs
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
                    &job.repo_full_name,
                    &job.commit_sha,
                    "failure",
                    &format!("Build failed: {}", truncate(&err, 80)),
                    &build_url,
                )
                .await;

            if let Some(check_id) = check_run_id {
                let _ = notifier
                    .update_check_run(
                        &token,
                        &job.repo_full_name,
                        check_id,
                        "failure",
                        "Build failed",
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
                     [View Build]({})",
                    &job.commit_sha[..7.min(job.commit_sha.len())],
                    &err,
                    build_url,
                );
                let _ = notifier
                    .comment_on_pr(&token, &job.repo_full_name, pr_number, &comment)
                    .await;
            }

            tracing::warn!(
                job_id = %job.id,
                error = %err,
                "Build failed"
            );
        }
    }

    Ok(true)
}

/// Execute the build: clone, detect framework, build wasm, deploy.
async fn execute_build(
    pool: &DbPool,
    config: &AppConfig,
    job: &BuildJob,
    token: &str,
) -> Result<(), String> {
    let work_dir = format!("/tmp/icforge-builds/{}", job.id);

    // Phase: clone
    log_build(pool, &job.id, "info", "clone", "Cloning repository...").await;

    let clone_url = format!(
        "https://x-access-token:{token}@github.com/{}.git",
        job.repo_full_name
    );

    run_cmd(
        &work_dir,
        &[
            "git",
            "clone",
            "--depth",
            "1",
            "--branch",
            &job.branch,
            &clone_url,
            &work_dir,
        ],
    )
    .await?;
    run_cmd(&work_dir, &["git", "checkout", &job.commit_sha]).await?;

    log_build(pool, &job.id, "info", "clone", "Repository cloned").await;

    // Fetch project slug for per-canister subdomain routing
    let project_slug: String = sqlx::query_scalar("SELECT slug FROM projects WHERE id = $1")
        .bind(&job.project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch project slug: {e}"))?;

    // Phase: detect
    log_build(
        pool,
        &job.id,
        "info",
        "detect",
        "Detecting project framework...",
    )
    .await;

    let framework = detect_framework(&work_dir).await;
    let framework_name = framework.as_deref().unwrap_or("unknown");

    // Update framework in DB
    let _ = sqlx::query("UPDATE build_jobs SET framework = $1 WHERE id = $2")
        .bind(framework_name)
        .bind(&job.id)
        .execute(pool)
        .await;

    log_build(
        pool,
        &job.id,
        "info",
        "detect",
        &format!("Detected framework: {framework_name}"),
    )
    .await;

    // Phase: build
    log_build(pool, &job.id, "info", "build", "Building project...").await;

    match framework_name {
        "motoko" => {
            // Look for a dfx.json and build the canister
            // For now, expect a pre-built .wasm or use moc compiler
            log_build(pool, &job.id, "info", "build", "Motoko build (using moc)").await;
            // TODO: actual Motoko build pipeline
            return Err(
                "Motoko build pipeline not yet implemented — please upload pre-built .wasm via CLI"
                    .into(),
            );
        }
        "assets" => {
            log_build(
                pool,
                &job.id,
                "info",
                "build",
                "Static assets — no build step needed",
            )
            .await;
        }
        "npm" | "node" => {
            log_build(
                pool,
                &job.id,
                "info",
                "build",
                "Running npm install && npm run build",
            )
            .await;
            run_cmd(&work_dir, &["npm", "install"]).await?;
            run_cmd(&work_dir, &["npm", "run", "build"]).await?;
        }
        "icp" | "rust" => {
            // icp.yaml project — parse canister configs and build each one
            log_build(
                pool,
                &job.id,
                "info",
                "build",
                "IC project — building canisters from icp.yaml",
            )
            .await;

            let canister_configs = parse_icp_yaml(&work_dir).await;

            if canister_configs.is_empty() && framework_name == "rust" {
                // Plain rust project without icp.yaml — build at root
                log_build(pool, &job.id, "info", "build", "Rust/IC canister build (cargo build --target wasm32-unknown-unknown --release)").await;
                run_cmd(
                    &work_dir,
                    &[
                        "cargo",
                        "build",
                        "--target",
                        "wasm32-unknown-unknown",
                        "--release",
                    ],
                )
                .await?;
            }

            // Pre-provision: ensure all canisters exist on IC before building,
            // so we can inject canister IDs as env vars into build commands.
            let mut canister_id_map: std::collections::HashMap<String, String> =
                std::collections::HashMap::new();

            if !canister_configs.is_empty() {
                let ic_pem = config.ic_identity_pem.as_deref().ok_or_else(|| {
                    "IC_IDENTITY_PEM not configured — cannot provision canisters".to_string()
                })?;
                let client = IcClient::new(ic_pem, &config.ic_url)
                    .await
                    .map_err(|e| format!("Failed to create IC agent: {e}"))?;

                for cc in &canister_configs {
                    let canister_row = sqlx::query_as::<_, (String, Option<String>, String)>(
                        "SELECT id, canister_id, type FROM canisters WHERE project_id = $1 AND name = $2"
                    )
                    .bind(&job.project_id)
                    .bind(&cc.name)
                    .fetch_optional(pool)
                    .await
                    .map_err(|e| format!("DB error looking up canister {}: {e}", cc.name))?;

                    if let Some((canister_db_id, existing_id, _)) = canister_row {
                        if let Some(cid) = existing_id {
                            log_build(
                                pool,
                                &job.id,
                                "info",
                                "provision",
                                &format!("Canister '{}' already exists: {cid}", cc.name),
                            )
                            .await;
                            canister_id_map.insert(cc.name.clone(), cid);
                        } else {
                            log_build(
                                pool,
                                &job.id,
                                "info",
                                "provision",
                                &format!("Creating canister '{}' on IC...", cc.name),
                            )
                            .await;
                            let cid = client.create_canister().await.map_err(|e| {
                                format!("Failed to create canister '{}': {e}", cc.name)
                            })?;
                            log_build(
                                pool,
                                &job.id,
                                "info",
                                "provision",
                                &format!("Created canister '{}': {cid}", cc.name),
                            )
                            .await;

                            let _ = sqlx::query("UPDATE canisters SET canister_id = $1, status = 'created', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $2")
                                .bind(&cid)
                                .bind(&canister_db_id)
                                .execute(pool)
                                .await;

                            canister_id_map.insert(cc.name.clone(), cid);
                        }
                    } else {
                        log_build(
                            pool,
                            &job.id,
                            "warn",
                            "provision",
                            &format!("No canister record for '{}' in project — skipping", cc.name),
                        )
                        .await;
                    }
                }
            }

            for cc in &canister_configs {
                let canister_dir = format!("{work_dir}/{}", cc.name);
                let recipe = cc.recipe_type.as_deref().unwrap_or("unknown");

                if recipe.contains("rust") {
                    log_build(
                        pool,
                        &job.id,
                        "info",
                        "build",
                        &format!("Building Rust canister: {}", cc.name),
                    )
                    .await;
                    run_cmd(
                        &canister_dir,
                        &[
                            "cargo",
                            "build",
                            "--target",
                            "wasm32-unknown-unknown",
                            "--release",
                        ],
                    )
                    .await?;
                } else if recipe.contains("asset-canister") || recipe.contains("asset") {
                    // Build env vars: inject all canister IDs as CANISTER_ID_<NAME>=<id>
                    let mut env_vars: Vec<(String, String)> = Vec::new();
                    for (name, cid) in &canister_id_map {
                        let env_name =
                            format!("CANISTER_ID_{}", name.to_uppercase().replace('-', "_"));
                        env_vars.push((env_name, cid.clone()));
                    }

                    // Run build commands with canister IDs injected
                    for cmd in &cc.build_commands {
                        log_build(
                            pool,
                            &job.id,
                            "info",
                            "build",
                            &format!("[{}] Running: {cmd}", cc.name),
                        )
                        .await;
                        run_cmd_with_env(&canister_dir, &["sh", "-c", cmd], &env_vars).await?;
                    }

                    // Download the asset canister wasm from dfinity SDK
                    let version = cc
                        .asset_version
                        .as_deref()
                        .unwrap_or(DEFAULT_ASSET_CANISTER_VERSION);
                    log_build(
                        pool,
                        &job.id,
                        "info",
                        "build",
                        &format!(
                            "[{}] Downloading asset canister wasm (SDK v{version})",
                            cc.name
                        ),
                    )
                    .await;

                    let wasm_gz_path =
                        format!("{work_dir}/.icforge-cache/{}_assetstorage.wasm.gz", cc.name);
                    download_asset_canister_wasm(version, &wasm_gz_path)
                        .await
                        .map_err(|e| format!("Failed to download asset canister wasm: {e}"))?;

                    let size = tokio::fs::metadata(&wasm_gz_path)
                        .await
                        .map(|m| m.len())
                        .unwrap_or(0);
                    log_build(
                        pool,
                        &job.id,
                        "info",
                        "build",
                        &format!(
                            "[{}] Asset canister wasm: {} bytes (gzipped)",
                            cc.name, size
                        ),
                    )
                    .await;
                } else if recipe == "unknown" {
                    // No canister.yaml — check for Cargo.toml
                    if tokio::fs::metadata(format!("{canister_dir}/Cargo.toml"))
                        .await
                        .is_ok()
                    {
                        log_build(
                            pool,
                            &job.id,
                            "info",
                            "build",
                            &format!("Building Rust canister: {}", cc.name),
                        )
                        .await;
                        run_cmd(
                            &canister_dir,
                            &[
                                "cargo",
                                "build",
                                "--target",
                                "wasm32-unknown-unknown",
                                "--release",
                            ],
                        )
                        .await?;
                    } else {
                        log_build(
                            pool,
                            &job.id,
                            "warn",
                            "build",
                            &format!("Unknown recipe for canister: {}", cc.name),
                        )
                        .await;
                    }
                }
            }
        }
        _ => {
            log_build(
                pool,
                &job.id,
                "warn",
                "build",
                &format!("Unknown framework '{framework_name}' — skipping build step"),
            )
            .await;
        }
    }

    // Phase: deploy
    log_build(pool, &job.id, "info", "deploy", "Deploying to IC...").await;

    let ic_pem = config
        .ic_identity_pem
        .as_deref()
        .ok_or_else(|| "IC_IDENTITY_PEM not configured — cannot deploy".to_string())?;

    let client = IcClient::new(ic_pem, &config.ic_url)
        .await
        .map_err(|e| format!("Failed to create IC agent: {e}"))?;

    // For icp.yaml projects, deploy using parsed canister configs
    let canister_configs = parse_icp_yaml(&work_dir).await;
    let use_config_deploy = !canister_configs.is_empty();

    if use_config_deploy {
        // Phase 1: Install code on all canisters
        // We track which canisters are asset canisters for Phase 3 (asset sync after env binding)
        let mut asset_canisters: Vec<(String, String, String)> = Vec::new(); // (name, canister_id, canister_db_id)

        for cc in &canister_configs {
            let recipe = cc.recipe_type.as_deref().unwrap_or("unknown");
            let is_asset = recipe.contains("asset-canister") || recipe.contains("asset");

            // Determine wasm bytes
            let wasm_bytes = if is_asset {
                // Use the downloaded asset canister wasm.gz
                let wasm_gz_path =
                    format!("{work_dir}/.icforge-cache/{}_assetstorage.wasm.gz", cc.name);
                tokio::fs::read(&wasm_gz_path).await.map_err(|e| {
                    format!("Failed to read asset canister wasm for {}: {e}", cc.name)
                })?
            } else if let Some(ref explicit_wasm) = cc.wasm_path {
                let full_path = format!("{work_dir}/{explicit_wasm}");
                tokio::fs::read(&full_path)
                    .await
                    .map_err(|e| format!("Failed to read wasm for {}: {e}", cc.name))?
            } else {
                // Find built wasm in target dir
                let canister_dir = format!("{work_dir}/{}", cc.name);
                let wasm_name = cc.name.replace('-', "_");
                let wasm_path = format!(
                    "{canister_dir}/target/wasm32-unknown-unknown/release/{wasm_name}.wasm"
                );
                if let Ok(bytes) = tokio::fs::read(&wasm_path).await {
                    bytes
                } else {
                    // Try workspace-level target dir
                    let workspace_wasm = format!(
                        "{work_dir}/target/wasm32-unknown-unknown/release/{wasm_name}.wasm"
                    );
                    tokio::fs::read(&workspace_wasm)
                        .await
                        .map_err(|e| format!("No wasm found for canister {}: {e}", cc.name))?
                }
            };

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!(
                    "Deploying {}: {} bytes{}",
                    cc.name,
                    wasm_bytes.len(),
                    if is_asset {
                        " (gzipped asset canister)"
                    } else {
                        ""
                    }
                ),
            )
            .await;

            // Look up canister in DB
            let canister_row = sqlx::query_as::<_, (String, Option<String>, String)>(
                "SELECT id, canister_id, type FROM canisters WHERE project_id = $1 AND name = $2",
            )
            .bind(&job.project_id)
            .bind(&cc.name)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("DB error looking up canister {}: {e}", cc.name))?;

            let (canister_db_id, existing_canister_id, _canister_type) = match canister_row {
                Some(row) => row,
                None => {
                    log_build(
                        pool,
                        &job.id,
                        "warn",
                        "deploy",
                        &format!("No canister record for '{}' in project — skipping", cc.name),
                    )
                    .await;
                    continue;
                }
            };

            // Create or upgrade canister
            let (canister_id, is_upgrade) = if let Some(cid) = existing_canister_id {
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    &format!("Upgrading existing canister: {cid}"),
                )
                .await;
                (cid, true)
            } else {
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    "Creating new canister on IC...",
                )
                .await;
                let cid = client
                    .create_canister()
                    .await
                    .map_err(|e| format!("Failed to create canister: {e}"))?;
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    &format!("Created canister: {cid}"),
                )
                .await;

                let _ = sqlx::query("UPDATE canisters SET canister_id = $1, status = 'created', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $2")
                    .bind(&cid)
                    .bind(&canister_db_id)
                    .execute(pool)
                    .await;

                (cid, false)
            };

            // Install code
            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("Installing code on {canister_id}..."),
            )
            .await;
            client
                .install_code(&canister_id, wasm_bytes, is_upgrade, None)
                .await
                .map_err(|e| format!("install_code failed for {canister_id}: {e}"))?;

            // Track asset canisters for Phase 3 (sync after env binding)
            if is_asset {
                asset_canisters.push((
                    cc.name.clone(),
                    canister_id.clone(),
                    canister_db_id.clone(),
                ));
            }

            // Update canister status
            let _ = sqlx::query("UPDATE canisters SET status = 'running', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1")
                .bind(&canister_db_id)
                .execute(pool)
                .await;

            // Create deployment record
            let deploy_id = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO deployments (id, project_id, canister_name, status, commit_sha, commit_message, branch, repo_full_name, started_at, completed_at) VALUES ($1, $2, $3, 'succeeded', $4, $5, $6, $7, to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'), to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))"
            )
            .bind(&deploy_id)
            .bind(&job.project_id)
            .bind(&cc.name)
            .bind(&job.commit_sha)
            .bind(&format!("Auto-deploy from push to {}", job.branch))
            .bind(&job.branch)
            .bind(&job.repo_full_name)
            .execute(pool)
            .await;

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("✅ Canister {} deployed to {canister_id}", cc.name),
            )
            .await;

            // Write per-canister subdomain mapping to Cloudflare KV (best-effort)
            let canister_slug = format!("{}.{}", cc.name, project_slug);
            if let Err(e) =
                crate::cloudflare::kv_write(config, &canister_slug, &canister_id, &job.project_id)
                    .await
            {
                tracing::warn!(
                    build_job_id = %job.id,
                    slug = %canister_slug,
                    error = %e,
                    "Failed to write Cloudflare KV subdomain mapping (non-fatal)"
                );
            }
        }

        // Phase 2: bind environment variables (PUBLIC_CANISTER_ID:<name> on each canister)
        // Re-query all canister IDs from DB to build the complete map
        let all_canisters = sqlx::query_as::<_, (String, Option<String>)>(
            "SELECT name, canister_id FROM canisters WHERE project_id = $1",
        )
        .bind(&job.project_id)
        .fetch_all(pool)
        .await
        .map_err(|e| format!("DB error fetching canisters for env binding: {e}"))?;

        let binding_vars: Vec<EnvironmentVariable> = all_canisters
            .iter()
            .filter_map(|(name, cid)| {
                cid.as_ref().map(|id| EnvironmentVariable {
                    name: format!("PUBLIC_CANISTER_ID:{name}"),
                    value: id.clone(),
                })
            })
            .collect();

        if !binding_vars.is_empty() {
            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!(
                    "Binding {} env vars to canisters: {}",
                    binding_vars.len(),
                    binding_vars
                        .iter()
                        .map(|v| format!("{}={}", v.name, v.value))
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            )
            .await;

            for (name, cid) in &all_canisters {
                if let Some(canister_id) = cid {
                    log_build(
                        pool,
                        &job.id,
                        "info",
                        "deploy",
                        &format!("Setting env vars on {name} ({canister_id})..."),
                    )
                    .await;
                    client
                        .update_settings(canister_id, binding_vars.clone())
                        .await
                        .map_err(|e| {
                            format!("update_settings failed for {name} ({canister_id}): {e}")
                        })?;
                }
            }

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                "✅ Environment variables bound to all canisters",
            )
            .await;
        }

        // Phase 3: Sync assets AFTER env vars are bound
        // The asset canister bakes env vars into the ic_env cookie during commit_batch,
        // so env vars must be set before syncing assets.
        for (asset_name, canister_id, _canister_db_id) in &asset_canisters {
            // Find the matching canister config to get asset_dir
            if let Some(cc) = canister_configs.iter().find(|c| &c.name == asset_name) {
                if let Some(ref asset_dir) = cc.asset_dir {
                    let full_asset_dir = format!("{work_dir}/{}/{asset_dir}", cc.name);
                    if tokio::fs::metadata(&full_asset_dir).await.is_ok() {
                        log_build(
                            pool,
                            &job.id,
                            "info",
                            "deploy",
                            &format!("Syncing assets from {asset_dir} to {canister_id}..."),
                        )
                        .await;

                        sync_assets(&client, canister_id, &full_asset_dir)
                            .await
                            .map_err(|e| format!("Asset sync failed for {canister_id}: {e}"))?;

                        log_build(
                            pool,
                            &job.id,
                            "info",
                            "deploy",
                            &format!("Assets synced to {canister_id}"),
                        )
                        .await;
                    } else {
                        log_build(
                            pool,
                            &job.id,
                            "warn",
                            "deploy",
                            &format!("Asset dir '{asset_dir}' not found — skipping sync"),
                        )
                        .await;
                    }
                } else {
                    log_build(
                        pool,
                        &job.id,
                        "warn",
                        "deploy",
                        &format!(
                            "No asset dir configured for {} — wasm installed but no assets synced",
                            cc.name
                        ),
                    )
                    .await;
                }
            }
        }
    } else {
        // Fallback: find all wasm files and deploy each one (non-icp.yaml projects)
        let wasm_files = find_all_wasms(&work_dir).await;
        if wasm_files.is_empty() {
            log_build(
                pool,
                &job.id,
                "warn",
                "deploy",
                "No .wasm files found after build",
            )
            .await;
        }

        for (canister_name, wasm_path) in &wasm_files {
            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("Deploying canister: {canister_name} ({wasm_path})"),
            )
            .await;

            let canister_row = sqlx::query_as::<_, (String, Option<String>, String)>(
                "SELECT id, canister_id, type FROM canisters WHERE project_id = $1 AND name = $2",
            )
            .bind(&job.project_id)
            .bind(canister_name)
            .fetch_optional(pool)
            .await
            .map_err(|e| format!("DB error looking up canister: {e}"))?;

            let (canister_db_id, existing_canister_id, _canister_type) = match canister_row {
                Some(row) => row,
                None => {
                    log_build(
                        pool,
                        &job.id,
                        "warn",
                        "deploy",
                        &format!("No canister record for '{canister_name}' in project — skipping"),
                    )
                    .await;
                    continue;
                }
            };

            let wasm_bytes = tokio::fs::read(wasm_path)
                .await
                .map_err(|e| format!("Failed to read wasm {wasm_path}: {e}"))?;

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("Wasm size: {} bytes", wasm_bytes.len()),
            )
            .await;

            let (canister_id, is_upgrade) = if let Some(cid) = existing_canister_id {
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    &format!("Upgrading existing canister: {cid}"),
                )
                .await;
                (cid, true)
            } else {
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    "Creating new canister on IC...",
                )
                .await;
                let cid = client
                    .create_canister()
                    .await
                    .map_err(|e| format!("Failed to create canister: {e}"))?;
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "deploy",
                    &format!("Created canister: {cid}"),
                )
                .await;

                let _ = sqlx::query("UPDATE canisters SET canister_id = $1, status = 'created', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $2")
                    .bind(&cid)
                    .bind(&canister_db_id)
                    .execute(pool)
                    .await;

                (cid, false)
            };

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("Installing code on {canister_id}..."),
            )
            .await;
            client
                .install_code(&canister_id, wasm_bytes, is_upgrade, None)
                .await
                .map_err(|e| format!("install_code failed for {canister_id}: {e}"))?;

            let _ = sqlx::query("UPDATE canisters SET status = 'running', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $1")
                .bind(&canister_db_id)
                .execute(pool)
                .await;

            let deploy_id = uuid::Uuid::new_v4().to_string();
            let _ = sqlx::query(
                "INSERT INTO deployments (id, project_id, canister_name, status, commit_sha, commit_message, branch, repo_full_name, started_at, completed_at) VALUES ($1, $2, $3, 'succeeded', $4, $5, $6, $7, to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'), to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))"
            )
            .bind(&deploy_id)
            .bind(&job.project_id)
            .bind(canister_name)
            .bind(&job.commit_sha)
            .bind(&format!("Auto-deploy from push to {}", job.branch))
            .bind(&job.branch)
            .bind(&job.repo_full_name)
            .execute(pool)
            .await;

            log_build(
                pool,
                &job.id,
                "info",
                "deploy",
                &format!("✅ Canister {canister_name} deployed to {canister_id}"),
            )
            .await;

            // Write per-canister subdomain mapping to Cloudflare KV (best-effort)
            let canister_slug = format!("{canister_name}.{project_slug}");
            if let Err(e) =
                crate::cloudflare::kv_write(config, &canister_slug, &canister_id, &job.project_id)
                    .await
            {
                tracing::warn!(
                    build_job_id = %job.id,
                    slug = %canister_slug,
                    error = %e,
                    "Failed to write Cloudflare KV subdomain mapping (non-fatal)"
                );
            }
        }
    }

    // Cleanup
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    log_build(pool, &job.id, "info", "complete", "Build complete").await;
    Ok(())
}

/// Parse icp.yaml and each canister's canister.yaml to build CanisterConfig list.
async fn parse_icp_yaml(work_dir: &str) -> Vec<CanisterConfig> {
    let icp_yaml_path = format!("{work_dir}/icp.yaml");
    let content = match tokio::fs::read_to_string(&icp_yaml_path).await {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let mut configs = vec![];

    // Parse the YAML-like icp.yaml to extract canister names
    // icp.yaml format:
    //   canisters:
    //     - backend
    //     - frontend
    // OR:
    //   canisters:
    //     - name: backend
    //       ...
    let mut in_canisters = false;
    for line in content.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("canisters:") || trimmed == "canisters" {
            in_canisters = true;
            continue;
        }

        if !in_canisters {
            continue;
        }

        // End of canisters section if we hit a non-indented, non-list line
        if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.starts_with('-') {
            break;
        }

        // Extract canister name from list item
        let entry = trimmed.trim_start_matches('-').trim();
        if entry.is_empty() || entry.starts_with('#') {
            continue;
        }

        // Could be a simple string like "backend" or "name: backend"
        let canister_name = if entry.starts_with("name:") {
            entry
                .trim_start_matches("name:")
                .trim()
                .trim_matches('"')
                .trim_matches('\'')
                .to_string()
        } else if entry.contains(':') {
            // Skip non-name key:value pairs
            continue;
        } else {
            entry.trim_matches('"').trim_matches('\'').to_string()
        };

        if canister_name.is_empty() {
            continue;
        }

        // Read canister.yaml for this canister
        let canister_yaml_path = format!("{work_dir}/{canister_name}/canister.yaml");
        let mut cc = CanisterConfig {
            name: canister_name.clone(),
            recipe_type: None,
            asset_dir: None,
            asset_version: None,
            build_commands: vec![],
            wasm_path: None,
        };

        if let Ok(cy_content) = tokio::fs::read_to_string(&canister_yaml_path).await {
            // Parse canister.yaml fields
            for cy_line in cy_content.lines() {
                let cy_trimmed = cy_line.trim();

                // recipe type: e.g. type: "@dfinity/asset-canister@v2.1.0"
                if cy_trimmed.starts_with("type:") {
                    let val = cy_trimmed
                        .trim_start_matches("type:")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    cc.recipe_type = Some(val.to_string());
                }

                // asset dir: e.g. dir: dist
                if cy_trimmed.starts_with("dir:") {
                    let val = cy_trimmed
                        .trim_start_matches("dir:")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    cc.asset_dir = Some(val.to_string());
                }

                // SDK version: e.g. version: 0.30.2
                if cy_trimmed.starts_with("version:") {
                    let val = cy_trimmed
                        .trim_start_matches("version:")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    cc.asset_version = Some(val.to_string());
                }

                // wasm path: e.g. wasm: target/wasm32-unknown-unknown/release/backend.wasm
                if cy_trimmed.starts_with("wasm:") {
                    let val = cy_trimmed
                        .trim_start_matches("wasm:")
                        .trim()
                        .trim_matches('"')
                        .trim_matches('\'');
                    cc.wasm_path = Some(val.to_string());
                }

                // build commands: e.g. - npm install
                // These are under the `build:` section as list items
                if cy_trimmed.starts_with("- ") && cy_content.contains("build:") {
                    // Crude: collect list items that appear after "build:" line
                    // Better parsing would use a proper YAML parser, but this handles the common case
                }
            }

            // Second pass: extract build commands (items under build: section)
            let mut in_build = false;
            for cy_line in cy_content.lines() {
                let cy_trimmed = cy_line.trim();
                if cy_trimmed == "build:" || cy_trimmed.starts_with("build:") {
                    in_build = true;
                    continue;
                }
                if in_build {
                    if cy_trimmed.starts_with("- ") {
                        let cmd = cy_trimmed
                            .trim_start_matches("- ")
                            .trim()
                            .trim_matches('"')
                            .trim_matches('\'');
                        if !cmd.is_empty() {
                            cc.build_commands.push(cmd.to_string());
                        }
                    } else if !cy_trimmed.is_empty()
                        && !cy_line.starts_with(' ')
                        && !cy_line.starts_with('\t')
                    {
                        in_build = false;
                    }
                }
            }

            // If no recipe_type set but canister.yaml exists, try to infer from content
            if cc.recipe_type.is_none() {
                if cy_content.contains("asset-canister") || cy_content.contains("asset") {
                    cc.recipe_type = Some("asset-canister".into());
                } else if cy_content.contains("rust") {
                    cc.recipe_type = Some("rust".into());
                }
            }
        } else {
            // No canister.yaml — mark as unknown
            cc.recipe_type = Some("unknown".into());
        }

        configs.push(cc);
    }

    configs
}

/// Download the official IC asset canister wasm.gz from the dfinity SDK releases.
async fn download_asset_canister_wasm(version: &str, dest_path: &str) -> Result<(), String> {
    let url = format!(
        "https://github.com/dfinity/sdk/raw/refs/tags/{version}/src/distributed/assetstorage.wasm.gz"
    );

    // Create parent dir
    if let Some(parent) = std::path::Path::new(dest_path).parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create cache dir: {e}"))?;
    }

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to download asset canister wasm from {url}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Failed to download asset canister wasm: HTTP {} from {url}",
            resp.status()
        ));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read asset canister wasm response: {e}"))?;

    if bytes.len() < 1000 {
        return Err(format!(
            "Asset canister wasm too small ({} bytes) — likely a 404 page. Check SDK version {version}",
            bytes.len()
        ));
    }

    tokio::fs::write(dest_path, &bytes)
        .await
        .map_err(|e| format!("Failed to write asset canister wasm to {dest_path}: {e}"))?;

    Ok(())
}

/// Sync static assets to an IC asset canister using ic_asset::sync.
async fn sync_assets(client: &IcClient, canister_id: &str, assets_dir: &str) -> Result<(), String> {
    let canister_principal = candid::Principal::from_text(canister_id)
        .map_err(|e| format!("Invalid canister principal for asset sync: {e}"))?;

    let canister = ic_utils::Canister::builder()
        .with_canister_id(canister_principal)
        .with_agent(client.agent())
        .build()
        .map_err(|e| format!("Failed to build Canister object for asset sync: {e}"))?;

    let logger = slog::Logger::root(slog::Discard, slog::o!());
    let assets_path = std::path::PathBuf::from(assets_dir);

    ic_asset::sync(&canister, &[assets_path.as_path()], false, &logger, None)
        .await
        .map_err(|e| format!("ic_asset::sync failed: {e}"))?;

    Ok(())
}

async fn log_build(pool: &DbPool, job_id: &str, level: &str, phase: &str, message: &str) {
    tracing::info!(job_id = job_id, phase = phase, "{}", message);
    let _ = sqlx::query(
        "INSERT INTO build_logs (build_job_id, level, message, phase) VALUES ($1, $2, $3, $4)",
    )
    .bind(job_id)
    .bind(level)
    .bind(message)
    .bind(phase)
    .execute(pool)
    .await;
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

async fn run_cmd_with_env(
    work_dir: &str,
    args: &[&str],
    env_vars: &[(String, String)],
) -> Result<String, String> {
    use tokio::process::Command;

    let _ = tokio::fs::create_dir_all(work_dir).await;

    let mut cmd = Command::new(args[0]);
    cmd.args(&args[1..]).current_dir(work_dir);

    for (key, val) in env_vars {
        cmd.env(key, val);
    }

    let output = cmd
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

async fn detect_framework(work_dir: &str) -> Option<String> {
    use tokio::fs;

    // Check for icp.yaml (icp-js project — the standard going forward)
    if fs::metadata(format!("{work_dir}/icp.yaml")).await.is_ok() {
        // Read icp.yaml and check canister.yaml files for recipe types
        if let Ok(content) = fs::read_to_string(format!("{work_dir}/icp.yaml")).await {
            // Check for Rust canisters by looking at canister dirs
            if content.contains("rust") {
                return Some("rust".into());
            }
            // Parse canister list — entries can be strings (dir names) or objects
            // Check each canister dir for canister.yaml
            for line in content.lines() {
                let trimmed = line.trim().trim_start_matches('-').trim();
                if !trimmed.is_empty()
                    && !trimmed.starts_with('#')
                    && !trimmed.contains(':')
                    && !trimmed.starts_with("canisters")
                {
                    let canister_yaml = format!("{work_dir}/{trimmed}/canister.yaml");
                    if let Ok(cy) = fs::read_to_string(&canister_yaml).await {
                        if cy.contains("rust") {
                            return Some("rust".into());
                        }
                        if cy.contains("asset-canister") || cy.contains("asset") {
                            // Has assets but keep looking for rust
                            continue;
                        }
                    }
                }
            }
            // Fallback: treat icp.yaml projects as icp-js
            return Some("icp".into());
        }
    }

    // Check for dfx.json (Motoko/IC project)
    if fs::metadata(format!("{work_dir}/dfx.json")).await.is_ok() {
        // Read dfx.json to detect Motoko vs Rust
        if let Ok(content) = fs::read_to_string(format!("{work_dir}/dfx.json")).await {
            if content.contains("\"type\": \"motoko\"") || content.contains("\"type\":\"motoko\"") {
                return Some("motoko".into());
            }
            if content.contains("\"type\": \"rust\"") || content.contains("\"type\":\"rust\"") {
                return Some("rust".into());
            }
            if content.contains("\"type\": \"assets\"") || content.contains("\"type\":\"assets\"") {
                return Some("assets".into());
            }
        }
    }

    // Check for Cargo.toml (Rust)
    if fs::metadata(format!("{work_dir}/Cargo.toml")).await.is_ok() {
        return Some("rust".into());
    }

    // Check for package.json (Node/NPM)
    if fs::metadata(format!("{work_dir}/package.json"))
        .await
        .is_ok()
    {
        return Some("npm".into());
    }

    // Check for index.html (static assets)
    if fs::metadata(format!("{work_dir}/index.html")).await.is_ok() {
        return Some("assets".into());
    }

    None
}

async fn find_wasm(work_dir: &str) -> Option<String> {
    use tokio::process::Command;

    let output = Command::new("find")
        .args([work_dir, "-name", "*.wasm", "-type", "f"])
        .output()
        .await
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout.lines().next().map(|s| s.to_string())
}

/// Find all .wasm files and map them to canister names.
/// Returns Vec<(canister_name, wasm_path)>.
async fn find_all_wasms(work_dir: &str) -> Vec<(String, String)> {
    use tokio::process::Command;

    let output = match Command::new("find")
        .args([work_dir, "-name", "*.wasm", "-type", "f"])
        .output()
        .await
    {
        Ok(o) => o,
        Err(_) => return vec![],
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut results = vec![];

    for line in stdout.lines() {
        let path = line.trim();
        if path.is_empty() {
            continue;
        }
        // Skip deps/ and build/ wasms — only want the actual canister output
        if path.contains("/deps/") || path.contains("/build/") || path.contains("/.cargo/") {
            continue;
        }
        // Extract canister name from wasm filename (e.g., backend.wasm -> backend)
        if let Some(filename) = path.rsplit('/').next() {
            if let Some(name) = filename.strip_suffix(".wasm") {
                // Skip names with hashes (e.g., backend-abc123.wasm)
                if !name.contains('-') || name.starts_with("ic_") {
                    results.push((name.replace('_', "-").to_string(), path.to_string()));
                } else {
                    // Could be a hyphenated name like "my-canister" — use as-is
                    results.push((name.to_string(), path.to_string()));
                }
            }
        }
    }

    results
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}
