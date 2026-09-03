import {
  log,
  readBlob,
  readCommit,
  readTree,
  writeBlob,
  writeCommit,
  writeTree,
  type PromiseFsClient,
  type TreeEntry,
} from "isomorphic-git";
import type { GitObjectBackend } from "./backend.js";

export const GITDIR = "/git";
const LOOSE_OBJECT_PATH = new RegExp(`^${GITDIR}/objects/([0-9a-f]{2})/([0-9a-f]{38})$`);

function oidFromLoosePath(path: unknown): string | undefined {
  if (typeof path !== "string") return undefined;
  const match = LOOSE_OBJECT_PATH.exec(path);
  if (!match) return undefined;
  return match[1] + match[2];
}

function fsError(code: string, message: string): Error {
  return Object.assign(new Error(`${code}: ${message}`), { code });
}

/** isomorphic-git fs shim over a content-addressed backend (SQL pointers + object bytes). */
export function makeGitObjectsFs(backend: GitObjectBackend): PromiseFsClient {
  return {
    promises: {
      async readFile(path: unknown): Promise<Uint8Array> {
        const oid = oidFromLoosePath(path);
        if (oid === undefined) throw fsError("ENOENT", `unsupported read: ${String(path)}`);
        const data = await backend.get(oid);
        if (!data) throw fsError("ENOENT", oid);
        return data;
      },
      async writeFile(path: unknown, data: Uint8Array): Promise<void> {
        const oid = oidFromLoosePath(path);
        if (oid === undefined) throw fsError("ENOENT", `unsupported write: ${String(path)}`);
        await backend.put(oid, data);
      },
      async stat(path: unknown) {
        const oid = oidFromLoosePath(path);
        if (oid === undefined) {
          if (path === GITDIR || String(path).startsWith(`${GITDIR}/objects`)) {
            return { isDirectory: () => true, isFile: () => false, size: 0 };
          }
          throw fsError("ENOENT", String(path));
        }
        const data = await backend.get(oid);
        if (!data) throw fsError("ENOENT", oid);
        return { isDirectory: () => false, isFile: () => true, size: data.byteLength };
      },
      async mkdir(): Promise<void> {},
      async readdir(path: unknown): Promise<string[]> {
        if (path === `${GITDIR}/objects/pack`) return [];
        return [];
      },
      async unlink(): Promise<void> {
        throw fsError("EPERM", "unlink");
      },
      async rmdir(): Promise<void> {
        throw fsError("EPERM", "rmdir");
      },
      async lstat(path: unknown) {
        return this.stat(path);
      },
      async readlink(): Promise<string> {
        throw fsError("EINVAL", "readlink");
      },
      async symlink(): Promise<void> {
        throw fsError("EPERM", "symlink");
      },
      async chmod(): Promise<void> {},
    },
  };
}

export type CommitIdentity = { name: string; email: string };

export type WriteCommitOptions = {
  author: CommitIdentity;
  committer?: CommitIdentity;
  parents: string[];
  message: string;
  timestamp: Date;
};

type TreeNode = Map<string, TreeNode | string>;

/** Plumbing git store: blobs in the backend, never in SQL. */
export class GitStore {
  #fs: PromiseFsClient;
  #cache: object = {};

  constructor(backend: GitObjectBackend) {
    this.#fs = makeGitObjectsFs(backend);
  }

  async writeFilesAsCommit(
    files: ReadonlyMap<string, string>,
    options: WriteCommitOptions,
  ): Promise<string> {
    const tree = await this.#writeTreeNode(buildTreeNode(files));
    const when = { timestamp: Math.floor(options.timestamp.getTime() / 1000), timezoneOffset: 0 };
    return await writeCommit({
      fs: this.#fs,
      gitdir: GITDIR,
      commit: {
        message: options.message,
        tree,
        parent: [...options.parents],
        author: { ...options.author, ...when },
        committer: { ...(options.committer ?? options.author), ...when },
      },
    });
  }

  async readCommitFiles(oid: string): Promise<Map<string, string>> {
    const { commit } = await readCommit({ fs: this.#fs, gitdir: GITDIR, oid, cache: this.#cache });
    const files = new Map<string, string>();
    await this.#collectTreeFiles(commit.tree, "", files);
    return files;
  }

  async #writeTreeNode(node: TreeNode): Promise<string> {
    const entries: TreeEntry[] = [];
    for (const [name, child] of node) {
      if (typeof child === "string") {
        const oid = await writeBlob({
          fs: this.#fs,
          gitdir: GITDIR,
          blob: new TextEncoder().encode(child),
        });
        entries.push({ mode: "100644", path: name, oid, type: "blob" });
      } else {
        const oid = await this.#writeTreeNode(child);
        entries.push({ mode: "040000", path: name, oid, type: "tree" });
      }
    }
    return await writeTree({ fs: this.#fs, gitdir: GITDIR, tree: entries });
  }

  async #collectTreeFiles(treeOid: string, prefix: string, out: Map<string, string>): Promise<void> {
    const { tree } = await readTree({
      fs: this.#fs,
      gitdir: GITDIR,
      oid: treeOid,
      cache: this.#cache,
    });
    for (const entry of tree) {
      const path = prefix + entry.path;
      if (entry.type === "tree") {
        await this.#collectTreeFiles(entry.oid, `${path}/`, out);
      } else if (entry.type === "blob" && (entry.mode === "100644" || entry.mode === "100755")) {
        const { blob } = await readBlob({
          fs: this.#fs,
          gitdir: GITDIR,
          oid: entry.oid,
          cache: this.#cache,
        });
        out.set(path, new TextDecoder().decode(blob));
      } else {
        throw new Error(`unsupported tree entry at ${path}: mode ${entry.mode}`);
      }
    }
  }
}

function buildTreeNode(files: ReadonlyMap<string, string>): TreeNode {
  const root: TreeNode = new Map();
  for (const [path, content] of files) {
    const segments = path.split("/");
    let node = root;
    for (const [i, segment] of segments.entries()) {
      if (segment === "" || segment === "." || segment === "..") {
        throw new Error(`invalid file path: ${path}`);
      }
      const last = i === segments.length - 1;
      const existing = node.get(segment);
      if (last) {
        if (existing !== undefined) throw new Error(`conflicting file paths at: ${path}`);
        node.set(segment, content);
      } else {
        if (existing === undefined) {
          node.set(segment, new Map());
        } else if (typeof existing === "string") {
          throw new Error(`conflicting file paths at: ${path}`);
        }
        node = node.get(segment) as TreeNode;
      }
    }
  }
  return root;
}

export { log };
