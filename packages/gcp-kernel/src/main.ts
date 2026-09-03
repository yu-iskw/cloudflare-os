import { createKernelServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const { server, dropApiSockets } = createKernelServer();
server.listen(port, () => {
  console.log(`kernel listening on ${port}`);
});

// Drop `/api` WebSockets without exiting so the SPA can prove reconnect (60-minute origin cap).
process.on("SIGUSR1", () => {
  console.log("dropping /api sockets");
  dropApiSockets();
});
