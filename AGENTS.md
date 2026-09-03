This project is **Company OS on Google Cloud**: vibe-coded personal applications and AI agents that run inside a strong sandbox (Cloud Run gen2 + nested `sandbox do`).

The following files are commonly important to reference:

* `packages/workshop-shared/node_modules/capnweb/README.md`: Explains how to use Cap'n Web RPC, which is used extensively for client-server communications.
* `packages/workshop-shared/src/api.ts`: Defines the RPC API used between the frontend and backend.

## Project structure

* **packages/gcp-kernel**: The Company OS **kernel**. Gen2 Cloud Run Service with `--sandbox-launcher`. Serves Cap'n Web over WebSocket at `/api`, holds workspace leases, and hosts `executeCode` via nested sandboxes. Reviewers read *every line* of `gcp-kernel` and of API changes in `workshop-shared`, so keep diffs here small and elegant. Concretely: doc-comment **every** exported member of the `workshop-shared` public API (types, consts, and functions — not just interfaces); never introduce a hand-written interface that mirrors an RPC interface plus an `as unknown as` cast (derive from the real type instead, or rethink the design); and prefer reusing existing mechanisms over adding parallel ones. Capability-based security note: a resource becomes "ambient" (auto-injected) only by user/admin configuration — a gatekeeper must never assert its own ambience. **Never persist RPC stubs.** Store capability records (account id, resource URL, vendor, token metadata) in the ledger and reconnect live stubs per session. Local listen port: **8080**.
* **packages/gcp-ledger**: Cloud SQL PostgreSQL (production) and an in-process Postgres-shaped store (tests / local). Workspace uniqueness is a lease (`SELECT FOR UPDATE` / advisory lock), not replica pinning. Tiny per-replica pools (2–5); Auth Proxy is not a pooler.
* **packages/gcp-git**: Content-addressed git **blobs**. SQL holds oids / `commitId`; bytes live in Cloud Storage (`GcsGitBackend`) or a local/FUSE directory. Never put git objects in Postgres cells.
* **packages/gcp-sandbox**: Wrapper around `/usr/local/gcp/bin/sandbox do` (override with `SANDBOX_BIN`). Deny-egress, no inherited env, no metadata. Capability calls stay on the host; never pass `--allow-egress`.
* **packages/gcp-agent**: Model Garden completions through Agent Gateway, with Model Armor floors on prompt and response. Code Mode still runs in `sandbox do`, not here. Agents authenticate with Agent Identity (SPIFFE), not a shared service account.
* **packages/gcp-gatekeeper-github**: The **only** v1 Gatekeeper. Own Cloud Run HTTP service. OAuth, observations, and queued writes for later human approval. The kernel stores a capability record and calls this service; gadgets never `fetch` GitHub.
* **packages/gcp-router**: Path routing for the Cloud Run origin: `/api` and `/blueprint-screenshot` to the kernel, `/gatekeeper/<slug>/*` to a Gatekeeper service, everything else to the SPA.
* **packages/workshop-frontend**: The Gadgets Workshop UI. Pure single-page app. Speaks to the kernel using Cap'n Web over a persistent WebSocket. React, `@gadgets/kumo` (https://kumo-ui.com/api/component-registry), Phosphor icons, Vite. Dev server: **3000**, proxying `/api` to the kernel on 8080.
* **packages/workshop-shared**: Shared Cap'n Web RPC interface between client and server. Object-capability RPC over a browser WebSocket. Read the capnweb readme for details.
* **packages/kumo**: `@gadgets/kumo` — type/runtime UI helpers used by the Workshop SPA.
* **packages/backend-utils**: Shared server libraries. Logging lives at `@gadgets/backend-utils/logger` (see below).

## Runtime topology

```text
browser (Vite :3000 in dev)
   │  Cap'n Web /api  (proxied)
   ▼
Cloud Run Service  (gcp-kernel :8080, gen2, --sandbox-launcher, IAP)
   ├─ sandbox do          executeCode, deny-egress
   ├─ Cloud SQL Postgres  users, workspaces, leases, capability records
   ├─ GCS                 git blobs, blueprints
   ├─ Agent Gateway       Model Garden + Model Armor
   └─ gcp-gatekeeper-github
```

Human login is Identity Platform + IAP (`IAP_AUDIENCE` in prod, `IAP_DEV_EMAIL` locally). Admin config (`AdminConfig`) has one SQL writer and a cheap cached read path (Postgres plus Memorystore or equivalent). Authentication/authorization settings stay env-var driven so they cannot be changed by a compromised admin session.

A resource becomes ambient only by user/admin configuration. v1 ships one GitHub Gatekeeper; do not add parallel connector runtimes.

Architecture depth: `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md` and `docs/superpowers/specs/`.

## Testing

- Run `pnpm build` to type-check, or `vp run -F <package> build` for one package — most packages declare `build` as a task rather than a script, and `pnpm --filter` cannot see a task. It is a type check and codegen pass, not a compile: most packages are `noEmit`, because nothing imports the others' `dist` — Vite bundles from source. A re-run with nothing changed replays from the task cache — see below.
- Run `pnpm test` to run unit tests. It runs every package's `test` task, including `@gadgets/scripts`, whose suites run under `node --test` rather than vitest.
- The cached per-package test run is a Vite+ `test` task in each package's `vite.config.ts` rather than a `test` script, so its `input` can exclude the scratch paths vitest writes and reads back (`scripts/vitest-task-vite-config.ts`, shared by all of them). Packages with no test files should not declare a vitest `test` script that would exit 1; the shared task already handles empty suites.
- Every command in that shared `test` task runs under `scripts/with-timeout.ts`, so a wedged run fails fast instead of stalling the whole `vp run`: it kills the command's entire process tree and exits 124 (GNU `timeout`'s code) after 60s with no output, or 600s in total.
- Two ways to run one package's tests: `pnpm --filter <package> test:run` goes straight to vitest, `vp run -F <package> test` goes through the cache. The cached path replays instantly when the package is untouched, but its fingerprinting and archiving lose to plain vitest on a package you just edited — by more than the whole suite costs on a small one. Use `test:run` while iterating and `pnpm test` to verify. The direct script is `test:run` rather than `test` because a task may not share a name with a script.
- `pnpm build` and `pnpm clean` are `vp run -r <task>`, not `pnpm run --recursive <task>`. Vite+ runs the same per-package scripts and tasks, in dependency order, but caches each one against its inputs, so an unchanged package replays its previous output instead of re-running. Commands joined with `&&` — or given as an array in a task — are cached as separate entries, so a package whose codegen is fresh can still re-run its `tsc`. `vp run --last-details` explains every hit and miss, which is the thing to read when a build is slower than expected. Don't reintroduce a root script that calls `pnpm run --recursive`: `vp run -r` selects the root package too, and would run it as a task and rebuild the whole workspace a second time.
- **A cached `vp` run strips the environment.** Each task and script sees only a built-in set (`PATH`, `HOME`, `CI`, `NODE_OPTIONS`, …). Anything else is invisible to the command *and* absent from the fingerprint, so a build that depends on an env var silently ignores it and no warning says so. A var can only be declared on a task — `env`/`untrackedEnv` don't exist on a package.json script — so any build that reads one has to *be* a task. `workshop-frontend`'s `build` declares `env: ['VITE_*']`, which both forwards the flags and folds them into the fingerprint, so a changed value is a reported cache miss rather than a stale bundle replayed. Prefer `env` over `untrackedEnv` for anything that changes the output. `scripts/env-passthrough.test.ts` fails on any build-time env read that isn't accounted for.
- **Declaring `env` on one task does not help a sibling script that does the same work.** A script duplicating a task's command takes the stripped path and the declaration buys nothing. So when you find a task with `env`, check what actually invokes that command.
- **`env` fingerprints the value, not what it points at.** A variable that names a path outside the workspace is invisible to the cache if only the path string is fingerprinted. An uncached task (`cache: false`) runs with the full ambient environment and needs no `env` declaration. Same caution for any var naming a path outside the workspace.
- `pnpm test` uses a filter that excludes the root package rather than `-r` because the root's `test` script *is* the `vp run` invocation: `-r` selects the root too, so it would re-enter itself. The filter hardcodes the root package's name — rename the root and that recursion comes back silently.
- `"singleThreaded": true` is set in the root `tsconfig.json` (and mirrored in the two standalone `tsconfig.app.json`s that don't extend it), so every `tsc` run is single-threaded without per-script flags. tsgo's default mode splits the program across parallel checker instances with separate type caches, and since every file here touches capnweb's instantiation-heavy recursive generics, each checker re-derives the same huge type graphs. Single-threaded is both the fastest and the smallest configuration, and it makes build tasks cheap enough for vp's default concurrency. If a test child is OOM-killed (exit 137) and wedges its vitest parent, the watchdog turns that into an exit 124 after 60s of silence rather than a hang — suspect memory first and drop vp's concurrency.
- Caching is off for tasks that read a path they also write, which is why `workshop-frontend`'s `build` excludes its own `dist/` from `input` — without that it never cached. The `test` tasks needed the same for the scratch paths vitest writes under `node_modules/.vite` and `node_modules/.vite-temp`; `scripts/vitest-task-vite-config.ts` covers which and why, and that list is unlikely to be closed — when a test task stops caching, `--last-details` names the path it read and wrote. This is also why no tsconfig sets `incremental`: `tsc` reads its own `.tsbuildinfo` and writes it back, taking the whole type check out of the task cache to save less than the cache does. Don't add it back without re-measuring `vp run --last-details`.

## Linting (oxlint, via Vite+)

- `pnpm lint` runs what CI enforces: `lint:check` (oxlint), `types:scripts` and `types:check`. Run this before pushing.
- Individual scripts:
  * `pnpm lint:check` / `pnpm lint:fix` — `vp lint`, i.e. oxlint driven by Vite+ (rules in the `lint` block of the root `vite.config.ts`; `correctness` + `suspicious` as errors). Vite+ pins the oxlint it runs (1.76.0), so there is no separate `oxlint` dependency to drift from it and no `.oxlintrc.json` beside the config — one toolchain config, one version. Diagnostics are identical to what running that oxlint directly would emit.
  * `pnpm types:check` — an alias for `pnpm build`. They were separate scripts running the same recursive `tsc` twice; one name is kept for habit and the other because the codegen prerequisites hang off it. `vp lint` is not part of `vp run`, so it has no task cache; it takes about a second regardless.
- Unused function parameters and caught errors are not lint-enforced; unused imports and local variables are still errors.
- Some rules are kept as warnings (e.g. `no-shadow`) for incremental cleanup; warnings don't block CI.
- Type-aware oxlint rules are intentionally not enabled yet. The type-aware engine is tsgo (TypeScript 7), which is now also the workspace `tsc`. Note `no-floating-promises` conflicts with RPC promise pipelining (below), which intentionally leaves promises unawaited. Type safety is still enforced by `tsc` through `pnpm types:check` and `pnpm build`.
- The `typescript` catalog entry is 7.0.2 (tsgo), but TS 7's main export is `./lib/version.cjs` — the compiler API is gone from it — so everything that still needs that API gets its own JS-based compiler. `capnweb-validate` (0.2.4+) ships its own capped `typescript` dependency for the `@validateRpc` transform. Packages that emit declarations set `"rootDir": "./src"` as TS 7 requires (TS5011).
- No tsconfig sets `baseUrl`, and none should. Every `paths` entry here is an explicit relative path, which `tsc` resolves against the tsconfig's own directory, so `baseUrl` bought nothing — and TypeScript 7 removed the option outright (TS5102).

IMPORTANT: This repository uses pnpm, not npm. Always use pnpm.

IMPORTANT: Remember when using RPC to use promise pipelining whenever possible. Cap'n Web implements promise pipelining (similar to Cap'n Proto). This means that if an RPC returns a stub, it's not necessary to await the RPC -- the promise itself can be used in place of the stub. Also, Cap'n Web lets you use the promise for a future result (even if it isn't a stub) in the arguments for another call; the promise will be replaced with its resolution on the server side before delivering the arguments. See the Cap'n Web README.md for more details.

IMPORTANT: When using React's useState(), the state value cannot be an RPC stub. At runtime, all stubs appear to be callable (because the system doesn't actually know if the stub points to a function on the server side or not). But the setter returned by useState() has different behavior if passed a function (including any callable object): it calls the function in order to get the state. In order to avoid this problem, whenever a useState() state will contain an RpcStub, it's important to wrap the stub in an object, and set the state to that object instead.

IMPORTANT: RPC stubs must be disposed to prevent resource leaks on the server side. Call `stub[Symbol.dispose]()` when the stub is no longer needed (or use a `using` declaration where possible). In particular, when a React component obtains a stub in a useEffect, the cleanup function should dispose the stub.

IMPORTANT: **Do not persist RPC stubs.** Capability records in Cloud SQL are the durable form. Live stubs are session-scoped and must be reconnected after a Cloud Run replica recycle or the 60-minute WebSocket cap.

IMPORTANT: All RPC interfaces should use the annotation `@validateRpc()` to apply capnweb-validate, which installs auto-generated runtime type validation matching the interface's TypeScript signatures. Do not write redundant validation code that duplicates the checks capnweb-validate already covers.

IMPORTANT: Server-side logging uses `@gadgets/backend-utils/logger` (frontend browser `console.*` is out of scope):
- Define a package-owned field type and module-scoped logger with a stable dot-separated `component`
  and, for gatekeepers, `vendorId`:
  `const logger = createLogger<GitHubLogFields>({ component: "gatekeeper.github", vendorId: VENDOR_ID });`.
- Emit concrete event names and relevant typed fields, for example:
  `logger.warn("failed to notify credential expiry", { event: "credentials.expiry.notify.failed", error: err });`.
  Each call emits one indexed object; module/child fields such as `vendorId` are inherited.
- Use immutable `logger.with(fields)` for object-owned or nearby context. Prefer module/object loggers
  over logger parameters, and do not replace a shallow child logger with ambient context just to
  remove a local variable.
- For bounded operation context needed by deep helpers, independent loggers, or other observability
  consumers, use `createObservabilityContext` from `@gadgets/backend-utils/observability-context`.
  Re-establish it per operation;
  it does not cross RPC, hibernation, or process restart.
- Pass caught values as `error`. The helper stringifies `Error` instances and primitives, uses an
  own string `message` for plain objects, omits `undefined`, and adds stacks to all `Error` logs.
  Keep this normalization deliberately small; do not traverse causes or copy arbitrary properties.
- Extend field vocabularies locally. Levels: `error` needs attention, `warn` continues best-effort,
  `info` is notable lifecycle, and `debug` is noisy breadcrumbs. Never log secrets, prompts, headers,
  tokens, or request/response bodies.
- To also dispatch a failure to the optional external issue Reporter (in addition to logging it),
  call `reportIssue(failureSite, caught, options?)` from
  `@gadgets/backend-utils/error-reporting`. Attach ambient fields from the package's observability
  context and augment them with capture-site fields:
  `reportIssue("overseer.catalog-fallback", err, { handled: true, attributes: { ...obsContext.get(), gatekeeperId } });`.
  It is a no-op when the `ERROR_REPORTER` binding is absent (local dev / deployments without an issue
  destination). Only bounded scalars are retained as attributes; reported context obeys the same
  no-secrets rules as log fields.

IMPORTANT: Frontend error reporting is a separate, opt-in path:
- `@gadgets/error-reporting` owns the vendor-neutral browser/server event contract and tolerant,
  bounded normalization. `VITE_FRONTEND_ERROR_REPORTING=true` enables trusted frontend producers
  and their hidden source maps at build time; deployments without reporting should leave it unset.
- The Workshop browser sends best-effort reports to the same-origin `POST /api/client-errors`
  endpoint. The backend dispatches only when both a reporter and a rate limiter are bound;
  otherwise the endpoint is an intentional no-op.
- Gatekeeper management/configurator UIs run as Workshop-owned opaque-origin `srcDoc` frames. They
  send bounded reports with `postMessage`; the host accepts them only from the known frame window
  with origin `null`, adds host-owned surface/vendor context, and performs the same-origin POST.
  Do not add direct cross-origin reporting from a Gatekeeper service origin.
- Frontend reports never convey authority. `reportedUserId` is supplied by the client and unverified
  — the name records that it is a report, not a finding — so it is a diagnostic label only and must
  never be read to make a decision. `pageLocation` is origin and pathname only, rebuilt by
  `normalizePageLocation` rather than trusted from producers, because a share link's fragment is a
  bearer capability and an `href` also retains credentials; non-`http(s)` URLs are dropped entirely.
- Install automatic capture only in trusted first-party surfaces, never gadget/user-authored code.
  Exception messages and stacks reach the external Reporter, so never intentionally put secrets,
  prompts, tokens, headers, or request/response bodies in thrown errors or report metadata.
