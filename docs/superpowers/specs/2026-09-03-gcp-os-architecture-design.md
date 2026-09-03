# Google Cloud OS architecture

Date: 2026-09-03
Status: research only — no implementation

This is the design companion to `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`.
Cloud Run depth: `docs/superpowers/specs/2026-09-03-cloud-run-server-and-sandbox.md`.
Ledger depth: `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`.

## Goal

Host Company OS on Google Cloud: sandboxed personal gadgets, a Code Mode agent, capability-based Gatekeepers, and **one** GitHub Gatekeeper. Persist capability **records**, never live RPC stubs.

## Category errors to avoid

Gemini Enterprise Agent Platform is an enterprise agent fleet. Company OS is an OS for private apps. Replacing the OS with Agent Runtime produces a chatbot, not this product.

Cloud Run is not one primitive. The **service** is the request-driven server. **Nested sandboxes** (`--sandbox-launcher`) are a second product inside that server. There is no SKU named Cloud Run servers. Cloud Run Instances (preview singletons) are a third thing. The GitHub repo `GoogleCloudPlatform/cloud-run-sandbox` is a fourth, unofficial, `runsc` WebSocket sample.

## Recommended topology (Cloud Run–first Hybrid)

```text
                    humans
                      |
              IAP / Identity Platform
                      |
         Cloud Run Service  (the server)
         gen2, --sandbox-launcher
         SPA + /api Cap'n Web + GitHub Gatekeeper HTTP
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
| Trusted server | Cloud Run **Service** | Router, SPA, kernel RPC, GitHub Gatekeeper OAuth |
| Untrusted snippets | Cloud Run **nested sandboxes** (`sandbox do`) | Code Mode / `executeCode` |
| System of record | Cloud SQL PostgreSQL | Users, workspaces, chat, git **pointers**, capability records |
| Git / blueprint bytes | Cloud Storage | Loose git objects, archives, screenshots |
| Live fan-out | Memorystore | Collaboration after replica failover |
| Human login | Identity Platform + IAP | Not a data plane; agents stay SPIFFE |
| Addressable gadgets (optional) | GKE Agent Sandbox | Long-lived inbound HTTP if gadgets need their own identity |
| Wakeups | Cloud Tasks / Cloud Scheduler | Durable per-workspace wake |
| Governance | Agent Platform | Models, Agent Identity, Gateway, Armor |
| GitHub connector | Cloud Run service (`gcp-gatekeeper-github`) | OAuth, observations, queued writes |

## Scored options

| Approach | Score | Feasibility | Performance | Maintainability | Complexity |
| --- | --- | --- | --- | --- | --- |
| B Cloud Run–first Hybrid (Service + nested sandbox; GKE only if needed) | 90 | High | `do` ~500 ms | One family for MVP | Medium |
| D Cloud Run Service + nested sandboxes only | 72 | High | Same | No cluster | Medium; inbound gadgets are DIY |
| A GKE-native (kernel also in-cluster) | 82 | High | Best inbound gadgets | Cluster ops | Medium-high |
| Isolate pool on GKE | 70 | Medium | Closest to in-process isolates | You own V8/Wasm | High |
| C Agent Platform-first rewrite | 48 | High | Fine for chat | Loses gadgets | Low for chat |
| Cloud Run Instances as actors | 38 | High for HTTP | Poor | Quota 100, 7-day restart | Low, wrong |

## Nested sandboxes as a first-class executor

A Cloud Run Service is a replica pool; it cannot be a unique workspace actor. Nested sandboxes inside that service **can** be the Code Mode executor without GKE:

- Deny-by-default egress (stronger than GKE Agent Sandbox’s default public internet).
- No env, secrets, or metadata inheritance.
- `sandbox do` is the `executeCode` analog.
- `sandbox run --detach` exists for long-lived processes, but **no per-sandbox URL**.

The sandbox still cannot be an inbound gadget with its own public identity. Together, service + `sandbox do` **are** the kernel server plus Code Mode.

## Open forks before implementation

1. Gadget host: GKE Agent Sandbox vs Cloud Run `sandbox run --detach` plus host mux vs in-process isolate pool.

Settled this revision: Overseer uniqueness on the Cloud Run path is a **Postgres lease**; `executeCode` is `sandbox do`; v1 ledger is **Cloud SQL PostgreSQL** (not Spanner, not Firestore). AlloyDB is a same-protocol upgrade. Spanner only if multi-region strong writes become real. Identity Platform for humans; Firebase SQL Connect is not the kernel API. Capability records only — never stored RPC stubs. One GitHub Gatekeeper.

## Not in this change

No runtime code, no deploy manifests, no package rename.
