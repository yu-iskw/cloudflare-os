import { createKernelServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const { server } = createKernelServer();
server.listen(port, () => {
  console.log(`kernel listening on ${port}`);
});
