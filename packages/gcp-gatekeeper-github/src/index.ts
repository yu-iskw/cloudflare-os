/**
 * GitHub Gatekeeper as a Cloud Run HTTP service.
 * Kernel stores capability records (vendor, resource URL, token) — never RPC stubs.
 */

export type CapabilityRecord = {
  vendorId: "github";
  accountLabel: string;
  resourceUrl: string;
  accessToken: string;
};

export type QueuedWrite = {
  id: number;
  capability: CapabilityRecord;
  method: string;
  args: unknown;
  status: "pending" | "approved" | "rejected";
};

export class GithubGatekeeper {
  #writes: QueuedWrite[] = [];
  #next = 1;

  /** Observation: list repos the token can see. Host performs this, not the sandbox. */
  async listRepos(record: CapabilityRecord, fetchImpl: typeof fetch = fetch): Promise<unknown> {
    const res = await fetchImpl("https://api.github.com/user/repos", {
      headers: {
        Authorization: `Bearer ${record.accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "company-os",
      },
    });
    if (!res.ok) throw new Error(`github ${res.status}`);
    return await res.json();
  }

  /** Side-effecting call: queue for human approval. */
  queueWrite(record: CapabilityRecord, method: string, args: unknown): QueuedWrite {
    const row: QueuedWrite = {
      id: this.#next++,
      capability: record,
      method,
      args,
      status: "pending",
    };
    this.#writes.push(row);
    return row;
  }

  approve(id: number): QueuedWrite {
    const row = this.#writes.find((w) => w.id === id);
    if (!row) throw new Error("unknown action");
    row.status = "approved";
    return row;
  }

  listPending(): QueuedWrite[] {
    return this.#writes.filter((w) => w.status === "pending");
  }
}
