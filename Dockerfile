# ──────────────────────────────────────────────────────────────────────────────
# DeepSeek Harness — Runtime-only Docker image
# Uses pre-published npm packages; NO source compilation inside the container.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-slim

LABEL org.opencontainers.image.source=https://github.com/deepseek-ai/deepseek-harness
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

# ── Install socat for reverse proxy ──────────────────────────────────────────
# DSH intentionally rejects --host 0.0.0.0 for safety. We bind to 127.0.0.1
# and use socat to proxy 0.0.0.0 -> 127.0.0.1 so Docker port mapping works.
RUN apt-get update && apt-get install -y --no-install-recommends socat \
    && rm -rf /var/lib/apt/lists/*

# ── Pre-publish npm packages ─────────────────────────────────────────────────
# Both packages ship pre-bundled JavaScript and static assets:
#   @deepseek-ai/dsh              — CLI launcher & profiles (pre-bundled lib/)
#   @deepseek-ai/dsh-web-frontend — Web GUI static dist (HTML, CSS, JS, fonts)
# The CLI's `web` profile requires both to be resolvable.
RUN npm install -g --omit=dev @deepseek-ai/dsh @deepseek-ai/dsh-web-frontend

# ── Non-root user ────────────────────────────────────────────────────────────
RUN addgroup --system --gid 1001 dshuser \
    && adduser --system --uid 1001 --ingroup dshuser --home /home/dshuser dshuser \
    && mkdir -p /home/dshuser/.dsh \
    && chown -R dshuser:dshuser /home/dshuser

# ── Copy entrypoint (as root) ────────────────────────────────────────────────
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

# ── Switch to non-root user ─────────────────────────────────────────────────
USER dshuser
ENV HOME=/home/dshuser

# ── Ports ────────────────────────────────────────────────────────────────────
# Override with DSH_HTTP_PORT environment variable.
EXPOSE 3000

# ── Health check ─────────────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

# ── Entrypoint ───────────────────────────────────────────────────────────────
# Entry point starts DSH on localhost + socat proxy to 0.0.0.0.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
