# Write a Gatekeeper (Cloud Run)

A Gatekeeper is a Cloud Run service that mediates all access between a Gadget and an external
service. The kernel stores **capability records** (account id, vendor, resource URL) and reconnects
a live stub — never persist RPC stubs in Postgres.

v1 ships one GitHub Gatekeeper (`packages/gcp-gatekeeper-github`). Writes are queued for approval;
reads (observations) run on the host, not inside `sandbox do`.
