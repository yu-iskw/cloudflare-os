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

**Objective.** Specify the Google Cloud hosting architecture for Company OS: sandboxed personal gadgets, a Code Mode agent, and capability-based Gatekeepers.

**Product authority.** The product remains an OS for personal apps plus an accountable agent, not a fleet of ADK chatbots. Gemini Enterprise Agent Platform is the enterprise control plane for models, identity, and egress. It is not the gadget kernel.

**Settled this revision.** Workspace uniqueness on the Cloud Run path is a **Postgres lease** (`SELECT FOR UPDATE` / advisory lock). `executeCode` is Cloud Run `sandbox do`. The v1 ledger is **Cloud SQL PostgreSQL** + GCS blobs — see `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`. One remaining fork: whether long-lived gadgets need GKE Agent Sandbox inbound identity, a host-muxed `sandbox run --detach` process, or stay host-mediated objects.

## Product Contract

### Summary

Company OS on Google Cloud splits into Cloud Run **services** (the request-driven server, with nested **sandboxes** for Code Mode), optional GKE Agent Sandbox for addressable long-lived gadgets, and Gemini Enterprise Agent Platform for models, Agent Identity, Agent Gateway, and Model Armor.

### Problem Frame

Company OS is an operating system for AI productivity. Every user runs a private instance of each app (a gadget). The kernel sandboxes that instance, injects only introduced capabilities, and lets an agent write and execute code against those capabilities.

Google Cloud covers those slices with three products: Cloud Run (request-driven containers plus nested sandboxes), GKE Agent Sandbox (isolated stateful single-replica pods for untrusted agent code), and Gemini Enterprise Agent Platform (managed agent runtime, identity, gateway, and prompt security). Using any one of them as the whole OS fails. Using each for what it actually does hosts the product.

### Primary Actor

Enterprise operators who must run Company OS inside a Google Cloud organization with VPC Service Controls, IAM, and Identity-Aware Proxy.

Secondary actors: end users of the Workshop UI; the coding agent; gadget authors (usually the agent).

### Key Decisions

- KD1. Target runtime is Google Cloud only: Cloud Run gen2, Cloud SQL, Cloud Storage, Identity Platform / IAP, Agent Gateway.
- KD2. Keep the product shape: gadgets, Cap'n Web, capability introductions, Gatekeepers with simulated writes / later approval, Code Mode. Do not replace the OS with a Gemini Enterprise chatbot.
- KD3. Treat Agent Platform as governance and model access, not as the gadget host. Agent Runtime Code Execution is a snippet sandbox. It cannot run a long-lived TypeScript gadget server.
- KD4. Do not host unique workspace actors on Cloud Run Services. Services are interchangeable replicas. Session affinity is best-effort. `concurrency=1` still scale-out-clones the process. There is no product named Cloud Run servers; the server is a Service.
- KD5. Recommended topology is Cloud Run–first Hybrid (Approach B): a gen2 Cloud Run Service with `--sandbox-launcher` is the kernel **and** the `executeCode` host (`sandbox do`, deny-egress). GKE Agent Sandbox is reserved for gadgets that need independently addressable inbound HTTP. The v1 ledger is **Cloud SQL PostgreSQL**, not Spanner. Agent Platform is LLM + identity + egress policy.
- KD6. Cloud Run nested sandboxes are the no-egress executor for snippets. They are not independently addressable: no per-sandbox URL, `--allow-egress` is all-or-nothing, host↔sandbox streams are unverified, and the box dies with the host replica.
- KD7. Persist **capability records** (account id, resource URL, vendor, token metadata). Never persist live RPC stubs.
- KD8. Do not treat `GoogleCloudPlatform/cloud-run-sandbox` (experimental `runsc` WebSocket sample) as the Cloud Run sandboxes product. The product is `/usr/local/gcp/bin/sandbox` injected by `--sandbox-launcher`.
- KD9. Storage ladder: Cloud SQL Postgres (v1) → AlloyDB (same SQL if the primary saturates or HTAP/vectors appear) → Spanner (only if multi-region strong writes become a requirement). Identity Platform owns human login. Firestore is presence/prototype only, not git, not the ledger. SQL Connect / Data Connect GraphQL must not sit beside Cap'n Web.
- KD10. v1 ships **one Gatekeeper**: GitHub, as its own Cloud Run service.

### Scope Boundaries

In scope:

- Architecture options and a recommended split across Cloud Run services, Cloud Run nested sandboxes, GKE, and Agent Platform.
- The Cloud Run resource family (services, jobs, worker pools, instances, functions, nested sandboxes).
- Ledger choice among Cloud SQL, AlloyDB, Spanner, and Firebase (Firestore / Auth / SQL Connect).
- A primitive-by-primitive map of the product onto GCP services.
- Success criteria for a later implementation program.
- Named non-approaches (Cloud Run Instances as actors, Agent Runtime as the OS).

Out of scope:

- Multi-region active-active in the first architecture.
- Replacing Cap'n Web with A2A or MCP as the gadget protocol.
- Additional Gatekeepers beyond GitHub.

### Requirements

**Product invariants**

- R1. Each gadget remains a private, addressable server instance that cannot open arbitrary network connections.
- R2. The agent performs work by writing and executing code against introduced capabilities, not by ambient MCP access to every connector.
- R3. Side-effecting Gatekeeper calls remain queueable for later human approval, with local simulation so the agent can continue.
- R4. Client and gadget server continue to speak Cap'n Web RPC over a reconnectable WebSocket (or an equivalent bidirectional stream with the same object-capability semantics).
- R5. Introducing a resource is still a capability grant, not an ACL on a shared SaaS tenant.

**Platform constraints**

- R6. A deployment runs on the Google Cloud products in this plan. No third-party isolate runtime is required.
- R7. Untrusted gadget and `executeCode` processes must run behind a kernel-level sandbox (gVisor or stronger), with default-deny to RFC1918, metadata, and the cluster control plane.
- R8. Trusted kernel state (users, workspaces, chat, git **metadata**, bound capabilities) must have a single-writer, strongly consistent home per workspace. For v1 that home is **Cloud SQL PostgreSQL** plus a workspace lease.
- R9. LLM calls go through Gemini Enterprise Agent Platform (Model Garden + Model Armor floors). Operator-supplied keys for other providers may exist, but they still egress through Agent Gateway when the deployment is in governed mode.
- R10. Human users authenticate with Google Cloud Identity / Identity Platform (and IAP). Agent processes authenticate with Agent Identity (SPIFFE), not a shared service account.
- R11. Blueprint and git **blobs** live in Cloud Storage. Deployment admin config has one writer and a cheap cached read path (Postgres plus Memorystore or equivalent).
- R14. Do not start the ledger on Spanner. Do not put git objects in Firestore or Spanner cells. Do not expose the kernel through Firebase SQL Connect / Data Connect GraphQL.

**Non-requirements for v1**

- R12. WebSocket hibernation is not required. Sessions are live Cap'n Web; the SPA reconnects.
- R13. Geographic placement hints are not required.

### Approaches

Scores are suitability for this product on Google Cloud (feasibility, performance, maintainability, complexity).

#### Approach A — GKE-native OS (score 82)

Run the kernel, gadgets, and `executeCode` inside one GKE cluster. Gadgets and code-mode workers are Agent Sandbox claims (`Sandbox` / `SandboxClaim` / `SandboxWarmPool`) with `runtimeClassName: gvisor`. The Overseer becomes a controller that owns sandbox identities. Agent Platform is used only for models, Armor, Identity, and Gateway.

- Pros: one stateful single-replica identity per gadget; no 60-minute Cloud Run WebSocket cap on in-cluster streams; snapshots and warm pools exist; default-deny NetworkPolicy is documented.
- Cons: you operate a cluster; gadget density is tens-to-hundreds per node; colocated transactional storage is still invented (PVC is not a capability store); kernel RPC into sandboxes goes through the Sandbox Router.
- Best when: the operator already standardizes on GKE, wants maximum fidelity to the actor/sandbox model, and accepts Kubernetes as the control plane.

#### Approach B — Cloud Run–first Hybrid (recommended, score 90)

A gen2 Cloud Run **Service** with `--sandbox-launcher` is the request-driven server: SPA, `/api`, Gatekeeper HTTP, and nested **`sandbox do`** for Code Mode (deny-egress, no metadata, ~500 ms). **Cloud SQL PostgreSQL** is the ledger (Auth Proxy sidecar or `--add-cloudsql-instances`; tiny per-replica pools). Git and blueprint **blobs** are GCS. Memorystore fans out live collaboration. Cloud Tasks replace durable per-actor wakes. GKE Agent Sandbox is **optional**, used only when a gadget needs an independently addressable long-lived HTTP process. Agent Gateway + Identity + Armor remain mandatory in governed mode. AlloyDB is the same-SQL upgrade. Spanner and Firestore-as-kernel are out of v1.

- Pros: `executeCode` stays on the same product as the kernel, with a stronger default-deny than GKE Agent Sandbox; no cluster required for the MVP; Agent Platform still covers enterprise governance.
- Cons: nested sandboxes share the host replica’s CPU/RAM and die on scale-to-zero; no per-sandbox URL; `--allow-egress` is all-or-nothing so capability calls must go through the host; gadget-as-detached-process is unverified host↔sandbox I/O.
- Best when: the operator wants Company OS on Google Cloud without standing up GKE on day one.

#### Approach C — Agent Platform-first rewrite (score 48)

Rebuild the agent on ADK, deploy to Agent Runtime, register tools and MCP in Agent Registry, put humans on Gemini Enterprise. Gadgets become ordinary Cloud Run services or disappear.

- Pros: fastest path to "enterprise agent platform" branding; Identity, Gateway, Armor, Sessions, Memory Bank are native; less custom kernel.
- Cons: abandons gadgets as private sandboxed apps; ADK is function-calling, not Code Mode; Agent Runtime Code Execution cannot host gadget servers; capability introductions collapse into IAM on Registry resources; this is a different product.
- Best when: the operator wants a governed agent fleet and does not need personal app instances.

#### Approach D — Cloud Run Service + nested sandboxes only (score 72)

Same as B without GKE. Gadgets are either host-side Cap'n Web objects with untrusted logic in `sandbox do`, or `sandbox run --detach` processes the host muxes.

- Pros: one product family; nested sandbox default-deny matches R7 better than GKE's public-egress default; ADK already has `CloudRunSandboxCodeExecutor`.
- Cons: per-gadget inbound identity is not a platform primitive; ComputeSDK documents no per-sandbox ports; replica recycle kills detached boxes; Instance quota still cannot be the gadget fabric.
- Best when: gadgets can stay "code the host runs in a box" rather than "private HTTP server with its own identity."

#### Rejected — Cloud Run Instances as actors (score 38)

One Cloud Run Instance per workspace or gadget.

- Why it fails: default quota 100 per project per region; 7-day forced restart; shared CPU 6.25% baseline; no colocated transactional storage; still not nested isolation unless you also set `sandboxLauncher`.
- Instances remain useful as a rare named daemon (admin worker), not thousands of gadgets.

### Recommendation

Ship Approach B (Cloud Run-first Hybrid). The Cloud Run **service** is the server. Cloud Run **sandboxes** host `executeCode`. GKE Agent Sandbox is added only if gadgets must be independently addressable HTTP servers. Agent Platform remains the enterprise plane (R9, R10). **Cloud SQL PostgreSQL** is the v1 ledger (R8, R14). Identity Platform is human login (R10), not a data plane. v1 Gatekeeper is GitHub only (KD10).

Depth on the service and nested sandbox lives in `docs/superpowers/specs/2026-09-03-cloud-run-server-and-sandbox.md`. Depth on the ledger lives in `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`.

Approach D is the MVP slice of B (skip GKE until gadget inbound routing is proven necessary). Approach A is the fallback if Cap'n Web cannot survive Cloud Run's 60-minute WebSocket cap. Approach C is only a companion product, never a replacement for the OS.

### Primitive Map

| Product primitive | What the product needs | GCP home | Gap to close |
| --- | --- | --- | --- |
| HTTPS origin (router + kernel) | Stateless HTTPS origin | Cloud Run Service + load balancer / IAP | Path routing is a container (`gcp-router`) |
| User / Overseer / AdminSettings | Unique single-writer + strongly consistent storage | Cloud SQL row + Postgres lease | No colocated compute+storage; persist capability **records**, never RPC stubs |
| Gadget children of Overseer | Parent-local named children, abort/reload | Host-mediated objects + nested sandbox, or GKE `SandboxClaim` | No per-sandbox URL on Cloud Run; GKE if inbound identity is required |
| Load user JS, no `fetch` | Untrusted eval, deny-egress | Cloud Run nested sandbox (`sandbox do` / `run`, deny-egress, no metadata) | Process-level isolation; `--allow-egress` is all-or-nothing; host proxies capability calls |
| `executeCode` | Ephemeral no-egress Code Mode | **Cloud Run `sandbox do`** on the kernel service | Agent Platform Code Execution is a different product (Python/JS snippets) |
| Durable wake | Per-workspace scheduled work | Cloud Tasks + Cloud Scheduler | At-least-once; kernel multiplexes slots |
| Cheap weakly consistent admin read | Hot config mirror | Memorystore (or equivalent) in front of Postgres | Writer remains the AdminSettings singleton equivalent |
| Object blobs | Blueprint archives, screenshots, **git blobs** | Cloud Storage | SQL holds oids / `commitId` only |
| Model calls | Governed completions | Agent Platform Model Garden + Gateway + Armor | Billing is GCP |
| Gatekeepers | Pluggable connector services | Cloud Run services + private service connect | v1: GitHub only (`gcp-gatekeeper-github`) |
| Cap'n Web WebSocket | Persistent RPC session | Cloud Run WS (reconnect ≤60 min) or GKE Gateway / Sandbox Router | Clients must reconnect |
| Sign-in | Human identity | Identity Platform + IAP | Password auth is optional; IAP is the enterprise default |
| Iframe CSP gadget client | Browser sandbox | Unchanged (frontend) | Keep `connect-src 'none'` and postMessage RPC |

### Key Flows

F1. **User opens a workspace.** Browser connects to the Cloud Run origin over WSS `/api`. The kernel authenticates via IAP/Identity Platform, loads the user record from Cloud SQL, and attaches the workspace lease (`SELECT FOR UPDATE` or advisory lock). If the lease is on another replica, the RPC is forwarded or the client is redirected. Covers R4, R8, R10.

F2. **Agent `executeCode`.** The kernel Service, running with `--sandbox-launcher`, invokes `/usr/local/gcp/bin/sandbox do` with no egress and no inherited env. Capability calls go back through the host (the box cannot `fetch` Gatekeepers). Observations are recorded; the box is deleted. Covers R2, R7.

F3. **Create or open a gadget.** Default: gadget server logic stays a host-mediated Cap'n Web object; untrusted evaluation uses nested sandboxes. If inbound addressability is required, the kernel claims a GKE Agent Sandbox (or, experimentally, `sandbox run --detach` plus a host mux). Recycle on code-version change. Covers R1, R4.

F4. **Introduce a GitHub resource.** User completes OAuth on the GitHub Gatekeeper Cloud Run service. The kernel stores a capability record (account id, resource URL, vendor) in Cloud SQL, not a live RPC stub. Later gadget/agent calls go kernel → Gatekeeper service with the capability token. Writes that need approval are simulated and queued. Covers R3, R5.

F5. **Governed model call.** Kernel or agent runtime calls Model Garden through Agent Gateway. Model Armor floors inspect prompt and response. The calling principal is an Agent Identity, mapped to the human owner in audit logs. Covers R9, R10.

### Acceptance Examples

- AE1. A Google Cloud-only deployment boots, serves the SPA, and completes a passwordless IAP login. Covers R6, R10.
- AE2. A gadget `fetch('https://example.com')` fails. The same gadget can call only the GitHub repo it was introduced to, via the Gatekeeper. Covers R1, R5, R7.
- AE3. The agent writes a Code Mode snippet that would write to GitHub. The call is observed. A write is queued for approval and does not hit GitHub until the user approves. Covers R2, R3.
- AE4. Two browsers edit one gadget. After a Cloud Run replica recycle, both reconnect and converge on the same Cloud SQL–backed state (git blobs in GCS). Covers R4, R8, R11.
- AE5. An admin sets a Model Armor floor. A jailbreak prompt is blocked before the gadget or agent sees the completion. Covers R9.

### Success Criteria

- S1. Reviewers can map every kernel object to a GCP home.
- S2. The recommended topology can be explained in one diagram with three planes (edge, sandbox, agent governance).
- S3. Ledger (Cloud SQL), uniqueness (Postgres lease on the Cloud Run path), and `executeCode` (`sandbox do`) are settled. The gadget-host fork is the only architecture fork left for planning.
- S4. Cloud Run services and Cloud Run nested sandboxes are specified as distinct primitives, not collapsed into "Cloud Run."
- S5. Reviewers can see why v1 is Cloud SQL rather than Spanner or Firestore, and where AlloyDB and Spanner sit on the upgrade ladder.

### Outstanding Questions

Resolve Before Planning:

- Q1. Gadget host: GKE Agent Sandbox per gadget vs Cloud Run `sandbox run --detach` plus a host mux vs an in-process V8/Wasm isolate pool.
- Q2. Workspace uniqueness — **settled for v1:** Postgres lease in front of a Cloud Run Service. GKE Sandbox identity only if gadget inbound routing forces Approach A.
- Q3. Chat agent loop: custom Code Mode harness calling `sandbox do` on the kernel Service vs Agent Runtime conversation with Code Mode as a tool.

Deferred to Planning:

- Q4. Ledger SKU — **settled:** Cloud SQL PostgreSQL v1. Not Spanner. Not Firestore as kernel. AlloyDB later. See `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`.
- Q5. Whether the GitHub Gatekeeper also registers as an Agent Registry MCP server in addition to Cap'n Web.
- Q6. Multi-region — **settled as out of first-architecture scope.** That is why Spanner is not the v1 ledger. Revisit only if active-active becomes a product requirement.

### Risks

- K1. Stored irrevocable RPC stubs have no SQL analog. Capability records plus live reconnect are the kernel design, not a config change.
- K2. Cloud Run nested sandboxes and GKE Agent Sandbox are both process isolation, not V8 isolates. Nested sandboxes additionally share the host replica and die on scale-to-zero.
- K3. Cloud Run WebSocket 60-minute timeout will drop `/api` sessions unless the frontend reconnects cleanly (it must be verified).
- K4. Agent Gateway IAM is resource-oriented. Capability introductions are object-capability-oriented. Do not let Registry-wide `roles/iap.egressor` become ambient MCP.
- K5. Cloud Run Instances (preview) look like unique actors in blog posts. Quota, 7-day restart, and shared CPU make them unfit as the gadget fabric.
- K6. `--allow-egress` on Cloud Run sandboxes is all-or-nothing. Capability-scoped fetch must stay on the host.
- K7. `GoogleCloudPlatform/cloud-run-sandbox` is an unofficial WebSocket `runsc` sample. Using it as if it were `--sandbox-launcher` is a product mix-up.
- K8. Cloud Run replica count × naive Postgres pools will exhaust `max_connections`. Auth Proxy is not a pooler. Session advisory locks are incompatible with transaction-mode managed pooling.
- K9. Starting on Spanner or putting an Overseer in one Firestore document looks like a unique actor and is not. Interleaving and documents are locality, not processes.

### How This Work Fits Together

<!-- ce-section: work-relationships -->

This plan owns architecture selection. Implementation splits by plane so kernel review stays small: (1) Cloud SQL ledger + GCS git + capability records, (2) Cloud Run Service with `--sandbox-launcher` and `sandbox do` for `executeCode`, (3) Cap'n Web reconnect on the same Service, (4) GitHub Gatekeeper as a Cloud Run service, (5) Agent Platform wiring, (6) GKE Agent Sandbox only if gadget inbound routing is required.

### Assumptions

- A1. "Enterprise-grade agent platform" means Agent Platform governance (Identity, Gateway, Armor, audit) plus the existing OS product, not a greenfield ADK app.
- A2. Direct fetches of `docs.cloud.google.com` were blocked in the research environment. Product facts are from Google search snippets, official blogs, quotas pages, and SIG Agent Sandbox docs as of 2026-09-03. A planner should re-read the live docs before locking APIs.
- A3. GKE Agent Sandbox GA (2026-05-20), Cloud Run nested sandboxes public preview (WeAreDevelopers ~Jul 2026), Cloud Run Instances preview (2026-08-25), Vertex AI → Gemini Enterprise Agent Platform (Next '26, 2026-04-22) are the current names.

## Appendix: Research notes

### Why a Cloud Run Service cannot be a unique actor (but can be the kernel server)

Cloud Run Services are a regional load-balanced replica set. `concurrency=1` serializes one replica, then starts more replicas. Session affinity is a cookie, broken on scale, CPU, or instance death. WebSockets are HTTP requests with a documented maximum of 60 minutes. There is no `idFromName` routing. There is no SKU named Cloud Run servers.

That does **not** mean Cloud Run cannot host the kernel. It is the right **request-driven server**. Nested sandboxes (`--sandbox-launcher`) add a deny-egress executor **inside** that server. See `docs/superpowers/specs/2026-09-03-cloud-run-server-and-sandbox.md`.

Cloud Run Instances are named singletons with a stable URL and no autoscaling. Default quota is 100 per project per region (increasable). Continuous execution restarts at 7 days (not increasable). They have no colocated transactional storage. They are a reasonable host for a deployment-wide daemon, not for thousands of gadgets.

Worker pools are homogeneous pull consumers. Direct VPC ingress gives each replica a private IP. Replicas are still interchangeable, not per-workspace actors.

Use Cloud Run for: SPA + router, kernel RPC gateway, GitHub Gatekeeper OAuth/HTTP, Cloud Tasks targets, **`sandbox do` for executeCode**, maybe AdminSettings as one Instance.

### Why Cloud Run nested sandboxes map to executeCode, not inbound gadgets

`--sandbox-launcher` injects `/usr/local/gcp/bin/sandbox` into a gen2 instance. `sandbox do` is create-exec-delete with deny-egress and no metadata — the `executeCode` analog. `sandbox run --detach` can keep a process alive, and docs mention web servers, but the CLI exposes **no per-sandbox ports**. Ingress stays on the host. `--allow-egress` is all-or-nothing.

GKE Agent Sandbox still maps better when a gadget needs an inbound identity (`X-Sandbox-ID`). Its default NetworkPolicy allows public internet, so it is weaker than Cloud Run sandboxes on egress unless customized.

### Why GKE Agent Sandbox can still host gadgets

GKE Agent Sandbox (add-on, no extra charge beyond GKE) installs SIG Apps CRDs: `Sandbox`, `SandboxTemplate`, `SandboxClaim`, `SandboxWarmPool`. Each Sandbox is a stateful single-replica pod with stable identity. The Sandbox Router addresses it by `X-Sandbox-ID`.

Isolation is gVisor (GKE Sandbox) by default; Kata is possible but unsupported by Google. Default network policy allows public egress and blocks RFC1918, metadata, and the control plane. Service account tokens are not mounted by default. Tighten public egress to deny as well; allow only the kernel/Gatekeeper destinations.

Warm pools: vendor claim of 300 sandboxes/s/cluster, p90 ~200 ms. Snapshots checkpoint to GCS for suspend/resume. Density in Google's published tests is tens to low hundreds per node.

This is the best inbound-gadget primitive on GCP. It is not the kernel ledger: use a PVC for gadget disk if needed, and Cloud SQL for kernel truth.

### Why Agent Platform is the control plane

Gemini Enterprise Agent Platform is the 2026 name for Vertex AI plus agent governance. Relevant pieces:

- Agent Runtime (ex Agent Engine): managed host for ADK agents; Sessions; Memory Bank. Useful if Q3 chooses to run the chat loop there.
- Code Execution sandboxes: Python and JavaScript snippets, no network, sub-second, not long-lived HTTP servers. Use for calculator-style tools, not gadgets.
- ADK: Python, TypeScript, Go, Java. First-party tool calling, MCP client, not Code Mode. A third-party `adk-code-mode` package exists; do not treat it as Google-supported.
- Agent Identity: SPIFFE principal per agent, mTLS + DPoP through the gateway.
- Agent Gateway + IAP: default-deny egress unless `roles/iap.egressor` on a Registry resource. This is IAM on named tools, not object capabilities. The kernel must still mint per-introduction grants or Gateway will be either too open or too closed.
- Model Armor: project floors on prompts/responses; can bind to Gateway.
- Model Garden: Gemini, Claude MaaS, others.

Agent Platform cannot: isolate a user-authored gadget, persist Cap'n Web stubs, or express Gatekeeper simulation/approval.

### Suggested later MVP (not this work)

A first end-to-end slice that would prove B without boiling the ocean: IAP-authenticated Cloud Run Service with `--sandbox-launcher`; `sandbox do` running a deny-egress hello snippet; one Cloud SQL workspace row plus a GCS git pointer; Cap'n Web from the existing frontend with reconnect; one model call through Agent Gateway with Armor; GitHub Gatekeeper; no GKE, no Spanner, no Firestore kernel.

Sources (re-read before planning): [Cloud Run resource model](https://docs.cloud.google.com/run/docs/resource-model), [Configure sandboxes](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes), [Code execution in Cloud Run](https://docs.cloud.google.com/run/docs/code-execution), [Cloud Run WebSockets](https://docs.cloud.google.com/run/docs/triggering/websockets), [Cloud Run quotas](https://docs.cloud.google.com/run/quotas), [GKE Agent Sandbox](https://docs.cloud.google.com/kubernetes-engine/docs/concepts/machine-learning/agent-sandbox), [Agent Sandbox GA blog](https://cloud.google.com/blog/products/containers-kubernetes/bringing-you-agent-sandbox-on-gke-and-agent-substrate), [Agent Platform overview](https://docs.cloud.google.com/gemini-enterprise-agent-platform/overview), [Agent Gateway](https://docs.cloud.google.com/gemini-enterprise-agent-platform/govern/gateways/agent-gateway-overview), [Cloud SQL from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-instance-cloud-run), ledger spec `docs/superpowers/specs/2026-09-03-alloydb-spanner-firebase.md`, repo kernel: `packages/gcp-kernel`, `packages/gcp-ledger`, `packages/gcp-git`, `packages/gcp-sandbox`, `packages/gcp-agent`, `packages/gcp-gatekeeper-github`, `packages/gcp-router`.
