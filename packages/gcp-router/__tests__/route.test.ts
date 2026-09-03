import { describe, expect, it } from "vitest";
import { routePath } from "../src/index.js";

describe("routePath", () => {
  it("sends /api to the kernel", () => {
    expect(routePath("/api")).toEqual({ target: "kernel" });
  });

  it("sends gatekeeper prefixes by slug", () => {
    expect(routePath("/gatekeeper/github/connect")).toEqual({ target: "gatekeeper", slug: "github" });
  });

  it("sends the rest to the SPA", () => {
    expect(routePath("/workspace/abc")).toEqual({ target: "spa" });
  });
});
