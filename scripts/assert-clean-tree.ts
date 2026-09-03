#!/usr/bin/env node
/**
 * Fails if the git-tracked tree contains the forbidden vendor token (any case).
 * Scans working tree paths that git would track, including the lockfile.
 */
import { execFileSync } from "node:child_process";

/** Contiguous spelling of the token would make this file fail its own scan. */
const NEEDLE = String.fromCharCode(0x63, 0x6c, 0x6f, 0x75, 0x64, 0x66, 0x6c, 0x61, 0x72, 0x65);

function gitGrep(pathspec: string[]): string {
  try {
    return execFileSync("git", ["grep", "-i", "-I", "-n", NEEDLE, "--", ...pathspec], {
      encoding: "utf8",
    });
  } catch (err) {
    const error = err as { status?: number; stdout?: string };
    if (error.status === 1) return "";
    throw err;
  }
}

const source = gitGrep([".", ":!pnpm-lock.yaml"]);
const lock = gitGrep(["pnpm-lock.yaml"]);
if (source || lock) {
  process.stderr.write(source + lock);
  process.exit(1);
}
console.log("ok: tracked tree is clean");
