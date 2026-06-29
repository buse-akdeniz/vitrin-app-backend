#!/usr/bin/env bash
set -euo pipefail
curl -sS -w "\nHTTP_STATUS:%{http_code}\n" \
  -X POST http://127.0.0.1:4012/api/uploads/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer smoketest" \
  --data-binary @/Users/busenurakdeniz/vitrin_app/backend/complete_payload.json
