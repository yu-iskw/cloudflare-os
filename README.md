# Company OS on Google Cloud

Company OS is an operating system for AI productivity. Every user runs a private, sandboxed instance of each app (a **gadget**). An accountable coding agent writes and executes code against **introduced** capabilities. A security layer, **Gatekeepers**, wraps external services so non-technical users can go nuts and nothing bad happens.

This repository is Company OS hosted on Google Cloud:

* a React SPA talking **Cap'n Web** over WebSocket at `/api`
* a gen2 **Cloud Run** Service (`gcp-kernel`) with nested **`sandbox do`** for Code Mode
* **Cloud SQL** PostgreSQL as the kernel ledger (workspace leases, capability **records** — never stored RPC stubs)
* **Cloud Storage** for git blobs and blueprints
* **Identity Platform / IAP** for human login
* **Agent Gateway + Model Armor** for governed model calls
* one **GitHub** Gatekeeper as its own Cloud Run service

The idea is not that your company uses a generic product, but that you make it *Your Company* OS.

![A Q3 planning workspace, with an AI-generated slide deck](docs/images/q3-planning-workspace.png)

This is not a traditional computer operating system. We use the term in two senses:

* An operating system for *the company* to be productive with AI, in a way that is safe, so that the security team can sleep at night.
* An operating system for AI workloads, analogous to the sense in which a traditional operating system manages compute workloads.

Company OS provides three things in particular:

1. An agent chat UI where you can ask agents to do tasks, preloaded with knowledge about how your company operates.
2. Sandboxed application development, so that you can ask agents to build gadgets (small personal apps) and safely share what you've built with others.
3. Gatekeepers that apply guardrails to both agents and apps.

## Quick start (local)

[Install pnpm](https://pnpm.io/). Then run the kernel and the SPA in two terminals:

```sh
# Terminal 1 — kernel (Cloud Run-shaped Node server)
IAP_DEV_EMAIL=dev@example.com pnpm --filter @gadgets/gcp-kernel start
# listens on http://localhost:8080  (/api Cap'n Web, /healthz)

# Terminal 2 — SPA
VITE_BACKEND_HOST=localhost:8080 pnpm --filter @gadgets/workshop-frontend dev
# Vite on http://localhost:3000, proxies /api to the kernel
```

Visit http://localhost:3000.

This is a local stand-in for the Cloud Run origin. Production is a gen2 Cloud Run Service with `--sandbox-launcher`, `--add-cloudsql-instances`, IAP, GCS git blobs, and Agent Gateway. Nested `sandbox do` needs `/usr/local/gcp/bin/sandbox` (or `SANDBOX_BIN` pointing at a fake binary in CI).

### What to try

Try prompts like:

* "Make slides for my upcoming meeting with a customer." (This will use the built-in slides blueprint.)
* "Make a collaborative whiteboard app." (This will create a new app from scratch.)
* "Make a tic tac toe game." followed by "I'll be X and you be O. I've made my first move. Your turn."
* "Make an issue dashboard for this GitHub repo." (Attach a repo; requires that the GitHub Gatekeeper is configured.)

### WARNING: Early access

Company OS is in a state of heavy development. As of the 2026 Google Cloud port, the product is capable but still has rough edges. Consider this an early-access release.

## Overview

### Gadgets: a new way of thinking about software

Company OS is more than another chatbox with connectors. Every user runs their own copy of the productivity apps they use.

When you create a slide deck, you are not calling out to some SaaS software running in the cloud. The system creates a *private instance* of the slide deck software *just for you*. We call this a gadget. This instance runs in a separate sandbox from everyone else's slide decks.

This has two profound effects:

1. It's impossible for the slide deck app to have a security bug that leaks your slides to an attacker. The kernel sandbox controls all access to your private instance of the app.
2. If you want, you can freely modify the code. If the slide deck app is missing a feature you need, you can just ask your agent to add it. And because of point 1, it's totally safe to do so.

This is a big departure from the last 25 years of cloud architecture and "Software as a Service", but AI has changed the equation. When any user is capable of prompting an agent to add the features they need, the centralized model of software stops making sense.

### Gatekeepers: a capability-based security layer

Gatekeepers are like supercharged MCP servers.

When you introduce an agent or gadget to an external resource, a Gatekeeper is created to manage that access. It:

* Provides a clean Cap'n Web API to the service (wrapping whatever API the service provides natively).
* Handles authorization (e.g. via OAuth).
* Enforces narrow access to only the specific resource the user intended.
* Logs every action the gadget (or agent) performs, for your review.
* For any action which has side effects, provides the human user an opportunity to approve or deny the action ("human in the loop").

On the last point, Gatekeepers simulate the outcome locally so the agent can proceed and queue more actions. The user approves or rejects later, in bulk or one-by-one.

v1 ships **one** Gatekeeper: GitHub (`packages/gcp-gatekeeper-github`), as its own Cloud Run service. The kernel stores a **capability record** (account id, resource URL, vendor) in Cloud SQL — never a live RPC stub — and calls the Gatekeeper with that record.

### Think of an office suite

The basic user experience is something like an online office suite. Instead of a fixed set of file types, each file — or gadget — is potentially its own custom application, written by AI to serve exactly your needs.

Just like office docs, each gadget is private by default, but can be shared — securely — in order to collaborate with your team.

Just like office docs, you can start from templates — called **Blueprints**. A Blueprint specifies a whole application, not just content.

### It kind of is an operating system

| Normal OS      | Company OS                         |
|----------------|------------------------------------|
| kernel         | `packages/gcp-kernel`              |
| device drivers | `packages/gcp-gatekeeper-github`   |
| shell          | `packages/workshop-frontend`       |
| processes      | gadgets                            |
| executables    | blueprints                         |
| users          | users                              |
| ACLs           | shared permissions                 |
| ???            | agents                             |

The kernel connects users to programs and devices (gadgets and Gatekeepers) while sandboxing applications and enforcing access control. Agents are not users: they are accountable to a human, with restricted permissions, and they work by writing snippets of code and executing them (`sandbox do`). The security model is capability-based, not access-control lists.

### Built on Google Cloud

| Plane | Product |
| --- | --- |
| Origin | Cloud Run Service (gen2, `--sandbox-launcher`, IAP) |
| Untrusted Code Mode | Nested `sandbox do` (deny-egress, no metadata) |
| Ledger | Cloud SQL PostgreSQL + workspace lease |
| Git / blueprint bytes | Cloud Storage |
| Humans | Identity Platform + IAP |
| Models | Agent Gateway + Model Armor + Model Garden |
| GitHub | Cloud Run Gatekeeper service |

Cloud Run Services are interchangeable replicas. Workspace uniqueness is a **Postgres lease**, not replica pinning. WebSockets last 60 minutes; the SPA reconnects. See `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`.

## Features

### General multi-purpose agent

The coding agent is a fully multi-purpose agent. It is a Code Mode agent: it performs tasks by writing and immediately executing snippets of code inside `sandbox do`. External resources are connected using Gatekeepers.

### Build apps with AI

The expectation is that AI writes gadget code for you. You can choose your LLM. Model calls go through Agent Gateway; Model Armor floors inspect prompt and response.

### Collaborate with AI

Every gadget automatically has an agent-friendly API. Client and server communicate via Cap'n Web RPC. That is a win-win:

1. Cap'n Web is extremely low-boilerplate, which makes it easy for agents to work with. You define a method on your server, then call it from your client, as if it were a local call.
2. The server necessarily exposes an API which the agent can invoke from Code Mode.

### Real-time multiplayer

You can share your gadget just like you'd share a document. After a Cloud Run replica recycle, clients reconnect and converge on the same Cloud SQL–backed state (git blobs in GCS).

### Blueprints: share your code

If you've created a gadget that might be useful to others, but you don't want to share the gadget itself, you can share a Blueprint — a copy of the code. Every user then runs their own copy of the software, and can change it with AI.

### Sandboxed and secure by default

Each gadget is prevented from talking to the internet at all without your explicit consent:

* Untrusted server evaluation runs in a Cloud Run nested sandbox with deny-egress. It can only reach external resources the host introduces, via capability records, through the kernel.
* Client code runs in a sandboxed iframe. This iframe can communicate with its server only via a Cap'n Web RPC session provided over `postMessage()` to the parent frame. The iframe is otherwise blocked from accessing the internet (to the maximum extent allowed by browsers, via `Content-Security-Policy` and iframe sandbox settings).

### Capability-based access control

Each agent, and each gadget, by default has access to nothing. You must *introduce* each agent (or gadget) to any particular resources you want it to access. An agent can also request an introduction, which you can then provide or deny.

This differs from most agent harnesses, where MCP servers are configured upfront, making broad access ambiently available. Capability-based introductions keep each agent restricted to only the access it actually needs.

## Developing

Kernel on 8080, frontend Vite on 3000 proxying `/api`:

```sh
IAP_DEV_EMAIL=dev@example.com pnpm --filter @gadgets/gcp-kernel start
VITE_BACKEND_HOST=localhost:8080 pnpm --filter @gadgets/workshop-frontend dev
```

Then visit http://localhost:3000.

Useful checks:

```sh
pnpm --filter @gadgets/gcp-kernel test:run
pnpm --filter @gadgets/gcp-ledger test:run
pnpm --filter @gadgets/workshop-frontend test:run
pnpm build
pnpm lint
```

GitHub Gatekeeper setup lives in `packages/gcp-gatekeeper-github`.

### Contributing

At this time, we are not seeking outside contribution.

AI has made writing code easy. The hard part, today, is not writing the code, but reviewing it, making sure quality stays high, and keeping the product coherent. In that light, unfortunately, external code contributions are "donating" the easy part of the job, while creating more of the hard work.

With that said, we are happy to accept small, trivially-verified PRs that fix a problem. However, we ask that you refrain from submitting low-value PRs (e.g. typo fixes) or PRs that are more than a dozen or so lines. Such PRs will be closed with a reference to this guideline.

This policy may change in the future as the project matures. Until then, thank you for your understanding.

## Credits

Company OS has far too many open source dependencies to list here. A few that do particularly heavy lifting:

* [Pi](https://pi.dev/) (specifically, `pi-agent-core`), which made it easy to support every LLM provider with one API.
* [CodeMirror](https://codemirror.net/) provides our code editor UI and operational transform implementation for synchronizing real-time edits.
* [isomorphic-git](https://isomorphic-git.org/) is used to implement the backing storage for gadget code and integration with external git servers.
* [Vite](https://vite.dev/), which makes the development loop so pleasant.
* Cap'n Web, the RPC protocol between SPA, kernel, gadgets, and Gatekeepers.
