#!/bin/sh
set -eu
node server/render-once.mjs
freeradius -f -l stdout &
RADIUS_PID=$!
cleanup() {
  kill "$RADIUS_PID" 2>/dev/null || true
}
trap cleanup INT TERM EXIT
exec node server/main.mjs
