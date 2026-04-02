use axum::{extract::Path, Json};
use serde_json::{json, Value};

pub async fn auth_callback() -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn list_projects() -> Json<Value> {
    Json(json!({ "projects": [] }))
}

pub async fn create_project() -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn deploy() -> Json<Value> {
    Json(json!({ "status": "not_implemented" }))
}

pub async fn deploy_status(Path(deploy_id): Path<String>) -> Json<Value> {
    Json(json!({ "deploy_id": deploy_id, "status": "not_implemented" }))
}

pub async fn deploy_logs(Path(deploy_id): Path<String>) -> Json<Value> {
    Json(json!({ "deploy_id": deploy_id, "logs": [] }))
}
