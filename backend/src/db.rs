use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;

pub type DbPool = PgPool;

pub async fn init_pool(database_url: &str) -> DbPool {
    let pool_opts = PgPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(30));

    // Retry connection up to 5 times — Render free-tier Postgres can be slow to wake
    let mut attempts = 0;
    loop {
        attempts += 1;
        match pool_opts.clone().connect(database_url).await {
            Ok(pool) => return pool,
            Err(e) => {
                if attempts >= 5 {
                    panic!("Failed to connect to database after {attempts} attempts: {e}");
                }
                tracing::warn!(
                    "DB connection attempt {attempts}/5 failed: {e}. Retrying in 5s..."
                );
                tokio::time::sleep(Duration::from_secs(5)).await;
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
