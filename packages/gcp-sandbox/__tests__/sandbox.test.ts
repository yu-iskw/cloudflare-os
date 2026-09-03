import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sandboxDo } from "../src/index.js";

describe("sandboxDo", () => {
  it("captures stdout from a fake sandbox binary and inherits no env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sandbox-"));
    const bin = join(dir, "sandbox");
    await writeFile(
      bin,
      `#!/bin/sh
printf '%s' "$(cat)"
printf '%s' "\${SECRET-}" >&2
exit 0
`,
    );
    await chmod(bin, 0o755);
    const result = await sandboxDo("1+1", { binary: bin, timeoutMs: 5000 });
    expect(result.stdout).toBe("1+1");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });

  it("evaluates a .mjs fake via process.execPath without PATH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sandbox-"));
    const bin = join(dir, "fake-sandbox.mjs");
    await writeFile(
      bin,
      `const chunks = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const code = Buffer.concat(chunks).toString("utf8");
  process.stdout.write(String((0, eval)(code)));
});
`,
    );
    const result = await sandboxDo("1+1", { binary: bin, timeoutMs: 5000 });
    expect(result.stdout).toBe("2");
    expect(result.exitCode).toBe(0);
  });
});
