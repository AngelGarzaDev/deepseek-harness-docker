# DeepSeek Harness — Runtime-only Docker image (Docker host ports DSH)
# Uses pre-published npm packages; NO source compilation inside the container.
# Simple setup: no proxy, no socat, just dsh web on localhost.
FROM node:22-slim

LABEL org.opencontainers.image.source=https://github.com/deepseek-ai/deepseek-harness
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

# Pre-publish npm packages
RUN npm install -g --omit=dev @deepseek-ai/dsh @deepseek-ai/dsh-web-frontend

# Non-root user
RUN addgroup --system --gid 1001 dshuser \
    && adduser --system --uid 1001 --ingroup dshuser --home /home/dshuser dshuser \
    && mkdir -p /home/dshuser/.dsh \
    && chown -R dshuser:dshuser /home/dshuser

# Copy entrypoint (as root)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

# Switch to non-root user
USER dshuser
ENV HOME=/home/dshuser

# Ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
