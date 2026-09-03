#!/usr/bin/env node
/**
 * CI / local stand-in for `/usr/local/gcp/bin/sandbox do`.
 * Evaluates stdin as JS and prints the result. Not used on Cloud Run.
 */
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const code = Buffer.concat(chunks).toString("utf8");
  try {
    const result = (0, eval)(code);
    if (result !== undefined) process.stdout.write(String(result));
  } catch (err) {
    process.stderr.write(String(err));
    process.exitCode = 1;
  }
});
