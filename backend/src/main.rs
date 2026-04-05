use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post},
    Json, Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod build_worker;
mod cloudflare;
mod config;
mod db;
mod deploy;
mod error;
mod github;
mod ic_client;
mod models;
mod routes;
mod webhooks;

/// A single log event broadcast to SSE subscribers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LogEvent {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub config: config::AppConfig,
    /// Per-deployment broadcast channels for real-time log streaming.
    pub log_channels: Arc<DashMap<String, broadcast::Sender<LogEvent>>>,
}

#[tokio::main]
async fn main() {
    // Load .env file (ignore if missing)
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let config = config::AppConfig::from_env();
    let port = config.port;

    let pool = db::init_pool(&config.database_url).await;
    db::run_migrations(&pool).await;

    let state = AppState {
        db: pool.clone(),
        config: config.clone(),
        log_channels: Arc::new(DashMap::new()),
    };

    // Start the background build worker
    build_worker::spawn_worker(pool, config);

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/login", get(routes::auth_login))
        .route("/api/v1/auth/callback", get(routes::auth_callback))
        .route("/api/v1/auth/me", get(routes::auth_me))
        .route("/api/v1/auth/dev-token", post(routes::dev_token))
        .route("/api/v1/projects", get(routes::list_projects))
        .route("/api/v1/projects", post(routes::create_project))
        .route("/api/v1/projects/{project_id}", get(routes::get_project))
        .route("/api/v1/deploy", post(routes::deploy))
        .route("/api/v1/deploy/{deploy_id}/status", get(routes::deploy_status))
        .route("/api/v1/deploy/{deploy_id}/logs", get(routes::deploy_logs))
        .route("/api/v1/deploy/{deploy_id}/logs/stream", get(routes::deploy_logs_stream))
        .route("/api/v1/cycles/balance", get(routes::cycles_balance))
        // Canister details
        .route("/api/v1/canisters/{canister_id}/env", get(routes::canister_env))
        // API tokens
        .route("/api/v1/tokens", get(routes::list_api_tokens))
        .route("/api/v1/tokens", post(routes::create_api_token))
        .route("/api/v1/tokens/{token_id}", delete(routes::delete_api_token))
        // Build jobs
        .route("/api/v1/builds", get(routes::list_builds))
        .route("/api/v1/builds/{build_id}", get(routes::get_build))
        // GitHub App
        .route("/api/v1/github/installations", get(routes::list_installations))
        .route("/api/v1/github/installations/claim", post(routes::claim_installation))
        .route("/api/v1/github/repos", get(routes::list_github_repos))
        .route("/api/v1/github/link", post(routes::link_repo))
        // Webhooks (no auth — signature-verified)
        .route("/api/v1/webhooks/github", post(webhooks::handle_webhook))
        .layer(DefaultBodyLimit::max(50 * 1024 * 1024)) // 50MB for wasm + assets
        .layer(CorsLayer::permissive())
        .with_state(state);

    let bind_addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&bind_addr)
        .await
        .expect("Failed to bind");

    tracing::info!("ICForge API listening on {bind_addr}");
    axum::serve(listener, app).await.expect("Server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
    })
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}
