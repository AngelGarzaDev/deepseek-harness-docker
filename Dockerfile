# Stage 1: Build & Compile Native Modules
FROM node:24-slim AS builder

WORKDIR /app

# Install build tools for node-pty
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libncursesw5 \
    libudev1 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy all files
COPY . .

# Install DSH and proxy dependencies in one go to potentially speed up
RUN npm install -g --no-audit --no-fund @deepseek-ai/dsh@next && \
    cd proxy && npm install --no-audit --no-fund

# Stage 2: Runtime Image
FROM node:24

LABEL org.opencontainers.image.source=https://github.com/AngelGarzaDev/deepseek-harness-docker
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

WORKDIR /app

# Copy Node.js binaries and global modules from builder
COPY --from=builder /usr/local/ /usr/local/

# Copy project files
COPY --from=builder /app/proxy/ ./proxy/
COPY --from=builder /app/entrypoint.sh ./entrypoint.sh

# Setup environment
ENV HOME=/root
ENV PROXY_PORT=3000
ENV DSH_PORT=3079
ENV DSH_HTTP_PORT=3000
ENV DSH_INTERNAL_PORT=3079
ENV DSH_WEB_LOG=/root/.dsh-web.log
ENV DSH_TOKEN_FILE_AUTO=/root/.dsh-launch-token
ENV PATH="/app/node_modules:.bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Prepare entrypoint
RUN chmod +x ./entrypoint.sh

# Install additional runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ripgrep \
    curl \
    ca-certificates \
    libncursesw5 \
    libudev1 \
    && rm -rf /var/lib/apt/lists/*

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD []