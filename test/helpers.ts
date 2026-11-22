import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Launch } from "../server/core/launch";

const FAKE_CLI = fileURLToPath(new URL("./fixtures/fake-cli.mjs", import.meta.url));

export function fakeLaunch(env: Record<string, string> = {}): { launch: Launch; pidFile: string } {
  const pidFile = join(mkdtempSync(join(tmpdir(), "sign-in-test-")), "pid");
  return {
    pidFile,
    launch: {
      command: process.execPath,
      args: [FAKE_CLI],
      env: { ...process.env, FAKE_PID_FILE: pidFile, ...env },
    },
  };
}

export function isRunning(pidFile: string): boolean {
  const pid = Number(readFileSync(pidFile, "utf8"));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
