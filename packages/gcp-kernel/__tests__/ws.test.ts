import { afterEach, describe, expect, it } from "vitest";
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
