# Cloud Run server and Cloud Run sandbox

Date: 2026-09-03
Status: research only — no implementation
Companion to `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`

The first architecture pass treated Cloud Run as “HTTP replicas + optional Instances.” That missed a 2026 nested product. This note is the Cloud Run ecosystem, with depth on the **service** (the request-driven server) and **sandboxes** (the in-instance untrusted executor).

There is **no** Admin API resource named Cloud Run servers. The server is a **Cloud Run service**.

## The family (every first-class box)

| Resource | What it is | OS mapping |
| --- | --- | --- |
| **Service** | Request-driven HTTPS/gRPC/WebSocket replicas, autoscaled, unique URL | Kernel origin + Cap’n Web `/api` |
| **Job** | Run-to-completion, up to 7 days, no public URL, always gen2 | Batch / one-shot alarm work |
| **Worker pool** | Always-on pull consumers; optional Direct VPC **ingress** private IP | Queue daemons, not unique actors |
| **Instance** (preview, 2026-08-25) | Named singleton, stable URL, no autoscaling, 7-day restart, quota 100/region | Rare named daemon, not gadget fabric |
| **Function** | Source-to-service UX on a Service (`--function`) | Webhooks, not a fifth runtime |
| **Nested sandbox** (`sandboxLauncher`) | Isolated box **inside** a gen2 instance | `executeCode`; maybe a gadget process the **host** proxies |

Adjacent, not compute SKUs: remote MCP at `run.googleapis.com/mcp` (manage Cloud Run), IAP, Direct VPC, sidecars (≤10), GPU, CMEK, VPC-SC, GCS/NFS/in-memory volumes, session affinity, multi-region service health (GA 2026-06-29).

Gen1 wraps the **whole instance** in gVisor. Gen2 is a microVM with a full Linux kernel. Nested sandboxes **force gen2** and add a **second** boundary inside that microVM.

## Cloud Run service = the server

A service is a regional, multi-zone replica set behind a stable URL. It is the right host for the Workshop origin: SPA, `/api` Cap’n Web, Gatekeeper OAuth.

It is **not** a Durable Object:

- Requests for one `workspaceId` can land on any replica.
- Session affinity is a cookie, best-effort, broken on scale/CPU/death.
- `concurrency=1` serializes **per replica**, then starts more replicas.
- WebSockets are long HTTP requests, **max 60 minutes**, reconnect required. Do not enable HTTP/2 end-to-end with WebSockets.
- Idle replicas die unless min instances + instance-based billing keep CPU allocated.

What a service **can** do that the first pass underweighted:

- `--sandbox-launcher` makes **this replica** a sandbox supervisor.
- Min instances + `--no-cpu-throttling` keep nested detached sandboxes alive **on that replica only**.
- Sidecars share localhost with the ingress container (proxy, OTel, DB auth). Nested sandboxes are **not** sidecars; they do not get a Cloud Run PORT.
- Volumes (GCS FUSE, NFS, in-memory) persist host files; bind-mount them into sandboxes with `--mount`.
- Service-level egress (Direct VPC, VPC-SC) is revision-wide. Per-gadget deny is the **sandbox** network, not org policy.

`min=max=1` is one replica for the **whole service**, not one replica per workspace.

## Cloud Run sandboxes = nested untrusted compute

Public preview, announced at WeAreDevelopers World Congress (~9–10 Jul 2026). Enable with `gcloud beta run … --sandbox-launcher` or `sandboxLauncher: true` on a container. Cloud Run injects `/usr/local/gcp/bin/sandbox`.

This is **not** GKE Agent Sandbox, **not** Agent Platform Code Execution, and **not** the experimental GitHub repo `GoogleCloudPlatform/cloud-run-sandbox` (that sample runs `runsc` behind WebSockets and its README says it is different).

### Two official lifecycles

**`sandbox do -- <cmd>`** — create, exec, delete. Stdout/stderr/exit. Google demo ~500 ms start–execute–stop. This is Code Mode / `executeCode`.

**`sandbox run <id> --detach -- <cmd>`** then `sandbox exec <id>` — named long-lived process. Docs name web servers, headless browsers, background agent loops. `sandbox tar` / `--export-tar` snapshot the writable overlay. `sandbox fork` clones a running box.

ADK `CloudRunSandboxCodeExecutor` is **only** the `do` path (local, stateless). ComputeSDK can be ephemeral or `executionMode: 'stateful'` over an HTTP gateway in front of the same CLI. ComputeSDK `getUrl()` is **unsupported**: the CLI does not expose per-sandbox ports.

### Isolation (the WorkerLoader analog)

Documented and independently reproduced:

- No inherited env, secrets, or `PATH`.
- No metadata server (no stolen workload identity).
- Default **zero outbound network**; `--allow-egress` is **all-or-nothing**, not a destination allowlist.
- Sandboxes isolated from each other.
- Host rootfs is **read-only** in the box; `--write` is a tmpfs overlay lost on delete unless tar/mount.
- Nested gVisor is strongly reported by operators; official pages say “highly optimized sandbox,” not the word gVisor.

That is a closer `globalOutbound: null` analog than GKE Agent Sandbox, whose default policy **allows public internet**.

Gaps vs WorkerLoader:

- Process-level, not a V8 isolate that exports `class Gadget extends DurableObject`.
- No capability bindings / `ctx.props` / stored RPC stubs. You pass `--env` or talk through the host.
- `--allow-egress` cannot say “only the Gmail gatekeeper.” The host must proxy capability calls.
- No public URL. Ingress stays on the **host** service.
- Host↔sandbox bidirectional streams (Unix socket, vsock, localhost) are **unverified**. `exec` is request/response stdin/stdout.
- Box dies when the host replica scales to zero or is replaced. No hibernation.

### What this means for gadgets

A gadget that is “run this JS snippet and return” maps to `sandbox do`. That is the executeCode story, and it should live here, not on GKE.

A gadget that is “long-lived Cap’n Web Durable Object with SQLite” does **not** map. You would have to:

1. `sandbox run gadget-$id --detach` with deny-egress.
2. Invent a host mux from the Workshop WebSocket into that process (unverified connectivity).
3. Persist overlay to GCS via `--mount` / tar, because replica death kills RAM and local disk.
4. Pin the client to the replica that holds the box (best-effort affinity), or accept restart.

That is a custom Facets layer on Cloud Run, not a platform feature. GKE Agent Sandbox still wins for **addressable inbound** gadget servers (`X-Sandbox-ID` router).

## Recommended Cloud Run split (revised)

```text
Cloud Run Service  (the server, gen2, --sandbox-launcher,
                    min instances, instance-based billing, IAP)
   │
   ├─ trusted kernel: Cap'n Web /api, capability records, Gatekeeper HTTP
   ├─ sandbox do:     executeCode  (deny-egress, no metadata)
   └─ optional sandbox run --detach: experimental gadget processes
                    (host must proxy; no per-sandbox URL)

Cloud SQL / Memorystore / Cloud Tasks / Cloud Storage / Agent Gateway
   as in the parent plan (not Spanner for v1).

GKE Agent Sandbox
   only if gadgets need independently addressable long-lived HTTP.
```

Do not put unique Overseers on Cloud Run Services. Do not treat Cloud Run Instances as the gadget fabric. Do not confuse nested sandboxes with the GitHub WebSocket sample.

## Sources

- [What is Cloud Run](https://docs.cloud.google.com/run/docs/overview/what-is-cloud-run)
- [Resource model](https://docs.cloud.google.com/run/docs/resource-model)
- [Configure sandboxes for services](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes)
- [Code execution in Cloud Run](https://docs.cloud.google.com/run/docs/code-execution)
- [Sandbox CLI](https://docs.cloud.google.com/run/docs/reference/sandbox-cli)
- [Announcement](https://cloud.google.com/blog/topics/developers-practitioners/google-cloud-run-sandboxes-are-in-public-preview)
- [Execution environments](https://cloud.google.com/run/docs/configuring/execution-environments)
- [WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets)
- [Quotas](https://docs.cloud.google.com/run/quotas)
- [ComputeSDK Cloud Run provider](https://github.com/computesdk/computesdk/tree/main/packages/cloud-run)
- [ADK CloudRunSandboxCodeExecutor](https://github.com/google/adk-python/blob/main/src/google/adk/integrations/cloud_run/_cloud_run_sandbox_code_executor.py)
