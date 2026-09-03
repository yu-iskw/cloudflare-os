import { LedgerConflict } from "./memory-sql.js";

/** Snapshot of a workspace lease row used by both MemoryLedger and Postgres. */
export type LeaseSnapshot = {
  holder: string;
  generation: number;
  expiresAt: number;
};

/**
 * Same conflict rule as `SELECT … FOR UPDATE` then upsert: a live lease held by
 * another replica is a conflict, not a queue. Transaction-mode pooling cannot
 * host session advisory locks, so this runs on a session connection (or in-process).
 */
export function nextLeaseGeneration(
  existing: LeaseSnapshot | undefined,
  holder: string,
  now: number,
): number {
  if (existing && existing.holder !== holder && existing.expiresAt > now) {
    throw new LedgerConflict();
  }
  return (existing?.generation ?? 0) + 1;
}
