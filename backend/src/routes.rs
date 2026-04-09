use axum::{
    extract::{Path, Query, State},
    response::Redirect,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{self, AuthUser};
use crate::error::AppError;
use crate::models::{
    TriggerDeployRequest,
    ApiToken, CanisterRecord, CreateProjectRequest, CreateTokenRequest, CreateTokenResponse,
    CyclesSettingsRequest, ManualTopupRequest,
    DeploymentRecord, Project, ProjectWithCanisters,
};
use crate::AppState;

// Re-export the SSE response type so the route handler signature works
pub use crate::deploy::deploy_logs_stream;

#[derive(Debug, Deserialize)]
pub struct AuthLoginParams {
    pub redirect: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AuthCallbackParams {
    pub code: String,
    pub state: Option<String>,
}

/// GET /api/v1/auth/login — Redirects to GitHub OAuth authorize URL
///
/// If `?redirect=<url>` is provided (e.g. from the CLI), we encode it into the
/// OAuth `state` parameter so the callback can relay the JWT back to the caller.
pub async fn auth_login(
    State(state): State<AppState>,
    Query(params): Query<AuthLoginParams>,
) -> Result<Redirect, AppError> {
    let client_id = &state.config.github_client_id;
    if client_id.is_empty() {
        return Err(AppError::BadRequest(
            "GitHub OAuth is not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, or use `icforge dev-auth` for local development.".into(),
        ));
    }

    // Backend handles the OAuth callback, then redirects to the CLI's local server
    let backend_url = &state.config.backend_url;
    let redirect_uri = format!("{backend_url}/api/v1/auth/callback");

    // Encode the CLI's redirect URL into the state param so callback knows where to send the token
    let oauth_state = params.redirect.unwrap_or_default();
    let encoded_state = urlencoding::encode(&oauth_state);

    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={client_id}&redirect_uri={}&scope=user:email&state={encoded_state}",
        urlencoding::encode(&redirect_uri)
    );
    Ok(Redirect::temporary(&url))
}

/// GET /api/v1/auth/callback — GitHub OAuth callback
///
/// If the OAuth `state` param contains a redirect URL (from the CLI), we redirect
/// there with `?token=<jwt>&username=<login>` so the CLI's local server can capture it.
/// Otherwise we return JSON (for dashboard/API callers).
pub async fn auth_callback(
    State(state): State<AppState>,
    Query(params): Query<AuthCallbackParams>,
) -> Result<axum::response::Response, AppError> {
    use axum::response::IntoResponse;

    // Exchange code for GitHub access token
    let access_token = auth::exchange_github_code(
        &state.config.github_client_id,
        &state.config.github_client_secret,
        &params.code,
    )
    .await?;

    // Get GitHub user info
    let github_user = auth::get_github_user(&access_token).await?;

    // Check if user already exists
    let existing_user: Option<crate::models::User> =
        sqlx::query_as("SELECT * FROM users WHERE github_id = $1")
            .bind(github_user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    let (user_id, username) = if let Some(user) = existing_user {
        // Update existing user
        sqlx::query(
            "UPDATE users SET email = $1, name = $2, avatar_url = $3, updated_at = $4 WHERE id = $5",
        )
        .bind(&github_user.email)
        .bind(&github_user.name)
        .bind(&github_user.avatar_url)
        .bind(chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string())
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;
        (user.id, github_user.login)
    } else {
        // Create new user
        let user_id = uuid::Uuid::new_v4().to_string();

        sqlx::query(
            "INSERT INTO users (id, github_id, email, name, avatar_url, plan) VALUES ($1, $2, $3, $4, $5, 'free')",
        )
        .bind(&user_id)
        .bind(github_user.id)
        .bind(&github_user.email)
        .bind(&github_user.name)
        .bind(&github_user.avatar_url)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        // Credit signup bonus
        if state.config.signup_bonus_cents > 0 {
            crate::billing::credit_balance(
                &state.db,
                &user_id,
                state.config.signup_bonus_cents,
                "signup_bonus",
                None,
                &format!("Welcome bonus ${:.2}", state.config.signup_bonus_cents as f64 / 100.0),
            )
            .await?;
        }

        (user_id, github_user.login)
    };

    // Create JWT
    let token = auth::create_token(&user_id, &state.config.jwt_secret)?;

    // If the OAuth state contains a CLI redirect URL, redirect there with the token
    if let Some(ref cli_redirect) = params.state {
        let cli_redirect = urlencoding::decode(cli_redirect)
            .unwrap_or_else(|_| cli_redirect.clone().into())
            .to_string();
        if !cli_redirect.is_empty() && cli_redirect.starts_with("http") {
            let sep = if cli_redirect.contains('?') { "&" } else { "?" };
            let redirect_url = format!(
                "{cli_redirect}{sep}token={}&username={}",
                urlencoding::encode(&token),
                urlencoding::encode(&username)
            );
            return Ok(Redirect::temporary(&redirect_url).into_response());
        }
    }

    // Default: return JSON (for dashboard / direct API callers)
    Ok(Json(json!({
        "token": token,
        "user_id": user_id,
        "username": username,
    }))
    .into_response())
}

/// GET /api/v1/auth/me — Get current user info
pub async fn auth_me(auth_user: AuthUser) -> Json<Value> {
    Json(json!({
        "user": auth_user.user,
    }))
}

/// GET /api/v1/projects — List projects for authenticated user
pub async fn list_projects(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let projects: Vec<Project> =
        sqlx::query_as("SELECT * FROM projects WHERE user_id = $1 ORDER BY created_at DESC")
            .bind(&auth_user.user.id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    let mut result: Vec<ProjectWithCanisters> = Vec::new();
    for project in projects {
        let canisters: Vec<CanisterRecord> =
            sqlx::query_as("SELECT * FROM canisters WHERE project_id = $1")
                .bind(&project.id)
                .fetch_all(&state.db)
                .await
                .map_err(AppError::Database)?;

        let latest_deployment: Option<DeploymentRecord> =
            sqlx::query_as("SELECT * FROM deployments WHERE project_id = $1 ORDER BY started_at DESC LIMIT 1")
                .bind(&project.id)
                .fetch_optional(&state.db)
                .await
                .map_err(AppError::Database)?;

        result.push(ProjectWithCanisters { project, canisters, latest_deployment });
    }

    Ok(Json(json!({ "projects": result })))
}

/// POST /api/v1/projects — Create a new project
pub async fn create_project(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateProjectRequest>,
) -> Result<Json<Value>, AppError> {
    // Validate
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("Project name is required".into()));
    }

    let project_id = uuid::Uuid::new_v4().to_string();
    let slug = slugify(&req.name);
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Check if project already exists with this slug (globally unique for subdomain routing)
    let existing: Option<(String, String, String, String)> =
        sqlx::query_as("SELECT id, user_id, name, slug FROM projects WHERE slug = $1")
            .bind(&slug)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    if let Some((existing_id, existing_user_id, existing_name, existing_slug)) = existing {
        // If it belongs to a different user, reject with a helpful error
        if existing_user_id != auth_user.user.id {
            return Err(AppError::BadRequest(format!(
                "The slug '{}' is already taken. Please choose a different project name.",
                slug
            )));
        }
        // Same user — return existing project (idempotent init)
        let canisters: Vec<CanisterRecord> =
            sqlx::query_as("SELECT * FROM canisters WHERE project_id = $1")
                .bind(&existing_id)
                .fetch_all(&state.db)
                .await
                .map_err(AppError::Database)?;

        return Ok(Json(serde_json::json!({
            "project": {
                "id": existing_id,
                "name": existing_name,
                "slug": existing_slug,
                "canisters": canisters,
            }
        })));
    }

    // Insert project
    sqlx::query(
        "INSERT INTO projects (id, user_id, name, slug, subnet_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(&project_id)
    .bind(&auth_user.user.id)
    .bind(&req.name)
    .bind(&slug)
    .bind(&req.subnet)
    .bind(&now)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Insert canisters
    let mut canisters = Vec::new();
    for canister_input in &req.canisters {
        let canister_id = uuid::Uuid::new_v4().to_string();
        // recipe takes priority, default to "custom"
        let recipe = canister_input.recipe.as_deref()
            .unwrap_or("custom");
        sqlx::query(
            "INSERT INTO canisters (id, project_id, name, type, recipe, subnet_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)",
        )
        .bind(&canister_id)
        .bind(&project_id)
        .bind(&canister_input.name)
        .bind(recipe)
        .bind(recipe)
        .bind(&req.subnet)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        canisters.push(CanisterRecord {
            id: canister_id,
            project_id: project_id.clone(),
            name: canister_input.name.clone(),
            recipe: recipe.to_string(),
            canister_id: None,
            subnet_id: req.subnet.clone(),
            status: "pending".into(),
            cycles_balance: None,
            candid_interface: None,
            canister_type: Some(recipe.to_string()),
            auto_topup: Some(false),
            cycles_alert_threshold: None,
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    let project = Project {
        id: project_id,
        user_id: auth_user.user.id,
        name: req.name,
        slug,
        custom_domain: None,
        subnet_id: req.subnet,
        github_repo_id: None,
        production_branch: None,
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(Json(json!({
        "project": ProjectWithCanisters { project, canisters, latest_deployment: None },
    })))
}

/// GET /api/v1/projects/:id — Get a single project with canisters and deployments
pub async fn get_project(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
        .bind(&project_id)
        .bind(&auth_user.user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let canisters: Vec<CanisterRecord> =
        sqlx::query_as("SELECT * FROM canisters WHERE project_id = $1")
            .bind(&project.id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    let deployments: Vec<crate::models::DeploymentRecord> = sqlx::query_as(
        "SELECT * FROM deployments WHERE project_id = $1 ORDER BY started_at DESC LIMIT 50",
    )
    .bind(&project.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Deployments are the unified table now (no separate builds)
    let all_deployments: Vec<crate::models::DeploymentRecord> = sqlx::query_as(
        "SELECT * FROM deployments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&project.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({
        "project": ProjectWithCanisters { project, canisters, latest_deployment: None },
        "deployments": deployments,
        "deployments": all_deployments,
    })))
}

/// GET /api/v1/deploy/{deploy_id}/status — Deploy status
pub async fn deploy_status(
    state: State<AppState>,
    auth_user: AuthUser,
    path: Path<String>,
) -> Result<Json<Value>, AppError> {
    crate::deploy::deploy_status(state, auth_user, path).await
}

/// GET /api/v1/deploy/{deploy_id}/logs — Deploy logs
pub async fn deploy_logs(
    state: State<AppState>,
    auth_user: AuthUser,
    path: Path<String>,
) -> Result<Json<Value>, AppError> {
    crate::deploy::deploy_logs(state, auth_user, path).await
}

/// Simple slug generation from a name
fn slugify(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

/// GET /api/v1/cycles/balance — Check the platform cycles pool balance.
/// Uses the platform IC identity (IC_IDENTITY_PEM env var).
pub async fn cycles_balance(
    State(state): State<AppState>,
    _auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let pem = state
        .config
        .ic_identity_pem
        .as_deref()
        .ok_or_else(|| AppError::Internal("IC_IDENTITY_PEM not configured".into()))?;

    let client = crate::ic_client::IcClient::new(pem, &state.config.ic_url).await?;
    let balance = client.cycles_balance().await?;

    Ok(Json(json!({
        "principal": client.identity_principal().to_text(),
        "cycles_balance": balance,
        "cycles_balance_t": format!("{:.2}T", balance as f64 / 1_000_000_000_000.0),
    })))
}

/// POST /api/v1/auth/dev-token — Dev-mode only: create a test user and return a JWT.
/// Only available when DEV_MODE=true.
pub async fn dev_token(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    if !state.config.dev_mode {
        return Err(AppError::NotFound("Not found".into()));
    }

    let user_id = "dev-user-001".to_string();
    let github_id: i64 = 99999;

    // Check if dev user exists
    let existing: Option<crate::models::User> = sqlx::query_as("SELECT * FROM users WHERE id = $1")
        .bind(&user_id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)?;

    if existing.is_none() {
        // Create dev user (no per-user IC identity — platform identity used for all deploys)
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        sqlx::query(
            "INSERT INTO users (id, github_id, email, name, avatar_url, plan, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'free', $6, $7)",
        )
        .bind(&user_id)
        .bind(github_id)
        .bind("dev@icforge.local")
        .bind("Dev User")
        .bind::<Option<&str>>(None)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        // Credit signup bonus for dev user too
        if state.config.signup_bonus_cents > 0 {
            crate::billing::credit_balance(
                &state.db,
                &user_id,
                state.config.signup_bonus_cents,
                "signup_bonus",
                None,
                &format!("Welcome bonus ${:.2}", state.config.signup_bonus_cents as f64 / 100.0),
            )
            .await?;
        }

        tracing::info!("Created dev user");
    }

    let token = auth::create_token(&user_id, &state.config.jwt_secret)?;

    Ok(Json(json!({
        "token": token,
        "user_id": user_id,
        "dev_mode": true,
    })))
}

// ============================================================
// API token management
// ============================================================

/// POST /api/v1/tokens — Create a new API token
pub async fn create_api_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CreateTokenRequest>,
) -> Result<Json<Value>, AppError> {
    if req.name.trim().is_empty() {
        return Err(AppError::BadRequest("Token name is required".into()));
    }

    let token_id = uuid::Uuid::new_v4().to_string();
    let raw_token = format!("icf_tok_{}", uuid::Uuid::new_v4().simple());
    let token_hash = crate::auth::sha256_hex(&raw_token);

    let expires_at = req.expires_in_days.map(|days| {
        (chrono::Utc::now() + chrono::Duration::days(days))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string()
    });

    sqlx::query(
        r#"
        INSERT INTO api_tokens (id, user_id, name, token_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        "#,
    )
    .bind(&token_id)
    .bind(&auth_user.user.id)
    .bind(&req.name)
    .bind(&token_hash)
    .bind(&expires_at)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!(CreateTokenResponse {
        token: raw_token,
        id: token_id,
        name: req.name,
        expires_at,
    })))
}

/// GET /api/v1/tokens — List user's API tokens (hashes not returned)
pub async fn list_api_tokens(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let tokens: Vec<ApiToken> =
        sqlx::query_as("SELECT * FROM api_tokens WHERE user_id = $1 ORDER BY created_at DESC")
            .bind(&auth_user.user.id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    Ok(Json(json!({ "tokens": tokens })))
}

/// DELETE /api/v1/tokens/{token_id} — Revoke an API token
pub async fn delete_api_token(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(token_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let result = sqlx::query("DELETE FROM api_tokens WHERE id = $1 AND user_id = $2")
        .bind(&token_id)
        .bind(&auth_user.user.id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        return Err(AppError::NotFound("Token not found".into()));
    }

    Ok(Json(json!({ "deleted": true })))
}

// ============================================================
// Build jobs
// ============================================================

/// GET /api/v1/builds — List build jobs for user's projects
pub async fn list_deployments(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let deployments: Vec<crate::models::DeploymentRecord> = sqlx::query_as(
        r#"
        SELECT d.* FROM deployments d
        JOIN projects p ON d.project_id = p.id
        WHERE p.user_id = $1
        ORDER BY d.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({ "deployments": deployments })))
}

/// POST /api/v1/deployments — Trigger a CLI-initiated build
pub async fn trigger_deploy(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<TriggerDeployRequest>,
) -> Result<Json<Value>, AppError> {
    // Validate project ownership
    let project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
        .bind(&req.project_id)
        .bind(&auth_user.user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    // Project must have a linked GitHub repo for server-side builds
    let repo_full_name = project.github_repo_id.as_deref()
        .ok_or_else(|| AppError::BadRequest("Project has no linked GitHub repo. Link one with `icforge init`.".into()))?;

    // Look up the GitHub repo record to get installation_id
    let repo: crate::models::GitHubRepo = sqlx::query_as(
        "SELECT * FROM github_repos WHERE id = $1"
    )
    .bind(repo_full_name)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::BadRequest("Linked GitHub repo not found in DB".into()))?;

    // Look up installation to get installation_id
    let installation: crate::models::GitHubInstallation = sqlx::query_as(
        "SELECT * FROM github_installations WHERE id = $1"
    )
    .bind(&repo.installation_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::Internal("GitHub installation not found".into()))?;

    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // Determine which canisters to build
    let canister_names: Vec<String> = if let Some(ref name) = req.canister_name {
        // CLI specified a single canister
        vec![name.clone()]
    } else {
        // Look up all registered canisters for per-canister jobs
        sqlx::query_scalar(
            "SELECT name FROM canisters WHERE project_id = $1 ORDER BY name",
        )
        .bind(&req.project_id)
        .fetch_all(&state.db)
        .await
        .map_err(AppError::Database)?
    };

    let mut build_ids = Vec::new();

    if canister_names.is_empty() {
        // No canisters registered — enqueue a single job (worker will discover from icp.yaml)
        let build_id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            r#"
            INSERT INTO deployments (id, project_id, commit_sha, commit_message, branch, repo_full_name, installation_id, trigger, status, retry_count, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'cli', 'queued', 0, $8, $9)
            "#,
        )
        .bind(&build_id)
        .bind(&req.project_id)
        .bind(&req.commit_sha)
        .bind(&req.commit_message)
        .bind(&req.branch)
        .bind(&repo.full_name)
        .bind(installation.installation_id)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        tracing::info!(
            build_id = %build_id,
            project_id = %req.project_id,
            commit = %req.commit_sha,
            trigger = "cli",
            "CLI-triggered deployment enqueued (all canisters)"
        );
        build_ids.push(build_id);
    } else {
        // One job per canister
        for canister_name in &canister_names {
            let build_id = uuid::Uuid::new_v4().to_string();
            sqlx::query(
                r#"
                INSERT INTO deployments (id, project_id, canister_name, commit_sha, commit_message, branch, repo_full_name, installation_id, trigger, status, retry_count, created_at, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'cli', 'queued', 0, $9, $10)
                "#,
            )
            .bind(&build_id)
            .bind(&req.project_id)
            .bind(canister_name)
            .bind(&req.commit_sha)
            .bind(&req.commit_message)
            .bind(&req.branch)
            .bind(&repo.full_name)
            .bind(installation.installation_id)
            .bind(&now)
            .bind(&now)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;

            tracing::info!(
                build_id = %build_id,
                project_id = %req.project_id,
                canister = %canister_name,
                commit = %req.commit_sha,
                trigger = "cli",
                "Per-canister CLI-triggered deployment enqueued"
            );
            build_ids.push(build_id);
        }
    }

    Ok(Json(json!({
        "deployment_id": build_ids.first().unwrap_or(&String::new()),
        "deployment_ids": build_ids,
    })))
}

/// GET /api/v1/deployments/{deploy_id} — Get a specific deployment with logs
pub async fn get_deployment(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let deployment: crate::models::DeploymentRecord = sqlx::query_as(
        r#"
        SELECT d.* FROM deployments d
        JOIN projects p ON d.project_id = p.id
        WHERE d.id = $1 AND p.user_id = $2
        "#,
    )
    .bind(&deploy_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Deployment not found".into()))?;

    let logs: Vec<crate::models::DeployLog> =
        sqlx::query_as("SELECT * FROM deploy_logs WHERE deployment_id = $1 ORDER BY id ASC")
            .bind(&deploy_id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    Ok(Json(json!({
        "deployment": deployment,
        "logs": logs,
    })))
}

// ============================================================
// GitHub setup
// ============================================================

/// GET /api/v1/github/installations — List user's GitHub App installations
pub async fn list_installations(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let installations: Vec<crate::models::GitHubInstallation> = sqlx::query_as(
        "SELECT * FROM github_installations WHERE user_id = $1 ORDER BY created_at DESC",
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({ "installations": installations })))
}

/// GET /api/v1/github/repos — List repos accessible via user's installations
pub async fn list_github_repos(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let rows = sqlx::query(
        r#"
        SELECT gr.id, gr.installation_id, gr.github_repo_id, gr.full_name, gr.default_branch,
               p.id as linked_project_id, p.name as linked_project_name
        FROM github_repos gr
        JOIN github_installations gi ON gr.installation_id = gi.id
        LEFT JOIN projects p ON p.github_repo_id = gr.id AND p.user_id = $1
        WHERE gi.user_id = $1
        ORDER BY gr.full_name ASC
        "#,
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    use sqlx::Row;
    let repos: Vec<Value> = rows
        .iter()
        .map(|row| {
            let mut v = json!({
                "id": row.get::<String, _>("id"),
                "installation_id": row.get::<String, _>("installation_id"),
                "github_repo_id": row.get::<i64, _>("github_repo_id"),
                "full_name": row.get::<String, _>("full_name"),
                "default_branch": row.get::<String, _>("default_branch"),
            });
            if let Ok(pid) = row.try_get::<String, _>("linked_project_id") {
                v["linked_project_id"] = Value::String(pid);
            }
            if let Ok(pname) = row.try_get::<String, _>("linked_project_name") {
                v["linked_project_name"] = Value::String(pname);
            }
            v
        })
        .collect();

    Ok(Json(json!({ "repos": repos })))
}

#[derive(Debug, Deserialize)]
pub struct ClaimInstallationParams {
    pub installation_id: i64,
}

/// POST /api/v1/github/installations/claim — Associate a pending installation with the current user
pub async fn claim_installation(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(params): Json<ClaimInstallationParams>,
) -> Result<Json<Value>, AppError> {
    let result = sqlx::query(
        r#"
        UPDATE github_installations
        SET user_id = $1, updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS')
        WHERE installation_id = $2 AND user_id = '__pending__'
        "#,
    )
    .bind(&auth_user.user.id)
    .bind(params.installation_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    if result.rows_affected() == 0 {
        // Maybe already claimed by this user?
        let existing: Option<crate::models::GitHubInstallation> = sqlx::query_as(
            "SELECT * FROM github_installations WHERE installation_id = $1 AND user_id = $2",
        )
        .bind(params.installation_id)
        .bind(&auth_user.user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)?;

        if existing.is_some() {
            return Ok(Json(json!({ "claimed": true, "already_owned": true })));
        }

        return Err(AppError::NotFound(
            "Installation not found or already claimed by another user".into(),
        ));
    }

    Ok(Json(json!({ "claimed": true })))
}

#[derive(Debug, Deserialize)]
pub struct LinkRepoParams {
    pub project_id: String,
    pub github_repo_id: String,
    pub production_branch: Option<String>,
}

/// POST /api/v1/github/link — Link a GitHub repo to a project
pub async fn link_repo(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(params): Json<LinkRepoParams>,
) -> Result<Json<Value>, AppError> {
    // Verify the project belongs to this user
    let _project: Project = sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
        .bind(&params.project_id)
        .bind(&auth_user.user.id)
        .fetch_optional(&state.db)
        .await
        .map_err(AppError::Database)?
        .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    // Verify the repo belongs to this user's installation
    let repo: crate::models::GitHubRepo = sqlx::query_as(
        r#"
        SELECT gr.* FROM github_repos gr
        JOIN github_installations gi ON gr.installation_id = gi.id
        WHERE gr.id = $1 AND gi.user_id = $2
        "#,
    )
    .bind(&params.github_repo_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("GitHub repo not found or not accessible".into()))?;

    let branch = params.production_branch.as_deref().unwrap_or("main");

    sqlx::query(
        "UPDATE projects SET github_repo_id = $1, production_branch = $2, updated_at = to_char(NOW(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = $3",
    )
    .bind(&params.github_repo_id)
    .bind(branch)
    .bind(&params.project_id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Auto-trigger the first build: fetch HEAD commit from default branch
    let installation: crate::models::GitHubInstallation = sqlx::query_as(
        "SELECT * FROM github_installations WHERE id = $1"
    )
    .bind(&repo.installation_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    let token = crate::github::get_installation_token(&state.config, installation.installation_id)
        .await?;

    let client = reqwest::Client::new();
    let branch_url = format!(
        "https://api.github.com/repos/{}/branches/{}",
        repo.full_name, branch
    );
    let branch_resp = client
        .get(&branch_url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "ICForge")
        .send()
        .await;

    let mut build_ids: Vec<String> = Vec::new();

    if let Ok(resp) = branch_resp {
        if resp.status().is_success() {
            if let Ok(body) = resp.json::<serde_json::Value>().await {
                let commit_sha = body["commit"]["sha"].as_str().unwrap_or("HEAD").to_string();
                let commit_msg = body["commit"]["commit"]["message"].as_str().unwrap_or("Initial deploy").to_string();

                let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

                // Look up all registered canisters
                let canister_names: Vec<String> = sqlx::query_scalar(
                    "SELECT name FROM canisters WHERE project_id = $1 ORDER BY name",
                )
                .bind(&params.project_id)
                .fetch_all(&state.db)
                .await
                .map_err(AppError::Database)?;

                if canister_names.is_empty() {
                    // Single build job for all canisters
                    let build_id = uuid::Uuid::new_v4().to_string();
                    sqlx::query(
                        r#"
                        INSERT INTO deployments (id, project_id, commit_sha, commit_message, branch, repo_full_name, installation_id, trigger, status, retry_count, created_at, updated_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, 'dashboard', 'queued', 0, $8, $9)
                        "#,
                    )
                    .bind(&build_id)
                    .bind(&params.project_id)
                    .bind(&commit_sha)
                    .bind(&commit_msg)
                    .bind(branch)
                    .bind(&repo.full_name)
                    .bind(installation.installation_id)
                    .bind(&now)
                    .bind(&now)
                    .execute(&state.db)
                    .await
                    .map_err(AppError::Database)?;

                    tracing::info!(
                        build_id = %build_id,
                        project_id = %params.project_id,
                        commit = %commit_sha,
                        trigger = "dashboard",
                        "Auto-triggered initial deployment (all canisters)"
                    );
                    build_ids.push(build_id);
                } else {
                    // One job per canister
                    for canister_name in &canister_names {
                        let build_id = uuid::Uuid::new_v4().to_string();
                        sqlx::query(
                            r#"
                            INSERT INTO deployments (id, project_id, canister_name, commit_sha, commit_message, branch, repo_full_name, installation_id, trigger, status, retry_count, created_at, updated_at)
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'dashboard', 'queued', 0, $9, $10)
                            "#,
                        )
                        .bind(&build_id)
                        .bind(&params.project_id)
                        .bind(canister_name)
                        .bind(&commit_sha)
                        .bind(&commit_msg)
                        .bind(branch)
                        .bind(&repo.full_name)
                        .bind(installation.installation_id)
                        .bind(&now)
                        .bind(&now)
                        .execute(&state.db)
                        .await
                        .map_err(AppError::Database)?;

                        tracing::info!(
                            build_id = %build_id,
                            project_id = %params.project_id,
                            canister = %canister_name,
                            commit = %commit_sha,
                            trigger = "dashboard",
                            "Auto-triggered initial per-canister deployment"
                        );
                        build_ids.push(build_id);
                    }
                }
            }
        }
    }

    Ok(Json(json!({
        "linked": true,
        "build_ids": build_ids,
    })))
}

/// GET /api/v1/github/repos/:repo_id/config — Fetch icp.yaml from the repo's default branch
pub async fn fetch_repo_config(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(repo_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Verify the repo belongs to this user's installation
    let repo: crate::models::GitHubRepo = sqlx::query_as(
        r#"
        SELECT gr.* FROM github_repos gr
        JOIN github_installations gi ON gr.installation_id = gi.id
        WHERE gr.id = $1 AND gi.user_id = $2
        "#,
    )
    .bind(&repo_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("GitHub repo not found or not accessible".into()))?;

    // Get installation_id to fetch an access token
    let installation: crate::models::GitHubInstallation = sqlx::query_as(
        "SELECT * FROM github_installations WHERE id = $1",
    )
    .bind(&repo.installation_id)
    .fetch_one(&state.db)
    .await
    .map_err(AppError::Database)?;

    let token = crate::github::get_installation_token(&state.config, installation.installation_id)
        .await?;

    // Fetch icp.yaml from the repo's default branch
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/contents/icp.yaml?ref={}",
        repo.full_name, repo.default_branch
    );

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {token}"))
        .header("Accept", "application/vnd.github.raw+json")
        .header("User-Agent", "ICForge")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub API request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(Json(json!({
            "found": false,
            "config": null,
            "raw": null,
        })));
    }

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub API error fetching icp.yaml: {body}"
        )));
    }

    let raw_yaml = resp
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read icp.yaml content: {e}")))?;

    // Parse the YAML to extract canister definitions
    let yaml_val: serde_json::Value = serde_yaml::from_str(&raw_yaml)
        .map_err(|e| AppError::BadRequest(format!("Invalid icp.yaml: {e}")))?;

    // For bare-string canister refs, fetch their canister.yaml to get recipe info
    let mut enriched_canisters: Vec<Value> = Vec::new();
    if let Some(canisters) = yaml_val.get("canisters").and_then(|c| c.as_array()) {
        for entry in canisters {
            if let Some(name) = entry.as_str() {
                // Bare string — try to fetch {name}/canister.yaml
                let canister_url = format!(
                    "https://api.github.com/repos/{}/contents/{}/canister.yaml?ref={}",
                    repo.full_name, name, repo.default_branch
                );
                let canister_resp = client
                    .get(&canister_url)
                    .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/vnd.github.raw+json")
                    .header("User-Agent", "ICForge")
                    .send()
                    .await;

                if let Ok(resp) = canister_resp {
                    if resp.status().is_success() {
                        if let Ok(body) = resp.text().await {
                            if let Ok(val) = serde_yaml::from_str::<serde_json::Value>(&body) {
                                enriched_canisters.push(val);
                                continue;
                            }
                        }
                    }
                }
                // Fallback: just the name
                enriched_canisters.push(json!({ "name": name }));
            } else {
                // Already an inline object
                enriched_canisters.push(entry.clone());
            }
        }
    }

    Ok(Json(json!({
        "found": true,
        "config": yaml_val,
        "canisters": enriched_canisters,
        "raw": raw_yaml,
    })))
}

/// GET /api/v1/canisters/:canister_id/env — Fetch environment variables from IC management canister
pub async fn canister_env(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(canister_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Verify the canister belongs to this user
    let _canister: CanisterRecord = sqlx::query_as(
        "SELECT c.* FROM canisters c JOIN projects p ON c.project_id = p.id WHERE c.canister_id = $1 AND p.user_id = $2"
    )
    .bind(&canister_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Canister not found or not owned by you".into()))?;

    let pem = state
        .config
        .ic_identity_pem
        .as_deref()
        .ok_or_else(|| AppError::Internal("IC_IDENTITY_PEM not configured".into()))?;
    let client = crate::ic_client::IcClient::new(pem, &state.config.ic_url).await?;
    let status = client.canister_status(&canister_id).await?;

    let env_vars: Vec<serde_json::Value> = status
        .settings
        .environment_variables
        .unwrap_or_default()
        .into_iter()
        .map(|ev| json!({ "name": ev.name, "value": ev.value }))
        .collect();

    Ok(Json(json!({
        "canister_id": canister_id,
        "environment_variables": env_vars,
    })))
}

// ============================================================
// Canister cycles / health endpoints
// ============================================================

/// GET /api/v1/canisters/:canister_id/cycles — Cycles balance + history
pub async fn canister_cycles(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(canister_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // canister_id here is the IC canister principal
    let canister: CanisterRecord = sqlx::query_as(
        "SELECT c.* FROM canisters c JOIN projects p ON c.project_id = p.id WHERE c.canister_id = $1 AND p.user_id = $2",
    )
    .bind(&canister_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Canister not found or not owned by you".into()))?;

    // Latest snapshots (last 30 days)
    let snapshots: Vec<crate::models::CyclesSnapshot> = sqlx::query_as(
        r#"SELECT * FROM cycles_snapshots
           WHERE ic_canister_id = $1 AND recorded_at >= $2
           ORDER BY recorded_at ASC"#,
    )
    .bind(&canister_id)
    .bind(
        (chrono::Utc::now() - chrono::Duration::days(30))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string(),
    )
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Recent top-ups
    let topups: Vec<crate::models::CanisterTopup> = sqlx::query_as(
        "SELECT * FROM canister_topups WHERE ic_canister_id = $1 ORDER BY created_at DESC LIMIT 20",
    )
    .bind(&canister_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let current_balance = canister.cycles_balance.unwrap_or(0);
    let health = cycles_health_level(current_balance);

    let history: Vec<Value> = snapshots
        .iter()
        .map(|s| {
            json!({
                "balance": s.cycles_balance,
                "memory_size": s.memory_size,
                "status": s.status,
                "recorded_at": s.recorded_at,
            })
        })
        .collect();

    Ok(Json(json!({
        "canister_id": canister_id,
        "canister_name": canister.name,
        "current_balance": current_balance,
        "health": health,
        "auto_topup": canister.auto_topup.unwrap_or(false),
        "alert_threshold": canister.cycles_alert_threshold.unwrap_or(500_000_000_000),
        "history": history,
        "topups": topups,
    })))
}

/// PUT /api/v1/canisters/:canister_id/cycles/settings — Update auto-topup and alert threshold
pub async fn canister_cycles_settings(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(canister_id): Path<String>,
    Json(req): Json<CyclesSettingsRequest>,
) -> Result<Json<Value>, AppError> {
    let canister: CanisterRecord = sqlx::query_as(
        "SELECT c.* FROM canisters c JOIN projects p ON c.project_id = p.id WHERE c.canister_id = $1 AND p.user_id = $2",
    )
    .bind(&canister_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Canister not found or not owned by you".into()))?;

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    if let Some(auto_topup) = req.auto_topup {
        sqlx::query("UPDATE canisters SET auto_topup = $1, updated_at = $2 WHERE id = $3")
            .bind(auto_topup)
            .bind(&now)
            .bind(&canister.id)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;
    }

    if let Some(threshold) = req.alert_threshold {
        sqlx::query("UPDATE canisters SET cycles_alert_threshold = $1, updated_at = $2 WHERE id = $3")
            .bind(threshold)
            .bind(&now)
            .bind(&canister.id)
            .execute(&state.db)
            .await
            .map_err(AppError::Database)?;
    }

    Ok(Json(json!({ "ok": true })))
}

/// POST /api/v1/canisters/:canister_id/cycles/topup — Manual top-up
pub async fn canister_cycles_topup(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(canister_id): Path<String>,
    Json(req): Json<ManualTopupRequest>,
) -> Result<Json<Value>, AppError> {
    let canister: CanisterRecord = sqlx::query_as(
        "SELECT c.* FROM canisters c JOIN projects p ON c.project_id = p.id WHERE c.canister_id = $1 AND p.user_id = $2",
    )
    .bind(&canister_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Canister not found or not owned by you".into()))?;

    if req.amount <= 0 {
        return Err(AppError::BadRequest("Amount must be positive".into()));
    }

    let cycles = req.amount as u128;
    let cost_cents = crate::compute_poller::cycles_to_cents(cycles, state.config.compute_margin);

    // Debit user balance
    crate::billing::debit_balance(
        &state.db,
        &auth_user.user.id,
        cost_cents,
        "execution",
        &format!("Manual top-up {} ({}) — {} cycles", canister.name, canister_id, req.amount),
    )
    .await?;

    // Deposit cycles to canister on IC
    let pem = state
        .config
        .ic_identity_pem
        .as_deref()
        .ok_or_else(|| AppError::Internal("IC_IDENTITY_PEM not configured".into()))?;
    let ic = crate::ic_client::IcClient::new(pem, &state.config.ic_url).await?;
    ic.deposit_cycles(&canister_id, cycles).await?;

    // Record the top-up
    let topup_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    sqlx::query(
        r#"INSERT INTO canister_topups (id, canister_id, ic_canister_id, user_id, cycles_amount, cost_cents, source, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, 'manual', $7)"#,
    )
    .bind(&topup_id)
    .bind(&canister.id)
    .bind(&canister_id)
    .bind(&auth_user.user.id)
    .bind(req.amount)
    .bind(cost_cents)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({
        "ok": true,
        "cycles_deposited": req.amount,
        "cost_cents": cost_cents,
        "topup_id": topup_id,
    })))
}

/// GET /api/v1/projects/:project_id/health — Project-level health summary
pub async fn project_health(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(project_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let _project: Project = sqlx::query_as(
        "SELECT * FROM projects WHERE id = $1 AND user_id = $2",
    )
    .bind(&project_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Project not found".into()))?;

    let canisters: Vec<CanisterRecord> =
        sqlx::query_as("SELECT * FROM canisters WHERE project_id = $1")
            .bind(&project_id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    let canister_health: Vec<Value> = canisters
        .iter()
        .map(|c| {
            let balance = c.cycles_balance.unwrap_or(0);
            json!({
                "name": c.name,
                "canister_id": c.canister_id,
                "cycles_balance": balance,
                "health": cycles_health_level(balance),
                "auto_topup": c.auto_topup.unwrap_or(false),
            })
        })
        .collect();

    // Overall project health = worst canister health
    let overall = canisters
        .iter()
        .map(|c| c.cycles_balance.unwrap_or(0))
        .min()
        .map(cycles_health_level)
        .unwrap_or_else(|| "unknown".to_string());

    Ok(Json(json!({
        "project_id": project_id,
        "overall_health": overall,
        "canisters": canister_health,
    })))
}

/// Map a cycles balance to a health level string.
fn cycles_health_level(balance: i64) -> String {
    if balance <= 0 {
        "frozen".to_string()
    } else if balance < 500_000_000_000 {
        "critical".to_string()
    } else if balance < 2_000_000_000_000 {
        "warning".to_string()
    } else {
        "healthy".to_string()
    }
}
