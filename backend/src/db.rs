use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use std::time::Duration;

pub type DbPool = PgPool;

pub async fn init_pool(database_url: &str) -> DbPool {
    // Parse the URL into options so we can set connect_timeout
    let connect_opts: PgConnectOptions = database_url
        .parse::<PgConnectOptions>()
        .expect("Invalid DATABASE_URL")
        .statement_cache_capacity(0);

    let pool_opts = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(60));

    // Retry connection up to 10 times — Render free-tier Postgres can be slow to wake
    let mut attempts = 0;
    loop {
        attempts += 1;
        match pool_opts.clone().connect_with(connect_opts.clone()).await {
            Ok(pool) => {
                tracing::info!("Connected to database on attempt {attempts}");
                return pool;
            }
            Err(e) => {
                if attempts >= 10 {
                    panic!("Failed to connect to database after {attempts} attempts: {e}");
                }
                tracing::warn!(
                    "DB connection attempt {attempts}/10 failed: {e}. Retrying in 3s..."
                );
                tokio::time::sleep(Duration::from_secs(3)).await;
            }
        }
    }
}

pub async fn run_migrations(pool: &DbPool) {
    sqlx::migrate!("./migrations")
        .run(pool)
        .await
        .expect("Failed to run database migrations");
}
