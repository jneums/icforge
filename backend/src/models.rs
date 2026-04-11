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
    pub stripe_customer_id: Option<String>,
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
    /// Log retention in hours (1, 24, 168=7d, 720=30d). Default 24.
    pub log_retention_hours: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CanisterRecord {
    pub id: String,
    pub project_id: String,
    pub name: String,
    /// icp-cli recipe (e.g. "rust@v3.1.0", "asset-canister@v2.1.0")
    pub recipe: String,
    pub canister_id: Option<String>,
    pub subnet_id: Option<String>,
    pub status: String,
    pub cycles_balance: Option<i64>,
    pub candid_interface: Option<String>,
    /// Legacy `type` column — nullable, kept for backward compat
    #[sqlx(rename = "type")]
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub canister_type: Option<String>,
    pub cycles_alert_threshold: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
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
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    // Fields merged from former build_jobs table:
    pub installation_id: Option<i64>,
    pub trigger: Option<String>,
    pub pr_number: Option<i32>,
    pub claimed_at: Option<String>,
    pub retry_count: i32,
    pub build_duration_ms: Option<i32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DeployLog {
    pub id: i32,
    pub deployment_id: String,
    pub level: String,
    pub message: String,
    pub timestamp: String,
}

/// Runtime canister log entry (from IC management canister's fetch_canister_logs)
#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CanisterLog {
    pub id: String,
    pub canister_id: String,      // DB canister record ID
    pub ic_canister_id: String,   // actual IC canister ID
    pub log_index: i64,
    pub level: String,
    pub message: String,
    pub ic_timestamp: i64,        // nanosecond timestamp from IC
    pub collected_at: String,
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
    /// Recipe string from icp.yaml (e.g. "rust@v3.1.0", "asset-canister@v2.1.0")
    pub recipe: Option<String>,
}

/// CLI/dashboard-triggered deployment request
#[derive(Debug, Deserialize)]
pub struct TriggerDeployRequest {
    pub project_id: String,
    pub commit_sha: String,
    pub branch: String,
    pub commit_message: Option<String>,
    pub canister_name: Option<String>,
    pub trigger: Option<String>,
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

// ============================================================
// Billing models
// ============================================================

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ComputeBalance {
    pub id: String,
    pub user_id: String,
    pub balance_cents: i32,
    pub auto_topup_enabled: bool,
    pub auto_topup_threshold_cents: Option<i32>,
    pub auto_topup_amount_cents: Option<i32>,
    pub credits_expire_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct ComputeTransaction {
    pub id: String,
    pub user_id: String,
    #[sqlx(rename = "type")]
    #[serde(rename = "type")]
    pub tx_type: String,
    pub amount_cents: i32,
    pub category: Option<String>,
    pub source: Option<String>,
    pub stripe_payment_id: Option<String>,
    pub description: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CyclesSnapshot {
    pub id: String,
    pub canister_id: String,
    pub ic_canister_id: String,
    pub cycles_balance: i64,
    pub memory_size: i64,
    pub status: String,
    pub recorded_at: String,
    // Extended fields (migration 015)
    pub idle_cycles_burned_per_day: Option<i64>,
    pub reserved_cycles: Option<i64>,
    pub reserved_cycles_limit: Option<i64>,
    pub compute_allocation: Option<i64>,
    pub memory_allocation: Option<i64>,
    pub freezing_threshold: Option<i64>,
    pub module_hash: Option<String>,
    pub query_num_calls: Option<i64>,
    pub query_num_instructions: Option<i64>,
    pub query_request_payload_bytes: Option<i64>,
    pub query_response_payload_bytes: Option<i64>,
    pub wasm_memory_limit: Option<i64>,
    pub wasm_memory_threshold: Option<i64>,
    // Memory breakdown fields (migration 017 — from IC MemoryMetrics)
    pub wasm_memory_size: Option<i64>,
    pub stable_memory_size: Option<i64>,
    pub global_memory_size: Option<i64>,
    pub canister_history_size: Option<i64>,
    pub snapshots_size: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct CanisterTopup {
    pub id: String,
    pub canister_id: String,
    pub ic_canister_id: String,
    pub user_id: String,
    pub cycles_amount: i64,
    pub cost_cents: i32,
    pub source: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
pub struct CheckoutRequest {
    pub amount: i32, // dollar amount, min $5
}

#[derive(Debug, Deserialize)]
pub struct AutoTopupRequest {
    pub enabled: bool,
    pub threshold_cents: Option<i32>,
    pub amount_cents: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct CyclesSettingsRequest {
    pub alert_threshold: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct ManualTopupRequest {
    /// Cycles amount to deposit (e.g. 2_000_000_000_000 = 2T)
    pub amount: i64,
}

#[derive(Debug, Deserialize)]
pub struct LogRetentionRequest {
    /// Retention in hours. Allowed: 1, 24, 168 (7d), 720 (30d).
    pub log_retention_hours: i32,
}
