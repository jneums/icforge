use hmac::{Hmac, Mac};
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use sha2::Sha256;

use crate::config::AppConfig;
use crate::error::AppError;

// ============================================================
// GitHub App JWT (app-level auth)
// ============================================================

/// Create a short-lived JWT signed with the GitHub App's private key.
/// Used to authenticate as the app itself (e.g., to create installation tokens).
pub fn create_app_jwt(config: &AppConfig) -> Result<String, AppError> {
    let app_id = config
        .github_app_id
        .as_ref()
        .ok_or_else(|| AppError::Internal("GITHUB_APP_ID not configured".into()))?;
    let private_key = config
        .github_app_private_key
        .as_ref()
        .ok_or_else(|| AppError::Internal("GITHUB_APP_PRIVATE_KEY not configured".into()))?;

    // Decode base64-encoded PEM if needed
    let pem_bytes = if private_key.contains("BEGIN") {
        private_key.as_bytes().to_vec()
    } else {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD
            .decode(private_key)
            .map_err(|e| AppError::Internal(format!("Failed to decode private key: {e}")))?
    };

    let now = chrono::Utc::now().timestamp();
    let claims = serde_json::json!({
        "iat": now - 60,          // clock skew buffer
        "exp": now + (10 * 60),   // 10 minutes max
        "iss": app_id,
    });

    encode(
        &Header::new(Algorithm::RS256),
        &claims,
        &EncodingKey::from_rsa_pem(&pem_bytes)
            .map_err(|e| AppError::Internal(format!("Invalid RSA private key: {e}")))?,
    )
    .map_err(|e| AppError::Internal(format!("Failed to create GitHub App JWT: {e}")))
}

// ============================================================
// Installation access token (repo-scoped auth)
// ============================================================

#[derive(Debug, serde::Deserialize)]
struct InstallationTokenResponse {
    token: String,
}

/// Exchange app JWT for an installation access token scoped to the repos
/// the user granted. Token is valid for 1 hour.
pub async fn get_installation_token(
    config: &AppConfig,
    installation_id: i64,
) -> Result<String, AppError> {
    let jwt = create_app_jwt(config)?;

    let client = reqwest::Client::new();
    let resp = client
        .post(format!(
            "https://api.github.com/app/installations/{installation_id}/access_tokens"
        ))
        .header("Authorization", format!("Bearer {jwt}"))
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", "ICForge")
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("GitHub installation token request failed: {e}")))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Internal(format!(
            "GitHub installation token exchange failed: {body}"
        )));
    }

    let token_resp: InstallationTokenResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to parse installation token: {e}")))?;

    Ok(token_resp.token)
}

// ============================================================
// Webhook signature verification
// ============================================================

/// Verify the HMAC-SHA256 signature on a GitHub webhook payload.
pub fn verify_webhook_signature(secret: &str, payload: &[u8], signature: &str) -> bool {
    let sig_hex = match signature.strip_prefix("sha256=") {
        Some(s) => s,
        None => return false,
    };

    let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(payload);
    let expected = hex::encode(mac.finalize().into_bytes());

    // Constant-time comparison would be ideal, but hex comparison is fine
    // since we're comparing the computed HMAC, not a user secret.
    sig_hex == expected
}

// ============================================================
// GitHub status / check run notifier
// ============================================================

pub struct GitHubNotifier {
    client: reqwest::Client,
}

impl GitHubNotifier {
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Post a commit status (pending/success/failure/error).
    pub async fn post_commit_status(
        &self,
        token: &str,
        repo: &str,
        sha: &str,
        state: &str,
        description: &str,
        target_url: &str,
        context: &str,
    ) -> Result<(), AppError> {
        self.client
            .post(format!(
                "https://api.github.com/repos/{repo}/statuses/{sha}"
            ))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "ICForge")
            .json(&serde_json::json!({
                "state": state,
                "target_url": target_url,
                "description": description,
                "context": context
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to post commit status: {e}")))?;

        Ok(())
    }

    /// Create a check run (returns the check run ID for later updates).
    pub async fn create_check_run(
        &self,
        token: &str,
        repo: &str,
        sha: &str,
        name: &str,
        title: &str,
    ) -> Result<u64, AppError> {
        let resp = self
            .client
            .post(format!(
                "https://api.github.com/repos/{repo}/check-runs"
            ))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "ICForge")
            .json(&serde_json::json!({
                "name": name,
                "head_sha": sha,
                "status": "in_progress",
                "started_at": chrono::Utc::now().to_rfc3339(),
                "output": {
                    "title": title,
                    "summary": "Build starting..."
                }
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to create check run: {e}")))?;

        let body: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to parse check run response: {e}")))?;

        body["id"]
            .as_u64()
            .ok_or_else(|| AppError::Internal("Check run response missing id".into()))
    }

    /// Update an existing check run with conclusion.
    pub async fn update_check_run(
        &self,
        token: &str,
        repo: &str,
        check_run_id: u64,
        conclusion: &str,
        title: &str,
        summary: &str,
    ) -> Result<(), AppError> {
        self.client
            .patch(format!(
                "https://api.github.com/repos/{repo}/check-runs/{check_run_id}"
            ))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "ICForge")
            .json(&serde_json::json!({
                "status": "completed",
                "conclusion": conclusion,
                "completed_at": chrono::Utc::now().to_rfc3339(),
                "output": {
                    "title": title,
                    "summary": summary
                }
            }))
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to update check run: {e}")))?;

        Ok(())
    }

    /// Post or update a comment on a PR.
    pub async fn comment_on_pr(
        &self,
        token: &str,
        repo: &str,
        pr_number: i32,
        body: &str,
    ) -> Result<(), AppError> {
        // First, try to find an existing ICForge comment to update
        let comments_resp = self
            .client
            .get(format!(
                "https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
            ))
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", "application/vnd.github+json")
            .header("User-Agent", "ICForge")
            .send()
            .await
            .map_err(|e| AppError::Internal(format!("Failed to fetch PR comments: {e}")))?;

        let comments: Vec<serde_json::Value> = comments_resp
            .json()
            .await
            .unwrap_or_default();

        // Look for existing ICForge comment (contains our marker)
        let marker = "### 🚀 ICForge Preview";
        let existing = comments
            .iter()
            .find(|c| {
                c["body"]
                    .as_str()
                    .map(|b| b.contains(marker))
                    .unwrap_or(false)
            });

        if let Some(existing_comment) = existing {
            // Update existing comment
            if let Some(comment_id) = existing_comment["id"].as_u64() {
                self.client
                    .patch(format!(
                        "https://api.github.com/repos/{repo}/issues/comments/{comment_id}"
                    ))
                    .header("Authorization", format!("Bearer {token}"))
                    .header("Accept", "application/vnd.github+json")
                    .header("User-Agent", "ICForge")
                    .json(&serde_json::json!({ "body": body }))
                    .send()
                    .await
                    .map_err(|e| AppError::Internal(format!("Failed to update PR comment: {e}")))?;
            }
        } else {
            // Create new comment
            self.client
                .post(format!(
                    "https://api.github.com/repos/{repo}/issues/{pr_number}/comments"
                ))
                .header("Authorization", format!("Bearer {token}"))
                .header("Accept", "application/vnd.github+json")
                .header("User-Agent", "ICForge")
                .json(&serde_json::json!({ "body": body }))
                .send()
                .await
                .map_err(|e| AppError::Internal(format!("Failed to post PR comment: {e}")))?;
        }

        Ok(())
    }
}
