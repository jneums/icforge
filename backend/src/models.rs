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
    pub error_message: Option<String>,
    pub started_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, sqlx::FromRow)]
pub struct DeployLog {
    pub id: i64,
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
}
