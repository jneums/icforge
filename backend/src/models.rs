use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct User {
    pub id: String,
    pub github_id: i64,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
    #[serde(skip_serializing)]
    pub ic_identity_pem: Option<String>,
    pub ic_principal: Option<String>,
    pub plan: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct Project {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub slug: String,
    pub custom_domain: Option<String>,
    pub subnet_id: Option<String>,
    pub github_repo_id: Option<String>,
    pub production_branch: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CanisterRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub canister_type: String,
    pub canister_id: Option<String>,
    pub subnet_id: Option<String>,
    pub status: String,
    pub cycles_balance: Option<i64>,
    pub candid_interface: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DeploymentRecord {
    pub id: String,
    pub project_id: String,
    pub canister_name: String,
    pub status: String,
    pub commit_sha: Option<String>,
    pub commit_message: Option<String>,
    pub branch: Option<String>,
    pub repo_full_name: Option<String>,
    pub error_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DeployLog {
    pub id: i32,
    pub deployment_id: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

// Request types
#[derive(Debug, Deserialize)]
pub struct CreateProjectRequest {
    pub name: String,
    pub canisters: Vec<CreateCanisterInput>,
    pub subnet: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateCanisterInput {
    pub name: String,
    #[serde(rename = "type")]
    pub canister_type: String,
}

// Response types
#[derive(Debug, Serialize)]
pub struct ProjectWithCanisters {
    #[serde(flatten)]
    pub project: Project,
    pub canisters: Vec<CanisterRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latest_deployment: Option<DeploymentRecord>,
}

// ============================================================
// GitHub App models
// ============================================================

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct GitHubInstallation {
    pub id: String,
    pub user_id: String,
    pub installation_id: i64,
    pub account_login: String,
    pub account_type: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct GitHubRepo {
    pub id: String,
    pub installation_id: String,
    pub github_repo_id: i64,
    pub full_name: String,
    pub default_branch: String,
    pub created_at: String,
}

// ============================================================
// Build pipeline models
// ============================================================

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct BuildJob {
    pub id: String,
    pub project_id: String,
    pub deployment_id: Option<String>,
    pub commit_sha: String,
    pub branch: String,
    pub repo_full_name: String,
    pub installation_id: i64,
    pub trigger: String,
    pub pr_number: Option<i32>,
    pub status: String,
    pub claimed_at: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub framework: Option<String>,
    pub build_duration_ms: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct BuildLog {
    pub id: i32,
    pub build_job_id: String,
    pub level: String,
    pub message: String,
    pub phase: Option<String>,
    pub timestamp: String,
}

// ============================================================
// API token models
// ============================================================

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ApiToken {
    pub id: String,
    pub user_id: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub token_hash: String,
    pub last_used_at: Option<String>,
    pub expires_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CreateTokenRequest {
    pub name: String,
    pub expires_in_days: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct CreateTokenResponse {
    pub token: String,
    pub id: String,
    pub name: String,
    pub expires_at: Option<String>,
}
