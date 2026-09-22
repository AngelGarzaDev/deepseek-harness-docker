#!/bin/bash
# Entrypoint: start DSH web bound to 127.0.0.1 on port 3000, using the docker profile.
export HOME="/home/dshuser"

# Use dsh web with docker profile so the sandbox-local plugin loads correctly
dsh web --no-open --profile docker --host 127.0.0.1 --port 3000 &

sleep 2
exec tail -f /dev/null
