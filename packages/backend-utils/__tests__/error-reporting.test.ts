import { describe, expect, it } from "vitest";
import { reportIssue } from "../src/error-reporting.js";

describe("reportIssue", () => {
  it("is a no-op when ERROR_REPORTER_URL is unset", () => {
    delete process.env.ERROR_REPORTER_URL;
    expect(() => reportIssue("kernel.test", new Error("boom"), { handled: true })).not.toThrow();
  });
});
