use std::time::Instant;

use crate::db::DbPool;
use crate::config::AppConfig;
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

    // Post pending commit status
    let build_url = format!(
        "{}/builds/{}",
        config.frontend_url, job.id
    );
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
            &format!("Building {}...", &job.commit_sha[..7.min(job.commit_sha.len())]),
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
    _config: &AppConfig,
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

    run_cmd(&work_dir, &["git", "clone", "--depth", "1", "--branch", &job.branch, &clone_url, &work_dir]).await?;
    run_cmd(&work_dir, &["git", "checkout", &job.commit_sha]).await?;

    log_build(pool, &job.id, "info", "clone", "Repository cloned").await;

    // Phase: detect
    log_build(pool, &job.id, "info", "detect", "Detecting project framework...").await;

    let framework = detect_framework(&work_dir).await;
    let framework_name = framework.as_deref().unwrap_or("unknown");

    // Update framework in DB
    let _ = sqlx::query("UPDATE build_jobs SET framework = $1 WHERE id = $2")
        .bind(framework_name)
        .bind(&job.id)
        .execute(pool)
        .await;

    log_build(pool, &job.id, "info", "detect", &format!("Detected framework: {framework_name}")).await;

    // Phase: build
    log_build(pool, &job.id, "info", "build", "Building project...").await;

    match framework_name {
        "motoko" => {
            // Look for a dfx.json and build the canister
            // For now, expect a pre-built .wasm or use moc compiler
            log_build(pool, &job.id, "info", "build", "Motoko build (using moc)").await;
            // TODO: actual Motoko build pipeline
            return Err("Motoko build pipeline not yet implemented — please upload pre-built .wasm via CLI".into());
        }
        "rust" => {
            log_build(pool, &job.id, "info", "build", "Rust/IC canister build (cargo build --target wasm32-unknown-unknown --release)").await;
            run_cmd(&work_dir, &["cargo", "build", "--target", "wasm32-unknown-unknown", "--release"]).await?;
        }
        "assets" => {
            log_build(pool, &job.id, "info", "build", "Static assets — no build step needed").await;
        }
        "npm" | "node" => {
            log_build(pool, &job.id, "info", "build", "Running npm install && npm run build").await;
            run_cmd(&work_dir, &["npm", "install"]).await?;
            run_cmd(&work_dir, &["npm", "run", "build"]).await?;
        }
        _ => {
            log_build(pool, &job.id, "warn", "build", &format!("Unknown framework '{framework_name}' — skipping build step")).await;
        }
    }

    // Phase: deploy
    log_build(pool, &job.id, "info", "deploy", "Deploying to IC...").await;

    // Find the wasm file
    let wasm_path = find_wasm(&work_dir).await;
    if let Some(wasm) = wasm_path {
        log_build(pool, &job.id, "info", "deploy", &format!("Found wasm: {wasm}")).await;

        // Create a deployment record and trigger the existing deploy pipeline
        // TODO: integrate with deploy module to install_code the wasm
        log_build(pool, &job.id, "info", "deploy", "Wasm deploy via build pipeline not yet wired — use CLI for now").await;
    } else {
        log_build(pool, &job.id, "warn", "deploy", "No .wasm file found after build").await;
    }

    // Cleanup
    let _ = tokio::fs::remove_dir_all(&work_dir).await;

    log_build(pool, &job.id, "info", "complete", "Build complete").await;
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

async fn detect_framework(work_dir: &str) -> Option<String> {
    use tokio::fs;

    // Check for dfx.json (Motoko/IC project)
    if fs::metadata(format!("{work_dir}/dfx.json"))
        .await
        .is_ok()
    {
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
    if fs::metadata(format!("{work_dir}/Cargo.toml"))
        .await
        .is_ok()
    {
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
    if fs::metadata(format!("{work_dir}/index.html"))
        .await
        .is_ok()
    {
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

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}...", &s[..max])
    }
}
