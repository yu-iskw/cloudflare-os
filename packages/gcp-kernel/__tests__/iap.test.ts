import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "@gadgets/gcp-ledger";
import { PublicApiImpl } from "../src/public-api.js";

describe("IAP", () => {
  it("mints a user from IAP_DEV_EMAIL", async () => {
    process.env.IAP_DEV_EMAIL = "ada@example.com";
    const ledger = createMemoryLedger();
    const api = new PublicApiImpl(ledger, "r1", "unused");
    const session = await api.authenticateFromIap();
    const me = await session.whoami();
    expect(me.id).toBeTruthy();
    expect(ledger.usersByName.get("ada@example.com")).toBeTruthy();
    delete process.env.IAP_DEV_EMAIL;
  });

  it("accepts a JWT whose aud matches IAP_AUDIENCE", async () => {
    delete process.env.IAP_DEV_EMAIL;
    const payload = Buffer.from(
      JSON.stringify({ email: "ada@example.com", sub: "accounts.google.com:1", aud: "/projects/p/apps/a" }),
    ).toString("base64url");
    const token = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    const { verifyIapAssertion } = await import("../src/iap.js");
    const identity = await verifyIapAssertion(token, "/projects/p/apps/a");
    expect(identity?.email).toBe("ada@example.com");
  });

  it("rejects a JWT whose aud does not match IAP_AUDIENCE", async () => {
    delete process.env.IAP_DEV_EMAIL;
    const payload = Buffer.from(
      JSON.stringify({ email: "ada@example.com", sub: "accounts.google.com:1", aud: "other" }),
    ).toString("base64url");
    const token = `eyJhbGciOiJub25lIn0.${payload}.sig`;
    const { verifyIapAssertion } = await import("../src/iap.js");
    await expect(verifyIapAssertion(token, "/projects/p/apps/a")).resolves.toBeNull();
  });
});
