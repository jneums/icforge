use axum::{
    extract::{Multipart, Path, State},
    Json,
};
use serde::Serialize;
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ic_client::IcClient;
use crate::models::{DeployLog, DeploymentRecord};
use crate::AppState;

// -- Response types --

#[derive(Debug, Serialize)]
pub struct DeployStatusResponse {
    pub deployment_id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canister_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeployLogsResponse {
    pub logs: Vec<DeployLogEntry>,
}

#[derive(Debug, Serialize)]
pub struct DeployLogEntry {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

// -- Helper: insert a deploy log entry --

async fn insert_log(db: &DbPool, deployment_id: &str, level: &str, message: &str) {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let _ = sqlx::query(
        "INSERT INTO deploy_logs (deployment_id, level, message, timestamp) VALUES (?, ?, ?, ?)",
    )
    .bind(deployment_id)
    .bind(level)
    .bind(message)
    .bind(&now)
    .execute(db)
    .await;
}

async fn update_deployment_status(db: &DbPool, deployment_id: &str, status: &str, error_msg: Option<&str>) {
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    if let Some(err) = error_msg {
        let _ = sqlx::query(
            "UPDATE deployments SET status = ?, error_message = ?, completed_at = ? WHERE id = ?",
        )
        .bind(status)
        .bind(err)
        .bind(&now)
        .bind(deployment_id)
        .execute(db)
        .await;
    } else {
        let _ = sqlx::query(
            "UPDATE deployments SET status = ?, completed_at = ? WHERE id = ?",
        )
        .bind(status)
        .bind(&now)
        .bind(deployment_id)
        .execute(db)
        .await;
    }
}

// -- POST /api/v1/deploy --

pub async fn deploy(
    State(state): State<AppState>,
    auth_user: AuthUser,
    mut multipart: Multipart,
) -> Result<Json<Value>, AppError> {
    // Parse multipart fields
    let mut project_id: Option<String> = None;
    let mut canister_name: Option<String> = None;
    let mut wasm_bytes: Option<Vec<u8>> = None;
    let mut commit_sha: Option<String> = None;
    let mut commit_message: Option<String> = None;

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::BadRequest(format!("Failed to read multipart field: {e}")))?
    {
        let name = field.name().unwrap_or("").to_string();
        match name.as_str() {
            "project_id" => {
                project_id = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read project_id: {e}")))?,
                );
            }
            "canister_name" => {
                canister_name = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read canister_name: {e}")))?,
                );
            }
            "wasm" => {
                wasm_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read wasm file: {e}")))?
                        .to_vec(),
                );
            }
            "commit_sha" => {
                commit_sha = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read commit_sha: {e}")))?,
                );
            }
            "commit_message" => {
                commit_message = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read commit_message: {e}")))?,
                );
            }
            _ => {
                // Skip unknown fields
            }
        }
    }

    let project_id =
        project_id.ok_or_else(|| AppError::BadRequest("project_id is required".into()))?;
    let canister_name =
        canister_name.ok_or_else(|| AppError::BadRequest("canister_name is required".into()))?;
    let wasm_bytes =
        wasm_bytes.ok_or_else(|| AppError::BadRequest("wasm file is required".into()))?;

    if wasm_bytes.is_empty() {
        return Err(AppError::BadRequest("wasm file is empty".into()));
    }

    // Verify project belongs to user
    let project_row: Option<crate::models::Project> =
        sqlx::query_as("SELECT * FROM projects WHERE id = ? AND user_id = ?")
            .bind(&project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    let _project =
        project_row.ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Find canister record
    let canister_row: Option<crate::models::CanisterRecord> = sqlx::query_as(
        "SELECT id, project_id, name, type AS canister_type, canister_id, subnet_id, status, cycles_balance, created_at, updated_at FROM canisters WHERE project_id = ? AND name = ?",
    )
    .bind(&project_id)
    .bind(&canister_name)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let canister = canister_row
        .ok_or_else(|| AppError::NotFound(format!("Canister '{}' not found in project", canister_name)))?;

    // Save wasm bytes to /tmp for the background task
    let deployment_id = uuid::Uuid::new_v4().to_string();
    let wasm_path = format!("/tmp/icforge_wasm_{}.wasm", deployment_id);
    tokio::fs::write(&wasm_path, &wasm_bytes)
        .await
        .map_err(|e| AppError::Internal(format!("Failed to save wasm to temp: {e}")))?;

    // Create deployment record with status='building'
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO deployments (id, project_id, canister_name, status, commit_sha, commit_message, started_at) VALUES (?, ?, ?, 'building', ?, ?, ?)",
    )
    .bind(&deployment_id)
    .bind(&project_id)
    .bind(&canister_name)
    .bind(&commit_sha)
    .bind(&commit_message)
    .bind(&now)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    // Get the user's IC identity PEM for the background task
    let ic_pem = auth_user
        .user
        .ic_identity_pem
        .clone()
        .ok_or_else(|| AppError::Internal("User has no IC identity".into()))?;

    let existing_canister_id = canister.canister_id.clone();
    let canister_db_id = canister.id.clone();
    let db = state.db.clone();
    let deploy_id = deployment_id.clone();

    // Spawn background deploy pipeline
    tokio::spawn(async move {
        run_deploy_pipeline(
            db,
            deploy_id,
            ic_pem,
            wasm_path,
            existing_canister_id,
            canister_db_id,
        )
        .await;
    });

    Ok(Json(json!({
        "deployment_id": deployment_id,
        "status": "building",
        "status_url": format!("/api/v1/deploy/{}/status", deployment_id),
    })))
}

// -- Background deploy pipeline --

async fn run_deploy_pipeline(
    db: DbPool,
    deployment_id: String,
    ic_pem: String,
    wasm_path: String,
    existing_canister_id: Option<String>,
    canister_db_id: String,
) {
    // Step 1: Log starting
    insert_log(&db, &deployment_id, "info", "Starting deployment...").await;
    update_deployment_status(&db, &deployment_id, "deploying", None).await;

    // Read wasm from temp file
    let wasm_bytes = match tokio::fs::read(&wasm_path).await {
        Ok(bytes) => bytes,
        Err(e) => {
            let msg = format!("Failed to read wasm file: {e}");
            insert_log(&db, &deployment_id, "error", &msg).await;
            update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
            return;
        }
    };

    // Clean up temp file (best effort)
    let _ = tokio::fs::remove_file(&wasm_path).await;

    // Step 2: Create IC agent
    let client = match IcClient::new(&ic_pem).await {
        Ok(c) => c,
        Err(e) => {
            let msg = format!("Failed to create IC agent: {e}");
            insert_log(&db, &deployment_id, "error", &msg).await;
            update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
            return;
        }
    };

    // Step 3: Create canister if needed, or use existing
    let (canister_id, is_upgrade) = if let Some(cid) = existing_canister_id {
        insert_log(
            &db,
            &deployment_id,
            "info",
            &format!("Upgrading canister: {cid}"),
        )
        .await;
        (cid, true)
    } else {
        insert_log(&db, &deployment_id, "info", "Creating new canister...").await;
        match client.create_canister().await {
            Ok(cid) => {
                insert_log(
                    &db,
                    &deployment_id,
                    "info",
                    &format!("Created canister: {cid}"),
                )
                .await;

                // Update canister record with the new canister_id
                let _ = sqlx::query(
                    "UPDATE canisters SET canister_id = ?, status = 'created', updated_at = datetime('now') WHERE id = ?",
                )
                .bind(&cid)
                .bind(&canister_db_id)
                .execute(&db)
                .await;

                (cid, false)
            }
            Err(e) => {
                let msg = format!("Failed to create canister: {e}");
                insert_log(&db, &deployment_id, "error", &msg).await;
                update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
                return;
            }
        }
    };

    // Step 4: Install code
    insert_log(
        &db,
        &deployment_id,
        "info",
        &format!(
            "Installing code ({})...",
            if is_upgrade { "upgrade" } else { "install" }
        ),
    )
    .await;

    match client
        .install_code(&canister_id, wasm_bytes, is_upgrade)
        .await
    {
        Ok(()) => {
            insert_log(&db, &deployment_id, "info", "Code installed successfully").await;
        }
        Err(e) => {
            let msg = format!("install_code failed: {e}");
            insert_log(&db, &deployment_id, "error", &msg).await;
            update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
            return;
        }
    }

    // Step 5: Update canister status
    let _ = sqlx::query(
        "UPDATE canisters SET status = 'running', updated_at = datetime('now') WHERE id = ?",
    )
    .bind(&canister_db_id)
    .execute(&db)
    .await;

    // Step 6: Success
    let live_url = format!("https://{canister_id}.ic0.app");
    insert_log(
        &db,
        &deployment_id,
        "info",
        &format!("Live at {live_url}"),
    )
    .await;
    update_deployment_status(&db, &deployment_id, "live", None).await;

    tracing::info!(
        deployment_id = %deployment_id,
        canister_id = %canister_id,
        "Deployment completed successfully"
    );
}

// -- GET /api/v1/deploy/:deploy_id/status --

pub async fn deploy_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Fetch deployment record
    let deployment: DeploymentRecord = sqlx::query_as(
        "SELECT * FROM deployments WHERE id = ?",
    )
    .bind(&deploy_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Deployment not found".into()))?;

    // Verify project belongs to user
    let _project: crate::models::Project =
        sqlx::query_as("SELECT * FROM projects WHERE id = ? AND user_id = ?")
            .bind(&deployment.project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?
            .ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Find canister_id for this deployment's canister
    let canister: Option<crate::models::CanisterRecord> = sqlx::query_as(
        "SELECT id, project_id, name, type AS canister_type, canister_id, subnet_id, status, cycles_balance, created_at, updated_at FROM canisters WHERE project_id = ? AND name = ?",
    )
    .bind(&deployment.project_id)
    .bind(&deployment.canister_name)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?;

    let canister_id = canister.and_then(|c| c.canister_id);

    let url = if deployment.status == "live" {
        canister_id
            .as_ref()
            .map(|cid| format!("https://{cid}.ic0.app"))
    } else {
        None
    };

    let response = DeployStatusResponse {
        deployment_id: deployment.id,
        status: deployment.status,
        url,
        canister_id,
        error: deployment.error_message,
    };

    Ok(Json(json!(response)))
}

// -- GET /api/v1/deploy/:deploy_id/logs --

pub async fn deploy_logs(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Fetch deployment to verify ownership
    let deployment: DeploymentRecord = sqlx::query_as(
        "SELECT * FROM deployments WHERE id = ?",
    )
    .bind(&deploy_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Deployment not found".into()))?;

    // Verify project belongs to user
    let _project: crate::models::Project =
        sqlx::query_as("SELECT * FROM projects WHERE id = ? AND user_id = ?")
            .bind(&deployment.project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?
            .ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Fetch logs
    let logs: Vec<DeployLog> = sqlx::query_as(
        "SELECT * FROM deploy_logs WHERE deployment_id = ? ORDER BY timestamp ASC, id ASC",
    )
    .bind(&deploy_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let log_entries: Vec<DeployLogEntry> = logs
        .into_iter()
        .map(|l| DeployLogEntry {
            level: l.level,
            message: l.message,
            timestamp: l.timestamp,
        })
        .collect();

    Ok(Json(json!({
        "logs": log_entries,
    })))
}
