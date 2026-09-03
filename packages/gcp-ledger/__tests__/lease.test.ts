import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryLedger, LedgerConflict, nextLeaseGeneration } from "../src/index.js";

describe("workspace lease", () => {
  it("lets one holder acquire a workspace", async () => {
    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws1", { id: "ws1", ownerId: "u1", title: "t", pinned: false });
    const gen = await ledger.acquireLease("ws1", "replica-a", 60_000);
    expect(gen).toBe(1);
  });

  it("rejects a second replica while the lease is live", async () => {
    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws1", { id: "ws1", ownerId: "u1", title: "t", pinned: false });
    await ledger.acquireLease("ws1", "replica-a", 60_000);
    await expect(ledger.acquireLease("ws1", "replica-b", 60_000)).rejects.toBeInstanceOf(LedgerConflict);
  });

  it("allows steal after expiry", async () => {
    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws1", { id: "ws1", ownerId: "u1", title: "t", pinned: false });
    const t0 = 1_000_000;
    await ledger.acquireLease("ws1", "replica-a", 10, t0);
    const gen = await ledger.acquireLease("ws1", "replica-b", 60_000, t0 + 11);
    expect(gen).toBe(2);
  });

  it("serializes concurrent acquires so only one wins", async () => {
    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws1", { id: "ws1", ownerId: "u1", title: "t", pinned: false });
    const results = await Promise.allSettled([
      ledger.acquireLease("ws1", "replica-a", 60_000),
      ledger.acquireLease("ws1", "replica-b", 60_000),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const conflict = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(conflict).toHaveLength(1);
    expect((conflict[0] as PromiseRejectedResult).reason).toBeInstanceOf(LedgerConflict);
  });

  it("rejects a duplicate chat sequence in one append", () => {
    const ledger = createMemoryLedger();
    ledger.appendChatMessage({ chatId: 1, sequence: 0, role: "user", body: "hi" });
    expect(() =>
      ledger.appendChatMessage({ chatId: 1, sequence: 0, role: "assistant", body: "yo" }),
    ).toThrow(LedgerConflict);
  });

  it("applies the same conflict rule Postgres uses", () => {
    const live = { holder: "replica-a", generation: 3, expiresAt: 2_000 };
    expect(() => nextLeaseGeneration(live, "replica-b", 1_000)).toThrow(LedgerConflict);
    expect(nextLeaseGeneration(live, "replica-b", 2_001)).toBe(4);
    expect(nextLeaseGeneration(undefined, "replica-a", 1_000)).toBe(1);
  });

  it("stores capability records without a stub field", () => {
    const ledger = createMemoryLedger();
    const cap = ledger.putCapability({
      ownerId: "u1",
      vendorId: "github",
      accountLabel: "ada",
      resourceUrl: "https://github.com/ada",
      accessToken: "t",
    });
    expect(cap.id).toBe(1);
    expect("stub" in cap).toBe(false);
    const action = ledger.enqueueAction({
      workspaceId: "ws1",
      capabilityId: cap.id,
      kind: "createIssue",
      payload: { title: "hi" },
    });
    expect(action.status).toBe("pending");
  });

  it("declares capability_records without a stub column", () => {
    const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/schema.sql"), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS capability_records/);
    expect(sql).toMatch(/UNIQUE \(chat_id, sequence\)/);
    expect(/\bstub\b/i.test(sql.replaceAll(/RPC stubs/g, ""))).toBe(false);
  });
});
