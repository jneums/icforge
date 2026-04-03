use axum::{
    extract::{Path, Query, State},
    response::Redirect,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::auth::{self, AuthUser};
use crate::error::AppError;
use crate::models::{CanisterRecord, CreateProjectRequest, Project, ProjectWithCanisters};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct AuthCallbackParams {
    pub code: String,
}

/// GET /api/v1/auth/login — Redirects to GitHub OAuth authorize URL
pub async fn auth_login(State(state): State<AppState>) -> Redirect {
    let client_id = &state.config.github_client_id;
    let redirect_uri = format!("{}/api/v1/auth/callback", state.config.frontend_url);
    let url = format!(
        "https://github.com/login/oauth/authorize?client_id={client_id}&redirect_uri={redirect_uri}&scope=user:email"
    );
    Redirect::temporary(&url)
}

/// GET /api/v1/auth/callback — GitHub OAuth callback
pub async fn auth_callback(
    State(state): State<AppState>,
    Query(params): Query<AuthCallbackParams>,
) -> Result<Json<Value>, AppError> {
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
        sqlx::query_as("SELECT * FROM users WHERE github_id = ?")
            .bind(github_user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    let user_id = if let Some(user) = existing_user {
        // Update existing user
        sqlx::query(
            "UPDATE users SET email = ?, name = ?, avatar_url = ?, updated_at = datetime('now') WHERE id = ?",
        )
        .bind(&github_user.email)
        .bind(&github_user.name)
        .bind(&github_user.avatar_url)
        .bind(&user.id)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;
        user.id
    } else {
        // Create new user with IC identity
        let user_id = uuid::Uuid::new_v4().to_string();

        let (ic_pem, ic_principal) = crate::identity::generate_identity()?;

        sqlx::query(
            "INSERT INTO users (id, github_id, email, name, avatar_url, ic_identity_pem, ic_principal, plan) VALUES (?, ?, ?, ?, ?, ?, ?, 'free')",
        )
        .bind(&user_id)
        .bind(github_user.id)
        .bind(&github_user.email)
        .bind(&github_user.name)
        .bind(&github_user.avatar_url)
        .bind(&ic_pem)
        .bind(&ic_principal)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        user_id
    };

    // Create JWT
    let token = auth::create_token(&user_id, &state.config.jwt_secret)?;

    Ok(Json(json!({
        "token": token,
        "user_id": user_id,
    })))
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
        sqlx::query_as("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC")
            .bind(&auth_user.user.id)
            .fetch_all(&state.db)
            .await
            .map_err(AppError::Database)?;

    let mut result: Vec<ProjectWithCanisters> = Vec::new();
    for project in projects {
        let canisters: Vec<CanisterRecord> = sqlx::query_as(
            "SELECT * FROM canisters WHERE project_id = ?",
        )
        .bind(&project.id)
        .fetch_all(&state.db)
        .await
        .map_err(AppError::Database)?;

        result.push(ProjectWithCanisters { project, canisters });
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

    // Insert project
    sqlx::query(
        "INSERT INTO projects (id, user_id, name, slug, subnet_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
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
            "INSERT INTO canisters (id, project_id, name, type, subnet_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
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
        created_at: now.clone(),
        updated_at: now,
    };

    Ok(Json(json!({
        "project": ProjectWithCanisters { project, canisters },
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

/// POST /api/v1/auth/dev-token — Dev-mode only: create a test user and return a JWT.
/// Only available when DEV_MODE=true.
pub async fn dev_token(
    State(state): State<AppState>,
) -> Result<Json<Value>, AppError> {
    if !state.config.dev_mode {
        return Err(AppError::NotFound("Not found".into()));
    }

    let user_id = "dev-user-001".to_string();
    let github_id: i64 = 99999;

    // Check if dev user exists
    let existing: Option<crate::models::User> =
        sqlx::query_as("SELECT * FROM users WHERE id = ?")
            .bind(&user_id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    if existing.is_none() {
        // Create dev user with a fresh IC identity
        let (ic_pem, ic_principal) = crate::identity::generate_identity()?;
        let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

        sqlx::query(
            "INSERT INTO users (id, github_id, email, name, avatar_url, ic_identity_pem, ic_principal, plan, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'free', ?, ?)",
        )
        .bind(&user_id)
        .bind(github_id)
        .bind("dev@icforge.local")
        .bind("Dev User")
        .bind::<Option<&str>>(None)
        .bind(&ic_pem)
        .bind(&ic_principal)
        .bind(&now)
        .bind(&now)
        .execute(&state.db)
        .await
        .map_err(AppError::Database)?;

        tracing::info!(principal = %ic_principal, "Created dev user with IC identity");
    }

    let token = auth::create_token(&user_id, &state.config.jwt_secret)?;

    Ok(Json(json!({
        "token": token,
        "user_id": user_id,
        "dev_mode": true,
    })))
}
