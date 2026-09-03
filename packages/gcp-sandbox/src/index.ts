import { spawn } from "node:child_process";

export type SandboxResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
};

export type SandboxOptions = {
  /** Override `/usr/local/gcp/bin/sandbox` (CI fake, local). */
  binary?: string;
  timeoutMs?: number;
};

/**
 * Run untrusted JS with deny-egress, no inherited env — Cloud Run `sandbox do`.
 * Capability calls stay on the host; never pass `--allow-egress`.
 */
export async function sandboxDo(code: string, options: SandboxOptions = {}): Promise<SandboxResult> {
  const binary = options.binary ?? process.env.SANDBOX_BIN ?? "/usr/local/gcp/bin/sandbox";
  const args = ["do", "--deny-all"];
  return await new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      env: {},
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("sandbox do timed out"));
    }, options.timeoutMs ?? 30_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, exitCode });
    });
    child.stdin.on("error", () => {
      // The box may close stdin before we finish writing (deny-egress fake binaries).
    });
    child.stdin.write(code);
    child.stdin.end();
  });
}
