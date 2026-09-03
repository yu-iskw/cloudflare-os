# GCP kernel (Cloud Run Service)

Gen2 Cloud Run service with `--sandbox-launcher`. Serve this image as the origin:

```text
gcloud run deploy company-os \
  --source . \
  --execution-environment gen2 \
  --sandbox=legacy \
  --no-cpu-throttling \
  --timeout=3600 \
  --concurrency=1 \
  --min-instances=1 \
  --add-cloudsql-instances=PROJECT:REGION:INSTANCE
```

`--concurrency=1` plus min instances keeps WebSockets on a sticky replica. Cloud Run caps a
connection at 60 minutes; the SPA reconnects before then (`packages/workshop-frontend/src/main.tsx`).

`--add-cloudsql-instances` plus IAM DB auth. Per-replica `postgres` client `max` is 2–5. **Auth
Proxy is not a pooler** — do not put a transaction-mode pooler in front of session `SELECT … FOR
UPDATE` leases.

`SANDBOX_BIN` overrides `/usr/local/gcp/bin/sandbox`. CI uses a fake binary. Nested sandbox is
unavailable in most CI images; on Cloud Run, `fetch('https://example.com')` from `sandbox do` must
fail and `1+1` must succeed.

IAP: set `IAP_AUDIENCE`. Local: `IAP_DEV_EMAIL`. Password login remains env-gated on the kernel, not
in AdminConfig.

Local listen port: **8080**. Cap'n Web is `newWebSocketRpcSession` on `/api` (Node `ws`), not a
Workers WebSocket helper.
