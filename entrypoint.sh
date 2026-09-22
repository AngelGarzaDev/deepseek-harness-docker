#!/bin/bash
# Entrypoint: start DSH web directly on port 3000 (no socat needed).
export HOME="/home/dshuser"

dsh web --no-open --host 0.0.0.0 --port 3000 &

sleep 2
exec tail -f /dev/null
