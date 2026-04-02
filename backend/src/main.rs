use axum::{
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use tower_http::cors::CorsLayer;
use tracing_subscriber::EnvFilter;

mod routes;
mod models;
mod auth;
mod deploy;
mod identity;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();

    let app = Router::new()
        .route("/health", get(health))
        .route("/api/v1/auth/callback", get(routes::auth_callback))
        .route("/api/v1/projects", get(routes::list_projects))
        .route("/api/v1/projects", post(routes::create_project))
        .route("/api/v1/deploy", post(routes::deploy))
        .route("/api/v1/deploy/{deploy_id}/status", get(routes::deploy_status))
        .route("/api/v1/deploy/{deploy_id}/logs", get(routes::deploy_logs))
        .layer(CorsLayer::permissive());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8080")
        .await
        .expect("Failed to bind");

    tracing::info!("ICForge API listening on 0.0.0.0:8080");
    axum::serve(listener, app).await.expect("Server failed");
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { status: "ok".into(), version: env!("CARGO_PKG_VERSION").into() })
}

#[derive(Serialize)]
struct HealthResponse {
    status: String,
    version: String,
}
