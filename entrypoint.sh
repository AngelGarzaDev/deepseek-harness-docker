#!/bin/bash

echo "[dsh] Starting entrypoint.sh"

echo "[dsh] Starting DSH on 0.0.0.0:${DSH_HTTP_PORT:-3000}..."
exec dsh web --no-open --host 0.0.0.0 --port "${DSH_HTTP_PORT:-3000}"
