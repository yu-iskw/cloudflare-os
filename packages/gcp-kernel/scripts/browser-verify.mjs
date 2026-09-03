#!/usr/bin/env node
/**
 * Headed Chrome (CDP) walkthrough of Company OS: signup, Code Mode `1+1`, workspace, reconnect.
 * Expects Vite on :3000 and the kernel on :8080. Optional KERNEL_PID for SIGUSR1 reconnect.
 */
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { createConnection } from "node:net";
import { WebSocket } from "ws";
import { newWebSocketRpcSession } from "capnweb";

const ORIGIN = process.env.SPA_ORIGIN ?? "http://127.0.0.1:3000";
const DEBUG_PORT = Number(process.env.CDP_PORT ?? 9333);
const USER = process.env.E2E_USER ?? "ada";
const PASS = process.env.E2E_PASS ?? "Password123!";
const CODE = "```js\n1+1\n```";
const SHOT_DIR = process.env.SHOT_DIR ?? "/tmp/company-os-e2e";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitPort(port, timeoutMs = 20_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = createConnection({ host: "127.0.0.1", port }, () => {
        sock.end();
        resolve(undefined);
      });
      sock.on("error", () => {
        sock.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error(`port ${port} not open`));
        else setTimeout(tryOnce, 150);
      });
    };
    tryOnce();
  });
}

async function cdpConnect() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
  const targets = await res.json();
  let page = targets.find((t) => t.type === "page");
  if (!page) {
    const created = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?${ORIGIN}`);
    page = await created.json();
  }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const send = (method, params = {}) => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("DOM.enable");
  return { ws, send };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "evaluate failed");
  }
  return result.result?.value;
}

async function waitFor(send, expression, timeoutMs = 25_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await evaluate(send, expression);
    if (value) return value;
    await delay(200);
  }
  throw new Error(`timeout waiting for: ${expression}`);
}

async function screenshot(send, name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const path = `${SHOT_DIR}/${name}.png`;
  await writeFile(path, Buffer.from(data, "base64"));
  console.log("wrote", path);
  return path;
}

async function focusAndType(send, selector, text) {
  const sel = JSON.stringify(selector);
  const focused = await evaluate(
    send,
    `(() => {
      const el = document.querySelector(${sel});
      if (!el) return false;
      el.focus();
      el.select?.();
      return true;
    })()`,
  );
  if (!focused) throw new Error(`no element ${selector}`);
  await send("Input.insertText", { text });
}

async function click(send, selector) {
  const sel = JSON.stringify(selector);
  const ok = await evaluate(
    send,
    `(() => {
      const el = document.querySelector(${sel});
      if (!el) return false;
      el.click();
      return true;
    })()`,
  );
  if (!ok) throw new Error(`click missed ${selector}`);
}

async function createWorkspaceWithCode(token) {
  const session = typeof token === "string" ? token : String(token ?? "");
  console.log("auth token length", session.length);
  const ws = new WebSocket("ws://127.0.0.1:8080/api");
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const stub = newWebSocketRpcSession(ws);
  try {
    const authed = stub.authenticate(session);
    const me = await authed.whoami();
    console.log("whoami", me.name, me.id);
    const overseer = authed.newGadget();
    const [chatId, meta] = await Promise.all([
      overseer.newChat(CODE, "gemini-3.6-flash"),
      overseer.getMetadata(),
    ]);
    return { workspaceId: meta.id, chatId };
  } finally {
    stub[Symbol.dispose]();
    ws.close();
  }
}

async function sendCodeFenceViaKernel(token, workspaceId, chatId) {
  const ws = new WebSocket("ws://127.0.0.1:8080/api");
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  const stub = newWebSocketRpcSession(ws);
  const authed = stub.authenticate(token);
  const overseer = authed.openGadget(workspaceId);
  await overseer.sendChatMessage(chatId, CODE, "gemini-3.6-flash");
  stub[Symbol.dispose]();
  ws.close();
}

async function main() {
  await mkdir(SHOT_DIR, { recursive: true });
  await rm("/tmp/company-os-e2e-profile", { recursive: true, force: true });

  const chrome = spawn(
    "google-chrome",
    [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=/tmp/company-os-e2e-profile`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1280,900",
      "--window-position=80,40",
      `${ORIGIN}/signup`,
    ],
    { env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":1" }, stdio: "ignore" },
  );
  process.on("exit", () => chrome.kill());
  await waitPort(DEBUG_PORT);
  await delay(800);
  const { ws, send } = await cdpConnect();
  const consoleLines = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.method === "Runtime.consoleAPICalled") {
      const text = (msg.params?.args ?? []).map((a) => a.value ?? a.description).join(" ");
      consoleLines.push(`${msg.params?.type}: ${text}`);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      consoleLines.push(`exception: ${msg.params?.exceptionDetails?.text}`);
    }
  });
  await send("Page.navigate", { url: ORIGIN });
  await waitFor(send, `document.readyState === "complete"`);
  await evaluate(send, `localStorage.removeItem("authToken"); localStorage.removeItem("lastSelectedModel")`);
  await send("Page.navigate", { url: ORIGIN });
  await waitFor(
    send,
    `!!document.querySelector('input[autocomplete="username"]') || document.body.innerText.includes("What are we working on?")`,
  );
  await screenshot(send, "01-login-or-home");

  const onHomeAlready = await evaluate(send, `document.body.innerText.includes("What are we working on?")`);
  if (!onHomeAlready) {
    await focusAndType(send, 'input[autocomplete="username"]', USER);
    const hasCurrent = await evaluate(send, `!!document.querySelector('input[autocomplete="current-password"]')`);
    if (hasCurrent) {
      await focusAndType(send, 'input[autocomplete="current-password"]', PASS);
      await click(send, 'button[type="submit"]');
    }
    try {
      await waitFor(send, `document.body.innerText.includes("What are we working on?")`, 8_000);
    } catch {
      await send("Page.navigate", { url: `${ORIGIN}/signup` });
      await waitFor(send, `!!document.querySelector('input[autocomplete="username"]')`);
      await focusAndType(send, 'input[autocomplete="username"]', USER);
      await focusAndType(send, 'input[autocomplete="new-password"]', PASS);
      await evaluate(send, `document.querySelectorAll('input[type="password"]')[1]?.focus()`);
      await send("Input.insertText", { text: PASS });
      await click(send, 'button[type="submit"]');
      await waitFor(send, `document.body.innerText.includes("What are we working on?")`, 15_000);
    }
  }

  const wizard = await evaluate(send, `document.body.innerText.includes("Create your profile")`);
  if (wizard) throw new Error("onboarding wizard still shown");
  await evaluate(send, `localStorage.removeItem("lastSelectedModel")`);
  await screenshot(send, "02-home");

  const token = await evaluate(
    send,
    `JSON.stringify({ token: localStorage.getItem("authToken"), keys: Object.keys(localStorage) })`,
  );
  console.log("storage", token);
  const parsed = JSON.parse(token);
  if (!parsed.token) throw new Error("no auth token after login");
  const created = await createWorkspaceWithCode(parsed.token);
  console.log("created workspace", created);
  await send("Page.navigate", {
    url: `${ORIGIN}/workspace/${created.workspaceId}?chat=${created.chatId}`,
  });
  await waitFor(send, `location.pathname.startsWith("/workspace/")`, 20_000);
  await waitFor(
    send,
    `document.body.innerText.includes("Untitled") || document.body.innerText.includes("Loading conversation") || document.body.innerText.includes("1+1")`,
    20_000,
  );
  const diag = await evaluate(
    send,
    `JSON.stringify({
      href: location.href,
      ready: document.readyState,
      text: document.body.innerText.slice(0, 1500),
      html: document.getElementById("root")?.innerHTML.slice(0, 800) ?? null,
    })`,
  );
  console.log("workspace diag:", diag);
  await screenshot(send, "03-workspace-loaded");
  await waitFor(
    send,
    `!document.body.innerText.includes("Loading conversation") && document.body.innerText.includes("1+1")`,
    25_000,
  );
  await screenshot(send, "03-workspace-code-mode");
  const body = await evaluate(send, `document.body.innerText.slice(0, 4000)`);
  if (!body.includes("1+1")) {
    console.log("chat body excerpt:", body.slice(0, 1500));
    throw new Error("code fence not visible");
  }

  const pid = process.env.KERNEL_PID;
  if (pid) {
    process.kill(Number(pid), "SIGUSR1");
    await delay(400);
    await screenshot(send, "04-reconnecting");
    await waitFor(
      send,
      `location.pathname.startsWith("/workspace/") && !document.body.innerText.includes("Loading conversation") && document.body.innerText.includes("1+1")`,
      20_000,
    );
    await delay(1500);
    await screenshot(send, "05-reconnected");
    console.log("after reconnect:", await evaluate(send, `location.href`));
  }

  console.log("ok");
  ws.close();
  chrome.kill();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
