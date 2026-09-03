import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createMemoryLedger } from "@gadgets/gcp-ledger";
import { GitStore, MemoryGitBackend } from "@gadgets/gcp-git";
import { OverseerImpl } from "../src/overseer.js";

describe("chat + Code Mode + git", () => {
  it("appends chat rows and runs sandbox do for a code fence", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sb-"));
    const bin = join(dir, "sandbox");
    await writeFile(bin, "#!/bin/sh\ncat >/dev/null\nprintf hi\n");
    await chmod(bin, 0o755);
    process.env.SANDBOX_BIN = bin;

    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws", { id: "ws", ownerId: "u", title: "t", pinned: false });
    const overseer = new OverseerImpl(ledger, new GitStore(new MemoryGitBackend()), "ws", "u", "r1");
    const chatId = await overseer.newChat("```js\n1+1\n```", "gemini-3.6-flash");
    const page = await overseer.getChatHistory(chatId);
    expect(page.messages.length).toBeGreaterThan(1);
    const last = page.messages[page.messages.length - 1];
    expect(last?.type).toBe("message");
    expect(last && "message" in last ? last.message : "").toContain("hi");
    delete process.env.SANDBOX_BIN;
  });

  it("writes git blobs outside SQL", async () => {
    const backend = new MemoryGitBackend();
    const ledger = createMemoryLedger();
    ledger.workspaces.set("ws", { id: "ws", ownerId: "u", title: "t", pinned: false });
    const overseer = new OverseerImpl(ledger, new GitStore(backend), "ws", "u", "r1");
    const oid = await overseer.writeFilesAsCommit({ "a.ts": "export {}\n" });
    expect(backend.objects.size).toBeGreaterThan(0);
    expect(ledger.gitPointers.get(oid)).toBe(oid);
    expect(ledger.gitPointers.get(oid)).toMatch(/^[0-9a-f]{40}$/);
    for (const pointer of ledger.gitPointers.values()) {
      expect(pointer.includes("export {}")).toBe(false);
    }
    const { files } = await overseer.getCodeAtCommit(oid);
    expect(files).toEqual([["a.ts", "export {}\n"]]);
  });
});
