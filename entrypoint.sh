#!/bin/bash
# Entrypoint: start DSH web bound to 127.0.0.1 on port 3000.
# Uses the "docker" profile so dsh-sandbox-local loads correctly under /home/dshuser.
export HOME="/home/dshuser"

dsh web --no-open --host 127.0.0.1 --port 3000 &

sleep 2
exec tail -f /dev/null
