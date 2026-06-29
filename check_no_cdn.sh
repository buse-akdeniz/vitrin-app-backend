#!/usr/bin/env bash
set -euo pipefail
ROOT="/Users/busenurakdeniz/vitrin_app"
cd "$ROOT/backend"

PORT=4012 AWS_REGION=eu-central-1 S3_RAW_BUCKET=test-bucket UPLOAD_API_TOKEN=smoketest VERIFY_OBJECT_ON_COMPLETE=false node src/server.js > "$ROOT/backend_no_cdn_server.log" 2>&1 &
PID=$!
cleanup() {
  kill "$PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for i in {1..20}; do
  if curl -sS "http://127.0.0.1:4012/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST "http://127.0.0.1:4012/api/uploads/complete" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer smoketest' \
  -d '{"key":"products/raw/2026/06/123e4567-e89b-12d3-a456-426614174000.jpg","folder":"products"}' \
  > "$ROOT/backend_no_cdn_response.log"

cat "$ROOT/backend_no_cdn_response.log"
