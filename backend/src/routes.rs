use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};

use crate::AppState;

pub async fn auth_callback(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn list_projects(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "projects": [] }))
}

pub async fn create_project(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn deploy(State(_state): State<AppState>) -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn deploy_status(
    State(_state): State<AppState>,
    Path(deploy_id): Path<String>,
) -> Json<Value> {
    Json(json!({ "deploy_id": deploy_id, "status": "not_implemented" }))
}

pub async fn deploy_logs(
    State(_state): State<AppState>,
    Path(deploy_id): Path<String>,
) -> Json<Value> {
    Json(json!({ "deploy_id": deploy_id, "logs": [] }))
}
