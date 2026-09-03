import { describe, expect, it } from "vitest";
import { createTracer } from "../src/tracing";

const traced = createTracer(() => ({}));

describe("traced span lifetime", () => {
  it("runs the callback and keeps isTraced true", async () => {
    const observed: boolean[] = [];
    await traced("probe", async (span) => {
      observed.push(span.isTraced);
    });
    expect(observed).toEqual([true]);
  });

  it("re-throws after marking error", async () => {
    await expect(
      traced("probe-reject", () => {
        throw new Error("nope");
      }),
    ).rejects.toThrow("nope");
  });
});
