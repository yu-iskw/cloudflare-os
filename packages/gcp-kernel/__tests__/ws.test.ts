import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { RpcTarget, newWebSocketRpcSession } from "capnweb";
import type { GadgetMetadata, PublicApi } from "@gadgets/workshop-shared/api";
import { createKernelServer } from "../src/server.js";
import type { Server } from "node:http";

describe("Cap'n Web /api", () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      server?.close(() => resolve());
      if (!server) resolve();
    });
    server = undefined;
  });

  it("pings over a WebSocket and disposes the stub", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const stub = newWebSocketRpcSession<PublicApi>(ws as never);
    await stub.ping();
    const config = await stub.getServerConfig();
    expect(config.passwordAuthEnabled).toBe(true);
    stub[Symbol.dispose]();
    ws.close();
  });

  it("creates an account, authenticates, and opens a workspace", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const stub = newWebSocketRpcSession<PublicApi>(ws as never);
    const hash = new Uint8Array(32);
    const token = await stub.createAccount("ada", "Ada", hash);
    expect(token).toBeTruthy();
    const authed = stub.authenticate(token!);
    const me = await authed.whoami();
    expect(me.name).toBe("Ada");
    const overseer = authed.newGadget();
    const meta = await overseer.getMetadata();
    expect(meta.title).toBe("Untitled Workspace");
    stub[Symbol.dispose]();
    ws.close();
  });

  it("skips onboarding and delivers metadata plus connected-accounts ready", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(ws);
    const stub = newWebSocketRpcSession<PublicApi>(ws as never);
    const hash = new Uint8Array(32);
    const token = await stub.createAccount("ada", "Ada", hash);
    const authed = stub.authenticate(token!);
    expect(await authed.isOnboardingCompleted()).toBe(true);
    const models = await authed.listModels();
    expect(models[0]?.id).toBe("gemini-3.6-flash");

    let accountsReady = false;
    class AccountsSub extends RpcTarget {
      add(): void {}
      remove(): void {}
      ready(): void {
        accountsReady = true;
      }
    }
    await authed.subscribeConnectedAccounts(new AccountsSub() as never);
    await expect.poll(() => accountsReady).toBe(true);

    const overseer = authed.newGadget();
    const meta = await new Promise<GadgetMetadata>((resolve) => {
      void overseer.subscribeToMetadata((next) => resolve(next));
    });
    expect(meta.title).toBe("Untitled Workspace");

    const chats = await overseer.listChats();
    expect(chats.length).toBeGreaterThanOrEqual(0);
    for (const chat of chats) {
      expect(chat.lastActive).toBeInstanceOf(Date);
      expect(Number.isNaN(chat.lastActive.getTime())).toBe(false);
    }

    stub[Symbol.dispose]();
    ws.close();
  });

  it("pipelines listChats after subscribeToChat the way the SPA does", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(ws);
    const stub = newWebSocketRpcSession<PublicApi>(ws as never);
    const hash = new Uint8Array(32);
    const token = await stub.createAccount("ada", "Ada", hash);
    const authed = stub.authenticate(token!);
    const overseer = authed.newGadget();
    const previous = process.env.SANDBOX_BIN;
    process.env.SANDBOX_BIN = fileURLToPath(new URL("../scripts/fake-sandbox.mjs", import.meta.url));
    let chatId: number;
    try {
      chatId = await overseer.newChat("```js\n1+1\n```", "gemini-3.6-flash");
    } finally {
      if (previous === undefined) delete process.env.SANDBOX_BIN;
      else process.env.SANDBOX_BIN = previous;
    }

    let generation = 0;
    class ChatSub extends RpcTarget {
      streamGeneration(value: number) {
        generation = value;
      }
      metadata(): void {}
      deleted(): void {}
      message(): void {}
      changeApplied(): void {}
      stream(): void {}
    }
    class ActionsSub extends RpcTarget {
      ready(): void {}
      upsert(): void {}
    }

    // Same order as ChatInterface: do not await subscribe, then read.
    const subscription = overseer.subscribeToChat(new ChatSub() as never);
    const actionsSub = overseer.subscribeToActions(new ActionsSub() as never);
    const [chats, models, history, actions] = await withTimeout(
      Promise.all([
        overseer.listChats(),
        overseer.listModels(),
        overseer.getChatHistory(chatId),
        overseer.listActions({ filter: "pending" } as never),
      ]),
      5_000,
      "SPA pipelined reads after subscribeToChat",
    );
    expect(chats.some((c) => c.id === chatId)).toBe(true);
    for (const chat of chats) {
      expect(chat.lastActive).toBeInstanceOf(Date);
      expect(chat.lastActive.getTime()).not.toBeNaN();
    }
    expect(models[0]?.id).toBe("gemini-3.6-flash");
    const bodies = history.messages
      .filter((m) => m.type === "message")
      .map((m) => m.message);
    expect(bodies.some((b) => b.includes("1+1"))).toBe(true);
    expect(bodies.some((b) => b.includes("2"))).toBe(true);
    expect(actions.entries).toEqual([]);
    await expect.poll(() => generation).toBe(1);

    subscription[Symbol.dispose]();
    actionsSub[Symbol.dispose]();
    stub[Symbol.dispose]();
    ws.close();
  });

  it("accepts a second WebSocket after the first is disposed", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);

    const first = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(first);
    const stub1 = newWebSocketRpcSession<PublicApi>(first as never);
    await stub1.ping();
    stub1[Symbol.dispose]();
    first.close();

    const second = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(second);
    const stub2 = newWebSocketRpcSession<PublicApi>(second as never);
    await stub2.ping();
    stub2[Symbol.dispose]();
    second.close();
  });

  it("dropApiSockets closes the live socket so a new one can connect", async () => {
    const started = createKernelServer();
    server = started.server;
    const port = await listen(server);

    const first = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(first);
    const stub1 = newWebSocketRpcSession<PublicApi>(first as never);
    await stub1.ping();
    const closed = new Promise<void>((resolve) => first.once("close", () => resolve()));
    started.dropApiSockets();
    await closed;

    const second = new WebSocket(`ws://127.0.0.1:${port}/api`);
    await opened(second);
    const stub2 = newWebSocketRpcSession<PublicApi>(second as never);
    await stub2.ping();
    stub2[Symbol.dispose]();
    second.close();
  });
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") resolve(addr.port);
      else reject(new Error("no port"));
    });
    server.on("error", reject);
  });
}

function opened(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
