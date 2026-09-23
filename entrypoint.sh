#!/bin/bash

echo "[dsh] Starting entrypoint.sh"

# Configuration
export DSH_HOST_IP="127.0.0.1"
export DSH_HTTP_PORT=${DSH_HTTP_PORT:-3000}
export DSH_INTERNAL_PORT=${DSH_INTERNAL_PORT:-3001}

echo "[dsh] DSH will listen on ${DSH_HOST_IP}:${DSH_INTERNAL_PORT}"
echo "[dsh] Proxy will listen on 0.0.0.0:${DSH_HTTP_PORT} -> ${DSH_HOST_IP}:${DSH_INTERNAL_PORT}"

# Start DSH on loopback (satisfies CLI safety constraints)
echo "[dsh] Starting DSH in background..."
dsh web --no-open --host "$DSH_HOST_IP" --port "$DSH_INTERNAL_PORT" --trusted-host 127.0.0.1:$DSH_INTERNAL_PORT &
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
