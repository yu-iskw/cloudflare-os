# Google Cloud OS architecture

Date: 2026-09-03
Status: research only — no implementation

This is the design companion to `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`.
Cloud Run depth: `docs/superpowers/specs/2026-09-03-cloud-run-server-and-sandbox.md`.
Ledger depth: `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`.

## Goal

Host the Gadgets Workshop product on Google Cloud with no Cloudflare runtime: same sandboxed personal gadgets, Code Mode agent, and capability-based Gatekeepers.

## Category errors to avoid

Gemini Enterprise Agent Platform is an enterprise agent fleet. Cloudflare OS is an OS for private apps. Replacing the OS with Agent Runtime produces a chatbot, not a port.

Cloud Run is not one primitive. The **service** is the request-driven server. **Nested sandboxes** (`--sandbox-launcher`) are a second product inside that server. There is no SKU named Cloud Run servers. Cloud Run Instances (preview singletons) are a third thing. The GitHub repo `GoogleCloudPlatform/cloud-run-sandbox` is a fourth, unofficial, `runsc` WebSocket sample.

## Recommended topology (Cloud Run–first Hybrid)

```text
                    humans
                      |
              IAP / Identity Platform
                      |
         Cloud Run Service  (the server)
         gen2, --sandbox-launcher
         SPA + /api Cap'n Web + gatekeeper HTTP
                      |
         +------------+------------------+
         |            |                  |
   sandbox do    Cloud SQL PG      Agent Gateway
   executeCode   users/workspaces  Model Armor,
   deny-egress   capabilities      Model Garden
                 GCS git blobs
         |
   optional later:
   GKE Agent Sandbox  (addressable gadget HTTP)
   or sandbox run --detach + host mux
```

| Plane | GCP product | Holds |
| --- | --- | --- |
| Trusted server | Cloud Run **Service** | Router, SPA, kernel RPC, Gatekeeper OAuth |
| Untrusted snippets | Cloud Run **nested sandboxes** (`sandbox do`) | Code Mode / `executeCode` |
| System of record | Cloud SQL PostgreSQL | Users, workspaces, chat, git **pointers**, capability records |
| Git / blueprint bytes | Cloud Storage | Loose git objects, archives, screenshots |
| Live fan-out | Memorystore | Collaboration after replica failover |
| Human login | Identity Platform + IAP | Not a data plane; agents stay SPIFFE |
| Addressable gadgets (optional) | GKE Agent Sandbox | Long-lived inbound HTTP if Facets demand it |
| Wakeups | Cloud Tasks / Cloud Scheduler | Durable Object `alarm()` analog |
| Governance | Agent Platform | Models, Agent Identity, Gateway, Armor |

## Scored options

| Approach | Score | Feasibility | Performance | Maintainability | Complexity |
| --- | --- | --- | --- | --- | --- |
| B Cloud Run–first Hybrid (Service + nested sandbox; GKE only if needed) | 90 | High | `do` ~500 ms | One family for MVP | Medium |
| D Cloud Run Service + nested sandboxes only | 72 | High | Same | No cluster | Medium; Facets are DIY |
| A GKE-native (kernel also in-cluster) | 82 | High | Best inbound gadgets | Cluster ops | Medium-high |
| Isolate pool on GKE (rebuild WorkerLoader) | 70 | Medium | Closest to isolates | You own V8/Wasm | High |
| C Agent Platform-first rewrite | 48 | High | Fine for chat | Loses gadgets | Low for chat |
| Cloud Run Instances as actors | 38 | High for HTTP | Poor | Quota 100, 7-day restart | Low, wrong |
| workerd on GKE | 0 | N/A | N/A | Forbidden | N/A |

## Why the first Cloud Run pass was incomplete

It scored “Cloud Run only” as 38 by treating Services as replica pools and Instances as fake Durable Objects. It did not treat **nested sandboxes** as a first-class executor:

- Deny-by-default egress (stronger than GKE Agent Sandbox’s default public internet).
- No env, secrets, or metadata inheritance.
- `sandbox do` is the `executeCode` analog.
- `sandbox run --detach` exists for long-lived processes, but **no per-sandbox URL**.

The service still cannot be a unique workspace actor. The sandbox still cannot be a Facet with inbound identity. Together they **can** be the kernel server plus Code Mode without GKE.

## Open forks before implementation

1. Gadget host: GKE Agent Sandbox vs Cloud Run `sandbox run --detach` plus host mux vs in-process isolate pool.

Settled this revision: Overseer uniqueness on the Cloud Run path is a **Postgres lease**; `executeCode` is `sandbox do`; v1 ledger is **Cloud SQL PostgreSQL** (not Spanner, not Firestore). AlloyDB is a same-protocol upgrade. Spanner only if multi-region strong writes become real. Identity Platform for humans; Firebase SQL Connect is not the kernel API.

## Not in this change

No runtime code, no deploy manifests, no package rename.
