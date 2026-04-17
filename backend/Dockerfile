# ── Stage 1: Runtime base (cached — only rebuilds when toolchain versions change) ──
FROM debian:bookworm-slim AS runtime-base

RUN apt-get update && apt-get install -y \
    ca-certificates libssl3 git curl build-essential libdbus-1-3 \
    && rm -rf /var/lib/apt/lists/*

# Install Rust toolchain + wasm target for build worker
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    --default-toolchain stable --profile minimal
ENV PATH="/root/.cargo/bin:${PATH}"
RUN rustup target add wasm32-unknown-unknown

# Install Node.js (LTS) for frontend builds
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install icp-cli (pinned), ic-wasm, and mops (Motoko package manager) — build worker needs all three
RUN npm install -g @icp-sdk/icp-cli@0.2.2 @icp-sdk/ic-wasm@0.9.10 ic-mops

# Increase Node.js heap for mops/npm — Render starter has 512MB, default ~256MB heap OOMs on mops install
ENV NODE_OPTIONS="--max-old-space-size=384"

# ── Stage 2: Build the Rust binary ──
FROM rust:1.88-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY migrations/ migrations/
# Cache dependency builds with a dummy main.rs
RUN mkdir src && echo "fn main() {}" > src/main.rs
RUN cargo build --release 2>&1 || true
# Now copy real source and rebuild (only recompiles our crate)
COPY src/ src/
RUN touch src/main.rs && SQLX_OFFLINE=true cargo build --release

# ── Stage 3: Final runtime image ──
FROM runtime-base

WORKDIR /app
COPY --from=builder /app/target/release/icforge-backend .

ENV DATABASE_URL=""
ENV HOST="0.0.0.0"

EXPOSE 8080

CMD ["./icforge-backend"]
