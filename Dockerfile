# DeepSeek Harness (DSH) requires Node.js; official npm package @deepseek-ai/dsh verified on Node 24.
# This Dockerfile ensures all native dependencies (like node-pty) are correctly compiled and linked.

FROM node:24

LABEL org.opencontainers.image.source=https://github.com/AngelGarzaDev/deepseek-harness-docker.git
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

WORKDIR /app

# Install all system dependencies (Build + Runtime)
# Including python3, make, g++ for compiling native modules like node-pty
# Including libncursesw5, libudev1 for terminal handling
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    libncursesw5 \
    libudev1 \
    ca-certificates \
    bash \
    ripgrep \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Install DSH globally
# Using @next to ensure we have the latest features and fixes
RUN npm install -g --no-audit --no-fund @deepseek-ai/dsh@next

# Copy project files
COPY . .

# Install project-specific dependencies
# Only the proxy directory is present in this repository
RUN cd proxy && npm install --omit=dev --no-audit --no-fund

# Setup environment variables
ENV HOME=/root
ENV PROXY_PORT=3000
ENV DSH_PORT=3079
ENV DSH_HTTP_PORT=3000
ENV DSH_INTERNAL_PORT=3079
ENV DSH_WEB_LOG=/root/.dsh-web.log
ENV DSH_TOKEN_FILE_AUTO=/root/.dsh-launch-token
# Ensure local node_modules are prioritized
ENV PATH="/app/node_modules:.bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Prepare entrypoint script
RUN chmod +x ./entrypoint.sh

# Expose the proxy port
EXPOSE 3000

# Healthcheck to verify the internal DSH service is responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD []
