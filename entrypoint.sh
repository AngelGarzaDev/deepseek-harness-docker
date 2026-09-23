#!/bin/bash
set -ex

echo "[dsh] Starting entrypoint.sh"

echo "[dsh] Performing binary health check..."
for bin in landlock-run ripgrep curl socat; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[dsh] Warning: $bin not found in PATH. Checking /usr/local/bin..."
    if [ -x "/usr/local/bin/$bin" ]; then
      ln -sf "/usr/local/bin/$bin" "/usr/bin/$bin"
    else
      echo "[dsh] Error: $bin not found in PATH or /usr/local/bin."
    fi
  fi
done

# Configuration
export DSH_HOST_IP="127.0.0.1"
export DSH_INTERNAL_PORT=${DSH_INTERNAL_PORT:-3001}
export DSH_HTTP_PORT=${DSH_HTTP_PORT:-3000}

echo "[dsh] Configured values: HOST_IP=$DSH_HOST_IP, INTERNAL_PORT=$DSH_INTERNAL_PORT, HTTP_PORT=$DSH_HTTP_PORT"

echo "[dsh] Starting internal bridge: socat TCP-LISTEN:$DSH_HTTP_PORT,fork TCP:127.0.0.1:$DSH_INTERNAL_PORT &"
socat TCP-LISTEN:$DSH_HTTP_PORT,fork TCP:127.0.0.1:$DSH_INTERNAL_PORT &
echo "[dsh] Socat backgrounded"

echo "[dsh] Starting DSH on $DSH_HOST_IP:$DSH_INTERNAL_PORT..."
exec dsh web --no-open --host "$DSH_HOST_IP" --port "$DSH_INTERNAL_PORT"
