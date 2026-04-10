use axum::{
    extract::DefaultBodyLimit,
    routing::{delete, get, post, put},
    Json, Router,
};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::broadcast;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod billing;
mod compute_poller;
mod deploy_worker;
mod cloudflare;
mod config;
mod db;
mod deploy;
mod error;
mod exchange_rate;
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
    /// Live XDR→USD exchange rate for cycles pricing.
    pub exchange_rate: exchange_rate::ExchangeRateCache,
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

    let exchange_rate = exchange_rate::ExchangeRateCache::new();
    exchange_rate::spawn_rate_refresher(exchange_rate.clone());

    let state = AppState {
        db: pool.clone(),
        config: config.clone(),
        log_channels: Arc::new(DashMap::new()),
        exchange_rate,
    };

    // Start the background build worker
    deploy_worker::spawn_worker(pool.clone(), config.clone(), state.log_channels.clone(), state.exchange_rate.clone());

    // Start the background cycles poller (checks every 6h)
    compute_poller::spawn_poller(pool, config, state.exchange_rate.clone());

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/login", get(routes::auth_login))
        .route("/api/v1/auth/callback", get(routes::auth_callback))
        .route("/api/v1/auth/me", get(routes::auth_me))
        .route("/api/v1/auth/dev-token", post(routes::dev_token))
        .route("/api/v1/projects", get(routes::list_projects))
        .route("/api/v1/projects", post(routes::create_project))
        .route("/api/v1/projects/{project_id}", get(routes::get_project))
        .route("/api/v1/deploy/{deploy_id}/status", get(routes::deploy_status))
        .route("/api/v1/deploy/{deploy_id}/logs", get(routes::deploy_logs))
        .route("/api/v1/deploy/{deploy_id}/logs/stream", get(routes::deploy_logs_stream))
        .route("/api/v1/cycles/balance", get(routes::cycles_balance))
        // Canister details
        .route("/api/v1/canisters/{canister_id}/env", get(routes::canister_env))
        .route("/api/v1/canisters/{canister_id}/cycles", get(routes::canister_cycles))
        .route("/api/v1/canisters/{canister_id}/cycles/settings", put(routes::canister_cycles_settings))
        .route("/api/v1/canisters/{canister_id}/cycles/topup", post(routes::canister_cycles_topup))
        // Project health
        .route("/api/v1/projects/{project_id}/health", get(routes::project_health))
        // API tokens
        .route("/api/v1/tokens", get(routes::list_api_tokens))
        .route("/api/v1/tokens", post(routes::create_api_token))
        .route("/api/v1/tokens/{token_id}", delete(routes::delete_api_token))
        // Deployments
        .route("/api/v1/deployments", get(routes::list_deployments))
        .route("/api/v1/deployments", post(routes::trigger_deploy))
        .route("/api/v1/deployments/{deploy_id}", get(routes::get_deployment))
        // GitHub App
        .route("/api/v1/github/installations", get(routes::list_installations))
        .route("/api/v1/github/installations/claim", post(routes::claim_installation))
        .route("/api/v1/github/repos", get(routes::list_github_repos))
        .route("/api/v1/github/repos/{repo_id}/config", get(routes::fetch_repo_config))
        .route("/api/v1/github/link", post(routes::link_repo))
        // Billing
        .route("/api/v1/billing/checkout", post(billing::billing_checkout))
        .route("/api/v1/billing/portal", get(billing::billing_portal))
        .route("/api/v1/billing/balance", get(billing::billing_balance))
        .route("/api/v1/billing/auto-topup", put(billing::billing_auto_topup))
        .route("/api/v1/billing/transactions", get(billing::billing_transactions))
        // Webhooks (no auth — signature-verified)
        .route("/api/v1/webhooks/github", post(webhooks::handle_webhook))
        .route("/api/v1/webhooks/stripe", post(billing::billing_webhook))
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
