# Google Cloud OS architecture

Date: 2026-09-03
Status: research only — no implementation

This is the design companion to `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`.
The plan is the requirements contract. This file is the architecture narrative.

## Goal

Host the Gadgets Workshop product on Google Cloud with no Cloudflare runtime: same sandboxed personal gadgets, Code Mode agent, and capability-based Gatekeepers, using Cloud Run, GKE, and Gemini Enterprise Agent Platform.

## Category error to avoid

Gemini Enterprise Agent Platform is an enterprise agent fleet (runtime, identity, gateway, armor).
Cloudflare OS is an operating system for private apps, with an agent as a first-class citizen.
Replacing the OS with Agent Runtime produces a chatbot product, not a port.

## Recommended topology (Hybrid)

```text
                    humans
                      |
              IAP / Identity Platform
                      |
              Cloud Run origin
           (SPA + /api Cap'n Web + gatekeeper HTTP)
                      |
         +------------+-------------+
         |                          |
   Spanner ledger            Agent Gateway
   (users, workspaces,       (Model Armor,
    capabilities, git)        Model Garden)
         |                          |
         |                   Agent Identity
         |
   GKE Agent Sandbox
   (gVisor, default-deny,
    warm pools, snapshots)
         |
    gadget N  |  executeCode
```

| Plane | GCP product | Holds |
| --- | --- | --- |
| Trusted edge | Cloud Run Services | Router, SPA, kernel RPC gateway, Gatekeeper OAuth |
| System of record | Spanner (Firestore acceptable for a first slice) | Users, workspaces, chat, git, capability records |
| Live fan-out | Memorystore | Collaboration after replica failover |
| Untrusted compute | GKE Agent Sandbox (gVisor) | Gadgets and Code Mode |
| Wakeups | Cloud Tasks / Cloud Scheduler | Durable Object `alarm()` analog |
| Blobs | Cloud Storage | Blueprints, screenshots |
| Governance | Agent Platform | Models, Agent Identity, Gateway, Armor |

## Scored options

| Approach | Score | Feasibility | Performance | Maintainability | Complexity |
| --- | --- | --- | --- | --- | --- |
| B Hybrid (Cloud Run + GKE sandbox + Agent Platform) | 88 | High | Good if warm pools | Three products, each used honestly | Medium |
| A GKE-native (kernel also in-cluster) | 82 | High | Best WS / locality | Cluster ops for everything | Medium-high |
| Isolate pool on GKE (rebuild WorkerLoader) | 70 | Medium | Closest to isolates | You own a V8/Wasm runtime | High |
| C Agent Platform-first rewrite | 48 | High | Fine for chat | Loses gadgets | Low for chat, infinite for OS fidelity |
| Cloud Run only (Services / Instances as actors) | 38 | High for HTTP | Poor for actors | Simple until uniqueness | Low, wrong |
| workerd on GKE | 0 | N/A | N/A | Forbidden | N/A |

## Why the losers lose

Cloud Run Services have no `workspaceId → one process` map.
Session affinity is best-effort.
`concurrency=1` creates many single-threaded clones.
WebSockets die at 60 minutes.
Cloud Run Instances are named singletons (preview), quota 100/region, restart every 7 days, no colocated SQLite.

Agent Platform Code Execution runs Python/JS snippets with no network.
It is not a place to run `export class Gadget`.
ADK is function-calling; Code Mode is not first-party.

`workerd` is a Cloudflare dependency.

## Hard gaps any port must design, not wrap

1. Stored irrevocable RPC stubs (`Fetcher` in Durable Object KV) become durable capability records plus live reconnect.
2. Facet abort/reload becomes sandbox recycle (or isolate recycle).
3. `globalOutbound: null` must be enforced as NetworkPolicy deny-all plus allowlist to kernel/Gatekeepers. GKE's default sandbox policy still allows public internet.
4. Object capabilities vs Agent Gateway IAM: do not grant Registry-wide egress.

## Open forks before implementation

1. Per-gadget GKE Sandbox vs in-process isolate pool.
2. Overseer as Spanner-leased Cloud Run worker vs Overseer as its own Sandbox.
3. Custom Code Mode harness vs Agent Runtime conversation with Code Mode as a GKE tool.

## Not in this change

No runtime code, no deploy manifests, no package rename.
