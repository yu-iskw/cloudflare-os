/**
 * Content-addressed git object bytes. SQL holds oids; this store holds zlib loose objects.
 */
export interface GitObjectBackend {
  get(oid: string): Promise<Uint8Array | undefined>;
  put(oid: string, data: Uint8Array): Promise<void>;
}

/** In-process object store (tests). */
export class MemoryGitBackend implements GitObjectBackend {
  readonly objects = new Map<string, Uint8Array>();

  async get(oid: string): Promise<Uint8Array | undefined> {
    return this.objects.get(oid);
  }

  async put(oid: string, data: Uint8Array): Promise<void> {
    this.objects.set(oid, data);
  }
}

/**
 * Local directory or GCS-style prefix. Production Cloud Run should set
 * `GIT_OBJECT_DIR` to a mounted / GCS FUSE path, or use {@link GcsGitBackend}.
 */
export class FsGitBackend implements GitObjectBackend {
  constructor(private readonly root: string) {}

  async get(oid: string): Promise<Uint8Array | undefined> {
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    try {
      return await readFile(join(this.root, oid.slice(0, 2), oid.slice(2)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  }

  async put(oid: string, data: Uint8Array): Promise<void> {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const dir = join(this.root, oid.slice(0, 2));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, oid.slice(2)), data);
  }
}

/**
 * PUT/GET objects at `gs://bucket/git/{oid}` via the JSON API and the instance metadata token.
 * Bytes never go into SQL.
 */
export class GcsGitBackend implements GitObjectBackend {
  constructor(
    private readonly bucket: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly tokenProvider: () => Promise<string> = metadataToken,
  ) {}

  async get(oid: string): Promise<Uint8Array | undefined> {
    const token = await this.tokenProvider();
    const url = `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(`git/${oid}`)}?alt=media`;
    const res = await this.fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`gcs get ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async put(oid: string, data: Uint8Array): Promise<void> {
    const token = await this.tokenProvider();
    const url =
      `https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o?uploadType=media&name=${encodeURIComponent(`git/${oid}`)}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/octet-stream",
      },
      body: data,
    });
    if (!res.ok) throw new Error(`gcs put ${res.status}`);
  }
}

async function metadataToken(): Promise<string> {
  const res = await fetch(
    "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
    { headers: { "Metadata-Flavor": "Google" } },
  );
  if (!res.ok) throw new Error("metadata token failed");
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}
