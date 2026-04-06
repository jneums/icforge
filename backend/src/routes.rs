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
    ApiToken, CanisterRecord, CreateProjectRequest, CreateTokenRequest, CreateTokenResponse,
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
        sqlx::query(
            "INSERT INTO canisters (id, project_id, name, type, subnet_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7)",
        )
        .bind(&canister_id)
        .bind(&project_id)
        .bind(&canister_input.name)
        .bind(&canister_input.canister_type)
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
            canister_type: canister_input.canister_type.clone(),
            canister_id: None,
            subnet_id: req.subnet.clone(),
            status: "pending".into(),
            cycles_balance: None,
            candid_interface: None,
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

    Ok(Json(json!({
        "project": ProjectWithCanisters { project, canisters, latest_deployment: None },
        "deployments": deployments,
    })))
}

/// POST /api/v1/deploy — Deploy a wasm to a canister
pub async fn deploy(
    state: State<AppState>,
    auth_user: AuthUser,
    multipart: axum::extract::Multipart,
) -> Result<Json<Value>, AppError> {
    crate::deploy::deploy(state, auth_user, multipart).await
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
pub async fn list_builds(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let builds: Vec<crate::models::BuildJob> = sqlx::query_as(
        r#"
        SELECT bj.* FROM build_jobs bj
        JOIN projects p ON bj.project_id = p.id
        WHERE p.user_id = $1
        ORDER BY bj.created_at DESC
        LIMIT 50
        "#,
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({ "builds": builds })))
}

/// GET /api/v1/builds/{build_id} — Get a specific build with logs
pub async fn get_build(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(build_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    let build: crate::models::BuildJob = sqlx::query_as(
        r#"
        SELECT bj.* FROM build_jobs bj
        JOIN projects p ON bj.project_id = p.id
        WHERE bj.id = $1 AND p.user_id = $2
        "#,
    )
    .bind(&build_id)
    .bind(&auth_user.user.id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Build not found".into()))?;

    let logs: Vec<crate::models::BuildLog> =
        sqlx::query_as("SELECT * FROM build_logs WHERE build_job_id = $1 ORDER BY id ASC")
            .bind(&build_id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    Ok(Json(json!({
        "build": build,
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
    let repos: Vec<crate::models::GitHubRepo> = sqlx::query_as(
        r#"
        SELECT gr.* FROM github_repos gr
        JOIN github_installations gi ON gr.installation_id = gi.id
        WHERE gi.user_id = $1
        ORDER BY gr.full_name ASC
        "#,
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

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
    let _repo: crate::models::GitHubRepo = sqlx::query_as(
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

    Ok(Json(json!({ "linked": true })))
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
