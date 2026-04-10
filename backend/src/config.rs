use std::env;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub github_client_id: String,
    pub github_client_secret: String,
    pub jwt_secret: String,
    pub frontend_url: String,
    pub backend_url: String,
    pub ic_url: String,
    /// Platform-level IC identity PEM (holds the cycles pool).
    /// If not set, cycles balance checks will fail on mainnet.
    pub ic_identity_pem: Option<String>,
    pub cloudflare_account_id: Option<String>,
    pub cloudflare_api_token: Option<String>,
    pub cloudflare_kv_namespace_id: Option<String>,
    // GitHub App (managed builds)
    pub github_app_id: Option<String>,
    pub github_app_private_key: Option<String>,
    pub github_webhook_secret: Option<String>,
    // Stripe billing
    pub stripe_secret_key: Option<String>,
    pub stripe_webhook_secret: Option<String>,
    pub signup_bonus_cents: i32,
    pub min_purchase_cents: i32,
    pub compute_margin: f64,
    pub dev_mode: bool,
    pub port: u16,
}

impl AppConfig {
    pub fn from_env() -> Self {
        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| "postgres://localhost/icforge".to_string()),
            github_client_id: env::var("GITHUB_CLIENT_ID")
                .unwrap_or_default(),
            github_client_secret: env::var("GITHUB_CLIENT_SECRET")
                .unwrap_or_default(),
            jwt_secret: env::var("JWT_SECRET")
                .unwrap_or_else(|_| "dev-secret-change-me".to_string()),
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            backend_url: env::var("BACKEND_URL")
                .unwrap_or_else(|_| "http://localhost:8080".to_string()),
            ic_url: env::var("IC_URL")
                .unwrap_or_else(|_| "https://icp0.io".to_string()),
            ic_identity_pem: env::var("IC_IDENTITY_PEM").ok(),
            cloudflare_account_id: env::var("CLOUDFLARE_ACCOUNT_ID").ok(),
            cloudflare_api_token: env::var("CLOUDFLARE_API_TOKEN").ok(),
            cloudflare_kv_namespace_id: env::var("CLOUDFLARE_KV_NAMESPACE_ID").ok(),
            github_app_id: env::var("GITHUB_APP_ID").ok(),
            github_app_private_key: env::var("GITHUB_APP_PRIVATE_KEY").ok(),
            github_webhook_secret: env::var("GITHUB_WEBHOOK_SECRET").ok(),
            stripe_secret_key: env::var("STRIPE_SECRET_KEY").ok(),
            stripe_webhook_secret: env::var("STRIPE_WEBHOOK_SECRET").ok(),
            signup_bonus_cents: env::var("SIGNUP_BONUS_CENTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1000),
            min_purchase_cents: env::var("MIN_PURCHASE_CENTS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(500),
            compute_margin: env::var("COMPUTE_MARGIN")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(1.3),
            dev_mode: env::var("DEV_MODE")
                .map(|v| v == "1" || v.to_lowercase() == "true")
                .unwrap_or(false),
            port: env::var("PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8080),
        }
    }
}
