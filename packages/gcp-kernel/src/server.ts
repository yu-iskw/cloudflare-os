import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { newWebSocketRpcSession } from "capnweb";
import { createMemoryLedger, MemoryLedger } from "@gadgets/gcp-ledger";
import { PublicApiImpl } from "./public-api.js";

export type KernelOptions = {
  ledger?: MemoryLedger;
  replicaId?: string;
  /** Directory of built SPA assets (Cloud Run origin). */
  frontendDist?: string;
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/** HTTP + Cap'n Web `/api` origin for Cloud Run. WebSockets last 60 minutes; the SPA reconnects. */
export function createKernelServer(options: KernelOptions = {}): {
  server: Server;
  ledger: MemoryLedger;
} {
  const ledger = options.ledger ?? createMemoryLedger();
  const replicaId = options.replicaId ?? `replica-${process.pid}`;
  const frontendDist = options.frontendDist ?? process.env.FRONTEND_DIST;
  const server = createServer((req, res) => {
    if (req.url === "/healthz") {
      res.writeHead(200);
      res.end("ok");
      return;
    }
    if (frontendDist) {
      serveSpa(frontendDist, req, res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server, path: "/api" });
  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const assertion = header(req, "x-goog-iap-jwt-assertion");
    const api = new PublicApiImpl(ledger, replicaId, assertion);
    newWebSocketRpcSession(ws, api);
  });
  return { server, ledger };
}

function serveSpa(root: string, req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://kernel.local");
  const relative = decodeURIComponent(url.pathname);
  const candidate = normalize(join(root, relative === "/" ? "index.html" : relative));
  if (!candidate.startsWith(normalize(root))) {
    res.writeHead(403);
    res.end();
    return;
  }
  const file = existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, "index.html");
  if (!existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
