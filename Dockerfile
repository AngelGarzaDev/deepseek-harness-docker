FROM node:22-slim

LABEL org.opencontainers.image.source=https://github.com/AngelGarzaDev/deepseek-harness-docker
LABEL org.opencontainers.image.title="DeepSeek Harness"
LABEL org.opencontainers.image.vendor="DeepSeek"
LABEL org.opencontainers.image.description="DeepSeek Harness runtime — runs pre-published npm packages via npx"

WORKDIR /app

# Copy project files first so npm knows where to put things
COPY . .

# Install all required dependencies locally
# This avoids global registry issues and ensures they are available to our scripts
RUN npm install @deepseek-ai/dsh @deepseek-ai/dsh-web-frontend http-proxy

# Non-root user setup
RUN groupadd -r dshuser && useradd -r -g dshuser -m -d /home/dshuser dshuser \
    && mkdir -p /home/dshuser/.dsh \
    && chown -R dshuser:dshuser /home/dshuser /app

# Setup entrypoint
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
