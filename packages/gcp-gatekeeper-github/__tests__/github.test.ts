import { describe, expect, it } from "vitest";
import { GithubGatekeeper } from "../src/index.js";

describe("GitHub gatekeeper", () => {
  it("stores a capability record and queues writes", async () => {
    const gk = new GithubGatekeeper();
    const record = {
      vendorId: "github" as const,
      accountLabel: "ada",
      resourceUrl: "https://github.com/ada/repo",
      accessToken: "t",
    };
    const queued = gk.queueWrite(record, "createIssue", { title: "hi" });
    expect(queued.status).toBe("pending");
    expect(gk.listPending()).toHaveLength(1);
    gk.approve(queued.id);
    expect(gk.listPending()).toHaveLength(0);
  });

  it("lists repos through the host fetch (observation)", async () => {
    const gk = new GithubGatekeeper();
    const record = {
      vendorId: "github" as const,
      accountLabel: "ada",
      resourceUrl: "https://github.com/ada",
      accessToken: "t",
    };
    const repos = await gk.listRepos(record, async () =>
      new Response(JSON.stringify([{ name: "repo" }]), { status: 200 }),
    );
    expect(repos).toEqual([{ name: "repo" }]);
  });
});
