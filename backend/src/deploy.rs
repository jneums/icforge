use axum::{
    extract::{Multipart, Path, State},
    Json,
};
use candid::Principal;
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
        "INSERT INTO deploy_logs (deployment_id, level, message, timestamp) VALUES ($1, $2, $3, $4)",
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
            "UPDATE deployments SET status = $1, error_message = $2, completed_at = $3 WHERE id = $4",
        )
        .bind(status)
        .bind(err)
        .bind(&now)
        .bind(deployment_id)
        .execute(db)
        .await;
    } else {
        let _ = sqlx::query(
            "UPDATE deployments SET status = $1, completed_at = $2 WHERE id = $3",
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
    let mut assets_bytes: Option<Vec<u8>> = None;
    let mut commit_sha: Option<String> = None;
    let mut commit_message: Option<String> = None;
    let mut init_arg_hex: Option<String> = None;
    let mut candid_text: Option<String> = None;

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
            "assets" => {
                assets_bytes = Some(
                    field
                        .bytes()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read assets tarball: {e}")))?
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
            "init_arg" => {
                init_arg_hex = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read init_arg: {e}")))?,
                );
            }
            "candid" => {
                candid_text = Some(
                    field
                        .text()
                        .await
                        .map_err(|e| AppError::BadRequest(format!("Failed to read candid: {e}")))?,
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
        sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
            .bind(&project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    let _project =
        project_row.ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Find canister record
    let canister_row: Option<crate::models::CanisterRecord> = sqlx::query_as(
        "SELECT * FROM canisters WHERE project_id = $1 AND name = $2",
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

    // Save assets tarball to /tmp if provided
    let assets_path = if let Some(assets) = assets_bytes {
        if assets.is_empty() {
            None
        } else {
            let path = format!("/tmp/icforge_assets_{}.tar.gz", deployment_id);
            tokio::fs::write(&path, &assets)
                .await
                .map_err(|e| AppError::Internal(format!("Failed to save assets to temp: {e}")))?;
            Some(path)
        }
    } else {
        None
    };

    // Create deployment record with status='building'
    let now = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    sqlx::query(
        "INSERT INTO deployments (id, project_id, canister_name, status, commit_sha, commit_message, started_at) VALUES ($1, $2, $3, 'building', $4, $5, $6)",
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

    // Use platform IC identity for canister creation (cycles pool model)
    let ic_pem = state.config.ic_identity_pem
        .clone()
        .ok_or_else(|| AppError::Internal("Platform IC_IDENTITY_PEM not configured".into()))?;

    let existing_canister_id = canister.canister_id.clone();
    let canister_db_id = canister.id.clone();
    let canister_type = canister.canister_type.clone();
    let db = state.db.clone();
    let deploy_id = deployment_id.clone();
    let ic_url = state.config.ic_url.clone();

    // Decode hex-encoded init_arg if provided
    let init_arg_bytes: Option<Vec<u8>> = match init_arg_hex {
        Some(hex_str) => {
            let cleaned = hex_str.strip_prefix("0x").unwrap_or(&hex_str);
            Some(
                hex::decode(cleaned)
                    .map_err(|e| AppError::BadRequest(format!("Invalid hex in init_arg: {e}")))?,
            )
        }
        None => None,
    };

    // Spawn background deploy pipeline
    tokio::spawn(async move {
        run_deploy_pipeline(
            db,
            deploy_id,
            ic_pem,
            ic_url,
            wasm_path,
            assets_path,
            existing_canister_id,
            canister_db_id,
            init_arg_bytes,
            candid_text,
            canister_type,
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
    ic_url: String,
    wasm_path: String,
    assets_path: Option<String>,
    existing_canister_id: Option<String>,
    canister_db_id: String,
    init_arg: Option<Vec<u8>>,
    candid: Option<String>,
    canister_type: String,
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
    let client = match IcClient::new(&ic_pem, &ic_url).await {
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
                    "UPDATE canisters SET canister_id = $1, status = 'created', updated_at = $2 WHERE id = $3",
                )
                .bind(&cid)
                .bind(chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string())
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
        .install_code(&canister_id, wasm_bytes, is_upgrade, init_arg)
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

    // Step 4.5: Sync static assets if a tarball was provided (frontend canisters only)
    if canister_type == "frontend" {
    if let Some(tarball_path) = assets_path {
        insert_log(&db, &deployment_id, "info", "Syncing static assets...").await;

        // Extract tarball to a temp directory
        let assets_dir = format!("/tmp/icforge_assets_extracted_{}", deployment_id);
        match extract_assets_tarball(&tarball_path, &assets_dir).await {
            Ok(()) => {}
            Err(e) => {
                let msg = format!("Failed to extract assets tarball: {e}");
                insert_log(&db, &deployment_id, "error", &msg).await;
                update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
                let _ = tokio::fs::remove_file(&tarball_path).await;
                let _ = tokio::fs::remove_dir_all(&assets_dir).await;
                return;
            }
        }

        // Clean up tarball
        let _ = tokio::fs::remove_file(&tarball_path).await;

        // Build Canister object and sync assets
        let canister_principal = match Principal::from_text(&canister_id) {
            Ok(p) => p,
            Err(e) => {
                let msg = format!("Invalid canister principal for asset sync: {e}");
                insert_log(&db, &deployment_id, "error", &msg).await;
                update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
                let _ = tokio::fs::remove_dir_all(&assets_dir).await;
                return;
            }
        };

        let canister = match ic_utils::Canister::builder()
            .with_canister_id(canister_principal)
            .with_agent(client.agent())
            .build()
        {
            Ok(c) => c,
            Err(e) => {
                let msg = format!("Failed to build Canister object for asset sync: {e}");
                insert_log(&db, &deployment_id, "error", &msg).await;
                update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
                let _ = tokio::fs::remove_dir_all(&assets_dir).await;
                return;
            }
        };

        let logger = slog::Logger::root(slog::Discard, slog::o!());
        let assets_path_buf = std::path::PathBuf::from(&assets_dir);
        match ic_asset::sync(&canister, &[assets_path_buf.as_path()], false, &logger, None).await {
            Ok(()) => {
                insert_log(&db, &deployment_id, "info", "Assets synced successfully").await;
            }
            Err(e) => {
                let msg = format!("Asset sync failed: {e}");
                insert_log(&db, &deployment_id, "error", &msg).await;
                update_deployment_status(&db, &deployment_id, "failed", Some(&msg)).await;
                let _ = tokio::fs::remove_dir_all(&assets_dir).await;
                return;
            }
        }

        // Clean up extracted assets
        let _ = tokio::fs::remove_dir_all(&assets_dir).await;
    }
    } // end if canister_type == "frontend"

    // Step 5: Update canister status
    let _ = sqlx::query(
        "UPDATE canisters SET status = 'running', updated_at = $1 WHERE id = $2",
    )
    .bind(chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string())
    .bind(&canister_db_id)
    .execute(&db)
    .await;

    // Step 5.5: Store candid interface if provided
    if let Some(candid_text) = candid {
        let _ = sqlx::query(
            "UPDATE canisters SET candid_interface = $1 WHERE id = $2",
        )
        .bind(&candid_text)
        .bind(&canister_db_id)
        .execute(&db)
        .await;
        insert_log(&db, &deployment_id, "info", "Candid interface stored").await;
    }

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
        "SELECT * FROM deployments WHERE id = $1",
    )
    .bind(&deploy_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Deployment not found".into()))?;

    // Verify project belongs to user
    let _project: crate::models::Project =
        sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
            .bind(&deployment.project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?
            .ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Find canister_id for this deployment's canister
    let canister: Option<crate::models::CanisterRecord> = sqlx::query_as(
        "SELECT * FROM canisters WHERE project_id = $1 AND name = $2",
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
        "SELECT * FROM deployments WHERE id = $1",
    )
    .bind(&deploy_id)
    .fetch_optional(&state.db)
    .await
    .map_err(AppError::Database)?
    .ok_or_else(|| AppError::NotFound("Deployment not found".into()))?;

    // Verify project belongs to user
    let _project: crate::models::Project =
        sqlx::query_as("SELECT * FROM projects WHERE id = $1 AND user_id = $2")
            .bind(&deployment.project_id)
            .bind(&auth_user.user.id)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?
            .ok_or_else(|| AppError::NotFound("Project not found or not owned by user".into()))?;

    // Fetch logs
    let logs: Vec<DeployLog> = sqlx::query_as(
        "SELECT * FROM deploy_logs WHERE deployment_id = $1 ORDER BY timestamp ASC, id ASC",
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

// -- Helper: extract a .tar.gz assets tarball to a directory --

async fn extract_assets_tarball(tarball_path: &str, dest_dir: &str) -> Result<(), String> {
    let tarball_path = tarball_path.to_string();
    let dest_dir = dest_dir.to_string();

    // Do blocking I/O in a spawn_blocking context
    tokio::task::spawn_blocking(move || {
        use flate2::read::GzDecoder;
        use tar::Archive;

        let file = std::fs::File::open(&tarball_path)
            .map_err(|e| format!("Failed to open tarball {tarball_path}: {e}"))?;
        let gz = GzDecoder::new(file);
        let mut archive = Archive::new(gz);

        std::fs::create_dir_all(&dest_dir)
            .map_err(|e| format!("Failed to create assets dir {dest_dir}: {e}"))?;

        archive
            .unpack(&dest_dir)
            .map_err(|e| format!("Failed to extract tarball: {e}"))?;

        Ok(())
    })
    .await
    .map_err(|e| format!("spawn_blocking failed: {e}"))?
}
