use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::Serialize;
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod auth;
mod config;
mod db;
mod deploy;
mod error;
mod ic_client;
mod identity;
mod models;
mod routes;

#[derive(Clone)]
pub struct AppState {
    pub db: db::DbPool,
    pub config: config::AppConfig,
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
        db: pool,
        config,
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/login", get(routes::auth_login))
        .route("/api/v1/auth/callback", get(routes::auth_callback))
        .route("/api/v1/auth/me", get(routes::auth_me))
        .route("/api/v1/projects", get(routes::list_projects))
        .route("/api/v1/projects", post(routes::create_project))
        .route("/api/v1/deploy", post(routes::deploy))
        .route("/api/v1/deploy/{deploy_id}/status", get(routes::deploy_status))
        .route("/api/v1/deploy/{deploy_id}/logs", get(routes::deploy_logs))
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
