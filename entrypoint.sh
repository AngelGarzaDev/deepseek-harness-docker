#!/bin/bash

echo "[dsh] Starting entrypoint.sh"

# Configuration
export DSH_HOST_IP="127.0.0.1"
export DSH_HTTP_PORT=${DSH_HTTP_PORT:-3000}
export DSH_INTERNAL_PORT=${DSH_INTERNAL_PORT:-3001}

echo "[dsh] DSH will listen on ${DSH_HOST_IP}:${DSH_INTERNAL_PORT}"
echo "[dsh] Proxy will listen on 0.0.0.0:${DSH_HTTP_PORT} -> ${DSH_HOST_IP}:${DSH_INTERNAL_PORT}"

# Start DSH on loopback (satisfies CLI safety constraints)
# Build trusted-host arguments from DSH_TRUSTED_HOSTS env var (comma-separated)
# plus the internal sidecar address.  Example:
#   DSH_TRUSTED_HOSTS=dsh.petr.ie,dsh.example.com:3080
TRUSTED_HOST_ARGS="--trusted-host 127.0.0.1:$DSH_INTERNAL_PORT"
if [ -n "$DSH_TRUSTED_HOSTS" ]; then
  IFS=',' read -ra EXTRA_HOSTS <<< "$DSH_TRUSTED_HOSTS"
  for host in "${EXTRA_HOSTS[@]}"; do
    host=$(echo "$host" | xargs)  # trim whitespace
    if [ -n "$host" ]; then
      TRUSTED_HOST_ARGS="$TRUSTED_HOST_ARGS --trusted-host $host"
    fi
  done
fi
echo "[dsh] DSH trusted-hosts: $TRUSTED_HOST_ARGS"

echo "[dsh] Starting DSH in background..."
dsh web --no-open --host "$DSH_HOST_IP" --port "$DSH_INTERNAL_PORT" $TRUSTED_HOST_ARGS &
DSH_PID=$!
echo "[dsh] DSH PID=$DSH_PID"

# Wait for DSH to be ready
echo "[dsh] Waiting for DSH to start..."
for i in $(seq 1 30); do
  if curl -sf "http://127.0.0.1:$DSH_INTERNAL_PORT/api/health" >/dev/null 2>&1; then
    echo "[dsh] DSH is ready after ${i}s"
    break
  fi
  sleep 1
done

# Start the sidecar proxy (handles Host-header rewriting for DSH /api fence)
echo "[dsh] Starting sidecar proxy on 0.0.0.0:$DSH_HTTP_PORT..."
exec node /app/sidecar/index.js
