# Ledger: Cloud SQL, AlloyDB, Spanner, Firebase

Date: 2026-09-03
Status: research only — no implementation
Companion to `docs/plans/2026-09-03-001-architecture-gcp-os-plan.md`

The kernel today is Durable Object KV + `transactionSync` + optional SQLite, including a per-workspace **git object database**. That is actor-local ACID, not a globally distributed SQL problem. Starting on Spanner is more product than the v1 topology needs — complexity and unused guarantees, not only invoice.

## What the ledger must do

Mapped from `packages/typed-storage`, `packages/workshop-backend/src/git-store.ts`, and the Durable Object classes in `workshop-backend`.

| Need | Why |
| --- | --- |
| Per-workspace atomic multi-key updates | `typedStorage.transaction` is `storage.transactionSync`. Record + unique/non-unique indexes, chat append, capability grants, and schedule enable all assume one atomic write. |
| Read-your-writes in one turn | Agent/chat assume no replica lag inside a turn. |
| Workspace lease / single-writer | Cloud Run Service replicas are not unique actors. `SELECT FOR UPDATE` or `pg_advisory_lock` stands in for DO identity. |
| Prefix/list by workspace | typed-storage collections are prefix-keyed views; SQL tables + indexes replace that. |
| Git **blobs** out of the DB | Overseer `GitStore` holds zlib git objects as `Uint8Array` in DO KV today. Comments in `git-store.ts` say no object exceeds ~2MB *today*; R2 spill was already the local escape hatch. On GCP those bytes belong in Cloud Storage. |
| Not stored RPC stubs | User `ConnectedAccountRecord.account: Fetcher`, Overseer `boundHooks` Fetchers, `GatekeeperRecord.class`, scheduler initiator stubs. There is no SQL analog. Capability **records** + live reconnect only. |

Multi-region active-active is an explicit non-goal for the first architecture. Geographic placement (`locationHint`) is unused in application code.

Gadget SQLite (facet-local) is **not** the kernel ledger. MCP `ActionStore` already uses real SQL (`ctx.storage.sql`); that ports to Postgres more honestly than typed-storage KV does.

## Scores (v1 single-region Company OS)

| Store | Score as kernel ledger | Score for its real job | Start with it? |
| --- | --- | --- | --- |
| **Cloud SQL PostgreSQL** | **92** | OLTP + leases + Cloud Run-native connect | **Yes** |
| Firestore Native (Firebase) | 45 as ledger | 80 for presence / last-seen; Identity Platform for login | Auth yes; ledger only as a throwaway slice |
| **AlloyDB** | 70 | HTAP, vectors, 99.99% size-independent failover | Later, same SQL |
| **Spanner** | 35 | Global strong consistency, horizontal write scale | Only if multi-region strong writes become real |

## Spanner — right product, wrong time

Spanner is Google’s horizontally sharded, externally consistent SQL (TrueTime). Editions:

| Edition | What it unlocks |
| --- | --- |
| **Standard** | Regional only. Features GA before 2024-09-24, plus scheduled backups. |
| **Enterprise** | Graph, full-text search, vector, managed autoscaler, extra read-only replicas. |
| **Enterprise Plus** | Dual-region + multi-region, geo-partitioning, **99.999%**. |

Compute starts at **100 processing units** (1 node = 1000 PU). A 100 PU Standard regional instance in us-central1 is on the order of **tens of dollars per month** (compute ~$66 plus storage), not thousands. The “too much” is **complexity and unused guarantees**, not the invoice.

Use it when you actually have: multi-region strong writes, many hot workspaces that outgrow one Postgres primary, or change streams into BigQuery as an audit requirement.

Do not use it for v1 because:

- The plan is **single-region**. Regional Spanner still runs 3-zone Paxos and TrueTime commit-wait for a problem Cloud SQL already solves with one primary.
- Cloud Run is not a global actor fabric. Interleaved tables give **storage locality** (child rows next to a parent, split-friendly, max depth 7). They do **not** give a Durable Object: no unique process, no stored RPC stubs. You still invent an application lease in front of replicas.
- Git blobs must not live in cells. Quota: **10 MiB per cell**, 100 MiB per commit, 80,000 mutations per statement. Even today’s ~2MB objects would be legal but wrong; packfiles and archives would not.
- Dialect is locked **at database create** and cannot switch. Postgres dialect is not Cloud SQL Postgres: no extensions, triggers, SAVEPOINT, transactional DDL, or `pg_advisory_lock` as we know it. Wire access is **PGAdapter**, not a native socket. Lifting a Cloud SQL schema is not a dump/restore.
- Hot parent keys still hotspot. Spanner will not split below a single row with no children.

Graduate **to** Spanner; do not start there.

## AlloyDB — premium Postgres, not a starter SKU

AlloyDB is PostgreSQL-compatible (extensions, ordinary drivers) with disaggregated storage, a columnar engine (HTAP), AlloyDB AI (vectors / Gemini in SQL), **99.99% SLA including maintenance**, and failover **&lt; 60 s** independent of size. HA primary is the default. 1 vCPU is sandbox-only (no SLA even with HA); production starts at 2+ vCPU.

Cloud Run talks to it via **AlloyDB Auth Proxy** sidecar or language connectors + private IP. There is **no** `--add-cloudsql-instances` checkbox — that flag is Cloud SQL only.

The kernel is short OLTP transactions and leases, not analytical scans or in-database Gemini. Columnar engine, Iceberg, and ScaNN do not pay rent on day one.

Same wire protocol as Cloud SQL: schema and `FOR UPDATE` / advisory locks port. Move to AlloyDB if a single primary saturates, you want read-pool autoscale without duplicating storage, 99.99% without Cloud SQL Enterprise Plus, or vector search in SQL becomes a product requirement.

Independent list prices put small compute above Cloud SQL; at large HA + disk, AlloyDB can meet or beat Cloud SQL because storage is shared across primary and read pools. For v1 size, **Cloud SQL is cheaper**.

AlloyDB Omni is a deploy-anywhere engine. Irrelevant until someone insists on running Postgres off Google Cloud.

## Cloud SQL PostgreSQL — the v1 ledger

Fully managed Postgres. Cloud Run has a first-class path: `--add-cloudsql-instances` injects Auth Proxy as a Unix socket (`/cloudsql/PROJECT:REGION:INSTANCE`). Alternatives: language connector in-process, private IP over Direct VPC, or an explicit proxy sidecar. IAM DB auth is supported; prefer dedicated cores (shared-core + IAM auth times out under CPU throttle).

This is the Durable Object storage analog:

| Today | Cloud SQL |
| --- | --- |
| `transactionSync` | `BEGIN … COMMIT` |
| typed-storage collections / indexes | tables + unique indexes |
| DO identity | `pg_advisory_lock(workspace_id)` or a `leases` row with `SELECT … FOR UPDATE` |
| git objects in Overseer KV | **pointers** (oid, gadget `commitId`) in SQL; **bytes** in GCS |
| AdminSettings + BLUEPRINTS KV mirror | one writer in SQL + Memorystore (or equivalent) hot read |
| stored `Fetcher` | capability records only |

Editions that matter: **Enterprise** HA is 99.95% excluding maintenance. **Enterprise Plus** is 99.99% including maintenance, &lt;1 s planned ops, and **Managed Connection Pooling**. Shared-core and single-zone instances are out of the SLA. A real v1 is a dedicated-core instance; HA when failover matters (low hundreds per month, not Spanner-class ops). A shared-core micro is only a sandbox.

Watch **connection storms**: Cloud Run replicas × app pool will exhaust `max_connections` (memory-derived unless you set the flag). Auth Proxy is **not** a pooler — each client connection is a backend. Plan tiny per-replica pools (2–5) plus either Cloud SQL Managed Connection Pooling (Enterprise Plus; enabling restarts the instance; transaction mode drops session `SET` / `LISTEN` / session advisory locks) or PgBouncer. If workspace leases use **session** advisory locks, do not put those connections in transaction-mode pooling.

## Firebase — a suite, not a database

| Piece | Own this? |
| --- | --- |
| **Identity Platform** (Firebase Auth under GCP) | **Yes** for human login (R10). In-place upgrade of Firebase Auth; adds MFA, SAML/OIDC, IAP integration, 99.95% SLA on email/password + JWT refresh. Agents stay SPIFFE / Agent Identity. |
| **Firestore Native** | Optional **thin** prototype (users, capability docs, chat as **new docs**, leases). Deny-all security rules; Admin SDK from the kernel only. Do **not** put an Overseer in one document. The old “1 write/sec per doc” line is **not** on the Native quotas page anymore; sustained hotspot writes still abort. Sequential indexed timestamps cap ~500 writes/sec per collection unless sharded. Document size **1 MiB** Native. |
| **Realtime Database** | No. Overlaps Memorystore for fan-out; weaker query model. |
| **Cloud Storage for Firebase** | Same buckets as GCS; use Cloud Storage from the kernel. |
| **SQL Connect** (ex Data Connect; GraphQL on Cloud SQL) | **No** beside Cap’n Web. Clients call pre-deployed named GraphQL operations with Firebase Auth `@auth`. The kernel already has an RPC API. Schema ownership would fight typed-storage. Optional later as a *separate* BaaS, never the Overseer API. |
| **App Hosting** | No. It is GitHub → Cloud Build → Cloud Run + CDN for SSR frameworks. This kernel needs `--sandbox-launcher`, Cloud SQL wiring, 60-minute WebSockets. Origin is a Cloud Run Service. |
| **FCM** | Optional later for approval pings, not the ledger. |

Firestore is a reasonable **presence / last-seen** store and a tempting prototype ledger. It is a poor git store (1 MiB docs, no CAS, billed writes per object) and a poor typed-storage replacement (no cheap multi-key SQL indexes, contention on hot workspace docs). If you prototype on Firestore, keep a path to Postgres; do not let GraphQL SQL Connect become the public API.

## Kernel objects → store

| Object | v1 home |
| --- | --- |
| User profile, sessions, connected **account records** (no Fetcher) | Cloud SQL |
| Workspace / Overseer metadata, chats, actions, share keys, gadget `commitId` | Cloud SQL + workspace lease |
| Git loose objects (`GitObjectRecord.data`) | GCS (`gs://…/git/{oid}`); SQL holds oid pointers |
| Blueprint archives, screenshots, site logo | GCS (today R2 / `BLUEPRINT_CONTENT`) |
| Admin config | Cloud SQL writer; Memorystore (or equivalent) hot read |
| Live collaboration after replica failover | Memorystore |
| Presence / last-seen | Firestore optional, or Memorystore |
| Gadget facet SQLite | Later: sandbox disk / PVC; not the kernel |
| Stored RPC stubs | Redesign: capability records + reconnect |

## Recommended ladder

1. **v1:** Cloud SQL PostgreSQL (regional, dedicated core; HA when needed; Enterprise Plus if you want managed pooling) + GCS for git/blueprints + Memorystore for live fan-out + Identity Platform for humans.
2. **Same SQL, more horsepower:** AlloyDB (Auth Proxy sidecar; same schema).
3. **Global strong writes:** Spanner Standard regional first (new schema, dialect chosen at create), then Enterprise Plus if multi-region is actually in scope.
4. **Firebase:** Auth always; Firestore only for presence or a throwaway prototype, never git, never Cap’n Web.

## Sources

- [Spanner editions](https://docs.cloud.google.com/spanner/docs/editions-overview)
- [Spanner quotas](https://docs.cloud.google.com/spanner/quotas)
- [Spanner PostgreSQL interface](https://docs.cloud.google.com/spanner/docs/postgresql-interface)
- [AlloyDB overview](https://docs.cloud.google.com/alloydb/docs/overview)
- [AlloyDB Auth Proxy](https://docs.cloud.google.com/alloydb/docs/auth-proxy/overview)
- [Connect Cloud SQL from Cloud Run](https://docs.cloud.google.com/sql/docs/postgres/connect-instance-cloud-run)
- [Cloud SQL Auth Proxy](https://docs.cloud.google.com/sql/docs/postgres/sql-proxy)
- [Cloud SQL managed connection pooling](https://cloud.google.com/sql/docs/postgres/managed-connection-pooling)
- [Firestore transactions / contention](https://firebase.google.com/docs/firestore/transaction-data-contention)
- [Firestore quotas](https://firebase.google.com/docs/firestore/quotas)
- [Identity Platform](https://cloud.google.com/identity-platform)
- [Firebase SQL Connect](https://firebase.google.com/docs/sql-connect)
- Kernel storage: `packages/typed-storage/src/index.ts`, `packages/workshop-backend/src/git-store.ts`
