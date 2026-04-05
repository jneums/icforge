use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
};
use serde_json::Value;

use crate::error::AppError;
use crate::github;
use crate::models::GitHubInstallation;
use crate::AppState;

/// Webhook receiver — verifies signature and routes events.
pub async fn handle_webhook(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, AppError> {
    // Verify signature
    let secret = state
        .config
        .github_webhook_secret
        .as_ref()
        .ok_or_else(|| AppError::Internal("GITHUB_WEBHOOK_SECRET not configured".into()))?;

    let signature = headers
        .get("X-Hub-Signature-256")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| AppError::BadRequest("Missing X-Hub-Signature-256 header".into()))?;

    if !github::verify_webhook_signature(secret, &body, signature) {
        return Err(AppError::Unauthorized("Invalid webhook signature".into()));
    }

    let event_type = headers
        .get("X-GitHub-Event")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown");

    let payload: Value = serde_json::from_slice(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON payload: {e}")))?;

    tracing::info!(event = event_type, "Received GitHub webhook");

    match event_type {
        "push" => handle_push(state, payload).await?,
        "pull_request" => handle_pull_request(state, payload).await?,
        "installation" => handle_installation(state, payload).await?,
        "installation_repositories" => handle_repos_changed(state, payload).await?,
        _ => {
            tracing::debug!(event = event_type, "Ignoring unknown webhook event");
        }
    }

    Ok(StatusCode::OK)
}

// ============================================================
// Push — trigger production build
// ============================================================

async fn handle_push(state: AppState, payload: Value) -> Result<(), AppError> {
    let repo_full_name = payload["repository"]["full_name"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Missing repository.full_name".into()))?;

    let branch_ref = payload["ref"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Missing ref".into()))?;

    // Extract branch name from "refs/heads/main"
    let branch = branch_ref
        .strip_prefix("refs/heads/")
        .unwrap_or(branch_ref);

    let commit_sha = payload["head_commit"]["id"]
        .as_str()
        .or_else(|| payload["after"].as_str())
        .ok_or_else(|| AppError::BadRequest("Missing commit SHA".into()))?;

    let installation_id = payload["installation"]["id"]
        .as_i64()
        .ok_or_else(|| AppError::BadRequest("Missing installation.id".into()))?;

    tracing::info!(
        repo = repo_full_name,
        branch = branch,
        sha = &commit_sha[..7],
        "Push event"
    );

    // Look up project linked to this repo + branch
    let project = sqlx::query_as::<_, crate::models::Project>(
        r#"
        SELECT p.* FROM projects p
        JOIN github_repos gr ON p.github_repo_id = gr.id
        WHERE gr.full_name = $1 AND p.production_branch = $2
        "#,
    )
    .bind(repo_full_name)
    .bind(branch)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let project = match project {
        Some(p) => p,
        None => {
            tracing::debug!(
                repo = repo_full_name,
                branch = branch,
                "No project linked to this repo/branch, skipping"
            );
            return Ok(());
        }
    };

    // Cancel any pending builds for this project (deduplication)
    sqlx::query(
        "UPDATE build_jobs SET status = 'cancelled', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE project_id = $1 AND status = 'pending'"
    )
    .bind(&project.id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Enqueue build job
    let job_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        r#"
        INSERT INTO build_jobs (id, project_id, commit_sha, branch, repo_full_name, installation_id, trigger, status)
        VALUES ($1, $2, $3, $4, $5, $6, 'push', 'pending')
        "#,
    )
    .bind(&job_id)
    .bind(&project.id)
    .bind(commit_sha)
    .bind(branch)
    .bind(repo_full_name)
    .bind(installation_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    tracing::info!(job_id = job_id, project = project.name, "Build job enqueued");

    Ok(())
}

// ============================================================
// Pull Request — trigger preview build or cleanup
// ============================================================

async fn handle_pull_request(state: AppState, payload: Value) -> Result<(), AppError> {
    let action = payload["action"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Missing action".into()))?;

    let repo_full_name = payload["repository"]["full_name"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Missing repository.full_name".into()))?;

    let pr_number = payload["pull_request"]["number"]
        .as_i64()
        .ok_or_else(|| AppError::BadRequest("Missing pull_request.number".into()))? as i32;

    let installation_id = payload["installation"]["id"]
        .as_i64()
        .ok_or_else(|| AppError::BadRequest("Missing installation.id".into()))?;

    tracing::info!(
        repo = repo_full_name,
        pr = pr_number,
        action = action,
        "Pull request event"
    );

    match action {
        "opened" | "synchronize" => {
            let branch = payload["pull_request"]["head"]["ref"]
                .as_str()
                .unwrap_or("unknown");
            let commit_sha = payload["pull_request"]["head"]["sha"]
                .as_str()
                .ok_or_else(|| AppError::BadRequest("Missing head SHA".into()))?;

            // Find project for this repo
            let project = sqlx::query_as::<_, crate::models::Project>(
                r#"
                SELECT p.* FROM projects p
                JOIN github_repos gr ON p.github_repo_id = gr.id
                WHERE gr.full_name = $1
                "#,
            )
            .bind(repo_full_name)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

            if let Some(project) = project {
                // Cancel any pending preview builds for this PR
                sqlx::query(
                    "UPDATE build_jobs SET status = 'cancelled', updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE project_id = $1 AND pr_number = $2 AND status = 'pending'"
                )
                .bind(&project.id)
                .bind(pr_number)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;

                // Enqueue preview build
                let job_id = uuid::Uuid::new_v4().to_string();
                sqlx::query(
                    r#"
                    INSERT INTO build_jobs (id, project_id, commit_sha, branch, repo_full_name, installation_id, trigger, pr_number, status)
                    VALUES ($1, $2, $3, $4, $5, $6, 'pull_request', $7, 'pending')
                    "#,
                )
                .bind(&job_id)
                .bind(&project.id)
                .bind(commit_sha)
                .bind(branch)
                .bind(repo_full_name)
                .bind(installation_id)
                .bind(pr_number)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;

                tracing::info!(
                    job_id = job_id,
                    project = project.name,
                    pr = pr_number,
                    "Preview build job enqueued"
                );
            }
        }
        "closed" => {
            // TODO: Cleanup preview canisters (spec 013)
            tracing::info!(
                repo = repo_full_name,
                pr = pr_number,
                "PR closed — preview cleanup will be implemented with spec 013"
            );
        }
        _ => {
            tracing::debug!(action = action, "Ignoring PR action");
        }
    }

    Ok(())
}

// ============================================================
// Installation — app installed/uninstalled
// ============================================================

async fn handle_installation(state: AppState, payload: Value) -> Result<(), AppError> {
    let action = payload["action"]
        .as_str()
        .ok_or_else(|| AppError::BadRequest("Missing action".into()))?;

    let installation_id = payload["installation"]["id"]
        .as_i64()
        .ok_or_else(|| AppError::BadRequest("Missing installation.id".into()))?;

    let account_login = payload["installation"]["account"]["login"]
        .as_str()
        .unwrap_or("unknown");

    let account_type = payload["installation"]["account"]["type"]
        .as_str()
        .unwrap_or("User");

    tracing::info!(
        action = action,
        installation_id = installation_id,
        account = account_login,
        "Installation event"
    );

    match action {
        "created" => {
            // Store installation — we'll associate it with a user when they
            // complete the setup flow in the dashboard.
            // For now, store with a placeholder user_id that gets updated
            // when the user hits /github/setup.
            let id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO github_installations (id, user_id, installation_id, account_login, account_type)
                VALUES ($1, '__pending__', $2, $3, $4)
                ON CONFLICT (installation_id) DO UPDATE
                SET account_login = $3, account_type = $4, updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
                "#,
            )
            .bind(&id)
            .bind(installation_id)
            .bind(account_login)
            .bind(account_type)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;

            // Store repos from the installation
            if let Some(repos) = payload["repositories"].as_array() {
                for repo in repos {
                    let repo_id = uuid::Uuid::new_v4().to_string();
                    let github_repo_id = repo["id"].as_i64().unwrap_or(0);
                    let full_name = repo["full_name"].as_str().unwrap_or("");
                    let default_branch = repo["default_branch"]
                        .as_str()
                        .unwrap_or("main");

                    // Need the installation's internal ID
                    let install_record = sqlx::query_as::<_, GitHubInstallation>(
                        "SELECT * FROM github_installations WHERE installation_id = $1",
                    )
                    .bind(installation_id)
                    .fetch_optional(&state.db)
                    .await
                    .map_err(AppError::Database)?;

                    if let Some(install) = install_record {
                        sqlx::query(
                            r#"
                            INSERT INTO github_repos (id, installation_id, github_repo_id, full_name, default_branch)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (github_repo_id) DO UPDATE
                            SET full_name = $4, default_branch = $5
                            "#,
                        )
                        .bind(&repo_id)
                        .bind(&install.id)
                        .bind(github_repo_id)
                        .bind(full_name)
                        .bind(default_branch)
                        .execute(&state.db)
                        .await
                        .map_err(AppError::Database)?;
                    }
                }
            }
        }
        "deleted" => {
            // Remove installation and associated repos
            // (projects linked to these repos won't auto-build anymore)
            sqlx::query(
                "DELETE FROM github_repos WHERE installation_id IN (SELECT id FROM github_installations WHERE installation_id = $1)"
            )
            .bind(installation_id)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;

            sqlx::query("DELETE FROM github_installations WHERE installation_id = $1")
                .bind(installation_id)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;

            tracing::info!(
                installation_id = installation_id,
                "Installation removed"
            );
        }
        _ => {}
    }

    Ok(())
}

// ============================================================
// Installation repositories changed
// ============================================================

async fn handle_repos_changed(state: AppState, payload: Value) -> Result<(), AppError> {
    let installation_id = payload["installation"]["id"]
        .as_i64()
        .ok_or_else(|| AppError::BadRequest("Missing installation.id".into()))?;

    let install = sqlx::query_as::<_, GitHubInstallation>(
        "SELECT * FROM github_installations WHERE installation_id = $1",
    )
    .bind(installation_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let install = match install {
        Some(i) => i,
        None => {
            tracing::warn!(
                installation_id = installation_id,
                "Repos changed for unknown installation"
            );
            return Ok(());
        }
    };

    // Add new repos
    if let Some(added) = payload["repositories_added"].as_array() {
        for repo in added {
            let repo_id = uuid::Uuid::new_v4().to_string();
            let github_repo_id = repo["id"].as_i64().unwrap_or(0);
            let full_name = repo["full_name"].as_str().unwrap_or("");
            let default_branch = repo["default_branch"]
                .as_str()
                .unwrap_or("main");

            sqlx::query(
                r#"
                INSERT INTO github_repos (id, installation_id, github_repo_id, full_name, default_branch)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (github_repo_id) DO UPDATE
                SET full_name = $4, default_branch = $5
                "#,
            )
            .bind(&repo_id)
            .bind(&install.id)
            .bind(github_repo_id)
            .bind(full_name)
            .bind(default_branch)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;
        }
    }

    // Remove repos
    if let Some(removed) = payload["repositories_removed"].as_array() {
        for repo in removed {
            let github_repo_id = repo["id"].as_i64().unwrap_or(0);
            sqlx::query("DELETE FROM github_repos WHERE github_repo_id = $1")
                .bind(github_repo_id)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;
        }
    }

    Ok(())
}
