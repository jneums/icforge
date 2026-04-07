use axum::{
    extract::{Path, State},
    response::sse::{Event, KeepAlive, Sse},
    Json,
};
use futures::stream::Stream;
use serde::Serialize;
use serde_json::{json, Value};
use std::convert::Infallible;
use tokio::sync::broadcast;

use crate::auth::AuthUser;
use crate::db::DbPool;
use crate::error::AppError;
use crate::models::{DeployLog, DeploymentRecord};
use crate::{AppState, LogEvent};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_sha: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_full_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DeployLogEntry {
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

// -- GET /api/v1/deploy/:deploy_id/status --

pub async fn deploy_status(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Result<Json<Value>, AppError> {
    // Fetch deployment record
    let deployment: DeploymentRecord = sqlx::query_as("SELECT * FROM deployments WHERE id = $1")
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
    let canister: Option<crate::models::CanisterRecord> =
        sqlx::query_as("SELECT * FROM canisters WHERE project_id = $1 AND name = $2")
            .bind(&deployment.project_id)
            .bind(&deployment.canister_name)
            .fetch_optional(&state.db)
            .await
            .map_err(AppError::Database)?;

    let canister_id = canister.and_then(|c| c.canister_id);

    let url = if deployment.status == "live" {
        canister_id
            .as_ref()
            .map(|cid| format!("https://{cid}.icp0.io"))
    } else {
        None
    };

    let response = DeployStatusResponse {
        deployment_id: deployment.id,
        status: deployment.status,
        url,
        canister_id,
        error: deployment.error_message,
        commit_sha: deployment.commit_sha,
        commit_message: deployment.commit_message,
        branch: deployment.branch,
        repo_full_name: deployment.repo_full_name,
        started_at: Some(deployment.started_at),
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
    let deployment: DeploymentRecord = sqlx::query_as("SELECT * FROM deployments WHERE id = $1")
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

    // Fetch logs — prefer deploy_logs (CLI path), fall back to build_logs (git push path)
    let logs: Vec<DeployLog> = sqlx::query_as(
        "SELECT * FROM deploy_logs WHERE deployment_id = $1 ORDER BY timestamp ASC, id ASC",
    )
    .bind(&deploy_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let log_entries: Vec<DeployLogEntry> = if !logs.is_empty() {
        logs.into_iter()
            .map(|l| DeployLogEntry {
                level: l.level,
                message: l.message,
                timestamp: l.timestamp,
            })
            .collect()
    } else if let Some(ref build_job_id) = deployment.build_job_id {
        // Fall back to build_logs for git-push deployments
        let build_logs: Vec<crate::models::BuildLog> = sqlx::query_as(
            "SELECT * FROM build_logs WHERE build_job_id = $1 ORDER BY id ASC",
        )
        .bind(build_job_id)
        .fetch_all(&state.db)
        .await
        .map_err(AppError::Database)?;

        build_logs
            .into_iter()
            .map(|l| DeployLogEntry {
                level: l.level,
                message: l.message,
                timestamp: l.timestamp,
            })
            .collect()
    } else {
        vec![]
    };

    Ok(Json(json!({
        "logs": log_entries,
    })))
}

// -- GET /api/v1/deploy/{deploy_id}/logs/stream (SSE) --

pub async fn deploy_logs_stream(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Path(deploy_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, AppError> {
    // Fetch deployment to verify ownership
    let deployment: DeploymentRecord = sqlx::query_as("SELECT * FROM deployments WHERE id = $1")
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

    // Replay existing logs from DB — prefer deploy_logs, fall back to build_logs
    let existing_logs: Vec<DeployLog> = sqlx::query_as(
        "SELECT * FROM deploy_logs WHERE deployment_id = $1 ORDER BY timestamp ASC, id ASC",
    )
    .bind(&deploy_id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let replay_entries: Vec<DeployLogEntry> = if !existing_logs.is_empty() {
        existing_logs
            .into_iter()
            .map(|l| DeployLogEntry {
                level: l.level,
                message: l.message,
                timestamp: l.timestamp,
            })
            .collect()
    } else if let Some(ref build_job_id) = deployment.build_job_id {
        let build_logs: Vec<crate::models::BuildLog> = sqlx::query_as(
            "SELECT * FROM build_logs WHERE build_job_id = $1 ORDER BY id ASC",
        )
        .bind(build_job_id)
        .fetch_all(&state.db)
        .await
        .map_err(AppError::Database)?;

        build_logs
            .into_iter()
            .map(|l| DeployLogEntry {
                level: l.level,
                message: l.message,
                timestamp: l.timestamp,
            })
            .collect()
    } else {
        vec![]
    };

    let status = deployment.status.clone();

    // Subscribe to broadcast channel for new logs (if still active)
    let rx = state
        .log_channels
        .get(&deploy_id)
        .map(|entry| entry.value().subscribe());

    let stream = async_stream::stream! {
        // Phase 1: replay existing logs
        for entry in replay_entries {
            let evt = LogEvent {
                level: entry.level,
                message: entry.message,
                timestamp: entry.timestamp,
            };
            let data = serde_json::to_string(&evt).unwrap_or_default();
            yield Ok(Event::default().event("log").data(data));
        }

        // Send current status
        yield Ok(Event::default().event("status").data(&status));

        // If deployment is already terminal, send done and return
        let is_terminal = matches!(status.as_str(), "live" | "failed");
        if is_terminal {
            yield Ok(Event::default().event("done").data(&status));
            return;
        }

        // Phase 2: stream new logs from broadcast channel
        if let Some(mut rx) = rx {
            loop {
                match rx.recv().await {
                    Ok(evt) => {
                        let is_done_msg = evt.message.starts_with("Live at ")
                            || evt.level == "error";
                        let data = serde_json::to_string(&evt).unwrap_or_default();
                        yield Ok(Event::default().event("log").data(data));

                        // After a terminal log, check DB for final status
                        if is_done_msg {
                            // Small delay to let status update propagate
                            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                            let final_status: Option<(String,)> = sqlx::query_as(
                                "SELECT status FROM deployments WHERE id = $1",
                            )
                            .bind(&deploy_id)
                            .fetch_optional(&state.db)
                            .await
                            .ok()
                            .flatten();

                            if let Some((s,)) = final_status {
                                if matches!(s.as_str(), "live" | "failed") {
                                    yield Ok(Event::default().event("status").data(&s));
                                    yield Ok(Event::default().event("done").data(&s));
                                    break;
                                }
                            }
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        let msg = format!("Skipped {n} log messages");
                        yield Ok(Event::default().event("log").data(
                            serde_json::to_string(&LogEvent {
                                level: "warn".to_string(),
                                message: msg,
                                timestamp: chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
                            }).unwrap_or_default()
                        ));
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        // Channel closed — deployment finished
                        let final_status: Option<(String,)> = sqlx::query_as(
                            "SELECT status FROM deployments WHERE id = $1",
                        )
                        .bind(&deploy_id)
                        .fetch_optional(&state.db)
                        .await
                        .ok()
                        .flatten();

                        let s = final_status.map(|(s,)| s).unwrap_or_else(|| "unknown".to_string());
                        yield Ok(Event::default().event("status").data(&s));
                        yield Ok(Event::default().event("done").data(&s));
                        break;
                    }
                }
            }
        } else {
            // No broadcast channel — deployment may have already completed
            // We already replayed logs and sent status above
            yield Ok(Event::default().event("done").data(&status));
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}
