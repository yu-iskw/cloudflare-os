/**
 * Kernel ledger: Postgres in production, in-process store for tests.
 * Capability records only — never persist RPC stubs.
 */
export {
  createMemoryLedger,
  LedgerConflict,
  MemoryLedger,
  type AdminConfigRow,
  type CapabilityRow,
  type ChatMessageRow,
  type ChatRow,
  type GadgetRow,
  type QueuedActionRow,
  type UserRow,
  type WorkspaceRow,
} from "./memory-sql.js";
export { acquirePgLease, createPgPool, migrate } from "./pg.js";
export { nextLeaseGeneration, type LeaseSnapshot } from "./lease.js";
