use axum::{
    extract::{Path, State},
    Json,
};
use serde_json::{json, Value};

use crate::auth::AuthUser;
use crate::error::AppError;
use crate::models::{AutoTopupRequest, CheckoutRequest, ComputeBalance, ComputeTransaction};
use crate::AppState;

// ============================================================
// Helpers
// ============================================================

/// Get or create a compute_balance row for a user.
pub async fn get_or_create_balance(
    db: &crate::db::DbPool,
    user_id: &str,
) -> Result<ComputeBalance, AppError> {
    let existing: Option<ComputeBalance> =
        sqlx::query_as("SELECT * FROM compute_balances WHERE user_id = $1")
            .bind(user_id)
            .fetch_optional(db)
            .await
            .map_err(AppError::Database)?;

    if let Some(bal) = existing {
        return Ok(bal);
    }

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    sqlx::query(
        r#"INSERT INTO compute_balances (id, user_id, balance_cents, auto_topup_enabled, created_at, updated_at)
           VALUES ($1, $2, 0, false, $3, $4)"#,
    )
    .bind(&id)
    .bind(user_id)
    .bind(&now)
    .bind(&now)
    .execute(db)
    .await
    .map_err(AppError::Database)?;

    sqlx::query_as("SELECT * FROM compute_balances WHERE id = $1")
        .bind(&id)
        .fetch_one(db)
        .await
        .map_err(AppError::Database)
}

/// Credit a user's compute balance and record a transaction.
pub async fn credit_balance(
    db: &crate::db::DbPool,
    user_id: &str,
    amount_cents: i32,
    source: &str,
    stripe_payment_id: Option<&str>,
    description: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let tx_id = uuid::Uuid::new_v4().to_string();

    // Ensure balance row exists
    get_or_create_balance(db, user_id).await?;

    // Credit the balance
    sqlx::query(
        "UPDATE compute_balances SET balance_cents = balance_cents + $1, credits_expire_at = $2, updated_at = $3 WHERE user_id = $4",
    )
    .bind(amount_cents)
    .bind(
        // Reset expiry to 6 months from now on any credit
        (chrono::Utc::now() + chrono::Duration::days(180))
            .format("%Y-%m-%dT%H:%M:%SZ")
            .to_string(),
    )
    .bind(&now)
    .bind(user_id)
    .execute(db)
    .await
    .map_err(AppError::Database)?;

    // Record the transaction
    sqlx::query(
        r#"INSERT INTO compute_transactions (id, user_id, type, amount_cents, source, stripe_payment_id, description, created_at)
           VALUES ($1, $2, 'credit', $3, $4, $5, $6, $7)"#,
    )
    .bind(&tx_id)
    .bind(user_id)
    .bind(amount_cents)
    .bind(source)
    .bind(stripe_payment_id)
    .bind(description)
    .bind(&now)
    .execute(db)
    .await
    .map_err(AppError::Database)?;

    Ok(())
}

/// Debit compute credits from a user's balance. Returns Err if insufficient funds.
/// Automatically triggers auto-topup if balance drops below threshold.
pub async fn debit_balance(
    db: &crate::db::DbPool,
    stripe_key: Option<&str>,
    user_id: &str,
    amount_cents: i32,
    category: &str,
    description: &str,
) -> Result<(), AppError> {
    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
    let tx_id = uuid::Uuid::new_v4().to_string();

    let bal = get_or_create_balance(db, user_id).await?;

    if bal.balance_cents < amount_cents {
        return Err(AppError::BadRequest("Insufficient compute balance".into()));
    }

    // Debit the balance
    sqlx::query(
        "UPDATE compute_balances SET balance_cents = balance_cents - $1, updated_at = $2 WHERE user_id = $3",
    )
    .bind(amount_cents)
    .bind(&now)
    .bind(user_id)
    .execute(db)
    .await
    .map_err(AppError::Database)?;

    // Record the transaction
    sqlx::query(
        r#"INSERT INTO compute_transactions (id, user_id, type, amount_cents, category, source, description, created_at)
           VALUES ($1, $2, 'debit', $3, $4, $5, $6, $7)"#,
    )
    .bind(&tx_id)
    .bind(user_id)
    .bind(amount_cents)
    .bind(category)
    .bind(category) // source = category for debits
    .bind(description)
    .bind(&now)
    .execute(db)
    .await
    .map_err(AppError::Database)?;

    // Check if auto-topup should fire
    let new_balance = bal.balance_cents - amount_cents;
    if bal.auto_topup_enabled {
        let threshold = bal.auto_topup_threshold_cents.unwrap_or(200);
        if new_balance < threshold {
            if let Some(key) = stripe_key {
                maybe_auto_topup(db, key, user_id, &bal).await;
            }
        }
    }

    Ok(())
}

/// Trigger an auto-topup charge via Stripe. Logs errors but does not fail the parent operation.
async fn maybe_auto_topup(
    db: &crate::db::DbPool,
    stripe_key: &str,
    user_id: &str,
    bal: &ComputeBalance,
) {
    let amount_cents = bal.auto_topup_amount_cents.unwrap_or(1000);

    // Look up stripe customer id
    let customer_id: Option<(Option<String>,)> = sqlx::query_as(
        "SELECT stripe_customer_id FROM users WHERE id = $1",
    )
    .bind(user_id)
    .fetch_optional(db)
    .await
    .ok()
    .flatten();

    let customer_id = match customer_id.and_then(|r| r.0) {
        Some(cid) => cid,
        None => {
            tracing::warn!(user_id, "Auto-topup skipped — no Stripe customer");
            return;
        }
    };

    // Get customer's default payment method
    let client = reqwest::Client::new();
    let customer_resp = client
        .get(&format!("https://api.stripe.com/v1/customers/{customer_id}"))
        .basic_auth(stripe_key, None::<&str>)
        .send()
        .await;

    let payment_method = match customer_resp {
        Ok(resp) => {
            let body: Value = match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    tracing::error!(user_id, error = %e, "Auto-topup: failed to parse customer");
                    return;
                }
            };
            // Try invoice_settings.default_payment_method first, then default_source
            body["invoice_settings"]["default_payment_method"]
                .as_str()
                .or_else(|| body["default_source"].as_str())
                .map(|s| s.to_string())
        }
        Err(e) => {
            tracing::error!(user_id, error = %e, "Auto-topup: failed to fetch customer");
            return;
        }
    };

    let payment_method = match payment_method {
        Some(pm) => pm,
        None => {
            // Try listing payment methods as fallback
            let pm_resp = client
                .get("https://api.stripe.com/v1/payment_methods")
                .basic_auth(stripe_key, None::<&str>)
                .query(&[("customer", &customer_id), ("type", &"card".to_string()), ("limit", &"1".to_string())])
                .send()
                .await;

            match pm_resp {
                Ok(resp) => {
                    let body: Value = match resp.json().await {
                        Ok(v) => v,
                        Err(_) => { return; }
                    };
                    match body["data"][0]["id"].as_str() {
                        Some(pm_id) => pm_id.to_string(),
                        None => {
                            tracing::warn!(user_id, "Auto-topup skipped — no payment method on file");
                            return;
                        }
                    }
                }
                Err(e) => {
                    tracing::error!(user_id, error = %e, "Auto-topup: failed to list payment methods");
                    return;
                }
            }
        }
    };

    // Create and confirm a PaymentIntent off-session
    let params = vec![
        ("amount", amount_cents.to_string()),
        ("currency", "usd".to_string()),
        ("customer", customer_id),
        ("payment_method", payment_method),
        ("off_session", "true".to_string()),
        ("confirm", "true".to_string()),
        ("metadata[user_id]", user_id.to_string()),
        ("metadata[source]", "auto_topup".to_string()),
        ("description", format!("ICForge auto top-up ${:.2}", amount_cents as f64 / 100.0)),
    ];

    match client
        .post("https://api.stripe.com/v1/payment_intents")
        .basic_auth(stripe_key, None::<&str>)
        .form(&params)
        .send()
        .await
    {
        Ok(resp) => {
            let body: Value = resp.json().await.unwrap_or_default();
            let status = body["status"].as_str().unwrap_or("unknown");
            if status == "succeeded" {
                tracing::info!(user_id, amount_cents, "Auto-topup PaymentIntent succeeded (credit via webhook)");
            } else if status == "requires_action" {
                tracing::warn!(user_id, "Auto-topup requires customer action (3D Secure) — Stripe will notify them");
            } else {
                tracing::error!(user_id, status, "Auto-topup PaymentIntent unexpected status: {}", body);
            }
        }
        Err(e) => {
            tracing::error!(user_id, error = %e, "Auto-topup: failed to create PaymentIntent");
        }
    }
}

/// Get or create a Stripe customer for a user. Returns the customer ID.
async fn ensure_stripe_customer(
    db: &crate::db::DbPool,
    stripe_key: &str,
    user: &crate::models::User,
) -> Result<String, AppError> {
    // Return existing if we have one
    if let Some(ref cid) = user.stripe_customer_id {
        return Ok(cid.clone());
    }

    // Create customer via Stripe API
    let client = reqwest::Client::new();
    let mut params = vec![
        ("metadata[icforge_user_id]".to_string(), user.id.clone()),
    ];
    if let Some(ref email) = user.email {
        params.push(("email".to_string(), email.clone()));
    }
    if let Some(ref name) = user.name {
        params.push(("name".to_string(), name.clone()));
    }

    let resp = client
        .post("https://api.stripe.com/v1/customers")
        .basic_auth(stripe_key, None::<&str>)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe request failed: {e}")))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {e}")))?;

    let customer_id = body["id"]
        .as_str()
        .ok_or_else(|| {
            AppError::Internal(format!("Stripe customer create failed: {body}"))
        })?
        .to_string();

    // Save to DB
    sqlx::query("UPDATE users SET stripe_customer_id = $1, updated_at = $2 WHERE id = $3")
        .bind(&customer_id)
        .bind(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
        .bind(&user.id)
        .execute(db)
        .await
        .map_err(AppError::Database)?;

    Ok(customer_id)
}

// ============================================================
// Route handlers
// ============================================================

/// POST /api/v1/billing/checkout — Create Stripe Checkout Session
pub async fn billing_checkout(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<CheckoutRequest>,
) -> Result<Json<Value>, AppError> {
    let stripe_key = state
        .config
        .stripe_secret_key
        .as_deref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    let amount_cents = req.amount * 100;
    if amount_cents < state.config.min_purchase_cents {
        return Err(AppError::BadRequest(format!(
            "Minimum purchase is ${:.2}",
            state.config.min_purchase_cents as f64 / 100.0
        )));
    }

    let customer_id =
        ensure_stripe_customer(&state.db, stripe_key, &auth_user.user).await?;

    let frontend_url = &state.config.frontend_url;
    let params = vec![
        ("mode", "payment".to_string()),
        ("customer", customer_id),
        ("line_items[0][price_data][currency]", "usd".to_string()),
        ("line_items[0][price_data][product_data][name]", "ICForge Compute Credits".to_string()),
        ("line_items[0][price_data][unit_amount]", amount_cents.to_string()),
        ("line_items[0][quantity]", "1".to_string()),
        ("success_url", format!("{frontend_url}/billing?session_id={{CHECKOUT_SESSION_ID}}")),
        ("cancel_url", format!("{frontend_url}/billing")),
        ("metadata[user_id]", auth_user.user.id.clone()),
        ("metadata[amount_cents]", amount_cents.to_string()),
        ("payment_intent_data[metadata][user_id]", auth_user.user.id.clone()),
        ("payment_intent_data[setup_future_usage]", "off_session".to_string()),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.stripe.com/v1/checkout/sessions")
        .basic_auth(stripe_key, None::<&str>)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe request failed: {e}")))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {e}")))?;

    let url = body["url"]
        .as_str()
        .ok_or_else(|| {
            AppError::Internal(format!("Stripe checkout create failed: {body}"))
        })?;

    Ok(Json(json!({ "checkout_url": url })))
}

/// GET /api/v1/billing/portal — Create Stripe Customer Portal session
pub async fn billing_portal(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let stripe_key = state
        .config
        .stripe_secret_key
        .as_deref()
        .ok_or_else(|| AppError::Internal("Stripe not configured".into()))?;

    let customer_id =
        ensure_stripe_customer(&state.db, stripe_key, &auth_user.user).await?;

    let frontend_url = &state.config.frontend_url;
    let params = vec![
        ("customer", customer_id),
        ("return_url", format!("{frontend_url}/billing")),
    ];

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.stripe.com/v1/billing_portal/sessions")
        .basic_auth(stripe_key, None::<&str>)
        .form(&params)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe request failed: {e}")))?;

    let body: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Internal(format!("Stripe response parse failed: {e}")))?;

    let url = body["url"]
        .as_str()
        .ok_or_else(|| {
            AppError::Internal(format!("Stripe portal create failed: {body}"))
        })?;

    Ok(Json(json!({ "portal_url": url })))
}

/// GET /api/v1/billing/balance — Get compute balance + usage
pub async fn billing_balance(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let bal = get_or_create_balance(&state.db, &auth_user.user.id).await?;

    // Get this month's usage breakdown
    let month_start = chrono::Utc::now()
        .format("%Y-%m-01T00:00:00Z")
        .to_string();

    let usage_rows: Vec<(Option<String>, i64)> = sqlx::query_as(
        r#"SELECT category, COALESCE(SUM(amount_cents), 0) as total
           FROM compute_transactions
           WHERE user_id = $1 AND type = 'debit' AND created_at >= $2
           GROUP BY category"#,
    )
    .bind(&auth_user.user.id)
    .bind(&month_start)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    let mut cycles_cents: i64 = 0;
    let mut provision_cents: i64 = 0;
    let mut builds_cents: i64 = 0;

    for (cat, total) in &usage_rows {
        match cat.as_deref() {
            Some("execution") => cycles_cents += *total,
            Some("provision") => provision_cents += *total,
            Some("builds") => builds_cents += *total,
            _ => {}
        }
    }

    let total_cents = cycles_cents + provision_cents + builds_cents;

    Ok(Json(json!({
        "compute_balance_cents": bal.balance_cents,
        "auto_topup_enabled": bal.auto_topup_enabled,
        "auto_topup_threshold_cents": bal.auto_topup_threshold_cents,
        "auto_topup_amount_cents": bal.auto_topup_amount_cents,
        "credits_expire_at": bal.credits_expire_at,
        "usage_this_month": {
            "total_cents": total_cents,
            "cycles_cents": cycles_cents,
            "provision_cents": provision_cents,
            "builds_cents": builds_cents,
        }
    })))
}

/// PUT /api/v1/billing/auto-topup — Configure auto-top-up
pub async fn billing_auto_topup(
    State(state): State<AppState>,
    auth_user: AuthUser,
    Json(req): Json<AutoTopupRequest>,
) -> Result<Json<Value>, AppError> {
    // Ensure balance exists
    get_or_create_balance(&state.db, &auth_user.user.id).await?;

    let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

    sqlx::query(
        r#"UPDATE compute_balances
           SET auto_topup_enabled = $1,
               auto_topup_threshold_cents = $2,
               auto_topup_amount_cents = $3,
               updated_at = $4
           WHERE user_id = $5"#,
    )
    .bind(req.enabled)
    .bind(req.threshold_cents.unwrap_or(200))
    .bind(req.amount_cents.unwrap_or(1000))
    .bind(&now)
    .bind(&auth_user.user.id)
    .execute(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({ "ok": true })))
}

/// GET /api/v1/billing/transactions — Transaction history
pub async fn billing_transactions(
    State(state): State<AppState>,
    auth_user: AuthUser,
) -> Result<Json<Value>, AppError> {
    let txns: Vec<ComputeTransaction> = sqlx::query_as(
        "SELECT * FROM compute_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100",
    )
    .bind(&auth_user.user.id)
    .fetch_all(&state.db)
    .await
    .map_err(AppError::Database)?;

    Ok(Json(json!({ "transactions": txns })))
}

/// POST /api/v1/billing/webhook — Stripe webhook handler
pub async fn billing_webhook(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: String,
) -> Result<Json<Value>, AppError> {
    // Verify webhook signature if secret is configured
    if let Some(ref secret) = state.config.stripe_webhook_secret {
        let sig_header = headers
            .get("stripe-signature")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");

        if !verify_stripe_signature(&body, sig_header, secret) {
            return Err(AppError::Unauthorized("Invalid webhook signature".into()));
        }
    }

    let event: Value = serde_json::from_str(&body)
        .map_err(|e| AppError::BadRequest(format!("Invalid JSON: {e}")))?;

    let event_type = event["type"].as_str().unwrap_or("");

    match event_type {
        "checkout.session.completed" => {
            let session = &event["data"]["object"];
            let user_id = session["metadata"]["user_id"].as_str();
            let amount_cents = session["metadata"]["amount_cents"]
                .as_str()
                .and_then(|s| s.parse::<i32>().ok());
            let payment_intent = session["payment_intent"].as_str();

            if let (Some(uid), Some(cents)) = (user_id, amount_cents) {
                credit_balance(
                    &state.db,
                    uid,
                    cents,
                    "purchase",
                    payment_intent,
                    &format!("Stripe checkout ${:.2}", cents as f64 / 100.0),
                )
                .await?;
                tracing::info!(user_id = uid, amount_cents = cents, "Checkout completed — balance credited");
            }
        }
        "payment_intent.succeeded" => {
            let pi = &event["data"]["object"];
            let user_id = pi["metadata"]["user_id"].as_str();
            let source = pi["metadata"]["source"].as_str();
            let amount = pi["amount"].as_i64().map(|a| a as i32);
            let pi_id = pi["id"].as_str();

            // Only credit for auto_topup — checkout purchases are handled by checkout.session.completed
            if source != Some("auto_topup") {
                tracing::debug!("payment_intent.succeeded skipped — not auto_topup");
            } else if let (Some(uid), Some(cents)) = (user_id, amount) {
                // Check if we already recorded this (idempotency)
                let existing: Option<(String,)> = sqlx::query_as(
                    "SELECT id FROM compute_transactions WHERE stripe_payment_id = $1",
                )
                .bind(pi_id)
                .fetch_optional(&state.db)
                .await
                .map_err(AppError::Database)?;

                if existing.is_none() {
                    credit_balance(
                        &state.db,
                        uid,
                        cents,
                        "auto_topup",
                        pi_id,
                        &format!("Auto top-up ${:.2}", cents as f64 / 100.0),
                    )
                    .await?;
                    tracing::info!(user_id = uid, amount_cents = cents, "Auto top-up succeeded");
                }
            }
        }
        "payment_intent.payment_failed" => {
            let pi = &event["data"]["object"];
            let user_id = pi["metadata"]["user_id"].as_str();
            if let Some(uid) = user_id {
                // Disable auto-top-up on payment failure
                sqlx::query(
                    "UPDATE compute_balances SET auto_topup_enabled = false, updated_at = $1 WHERE user_id = $2",
                )
                .bind(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string())
                .bind(uid)
                .execute(&state.db)
                .await
                .map_err(AppError::Database)?;
                tracing::warn!(user_id = uid, "Payment failed — auto-top-up disabled");
            }
        }
        _ => {
            tracing::debug!(event_type, "Unhandled Stripe event");
        }
    }

    Ok(Json(json!({ "received": true })))
}

/// Verify Stripe webhook signature (v1 scheme)
fn verify_stripe_signature(payload: &str, sig_header: &str, secret: &str) -> bool {
    use hmac::{Hmac, Mac};
    use sha2::Sha256;

    // Parse sig header: t=...,v1=...
    let mut timestamp = "";
    let mut signature = "";

    for part in sig_header.split(',') {
        let part = part.trim();
        if let Some(t) = part.strip_prefix("t=") {
            timestamp = t;
        } else if let Some(v) = part.strip_prefix("v1=") {
            signature = v;
        }
    }

    if timestamp.is_empty() || signature.is_empty() {
        return false;
    }

    let signed_payload = format!("{timestamp}.{payload}");
    let mut mac = match Hmac::<Sha256>::new_from_slice(secret.as_bytes()) {
        Ok(m) => m,
        Err(_) => return false,
    };
    mac.update(signed_payload.as_bytes());

    let expected = hex::encode(mac.finalize().into_bytes());
    expected == signature
}
