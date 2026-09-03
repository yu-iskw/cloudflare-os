import { createServer } from "node:http";
import { GithubGatekeeper, type CapabilityRecord } from "./index.js";

const gk = new GithubGatekeeper();
const port = Number(process.env.PORT ?? 8081);

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://gatekeeper.local");
  if (url.pathname === "/healthz") {
    res.writeHead(200);
    res.end("ok");
    return;
  }
  if (url.pathname === "/connect") {
    const clientId = process.env.GITHUB_CLIENT_ID ?? "";
    const redirect = `${process.env.PUBLIC_ORIGIN ?? ""}/gatekeeper/github/callback`;
    res.writeHead(302, {
      Location: `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(redirect)}`,
    });
    res.end();
    return;
  }
  if (req.method === "POST" && url.pathname === "/observe/repos") {
    const body = await readJson(req);
    try {
      const repos = await gk.listRepos(body as CapabilityRecord);
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(repos));
    } catch (err) {
      res.writeHead(500);
      res.end(String(err));
    }
    return;
  }
  if (req.method === "POST" && url.pathname === "/queue") {
    const body = (await readJson(req)) as { record: CapabilityRecord; method: string; args: unknown };
    const queued = gk.queueWrite(body.record, body.method, body.args);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(queued));
    return;
  }
  res.writeHead(404);
  res.end();
}).listen(port);

function readJson(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
