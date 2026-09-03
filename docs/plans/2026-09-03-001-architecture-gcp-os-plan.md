---
title: "Google Cloud OS - Plan"
date: 2026-09-03
artifact_contract: ce-unified-plan/v1
artifact_readiness: requirements-only
product_contract_source: ce-brainstorm
execution: research
---

# Google Cloud OS - Plan

## Goal Capsule

**Objective.** Choose a Google Cloud hosting architecture that can carry the Cloudflare OS product — sandboxed personal gadgets, a Code Mode agent, and capability-based Gatekeepers — with no Cloudflare runtime, APIs, or brand dependencies.

**Product authority.** The product remains an OS for personal apps plus an accountable agent, not a fleet of ADK chatbots. Gemini Enterprise Agent Platform is the enterprise control plane for models, identity, and egress. It is not the gadget kernel.

**Open blockers.** Two forks must be resolved before implementation planning: whether gadget processes live as GKE Agent Sandboxes or as an in-process isolate pool; whether workspace uniqueness is a GKE Sandbox identity or a Spanner-leased actor in front of Cloud Run.

## Product Contract

### Summary

Port the Gadgets Workshop onto Google Cloud by splitting today's "everything is a Durable Object" kernel across three GCP products: Cloud Run for the public HTTP/RPC edge, GKE Agent Sandbox for untrusted gadget and `executeCode` processes, and Gemini Enterprise Agent Platform for models, Agent Identity, Agent Gateway, and Model Armor.

### Problem Frame

Cloudflare OS is an operating system for AI productivity. Every user runs a private instance of each app (a gadget). The kernel sandboxes that instance, injects only introduced capabilities, and lets an agent write and execute code against those capabilities.

That kernel is built on Workers features that Google Cloud does not offer as a single primitive: globally unique single-threaded actors with colocated storage (Durable Objects), child actors of a parent (Facets), and load-user-JS-with-no-egress isolates (WorkerLoader + `globalOutbound: null`).

Google Cloud in 2026 does offer three products that cover adjacent slices: Cloud Run (request-driven and singleton containers), GKE Agent Sandbox (isolated stateful single-replica pods for untrusted agent code), and Gemini Enterprise Agent Platform (managed agent runtime, identity, gateway, and prompt security). Using any one of them as a drop-in Workers replacement fails. Using all three for what each actually does can host the same product.

### Primary Actor

Enterprise operators who must run "Company OS" inside a Google Cloud organization with VPC Service Controls, IAM, and no Cloudflare account.

Secondary actors: end users of the Workshop UI; the coding agent; gadget authors (usually the agent).

### Key Decisions

- KD1. Target runtime is Google Cloud only. No `workerd`, Wrangler, Workers AI, Durable Objects, WorkerLoader, or Cloudflare KV/R2. (session-settled: user-directed — chosen over self-hosting workerd: the operator requirement is zero Cloudflare dependency.)
- KD2. Keep the product shape: gadgets, Cap'n Web, capability introductions, Gatekeepers with simulated writes / later approval, Code Mode. Do not replace the OS with a Gemini Enterprise chatbot.
- KD3. Treat Agent Platform as governance and model access, not as the gadget host. Agent Runtime Code Execution is a snippet sandbox. It cannot run a long-lived TypeScript gadget server.
- KD4. Do not host unique workspace actors on Cloud Run Services. Services are interchangeable replicas. Session affinity is best-effort. `concurrency=1` still scale-out-clones the process.
- KD5. Recommended topology is Hybrid (Approach B below): Cloud Run for the trusted edge, GKE Agent Sandbox for untrusted code, Spanner (or Firestore in a first slice) for strongly consistent kernel state, Agent Platform for LLM + identity + egress policy.
- KD6. This document is research only. No production code, no package rename, no runtime shim in this work unit.

### Scope Boundaries

In scope:

- Architecture options and a recommended split across Cloud Run, GKE, and Agent Platform.
- A primitive-by-primitive map of the current kernel onto GCP services.
- Success criteria for a later implementation program.
- Named non-approaches (workerd-on-GKE, Cloud-Run-only actors, Agent-Runtime-as-OS).

Out of scope:

- Implementing a GCP runtime, rewriting `workshop-backend`, or adding a Google Cloud deploy path.
- Renaming the product in the current Cloudflare-hosted repo.
- Replacing Cap'n Web with A2A or MCP as the gadget protocol.
- Multi-region active-active in the first architecture.

### Requirements

**Product invariants (must survive the port)**

- R1. Each gadget remains a private, addressable server instance that cannot open arbitrary network connections.
- R2. The agent performs work by writing and executing code against introduced capabilities, not by ambient MCP access to every connector.
- R3. Side-effecting Gatekeeper calls remain queueable for later human approval, with local simulation so the agent can continue.
- R4. Client and gadget server continue to speak Cap'n Web RPC over a reconnectable WebSocket (or an equivalent bidirectional stream with the same object-capability semantics).
- R5. Introducing a resource is still a capability grant, not an ACL on a shared SaaS tenant.

**Platform constraints**

- R6. No Cloudflare account, API token, Worker, Durable Object, or `workerd` process may be required to run a deployment.
- R7. Untrusted gadget and `executeCode` processes must run behind a kernel-level sandbox (gVisor or stronger), with default-deny to RFC1918, metadata, and the cluster control plane.
- R8. Trusted kernel state (users, workspaces, chat, git objects, bound capabilities) must have a single-writer, strongly consistent home per workspace.
- R9. LLM calls go through Gemini Enterprise Agent Platform (Model Garden + Model Armor floors). Operator-supplied keys for other providers may exist, but they still egress through Agent Gateway when the deployment is in governed mode.
- R10. Human users authenticate with Google Cloud Identity / Identity Platform (and optional IAP). Agent processes authenticate with Agent Identity (SPIFFE), not a shared service account.
- R11. Blueprint blobs live in Cloud Storage. Deployment admin config has one writer and a cheap cached read path (Spanner/Firestore plus Memorystore or equivalent).

**Non-requirements for v1 of a GCP port**

- R12. WebSocket hibernation is not required. The current kernel already uses live Cap'n Web, not Durable Object hibernation APIs.
- R13. Geographic placement hints are not required. Application code does not use `locationHint`.

### Approaches

Scores are suitability for this product on Google Cloud (feasibility, performance, maintainability, complexity). None of these is a Workers clone.

#### Approach A — GKE-native OS (score 82)

Run the kernel, gadgets, and `executeCode` inside one GKE cluster. Gadgets and code-mode workers are Agent Sandbox claims (`Sandbox` / `SandboxClaim` / `SandboxWarmPool`) with `runtimeClassName: gvisor`. The Overseer becomes a controller that owns sandbox identities the way it owns Facets today. Agent Platform is used only for models, Armor, Identity, and Gateway.

- Pros: closest analog to Facets (one stateful single-replica identity per gadget); no 60-minute Cloud Run WebSocket cap on in-cluster streams; snapshots and warm pools exist; default-deny NetworkPolicy is documented.
- Cons: you operate a cluster; gadget density is tens-to-hundreds per node, not isolate-cheap; you still must invent colocated transactional storage (PVC is not Durable Object KV with stored RPC stubs); kernel RPC into sandboxes goes through the Sandbox Router, not `ctx.facets.get`.
- Best when: the operator already standardizes on GKE, wants maximum fidelity to the actor/sandbox model, and accepts Kubernetes as the control plane.

#### Approach B — Hybrid (recommended, score 88)

Cloud Run Services host the trusted edge: router, frontend assets, kernel RPC gateway, and Gatekeeper HTTP/OAuth. GKE Agent Sandbox hosts untrusted gadget servers and `executeCode`. Spanner (or Firestore for a thinner first slice) is the system of record. Memorystore fans out live collaboration. Cloud Tasks replace Durable Object alarms. Agent Runtime is optional for the chat loop; Agent Gateway + Identity + Armor are mandatory in governed enterprise mode.

- Pros: each GCP product is used for a job it already has; Cloud Run scales the trusted HTTP plane; GKE Sandbox covers the security boundary the product actually needs; Agent Platform covers enterprise governance the current kernel does not have.
- Cons: the Overseer is no longer one process with colocated storage; Facet abort/reload becomes a sandbox recycle; stored RPC stubs must become durable capability records plus live reconnect; more moving parts than A.
- Best when: the goal is an enterprise-grade Company OS on Google Cloud rather than a line-for-line Workers port.

#### Approach C — Agent Platform-first rewrite (score 48)

Rebuild the agent on ADK, deploy to Agent Runtime, register tools and MCP in Agent Registry, put humans on Gemini Enterprise. Gadgets become ordinary Cloud Run services or disappear.

- Pros: fastest path to "enterprise agent platform" branding; Identity, Gateway, Armor, Sessions, Memory Bank are native; less custom kernel.
- Cons: abandons gadgets as private sandboxed apps; ADK is function-calling, not Code Mode; Agent Runtime Code Execution cannot host gadget servers; capability introductions collapse into IAM on Registry resources; this is a different product.
- Best when: the operator wants a governed agent fleet and does not need personal app instances.

#### Rejected — Cloud Run only (score 38)

Put kernel and gadgets on Cloud Run Services, maybe one Cloud Run Instance per workspace.

- Why it fails R1/R8: Services are not unique actors. Affinity breaks on scale. Default Instance quota is 100 per project per region. Instances restart every 7 days and have no colocated SQLite. Request timeout is 60 minutes. Egress deny is org-policy-wide, not per gadget isolate.
- Cloud Run Instances remain useful as a rare singleton (a deployment-wide admin worker), not as the gadget fabric.

#### Rejected — workerd on GKE (score 0)

Forbidden by R6.

### Recommendation

Ship Approach B. Use Agent Platform as the enterprise plane (R9, R10). Use GKE Agent Sandbox as the untrusted compute plane (R1, R7). Use Cloud Run as the trusted edge. Use Spanner as the workspace ledger (R8).

Approach A is the fallback if Cloud Run's 60-minute WebSocket cap cannot be made reconnect-safe for Cap'n Web. Approach C is only a companion product (a Gemini Enterprise front door), never a replacement for the OS.

### Primitive Map

| Cloudflare OS primitive | What the product needs | GCP analog | Gap to close in implementation |
| --- | --- | --- | --- |
| Worker (router + kernel HTTP) | Stateless HTTPS origin | Cloud Run Service + load balancer / IAP | Path routing today is a Worker; becomes a container |
| Durable Object (User, Overseer, AdminSettings, Gatekeeper accounts) | Unique single-writer actor + strongly consistent storage | Spanner row + lease, or GKE Sandbox identity | No colocated compute+storage; stored `Fetcher` stubs cannot persist |
| Facets (gadget + gatekeeper children of Overseer) | Parent-local named children, abort/reload | GKE `SandboxClaim` named by gadget id; recycle on code change | Parent/child GC and `ctx.props` must be reinvented |
| WorkerLoader + `globalOutbound: null` | Load user JS, no `fetch` | GKE Agent Sandbox default-deny + no SA token | Process-level, not V8 isolate; slower/heavier |
| `executeCode` isolate | Ephemeral no-egress Code Mode | GKE sandbox from a warm pool, or Agent Platform Code Execution for snippets only | Agent Platform JS/Python sandboxes are not gadget servers |
| DO `alarm()` | Per-actor durable wake | Cloud Tasks + Cloud Scheduler | At-least-once; no "one slot per DO" unless the kernel multiplexes |
| KV (admin mirror, blueprints metadata) | Cheap weakly consistent read | Memorystore or Spanner stale read | Writer remains the AdminSettings singleton equivalent |
| R2 | Blueprint archives, screenshots | Cloud Storage | Straightforward |
| Workers AI / AI Gateway | Model calls + optional shared keys | Agent Platform Model Garden + Gateway + Armor | Provider list changes; billing is GCP |
| Service bindings `GATEKEEPER_*` | Pluggable connector workers | Cloud Run services + private service connect / Agent Registry MCP | Dynamic discovery must not depend on Wrangler binding scan |
| Cap'n Web WebSocket | Persistent RPC session | Cloud Run WS (reconnect ≤60 min) or GKE Gateway / Sandbox Router | Clients must reconnect; no hibernation |
| Cloudflare Access / AUTH_GATEKEEPERS | Sign-in | Identity Platform + IAP; Google as an auth gatekeeper | Password auth is optional; IAP is the enterprise default |
| Iframe CSP gadget client | Browser sandbox | Unchanged (frontend) | Keep `connect-src 'none'` and postMessage RPC |

### Key Flows

F1. **User opens a workspace.** Browser connects to the Cloud Run origin over WSS `/api`. The kernel authenticates via IAP/Identity Platform, loads the user record from Spanner, and attaches the workspace lease. If the lease is on another replica, the RPC is forwarded or the client is redirected. Covers R4, R8, R10.

F2. **Agent `executeCode`.** Overseer logic claims a GKE sandbox from the code-mode warm pool, injects only the introduced capability endpoints (as localhost or Sandbox Router routes), runs the snippet, records observations, and releases or snapshots the sandbox. The snippet has no metadata, RFC1918, or cluster API access. Covers R2, R7.

F3. **Create or open a gadget.** Kernel creates or claims a Sandbox from the gadget template, keyed by gadget id. User-authored server code runs there. The iframe still talks Cap'n Web via the parent Workshop frame. Recycle the sandbox when the code version changes (Facet abort analog). Covers R1, R4.

F4. **Introduce a Gatekeeper resource.** User completes OAuth on the Gatekeeper Cloud Run service. The kernel stores a capability record (account id, resource URL, vendor) in Spanner, not a live RPC stub. Later gadget/agent calls go kernel → Gatekeeper service with the capability token. Writes that need approval are simulated and queued. Covers R3, R5.

F5. **Governed model call.** Kernel or agent runtime calls Model Garden through Agent Gateway. Model Armor floors inspect prompt and response. The calling principal is an Agent Identity, mapped to the human owner in audit logs. Covers R9, R10.

### Acceptance Examples

- AE1. A deployment with no Cloudflare credentials boots, serves the SPA, and completes a passwordless IAP login. Covers R6, R10.
- AE2. A gadget `fetch('https://example.com')` fails. The same gadget can call only the GitHub repo it was introduced to, via the Gatekeeper. Covers R1, R5, R7.
- AE3. The agent writes a Code Mode snippet that calls a bound Gmail session. The call is observed. A send is queued for approval and does not hit Gmail until the user approves. Covers R2, R3.
- AE4. Two browsers edit one gadget. After a Cloud Run replica recycle, both reconnect and converge on the same Spanner-backed state. Covers R4, R8, R12.
- AE5. An admin sets a Model Armor floor. A jailbreak prompt is blocked before the gadget or agent sees the completion. Covers R9.

### Success Criteria

- S1. Reviewers can map every current Durable Object class to a GCP home without leftover "must stay on Workers" items other than explicit non-goals.
- S2. The recommended topology can be explained in one diagram with three planes (edge, sandbox, agent governance) and no Cloudflare boxes.
- S3. The two open blockers in the Goal Capsule are the only architecture forks left for planning.

### Outstanding Questions

Resolve Before Planning:

- Q1. Gadget host: GKE Agent Sandbox per gadget (Approach A/B default) vs an in-process V8/Wasm isolate pool on trusted GKE nodes (cheaper, closer to WorkerLoader, more code to own).
- Q2. Workspace uniqueness: Spanner lease in front of Cloud Run vs giving each Overseer its own GKE Sandbox.
- Q3. Chat agent loop: keep a custom Code Mode harness on GKE vs run the conversation on Agent Runtime and keep Code Mode as a tool that calls GKE.

Deferred to Planning:

- Q4. Spanner vs Firestore for the first kernel ledger.
- Q5. Whether Gatekeepers register as Agent Registry MCP servers in addition to Cap'n Web.
- Q6. Multi-region: regional Spanner + Cloud Run vs single-region v1.
- Q7. Product rename and remaining "Cloudflare OS" strings (frontend, OAuth copy, `DEFAULT_SITE_NAME`).

### Risks

- K1. Stored irrevocable RPC stubs (`Fetcher` in Durable Object KV) have no GCP equivalent. Capability records plus live reconnect are a kernel redesign, not a config change.
- K2. GKE Agent Sandbox is process isolation, not V8 isolates. Memory and cold-start economics will not match Dynamic Workers. Warm pools and snapshots are mandatory for Code Mode latency.
- K3. Cloud Run WebSocket 60-minute timeout will drop `/api` sessions unless the frontend already reconnects cleanly (it must be verified).
- K4. Agent Gateway IAM is resource-oriented. Capability introductions are object-capability-oriented. Do not let Registry-wide `roles/iap.egressor` become ambient MCP.
- K5. Cloud Run Instances (preview) look like Durable Objects in blog posts. Quota, 7-day restart, and shared CPU make them unfit as the gadget fabric.

### How This Work Fits Together

<!-- ce-section: work-relationships -->

This plan owns architecture selection only. A later implementation program would split by plane so kernel review stays small: (1) ledger + capability records, (2) GKE sandbox adapter for gadgets/`executeCode`, (3) Cloud Run edge + Cap'n Web reconnect, (4) Gatekeeper workers as Cloud Run services, (5) Agent Platform wiring. Those units are not in scope here.

### Assumptions

- A1. "Enterprise-grade agent platform" means Agent Platform governance (Identity, Gateway, Armor, audit) plus the existing OS product, not a greenfield ADK app.
- A2. Direct fetches of `docs.cloud.google.com` were blocked in the research environment. Product facts are from Google search snippets, official blogs, quotas pages, and SIG Agent Sandbox docs as of 2026-09-03. A planner should re-read the live docs before locking APIs.
- A3. GKE Agent Sandbox GA (2026-05-20), Cloud Run Instances (preview), and Vertex AI → Gemini Enterprise Agent Platform (Next '26, 2026-04-22) are the current names.

## Appendix: Research notes

### Why Cloud Run cannot be the kernel

Cloud Run Services are a regional load-balanced replica set. `concurrency=1` serializes one replica, then starts more replicas. Session affinity is a cookie, broken on scale, CPU, or instance death. WebSockets are HTTP requests with a documented maximum of 60 minutes. There is no `idFromName` routing.

Cloud Run Instances are named singletons with a stable URL and no autoscaling. Default quota is 100 per project per region (increasable). Continuous execution restarts at 7 days (not increasable). They have no colocated transactional storage. They are a reasonable host for a deployment-wide daemon, not for thousands of gadgets.

Worker pools are homogeneous pull consumers. Direct VPC ingress gives each replica a private IP. Replicas are still interchangeable, not per-workspace actors.

Use Cloud Run for: SPA + router, kernel RPC gateway, Gatekeeper OAuth/HTTP, Cloud Tasks targets, maybe AdminSettings as one Instance.

### Why GKE Agent Sandbox can host gadgets

GKE Agent Sandbox (add-on, no extra charge beyond GKE) installs SIG Apps CRDs: `Sandbox`, `SandboxTemplate`, `SandboxClaim`, `SandboxWarmPool`. Each Sandbox is a stateful single-replica pod with stable identity. The Sandbox Router addresses it by `X-Sandbox-ID`.

Isolation is gVisor (GKE Sandbox) by default; Kata is possible but unsupported by Google. Default network policy allows public egress and blocks RFC1918, metadata, and the control plane. Service account tokens are not mounted by default. That is the right default-deny shape for gadgets, except public egress should be tightened to deny as well (WorkerLoader uses `globalOutbound: null`). Close that with a custom NetworkPolicy that allows only the kernel/Gatekeeper destinations.

Warm pools: vendor claim of 300 sandboxes/s/cluster, p90 ~200 ms. Snapshots checkpoint to GCS for suspend/resume. Density in Google's published tests is tens to low hundreds per node, not thousands of isolates.

This maps to Facets better than anything else on GCP. It does not map to Durable Object storage: use a PVC for gadget disk if needed, and Spanner for kernel truth.

### Why Agent Platform is the control plane

Gemini Enterprise Agent Platform is the 2026 name for Vertex AI plus agent governance. Relevant pieces:

- Agent Runtime (ex Agent Engine): managed host for ADK agents; Sessions; Memory Bank. Useful if Q3 chooses to run the chat loop there.
- Code Execution sandboxes: Python and JavaScript snippets, no network, sub-second, not long-lived HTTP servers. Use for calculator-style tools, not gadgets.
- ADK: Python, TypeScript, Go, Java. First-party tool calling, MCP client, not Code Mode. A third-party `adk-code-mode` package exists; do not treat it as Google-supported.
- Agent Identity: SPIFFE principal per agent, mTLS + DPoP through the gateway.
- Agent Gateway + IAP: default-deny egress unless `roles/iap.egressor` on a Registry resource. This is the enterprise analog of "no ambient fetch," but it is IAM on named tools, not object capabilities. The kernel must still mint per-introduction grants or Gateway will be either too open or too closed.
- Model Armor: project floors on prompts/responses; can bind to Gateway.
- Model Garden: Gemini, Claude MaaS, others — replacement for Workers AI Gateway.

Agent Platform cannot: isolate a user-authored gadget, persist Cap'n Web stubs, or express Gatekeeper simulation/approval.

### Suggested later MVP (not this work)

A first end-to-end slice that would prove B without boiling the ocean: IAP-authenticated Cloud Run origin; one Spanner workspace row; one GKE sandbox that runs a hello-world gadget with network denied; Cap'n Web from the existing frontend with reconnect; one model call through Agent Gateway with Armor; no Gatekeeper port yet.

Sources (re-read before planning): [Cloud Run resource model](https://docs.cloud.google.com/run/docs/resource-model), [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [GKE Agent Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-sandbox), [Agent Sandbox GA blog](https://cloud.google.com/blog/products/containers-kubernetes/bringing-you-agent-sandbox-on-gke-and-agent-substrate), [Agent Platform overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview), [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview), [Code Execution](https://docs.cloud.google.com/gemini-enterprise-agent-platform/scale/sandbox/code-execution-overview), repo kernel: `packages/workshop-backend/src/overseer.ts`, `packages/workshop-backend/src/agent.ts`, `README.md`.
