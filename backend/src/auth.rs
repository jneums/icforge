use axum::{
    extract::FromRequestParts,
    http::request::Parts,
};
use chrono::Utc;
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::models::User;
use crate::AppState;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: i64,
    pub iat: i64,
}

pub fn create_token(user_id: &str, secret: &str) -> Result<String, AppError> {
    let now = Utc::now().timestamp();
    let claims = Claims {
        sub: user_id.to_string(),
        iat: now,
        exp: now + 86400 * 7, // 7 days
    };
    encode(
        &Header::default(),
        &claims,
        &EncodingKey::from_secret(secret.as_bytes()),
    )
    .map_err(|e| AppError::Internal(format!("Failed to create token: {e}")))
}

pub fn verify_token(token: &str, secret: &str) -> Result<Claims, AppError> {
    let token_data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(secret.as_bytes()),
        &Validation::default(),
    )
    .map_err(|e| AppError::Unauthorized(format!("Invalid token: {e}")))?;
    Ok(token_data.claims)
}

#[derive(Debug, Deserialize)]
pub struct GitHubUser {
    pub id: i64,
    pub login: String,
    pub email: Option<String>,
    pub name: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GitHubTokenResponse {
    access_token: String,
}

pub async fn exchange_github_code(
    client_id: &str,
    client_secret: &str,
    code: &str,
) -> Result<String, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://github.com/login/oauth/access_token")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "client_id": client_id,
            "client_secret": client_secret,
            "code": code,
        }))
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub OAuth request failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub OAuth token exchange failed: {body}"
        )));
    }

    let token_resp: GitHubTokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse GitHub token response: {e}")))?;

    Ok(token_resp.access_token)
}

pub async fn get_github_user(access_token: &str) -> Result<GitHubUser, AppError> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.github.com/user")
        .header("Authorization", format!("Bearer {access_token}"))
        .header("User-Agent", "ICForge")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub user request failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub user API failed: {body}"
        )));
    }

    let user: GitHubUser = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse GitHub user: {e}")))?;

    Ok(user)
}

/// Extractor that validates JWT and loads user from DB
pub struct AuthUser {
    pub user: User,
}

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> impl std::future::Future<Output = Result<Self, Self::Rejection>> + Send {
        let db = state.db.clone();
        let jwt_secret = state.config.jwt_secret.clone();
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        async move {
            let header = auth_header
                .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".into()))?;

            let token = header
                .strip_prefix("Bearer ")
                .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".into()))?;

            let claims = verify_token(token, &jwt_secret)?;

            let user: User = sqlx::query_as("SELECT * FROM users WHERE id = ?")
                .bind(&claims.sub)
                .fetch_optional(&db)
                .await
                .map_err(AppError::Database)?
                .ok_or_else(|| AppError::Unauthorized("User not found".into()))?;

            Ok(AuthUser { user })
        }
    }
}
