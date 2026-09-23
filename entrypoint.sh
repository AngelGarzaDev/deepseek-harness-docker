#!/bin/bash

echo "[dsh] Starting entrypoint.sh"

# Configuration
export DSH_HOST_IP="127.0.0.1"
export DSH_INTERNAL_PORT=${DSH_INTERNAL_PORT:-3001}
export DSH_HTTP_PORT=${DSH_HTTP_PORT:-3000}

echo "[dsh] Configured values: HOST_IP=$DSH_HOST_IP, INTERNAL_PORT=$DSH_INTERNAL_PORT, HTTP_PORT=$DSH_HTTP_PORT"

echo "[dsh] Starting DSH in background..."
dsh web --no-open --host "$DSH_HOST_IP" --port "$DSH_INTERNAL_PORT" --trusted-host 127.0.0.1:$DSH_INTERNAL_PORT &
DSH_PID=$!

sleep 5

echo "[dsh] Starting internal bridge: socat TCP-LISTEN:$DSH_HTTP_PORT,fork TCP:127.0.0.1:$DSH_INTERNAL_PORT"
exec socat TCP-LISTEN:$DSH_HTTP_PORT,fork TCP:127.0.0.1:$DSH_INTERNAL_PORT
