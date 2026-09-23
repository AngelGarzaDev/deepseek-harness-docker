#!/bin/bash
# Entrypoint: start DSH bound to 127.0.0.1 and proxy to 0.0.0.0

echo "[dsh] Starting DSH on 127.0.0.1:$DSH_INTERNAL_PORT..."
# Note: Use 127.0.0.1 instead of 0.0.0.0 for safety as per DSH requirements.
dsh web --no-open --host 127.0.0.1 --port "$DSH_INTERNAL_PORT" > "$DSH_WEB_LOG" 2>&1 &
DSH_PID=$!

echo "[dsh] Waiting for DSH to be ready..."
ready=0
i=0
while [ "$i" -lt 120 ]; do
  if node -e "fetch('http://127.0.0.1:$DSH_INTERNAL_PORT/').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
    ready=1
    break
  fi
  if ! kill -0 "$DSH_PID" 2>/dev/null; then
    echo "[dsh] Error: DSH process exited."
    exit 1
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "[dsh] Error: DSH did not become ready within 120 seconds."
  exit 1
fi

echo "[dsh] DSH is ready (pid $DSH_PID)"

# Cleanup function
cleanup() {
  echo "[proxy] Received exit signal, stopping DSH..."
  kill "$DSH_PID" 2>/dev/null || true
  wait "$DSH_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[proxy] Starting proxy: 0.0.0.0:$DSH_HTTP_PORT -> 127.0.0.1:$DSH_INTERNAL_PORT"
# Run the proxy in the foreground
exec node proxy/index.js
