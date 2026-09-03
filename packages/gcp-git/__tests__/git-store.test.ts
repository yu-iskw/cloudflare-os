import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FsGitBackend, GcsGitBackend, GitStore, MemoryGitBackend } from "../src/index.js";

describe("GitStore", () => {
  it("round-trips files through memory without SQL bytes", async () => {
    const backend = new MemoryGitBackend();
    const store = new GitStore(backend);
    const files = new Map([
      ["README.md", "# hi"],
      ["src/main.ts", "export const n = 1;\n"],
      ["src/util.ts", "export const z = 0;\n"],
    ]);
    const oid = await store.writeFilesAsCommit(files, {
      author: { name: "Ada", email: "ada@example.com" },
      parents: [],
      message: "init\n",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    expect(oid).toMatch(/^[0-9a-f]{40}$/);
    expect(backend.objects.size).toBeGreaterThan(0);
    const round = await store.readCommitFiles(oid);
    expect(round.get("README.md")).toBe("# hi");
    expect(round.get("src/main.ts")).toBe("export const n = 1;\n");
  });

  it("stores objects on a filesystem backend", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gcp-git-"));
    try {
      const store = new GitStore(new FsGitBackend(dir));
      const oid = await store.writeFilesAsCommit(new Map([["a.txt", "x"]]), {
        author: { name: "Ada", email: "ada@example.com" },
        parents: [],
        message: "a\n",
        timestamp: new Date("2026-01-01T00:00:00Z"),
      });
      const round = await store.readCommitFiles(oid);
      expect(round.get("a.txt")).toBe("x");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps object bytes in the object store, not in SQL pointers", async () => {
    const backend = new MemoryGitBackend();
    const sqlPointers = new Map<string, string>();
    const store = new GitStore(backend);
    const marker = "never-in-sql-" + "x".repeat(80);
    const oid = await store.writeFilesAsCommit(new Map([["big.txt", marker]]), {
      author: { name: "Ada", email: "ada@example.com" },
      parents: [],
      message: "blob\n",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    sqlPointers.set(oid, oid);
    expect([...sqlPointers.values()].every((pointer) => /^[0-9a-f]{40}$/.test(pointer))).toBe(true);
    expect([...sqlPointers.values()].some((pointer) => pointer.includes("never-in-sql"))).toBe(false);
    expect([...backend.objects.values()].some((bytes) => bytes.byteLength > 40)).toBe(true);
    const round = await store.readCommitFiles(oid);
    expect(round.get("big.txt")).toBe(marker);
  });

  it("round-trips through a GCS-shaped backend without SQL cells", async () => {
    const cells = new Map<string, Uint8Array>();
    const backend = new GcsGitBackend(
      "git-bucket",
      async (input) => {
        const url = String(input);
        const name = decodeURIComponent(/name=([^&]+)/.exec(url)?.[1] ?? /o\/([^?]+)/.exec(url)?.[1] ?? "");
        const oid = name.replace(/^git\//, "");
        if (url.includes("uploadType=media")) {
          return new Response(null, { status: 200 });
        }
        const data = cells.get(oid);
        if (!data) return new Response(null, { status: 404 });
        return new Response(data, { status: 200 });
      },
      async () => "token",
    );
    // GcsGitBackend.put does not keep a local copy — wrap put to record bytes.
    const origPut = backend.put.bind(backend);
    backend.put = async (oid, data) => {
      cells.set(oid, data);
      await origPut(oid, data);
    };
    const store = new GitStore(backend);
    const oid = await store.writeFilesAsCommit(new Map([["a.txt", "gcs"]]), {
      author: { name: "Ada", email: "ada@example.com" },
      parents: [],
      message: "gcs\n",
      timestamp: new Date("2026-01-01T00:00:00Z"),
    });
    const round = await store.readCommitFiles(oid);
    expect(round.get("a.txt")).toBe("gcs");
    expect(cells.size).toBeGreaterThan(0);
  });
});
