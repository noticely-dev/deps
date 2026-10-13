#!/usr/bin/env bash
# Post-deploy smoke test: health endpoint and the sample report page.
set -euo pipefail
BASE="${1:-https://deps.noticely.dev}"
for i in $(seq 1 20); do
  [ "$(curl -fsS "$BASE/healthz" 2>/dev/null || true)" = "ok" ] && break
  sleep 3
done
[ "$(curl -fsS "$BASE/healthz")" = "ok" ] || { echo "healthz failed"; exit 1; }
curl -fsSL "$BASE/sample" | grep -q 'class="ring"' || { echo "sample report missing score ring"; exit 1; }
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/metrics")" = "404" ] || { echo "/metrics must not be public"; exit 1; }
echo "smoke ok: $BASE"
