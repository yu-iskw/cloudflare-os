import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "@gadgets/gcp-ledger";
import { AuthenticatedApiImpl } from "../src/authenticated-api.js";

describe("capability records", () => {
  it("connectAccount stores a record with no stub and queues a write", async () => {
    const ledger = createMemoryLedger();
    ledger.putUser({
      id: "u1",
      username: "ada",
      displayName: "Ada",
      passwordHashHash: null,
      sessionToken: "t",
      preferredModel: null,
      onboardingCompleted: true,
    });
    const api = new AuthenticatedApiImpl(ledger, "u1", "replica-a");
    const { url } = await api.connectAccount("github");
    expect(url).toContain("/gatekeeper/github/connect?capabilityId=");
    expect(ledger.capabilities.size).toBe(1);
    const cap = [...ledger.capabilities.values()][0]!;
    expect(cap.vendorId).toBe("github");
    expect(cap.ownerId).toBe("u1");
    expect("stub" in cap).toBe(false);
    const queued = ledger.enqueueAction({
      workspaceId: "ws1",
      capabilityId: cap.id,
      kind: "createIssue",
      payload: { title: "hi" },
    });
    expect(queued.status).toBe("pending");
  });
});
