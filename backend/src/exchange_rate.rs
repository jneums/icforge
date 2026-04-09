//! Live XDR→USD exchange rate for converting IC cycles to USD.
//!
//! IC pegs 1 trillion cycles = 1 XDR (Special Drawing Right).
//! We fetch the XDR/USD rate from a free API and cache it.
//! Combined with the platform margin (default 1.3x), this gives us
//! the compute credit price.

use std::sync::Arc;
use tokio::sync::RwLock;
use tokio::time::{interval, Duration};

/// Cached exchange rate data.
#[derive(Debug, Clone)]
pub struct RateData {
    /// 1 XDR = this many USD (e.g. 1.37)
    pub xdr_usd: f64,
    /// When this rate was last fetched (UTC ISO string)
    pub updated_at: String,
}

/// Thread-safe cached exchange rate, refreshed periodically.
#[derive(Clone)]
pub struct ExchangeRateCache {
    inner: Arc<RwLock<RateData>>,
}

impl ExchangeRateCache {
    /// Create with a sensible default (will be overwritten on first fetch).
    pub fn new() -> Self {
        Self {
            inner: Arc::new(RwLock::new(RateData {
                xdr_usd: 1.37, // reasonable default until first fetch
                updated_at: "boot".to_string(),
            })),
        }
    }

    /// Get the current cached rate.
    pub async fn get(&self) -> RateData {
        self.inner.read().await.clone()
    }

    /// Convert raw cycles to USD (before margin).
    /// 1T cycles = 1 XDR, so: usd = (cycles / 1e12) * xdr_usd
    pub async fn cycles_to_usd(&self, cycles: u128) -> f64 {
        let rate = self.inner.read().await;
        (cycles as f64 / 1_000_000_000_000.0) * rate.xdr_usd
    }

    /// Convert raw cycles to compute credit cents (with margin).
    /// Returns USD cents as i32.
    pub async fn cycles_to_credit_cents(&self, cycles: u128, margin: f64) -> i32 {
        let usd = self.cycles_to_usd(cycles).await;
        (usd * margin * 100.0).ceil() as i32
    }

    /// Update the cached rate.
    async fn update(&self, xdr_usd: f64) {
        let mut data = self.inner.write().await;
        data.xdr_usd = xdr_usd;
        data.updated_at = chrono::Utc::now().to_rfc3339();
        tracing::info!(xdr_usd, "Exchange rate updated");
    }
}

/// Pure function: convert cycles to USD cents given a known XDR/USD rate + margin.
/// Use this in sync contexts after fetching the rate once with `cache.get()`.
pub fn cycles_to_credit_cents(cycles: u128, xdr_usd: f64, margin: f64) -> i32 {
    let usd = (cycles as f64 / 1_000_000_000_000.0) * xdr_usd;
    (usd * margin * 100.0).ceil() as i32
}

/// Fetch XDR/USD from the free ExchangeRate-API.
/// Returns None on failure (caller should keep using cached value).
async fn fetch_xdr_usd() -> Option<f64> {
    let resp = reqwest::get("https://open.er-api.com/v6/latest/XDR")
        .await
        .ok()?;

    let body: serde_json::Value = resp.json().await.ok()?;

    let rate = body
        .get("rates")?
        .get("USD")?
        .as_f64()?;

    // Sanity check — XDR/USD should be roughly 1.2-1.6
    if rate < 0.5 || rate > 3.0 {
        tracing::warn!(rate, "XDR/USD rate looks suspicious, ignoring");
        return None;
    }

    Some(rate)
}

/// Spawn background task that refreshes the exchange rate every 6 hours.
/// Does an initial fetch immediately on startup.
pub fn spawn_rate_refresher(cache: ExchangeRateCache) {
    tokio::spawn(async move {
        // Fetch immediately on startup
        match fetch_xdr_usd().await {
            Some(rate) => cache.update(rate).await,
            None => tracing::warn!("Initial XDR/USD fetch failed, using default"),
        }

        // Then refresh every 6 hours
        let mut tick = interval(Duration::from_secs(6 * 60 * 60));
        tick.tick().await; // skip first (we just fetched)

        loop {
            tick.tick().await;
            match fetch_xdr_usd().await {
                Some(rate) => cache.update(rate).await,
                None => tracing::warn!("XDR/USD fetch failed, keeping cached value"),
            }
        }
    });
}
