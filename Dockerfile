FROM node:22-slim

LABEL org.opencontainers.image.source=https://github.com/AngelGarzaDev/deepseek-harness-docker
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

# Install system dependencies for some potential native modules if needed later
# But for now, we just need to ensure npm can install globally.

# Use a dedicated user
RUN addgroup --system --gid 1001 dshuser \
    && adduser --system --uid 1001 --ingroup dshuser --home /home/dshuser dshuser \
    && mkdir -p /home/dshuser/.dsh \
    && chown -R dshuser:dshuser /home/dshuser

# Global installation of required packages
# We use --unsafe-perm because some global installs might fail as non-root user without it
RUN npm install -g --omit=dev @deepseek-ai/dsh @deepseek-ai/dsh-web-frontend http-proxy

# Workspace setup
WORKDIR /app

# Copy project files
COPY . .

# Ensure permissions on app folder
RUN chown -R dshuser:dshuser /app

# Copy entrypoint (as root)
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh

# Switch to non-root user
USER dshuser
ENV HOME=/home/dshuser
ENV DSH_HTTP_PORT=3000
ENV DSH_INTERNAL_PORT=3079
ENV DSH_WEB_LOG=/home/dshuser/.dsh-web.log
ENV DSH_TOKEN_FILE_AUTO=/home/dshuser/.dsh-launch-token

# Ports
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.DSH_HTTP_PORT||'3000')).then(()=>process.exit(0)).catch(()=>process.exit(1))"

# Entrypoint
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD []
