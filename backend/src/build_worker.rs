use std::time::Instant;

use crate::config::AppConfig;
use crate::db::DbPool;
use crate::github::{self, GitHubNotifier};
use crate::models::BuildJob;

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

    // Per-canister check name for GitHub statuses + check runs
    let canister_name_ref = job.canister_name.as_deref()
        .ok_or_else(|| "BUG: build job has no canister_name".to_string())?;
    let check_name = format!("icforge/{canister_name_ref}");

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
            &check_name,
        )
        .await;

    // Create check run
    let check_run_id = notifier
        .create_check_run(
            &token,
            &job.repo_full_name,
            &job.commit_sha,
            &check_name,
            &format!(
                "Building {} @ {}...",
                canister_name_ref,
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
                    &check_name,
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
                    &check_name,
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

/// Execute the build: clone, setup icp-cli identity, hydrate .icp mappings, run `icp deploy`.
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

    // Require icp.yaml — no fallback framework detection
    let icp_yaml_path = format!("{work_dir}/icp.yaml");
    if !tokio::fs::metadata(&icp_yaml_path).await.is_ok() {
        return Err("No icp.yaml found in repository root. ICForge requires icp-cli projects.".into());
    }

    // Fetch project slug for per-canister subdomain routing
    let project_slug: String = sqlx::query_scalar("SELECT slug FROM projects WHERE id = $1")
        .bind(&job.project_id)
        .fetch_one(pool)
        .await
        .map_err(|e| format!("Failed to fetch project slug: {e}"))?;

    // Phase: setup icp-cli identity
    log_build(pool, &job.id, "info", "setup", "Setting up icp-cli identity...").await;

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

    log_build(pool, &job.id, "info", "setup", "Identity configured").await;

    // Every job targets exactly one canister — webhook fan-out guarantees this
    let canister_name = job.canister_name.as_deref()
        .ok_or_else(|| "BUG: build job has no canister_name — webhook fan-out should always set this".to_string())?;

    log_build(
        pool,
        &job.id,
        "info",
        "deploy",
        &format!("Deploying canister '{canister_name}'..."),
    )
    .await;

    // Phase: pre-provision — ensure canister has ID in DB
    log_build(pool, &job.id, "info", "provision", &format!("Pre-provisioning canister '{canister_name}'...")).await;

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
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Canister '{canister_name}' already provisioned: {cid}"),
                )
                .await;
            }
            Some((db_id, None)) => {
                // DB record exists but no canister ID — create on IC via icp-cli
                log_build(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Creating canister '{canister_name}' on IC..."),
                )
                .await;

                let output = run_cmd(
                    &work_dir,
                    &["icp", "canister", "create", canister_name, "-e", "ic", "--identity", "icforge"],
                )
                .await
                .map_err(|e| format!("Failed to create canister '{canister_name}': {e}"))?;

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

                log_build(
                    pool,
                    &job.id,
                    "info",
                    "provision",
                    &format!("Created canister '{canister_name}': {cid}"),
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
    log_build(pool, &job.id, "info", "hydrate", "Hydrating .icp mappings from DB...").await;

    let all_canisters = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT name, canister_id FROM canisters WHERE project_id = $1",
    )
    .bind(&job.project_id)
    .fetch_all(pool)
    .await
    .map_err(|e| format!("DB error fetching canisters for hydration: {e}"))?;

    let mappings_dir = format!("{work_dir}/.icp/data/mappings/ic");
    tokio::fs::create_dir_all(&mappings_dir)
        .await
        .map_err(|e| format!("Failed to create .icp mappings dir: {e}"))?;

    for (name, cid) in &all_canisters {
        if let Some(canister_id) = cid {
            let mapping_path = format!("{mappings_dir}/{name}");
            tokio::fs::write(&mapping_path, canister_id)
                .await
                .map_err(|e| format!("Failed to write mapping for {name}: {e}"))?;
        }
    }

    log_build(
        pool,
        &job.id,
        "info",
        "hydrate",
        &format!(
            "Wrote {} canister mappings to .icp/data/mappings/ic/",
            all_canisters.iter().filter(|(_, c)| c.is_some()).count()
        ),
    )
    .await;

    // Phase: deploy — run `icp deploy <canister_name>`
    let _output = run_cmd_streaming(
        pool,
        &job.id,
        &work_dir,
        &["icp", "deploy", canister_name, "-e", "ic", "--identity", "icforge"],
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

    // Create deployment record
    let deploy_id = uuid::Uuid::new_v4().to_string();
    let _ = sqlx::query(
        "INSERT INTO deployments (id, project_id, canister_name, status, commit_sha, commit_message, branch, repo_full_name, build_job_id, started_at, completed_at) VALUES ($1, $2, $3, 'succeeded', $4, $5, $6, $7, $8, to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'), to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS'))",
    )
    .bind(&deploy_id)
    .bind(&job.project_id)
    .bind(canister_name)
    .bind(&job.commit_sha)
    .bind(&job.commit_message.as_deref().unwrap_or("Auto-deploy"))
    .bind(&job.branch)
    .bind(&job.repo_full_name)
    .bind(&job.id)
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
        log_build(
            pool,
            &job.id,
            "info",
            "deploy",
            &format!("✅ Canister '{canister_name}' deployed to {cid}"),
        )
        .await;

        // Write per-canister subdomain mapping to Cloudflare KV (best-effort)
        let canister_slug = format!("{canister_name}.{project_slug}");
        if let Err(e) =
            crate::cloudflare::kv_write(config, &canister_slug, cid, &job.project_id).await
        {
            tracing::warn!(
                build_job_id = %job.id,
                slug = %canister_slug,
                error = %e,
                "Failed to write Cloudflare KV subdomain mapping (non-fatal)"
            );
        }
    } else {
        log_build(
            pool,
            &job.id,
            "info",
            "deploy",
            &format!("✅ Canister '{canister_name}' deployed (no canister ID in DB yet)"),
        )
        .await;
    }

    // Cleanup
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    log_build(pool, &job.id, "info", "complete", "Build complete").await;
    Ok(())
}

/// Parse a canister ID (principal) from icp-cli command output.
/// Looks for patterns like `canister_id: <principal>` or just a bare principal on a line.
fn parse_canister_id_from_output(output: &str) -> Option<String> {
    // Try "canister_id: xxxxx-xxxxx-..." or "Canister ID: ..."
    for line in output.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed
            .strip_prefix("canister_id:")
            .or_else(|| trimmed.strip_prefix("Canister ID:"))
        {
            let id = rest.trim().trim_matches('"');
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }

    // Fallback: look for a principal-shaped string (xxxxx-xxxxx-xxxxx-xxxxx-xxx)
    for line in output.lines() {
        let trimmed = line.trim();
        if trimmed.contains('-')
            && trimmed.len() >= 25
            && trimmed.len() <= 63
            && trimmed.chars().all(|c| c.is_alphanumeric() || c == '-')
        {
            return Some(trimmed.to_string());
        }
    }

    None
}

/// Run a command and stream its output as build log lines.
async fn run_cmd_streaming(
    pool: &DbPool,
    job_id: &str,
    work_dir: &str,
    args: &[&str],
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

    let mut all_output = String::new();

    // Stream stdout
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log_build(pool, job_id, "info", "deploy", &format!("  | {line}")).await;
            all_output.push_str(&line);
            all_output.push('\n');
        }
    }

    // Collect stderr
    let mut stderr_output = String::new();
    if let Some(stderr) = child.stderr.take() {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            log_build(pool, job_id, "warn", "deploy", &format!("  | {line}")).await;
            stderr_output.push_str(&line);
            stderr_output.push('\n');
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for {}: {e}", args[0]))?;

    if !status.success() {
        return Err(format!(
            "Command `{}` failed (exit {}):\n{stderr_output}",
            args.join(" "),
            status.code().unwrap_or(-1)
        ));
    }

    all_output.push_str(&stderr_output);
    Ok(all_output)
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

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}
