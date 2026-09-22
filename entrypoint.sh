#!/bin/bash
# Entrypoint: start DSH on localhost, then proxy 0.0.0.0 -> 127.0.0.1 so
# Docker port mapping works. DSH intentionally rejects --host 0.0.0.0 for
# safety; we bypass that limitation for Docker deployments only.

export HOME="/home/dshuser"

PORT="${DSH_HTTP_PORT:-3000}"

# Start DSH web bound to localhost
dsh web --no-open --host 127.0.0.1 --port "$PORT" &

# Wait for DSH to start listening
sleep 2

# Proxy 0.0.0.0 -> 127.0.0.1 using Node.js TCP proxy (becomes PID 1)
exec node /usr/local/bin/proxy.js
