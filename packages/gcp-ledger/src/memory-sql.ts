import { nextLeaseGeneration } from "./lease.js";

/**
 * In-process Postgres-shaped ledger for tests and local dev without Cloud SQL.
 * Row locks model `SELECT … FOR UPDATE`: a second holder cannot take a live lease.
 */

export type SqlValue = string | number | boolean | Uint8Array | Date | null;

export class LedgerConflict extends Error {
  constructor(message = "workspace lease is held") {
    super(message);
    this.name = "LedgerConflict";
  }
}

export type UserRow = {
  id: string;
  username: string;
  displayName: string;
  passwordHashHash: Uint8Array | null;
  sessionToken: string | null;
  preferredModel: string | null;
  onboardingCompleted: boolean;
};

export type WorkspaceRow = {
  id: string;
  ownerId: string;
  title: string;
  pinned: boolean;
};

export type ChatRow = {
  id: number;
  workspaceId: string;
  title: string;
};

export type ChatMessageRow = {
  id: number;
  chatId: number;
  sequence: number;
  role: string;
  body: string;
};

export type GadgetRow = {
  id: string;
  workspaceId: string;
  title: string;
  commitId: string | null;
};

export type CapabilityRow = {
  id: number;
  ownerId: string;
  vendorId: string;
  accountLabel: string;
  resourceUrl: string | null;
  accessToken: string | null;
};

export type QueuedActionRow = {
  id: number;
  workspaceId: string;
  capabilityId: number;
  kind: string;
  payload: unknown;
  status: "pending" | "approved" | "rejected";
};

export type AdminConfigRow = {
  signupsEnabled: boolean;
  siteName: string;
  instanceInstructions: string;
  announcement: string;
  banner: string;
  bannerColor: string;
  accentColor: string;
};

type LeaseRow = {
  workspaceId: string;
  holder: string;
  generation: number;
  expiresAt: number;
};

/** Kernel persistence used by the Cloud Run origin. */
export class MemoryLedger {
  users = new Map<string, UserRow>();
  usersByName = new Map<string, string>();
  usersByToken = new Map<string, string>();
  workspaces = new Map<string, WorkspaceRow>();
  leases = new Map<string, LeaseRow>();
  chats = new Map<number, ChatRow>();
  chatMessages = new Map<number, ChatMessageRow[]>();
  gadgets = new Map<string, GadgetRow>();
  gitPointers = new Map<string, string>();
  capabilities = new Map<number, CapabilityRow>();
  actions = new Map<number, QueuedActionRow>();
  admin: AdminConfigRow = {
    signupsEnabled: true,
    siteName: "",
    instanceInstructions: "",
    announcement: "",
    banner: "",
    bannerColor: "blue",
    accentColor: "",
  };

  #nextChat = 1;
  #nextMessage = 1;
  #nextCap = 1;
  #nextAction = 1;
  #locks = new Map<string, Promise<void>>();

  async withWorkspaceLock<T>(workspaceId: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.#locks.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#locks.set(workspaceId, previous.then(() => gate));
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Take exclusive ownership of a workspace row for `ttlMs`.
   * A live lease held by another replica is a conflict, not a queue.
   */
  async acquireLease(workspaceId: string, holder: string, ttlMs: number, now = Date.now()): Promise<number> {
    return this.withWorkspaceLock(workspaceId, () => {
      const existing = this.leases.get(workspaceId);
      const generation = nextLeaseGeneration(existing, holder, now);
      this.leases.set(workspaceId, {
        workspaceId,
        holder,
        generation,
        expiresAt: now + ttlMs,
      });
      return generation;
    });
  }

  /** Drop the lease if this holder still owns it. */
  async releaseLease(workspaceId: string, holder: string): Promise<void> {
    return this.withWorkspaceLock(workspaceId, () => {
      const existing = this.leases.get(workspaceId);
      if (existing?.holder === holder) this.leases.delete(workspaceId);
    });
  }

  putUser(user: UserRow): void {
    this.users.set(user.id, user);
    this.usersByName.set(user.username, user.id);
    if (user.sessionToken) this.usersByToken.set(user.sessionToken, user.id);
  }

  /**
   * Append a chat message. `(chatId, sequence)` is unique — a duplicate is a conflict,
   * matching the Postgres unique index.
   */
  appendChatMessage(row: Omit<ChatMessageRow, "id">): ChatMessageRow {
    const list = this.chatMessages.get(row.chatId) ?? [];
    if (list.some((m) => m.sequence === row.sequence)) {
      throw new LedgerConflict(`duplicate chat sequence ${row.chatId}:${row.sequence}`);
    }
    const stored: ChatMessageRow = { ...row, id: this.#nextMessage++ };
    list.push(stored);
    this.chatMessages.set(row.chatId, list);
    return stored;
  }

  /**
   * Persist a Gatekeeper capability record (ids + token metadata). Never a live RPC stub.
   */
  putCapability(row: Omit<CapabilityRow, "id">): CapabilityRow {
    const stored: CapabilityRow = { ...row, id: this.#nextCap++ };
    this.capabilities.set(stored.id, stored);
    return stored;
  }

  /** Queue a write for human approval. */
  enqueueAction(row: Omit<QueuedActionRow, "id" | "status">): QueuedActionRow {
    const stored: QueuedActionRow = { ...row, id: this.#nextAction++, status: "pending" };
    this.actions.set(stored.id, stored);
    return stored;
  }
}

/** Shared in-process ledger for a single Cloud Run replica (tests and local). */
export function createMemoryLedger(): MemoryLedger {
  return new MemoryLedger();
}
