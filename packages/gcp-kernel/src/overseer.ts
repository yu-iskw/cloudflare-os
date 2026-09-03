import { RpcStub, RpcTarget } from "capnweb";
import type {
  AiChatAuthorInfo,
  AiChatHistoryPage,
  AiChatMetadata,
  GadgetMetadata,
  Overseer,
  SlashCommandChoice,
} from "@gadgets/workshop-shared/api";
import { MemoryLedger } from "@gadgets/gcp-ledger";
import { GitStore } from "@gadgets/gcp-git";
import { sandboxDo } from "@gadgets/gcp-sandbox";
import { completeThroughGateway, defaultArmorFloor } from "@gadgets/gcp-agent";

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
    const out: AiChatMetadata[] = [];
    for (const chat of this.ledger.chats.values()) {
      if (chat.workspaceId === this.workspaceId) {
        const now = new Date();
        out.push({ id: chat.id, title: chat.title, started: now, lastActive: now });
      }
    }
    return out;
  }

  async listModels(): Promise<AiChatAuthorInfo[]> {
    return [{ type: "model", id: "gemini-3.6-flash", name: "Gemini" }];
  }

  async getChatHistory(chatId: number): Promise<AiChatHistoryPage> {
    const messages = this.ledger.chatMessages.get(chatId) ?? [];
    return {
      messages: messages.map((m) => ({
        chatId,
        sequence: m.sequence,
        author: { type: "user" as const, id: this.userId, name: "user" },
        content: [{ type: "text" as const, text: m.body }],
        created: new Date(),
      })),
    } as unknown as AiChatHistoryPage;
  }

  async newChat(initialMessage: string, modelId: string | null): Promise<number> {
    const text = typeof initialMessage === "string" ? initialMessage : "";
    const id = this.ledger.chats.size + 1;
    this.ledger.chats.set(id, { id, workspaceId: this.workspaceId, title: text.slice(0, 40) || "New Chat" });
    this.ledger.appendChatMessage({ chatId: id, sequence: 0, role: "user", body: text });
    await this.#maybeAgent(id, text, modelId);
    return id;
  }

  async sendChatMessage(chatId: number, message: string, modelId: string | null): Promise<void> {
    const text = typeof message === "string" ? message : "";
    const list = this.ledger.chatMessages.get(chatId) ?? [];
    this.ledger.appendChatMessage({
      chatId,
      sequence: list.length,
      role: "user",
      body: text,
    });
    await this.#maybeAgent(chatId, text, modelId);
  }

  async #maybeAgent(chatId: number, text: string, modelId: string | null): Promise<void> {
    if (!modelId) return;
    const code = extractCodeFence(text);
    let body: string;
    if (code) {
      const result = await sandboxDo(code, {
        binary: process.env.SANDBOX_BIN,
        timeoutMs: 15_000,
      });
      body = result.stdout || result.stderr || `(exit ${result.exitCode})`;
    } else {
      const completion = await completeThroughGateway(gateway, defaultArmorFloor, {
        model: modelId,
        prompt: text,
      });
      body = completion.blocked ? "(blocked by model armor)" : completion.text;
    }
    const list = this.ledger.chatMessages.get(chatId) ?? [];
    this.ledger.appendChatMessage({
      chatId,
      sequence: list.length,
      role: "assistant",
      body,
    });
  }

  async listSlashCommands(): Promise<SlashCommandChoice[]> {
    return [];
  }

  async subscribeToMetadata(): Promise<RpcStub<{}>> {
    return dummySub();
  }

  async subscribeToPresence(): Promise<RpcStub<{}>> {
    return dummySub();
  }

  async subscribeToWorkpieces(): Promise<RpcStub<{}>> {
    return dummySub();
  }

  async subscribeToActions(): Promise<RpcStub<{}>> {
    return dummySub();
  }

  async subscribeToChat(): Promise<RpcStub<{}>> {
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
}

function dummySub(): RpcStub<{}> {
  const target = new RpcTarget();
  return target as unknown as RpcStub<{}>;
}

function extractCodeFence(text: string): string | undefined {
  const match = /```(?:javascript|js)?\n([\s\S]*?)```/.exec(text);
  return match?.[1];
}

export type { Overseer };
