#!/bin/bash
# Entrypoint: start DSH on an internal localhost port, then proxy the
# external-facing port to it. DSH intentionally rejects --host 0.0.0.0 for
# safety; we bypass that limitation for Docker deployments only.

export HOME="/home/dshuser"

# External port exposed via Docker -p mapping (default 3000).
PORT="${DSH_HTTP_PORT:-3000}"
# Internal port where DSH binds on 127.0.0.1 (must differ from PORT).
INTERNAL_PORT="${DSH_INTERNAL_PORT:-3001}"

# Start DSH web bound to localhost on internal port
dsh web --no-open --host 127.0.0.1 --port "$INTERNAL_PORT" &

# Wait for DSH to start listening
sleep 2

# Proxy external 0.0.0.0:PORT -> internal 127.0.0.1:INTERNAL_PORT
# Set env vars so proxy.js picks them up, then become PID 1.
export DSH_HTTP_PORT="$PORT"
export DSH_INTERNAL_PORT="$INTERNAL_PORT"
exec node /usr/local/bin/proxy.js
