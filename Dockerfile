# ──────────────────────────────────────────────────────────────────────────────
# Stage 1 – Builder: install dependencies and compile everything
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-bookworm AS builder

LABEL org.opencontainers.image.source=https://github.com/deepseek-ai/deepseek-harness
LABEL org.opencontainers.image.description="DeepSeek Harness — AI agent framework (builder stage)"

# Build-time tools: C toolchain (native addons), Git (commit hash during build), Python (esbuild dep)
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
         build-essential \
         musl-tools \
         git \
         python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Corepack enables the packageManager declared in root package.json (pnpm@11.7.0)
RUN corepack enable

# Copy lockfile first for layer caching before sources
COPY package.json pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY patches ./patches

# Install workspace dependencies (including cross-platform esbuild binaries)
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Copy full source tree
COPY . .

# Complete build: native system addons → TypeScript libs → Web frontend → build record
# scripts/build.ts orchestrates all three stages atomically and writes
# .dsh-build/client-build-environment.json binding env vars to artifacts.
RUN pnpm exec tsx scripts/build.ts

# Verify built outputs exist
RUN test -f apps/cli/lib/bin.js          \
    && test -f apps/web/dist/index.html  \
    && test -f .dsh-build/client-build-environment.json



# ──────────────────────────────────────────────────────────────────────────────
# Stage 2 – Production: runtime-only image
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim AS production

LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.url=https://deepseek.com

# Non-root user for container security
RUN addgroup --system --gid 1001 dshuser \
    && adduser --system --uid 1001 --ingroup dshuser dshuser

WORKDIR /app

# Copy the entire workspace tree from builder.
#
# CRITICAL: pnpm workspace symlinks use absolute paths (/app/… → /app/…).
# Keeping the same WORKDIR preserves those symlinks. A selective COPY would
# break them because the target directories referenced by the links must exist
# at identical paths in the destination image.
COPY --from=builder --chown=dshuser:dshuser /app /app

USER dshuser

# Expose the default HTTP port used by the host webserver.
# Override with DSH_HTTP_PORT or configure via --config http.port.
EXPOSE 3000

# Health check probes the web server once it is ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+process.env['DSH_HTTP_PORT']||'3000').then(()=>process.exit(0)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/app/apps/cli/lib/bin.js"]

# Default: serve the Web GUI. Override for headless usage:
#   --profile headless  (agent-only, no webserver)
CMD ["web"]
