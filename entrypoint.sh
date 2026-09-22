#!/bin/bash
# Entrypoint: start DSH web bound to localhost on port 3000.
export HOME="/home/dshuser"

dsh web --no-open --host 0.0.0.0 --port 3000 &

sleep 2
exec tail -f /dev/null
