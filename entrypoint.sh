#!/bin/bash
# Entrypoint: start DSH bound to its private container IP for security and reachability

echo "[dsh] Performing binary health check..."
for bin in landlock-run ripgrep curl; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[dsh] Warning: $bin not found in PATH. Checking /usr/local/bin..."
    if [ -x "/usr/local/bin/$bin" ]; then
      echo "[dsh] Found $bin in /usr/local/bin. Linking to /usr/bin/$bin."
      ln -sf "/usr/local/bin/$bin" "/usr/bin/$bin"
    else
      echo "[dsh] Error: $bin not found in PATH or /usr/local/bin."
    fi
  fi
done

# Detect the container's primary private IP address (excluding loopback)
# hostname -I typically returns all addresses; we take the first one that isn't 127.0.0.1
CONTAINER_IP=$(hostname -I | grep -v "^127." | cut -d. -f1-4 | head -n 1)

if [ -z "$CONTAINER_IP" ]; then
  echo "[dsh] Error: Could not detect container IP. Falling back to 127.0.0.1 (Note: May block external access)."
  export DSH_HOST_IP="127.0.0.1"
else
  echo "[dsh] Detected container IP: $CONTAINER_IP"
  export DSH_HOST_IP="$CONTAINER_IP"
fi

# Default to 3000 if not provided
export DSH_INTERNAL_PORT=${DSH_INTERNAL_PORT:-3000}

echo "[dsh] Starting DSH on $DSH_HOST_IP:$DSH_INTERNAL_PORT..."
# Bound to the detected private IP. This is NOT 0.0.0.0, satisfying DSH security rules.
dsh web --no-open --host "$DSH_HOST_IP" --port "$DSH_INTERNAL_PORT" > "$DSH_WEB_LOG" 2>&1 &
DSH_PID=$!

echo "[dsh] Waiting for DSH to be ready..."
ready=0
i=0
while [ "$i" -lt 120 ]; do
  # Probing via loopback is generally safe for local process checks
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
