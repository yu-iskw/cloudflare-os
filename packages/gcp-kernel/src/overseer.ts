import { RpcStub, RpcTarget } from "capnweb";
import type {
  ActionHistoryPage,
  AiChatAuthorInfo,
  AiChatHistoryPage,
  AiChatMessage,
  AiChatMetadata,
  AiChatSubscriber,
  BoundHookInfo,
  GadgetMetadata,
  Overseer,
  SlashCommandChoice,
  WorkpiecesSubscriber,
} from "@gadgets/workshop-shared/api";
import { MemoryLedger, type ChatMessageRow } from "@gadgets/gcp-ledger";
import { GitStore } from "@gadgets/gcp-git";
import { sandboxDo } from "@gadgets/gcp-sandbox";
import { completeThroughGateway, defaultArmorFloor } from "@gadgets/gcp-agent";
import { dummySub } from "./rpc-stubs.js";

const DEFAULT_MODEL: AiChatAuthorInfo = {
  type: "agent",
  id: "gemini-3.6-flash",
  name: "Gemini",
};

const gateway = {
  async complete(req: { prompt: string; model: string }) {
    const url = process.env.AGENT_GATEWAY_URL;
    if (!url) return { text: `(local) ${req.prompt.slice(0, 200)}`, blocked: false as const };
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? "", blocked: false as const };
  },
};

/** Workspace actor analog: lease + SQL/memory rows + git pointers. */
export class OverseerImpl extends RpcTarget {
  #chatSubscribers = new Set<AiChatSubscriber>();

  constructor(
    private readonly ledger: MemoryLedger,
    private readonly git: GitStore,
    private readonly workspaceId: string,
    private readonly userId: string,
    private readonly replicaId: string,
  ) {
    super();
  }

  async getMetadata(): Promise<GadgetMetadata> {
    const ws = this.ledger.workspaces.get(this.workspaceId);
    if (!ws) throw new Error("workspace gone");
    return { id: ws.id, title: ws.title, pinned: ws.pinned };
  }

  async setTitle(title: string): Promise<void> {
    const ws = this.ledger.workspaces.get(this.workspaceId);
    if (ws) ws.title = title;
  }

  async setPinned(pinned: boolean): Promise<void> {
    const ws = this.ledger.workspaces.get(this.workspaceId);
    if (ws) ws.pinned = pinned;
  }

  async deleteSelf(): Promise<void> {
    this.ledger.workspaces.delete(this.workspaceId);
    await this.ledger.releaseLease(this.workspaceId, this.replicaId);
  }

  async listChats(): Promise<AiChatMetadata[]> {
    return this.#chatMeta();
  }

  async listModels(): Promise<AiChatAuthorInfo[]> {
    return [DEFAULT_MODEL];
  }

  async getChatHistory(chatId: number): Promise<AiChatHistoryPage> {
    const messages = this.ledger.chatMessages.get(chatId) ?? [];
    return { messages: messages.map((row) => this.#toMessage(row)) };
  }

  async newChat(initialMessage: string, modelId: string | null): Promise<number> {
    const text = typeof initialMessage === "string" ? initialMessage : "";
    const chat = this.ledger.createChat(this.workspaceId, text.slice(0, 40) || "New Chat");
    const userRow = this.ledger.appendChatMessage({
      chatId: chat.id,
      sequence: 0,
      role: "user",
      body: text,
    });
    this.#emitChat(chat.id, userRow);
    await this.#maybeAgent(chat.id, text, modelId);
    return chat.id;
  }

  async sendChatMessage(chatId: number, message: string, modelId: string | null): Promise<void> {
    const text = typeof message === "string" ? message : "";
    const list = this.ledger.chatMessages.get(chatId) ?? [];
    const userRow = this.ledger.appendChatMessage({
      chatId,
      sequence: list.length,
      role: "user",
      body: text,
    });
    this.#emitChat(chatId, userRow);
    await this.#maybeAgent(chatId, text, modelId);
  }

  async #maybeAgent(chatId: number, text: string, modelId: string | null): Promise<void> {
    const code = extractCodeFence(text);
    let body: string | undefined;
    if (code) {
      const result = await sandboxDo(code, {
        binary: process.env.SANDBOX_BIN,
        timeoutMs: 15_000,
      });
      body = result.stdout || result.stderr || `(exit ${result.exitCode})`;
    } else if (modelId) {
      const completion = await completeThroughGateway(gateway, defaultArmorFloor, {
        model: modelId,
        prompt: text,
      });
      body = completion.blocked ? "(blocked by model armor)" : completion.text;
    }
    if (body === undefined) return;
    const list = this.ledger.chatMessages.get(chatId) ?? [];
    const row = this.ledger.appendChatMessage({
      chatId,
      sequence: list.length,
      role: "assistant",
      body,
    });
    this.#emitChat(chatId, row);
  }

  async listSlashCommands(): Promise<SlashCommandChoice[]> {
    return [];
  }

  async listActions(): Promise<ActionHistoryPage> {
    return { entries: [] };
  }

  async listHooks(): Promise<BoundHookInfo[]> {
    return [];
  }

  /**
   * Push current metadata immediately so the SPA can leave the loading spinner.
   * The callback is a client stub; invoke without awaiting (promise pipelining).
   */
  async subscribeToMetadata(
    callback: (metadata: GadgetMetadata) => void,
  ): Promise<RpcStub<{}>> {
    callback(await this.getMetadata());
    return dummySub();
  }

  async subscribeToPresence(subscriber: { init(participants: unknown[]): void }): Promise<RpcStub<{}>> {
    subscriber.init([]);
    return dummySub();
  }

  async subscribeToWorkpieces(subscriber: WorkpiecesSubscriber): Promise<RpcStub<{}>> {
    subscriber.ready();
    return dummySub();
  }

  async subscribeToActions(subscriber: { ready?(): void }): Promise<RpcStub<{}>> {
    subscriber.ready?.();
    return dummySub();
  }

  async subscribeToChat(subscriber: AiChatSubscriber): Promise<RpcStub<{}>> {
    this.#chatSubscribers.add(subscriber);
    subscriber.streamGeneration(1);
    for (const meta of this.#chatMeta()) {
      subscriber.metadata(meta);
      for (const row of this.ledger.chatMessages.get(meta.id) ?? []) {
        subscriber.message(this.#toMessage(row));
      }
    }
    return dummySub();
  }

  async subscribeToConsoleLogs(): Promise<RpcStub<{}>> {
    return dummySub();
  }

  async writeFilesAsCommit(files: Record<string, string>): Promise<string> {
    const oid = await this.git.writeFilesAsCommit(new Map(Object.entries(files)), {
      author: { name: "kernel", email: "kernel@example.com" },
      parents: [],
      message: "save\n",
      timestamp: new Date(),
    });
    const gadget = [...this.ledger.gadgets.values()].find((g) => g.workspaceId === this.workspaceId);
    if (gadget) gadget.commitId = oid;
    // SQL/memory holds the oid pointer only; bytes stay in the git backend.
    this.ledger.gitPointers.set(oid, oid);
    return oid;
  }

  async getCodeAtCommit(commitId: string): Promise<{ files: [string, string][] }> {
    const files = await this.git.readCommitFiles(commitId);
    return { files: [...files.entries()] };
  }

  #chatMeta(): AiChatMetadata[] {
    const now = new Date();
    const out: AiChatMetadata[] = [];
    for (const chat of this.ledger.chats.values()) {
      if (chat.workspaceId !== this.workspaceId) continue;
      out.push({ id: chat.id, title: chat.title, started: now, lastActive: now });
    }
    return out;
  }

  #toMessage(row: ChatMessageRow): AiChatMessage {
    const assistant = row.role === "assistant";
    return {
      chatId: row.chatId,
      sequence: row.sequence,
      timestamp: new Date(),
      author: assistant
        ? DEFAULT_MODEL
        : { type: "user", id: this.userId, name: "user" },
      type: "message",
      message: row.body,
    };
  }

  #emitChat(chatId: number, row: ChatMessageRow): void {
    const meta = this.#chatMeta().find((c) => c.id === chatId);
    const msg = this.#toMessage(row);
    for (const subscriber of this.#chatSubscribers) {
      if (meta) subscriber.metadata(meta);
      subscriber.message(msg);
    }
  }
}

function extractCodeFence(text: string): string | undefined {
  const match = /```(?:javascript|js)?\n([\s\S]*?)```/.exec(text);
  return match?.[1];
}

export type { Overseer };
