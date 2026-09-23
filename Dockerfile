FROM node:24

LABEL org.opencontainers.image.source=https://github.com/AngelGarzaDev/deepseek-harness-docker.git
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    gcc \
    libc6-dev \
    libncursesw5 \
    libudev1 \
    ca-certificates \
    bash \
    ripgrep \
    curl \
    unzip \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install DSH globally
RUN npm install -g --no-audit --no-fund @deepseek-ai/dsh@next

# Copy project files
COPY . .
RUN chmod +x ./entrypoint.sh
RUN npm install --prefix /app/sidecar --no-audit --no-fund

# Setup environment variables
ENV HOME=/root
ENV DSH_HTTP_PORT=3000
ENV DSH_INTERNAL_PORT=3001
ENV DSH_WEB_LOG=/root/.dsh-web.log
ENV DSH_TOKEN_FILE_AUTO=/root/.dsh-launch-token
ENV PATH="/app/node_modules:.bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# Ensure landlock-run is linked if it exists
RUN ln -sf /usr/local/bin/landlock-run /usr/bin/landlock-run || true

# Expose ports
EXPOSE 3000

# Healthcheck (via proxy, which forwards to DSH on loopback)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD []
