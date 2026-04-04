use crate::config::AppConfig;
use serde_json::json;

/// Write a slug → canister mapping to Cloudflare KV.
///
/// Silently returns Ok(()) if Cloudflare is not configured (any of the three
/// env vars missing). This keeps deploys working in local / self-hosted
/// environments that don't use Cloudflare Workers for subdomain routing.
pub async fn kv_write(
    config: &AppConfig,
    slug: &str,
    canister_id: &str,
    project_id: &str,
) -> Result<(), String> {
    let (account_id, api_token, namespace_id) = match (
        config.cloudflare_account_id.as_deref(),
        config.cloudflare_api_token.as_deref(),
        config.cloudflare_kv_namespace_id.as_deref(),
    ) {
        (Some(a), Some(t), Some(n)) => (a, t, n),
        _ => return Ok(()), // not configured — skip silently
    };

    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{slug}"
    );

    let body = json!({
        "canister_id": canister_id,
        "project_id": project_id,
    });

    let client = reqwest::Client::new();
    let resp = client
        .put(&url)
        .header("Authorization", format!("Bearer {api_token}"))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Cloudflare KV PUT request failed: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!(
            "Cloudflare KV PUT returned {status}: {text}"
        ))
    }
}

/// Delete a slug from Cloudflare KV.
///
/// Same skip-if-not-configured logic as `kv_write`.
pub async fn kv_delete(config: &AppConfig, slug: &str) -> Result<(), String> {
    let (account_id, api_token, namespace_id) = match (
        config.cloudflare_account_id.as_deref(),
        config.cloudflare_api_token.as_deref(),
        config.cloudflare_kv_namespace_id.as_deref(),
    ) {
        (Some(a), Some(t), Some(n)) => (a, t, n),
        _ => return Ok(()), // not configured — skip silently
    };

    let url = format!(
        "https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/{namespace_id}/values/{slug}"
    );

    let client = reqwest::Client::new();
    let resp = client
        .delete(&url)
        .header("Authorization", format!("Bearer {api_token}"))
        .send()
        .await
        .map_err(|e| format!("Cloudflare KV DELETE request failed: {e}"))?;

    if resp.status().is_success() {
        Ok(())
    } else {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        Err(format!(
            "Cloudflare KV DELETE returned {status}: {text}"
        ))
    }
}
