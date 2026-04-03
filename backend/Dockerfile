# ── Build stage ──
# Using latest stable Rust (needs ≥1.88 for time crate)
FROM rust:1.88-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
# Create a dummy main.rs to cache dependency builds
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>&1 || true
# Now copy real source and rebuild
COPY src/ src/
RUN touch src/main.rs && cargo build --release

# ── Runtime stage ──
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y ca-certificates libssl3 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/icforge-backend .

# Create data directory for SQLite
RUN mkdir -p /app/data

ENV DATABASE_URL="sqlite:///app/data/icforge.db?mode=rwc"
ENV HOST="0.0.0.0"

EXPOSE 8080

CMD ["./icforge-backend"]
