import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Launch } from "./launch";

const IS_WINDOWS = process.platform === "win32";

/**
 * Starts a CLI from an argument list. No shell is involved, so no argument is
 * ever interpreted as shell syntax. On POSIX the child leads its own process
 * group, which lets stopProcess() also stop helpers the CLI started.
 */
export function startProcess(launch: Launch, extraArgs: readonly string[]): ChildProcessWithoutNullStreams {
  return spawn(launch.command, [...launch.args, ...extraArgs], {
    env: launch.env,
    shell: false,
    stdio: "pipe",
    detached: !IS_WINDOWS,
    windowsHide: true,
  });
}

export function signalProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (!IS_WINDOWS && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process is already gone.
  }
}

/** Stops a child: SIGTERM, then SIGKILL after the grace period. Resolves when it is gone. */
export function stopProcess(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const force = setTimeout(() => signalProcess(child, "SIGKILL"), graceMs);
    child.once("close", () => {
      clearTimeout(force);
      resolve();
    });
    signalProcess(child, "SIGTERM");
  });
}

export interface RunResult {
  /** Null when the process did not start or was stopped by a signal. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started, for example "ENOENT". */
  spawnError: string | null;
  timedOut: boolean;
}

const MAX_OUTPUT = 256 * 1024;

/** Runs a CLI to its end and collects its output, with a time limit. */
export function runToEnd(launch: Launch, extraArgs: readonly string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let spawnError: string | null = null;
    let timedOut = false;
    const child = startProcess(launch, extraArgs);
    const timer = setTimeout(() => {
      timedOut = true;
      signalProcess(child, "SIGKILL");
    }, timeoutMs);
    child.stdin.on("error", () => {});
    child.stdin.end();
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < MAX_OUTPUT) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_OUTPUT) stderr += chunk.toString("utf8");
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error.code ?? "ERROR";
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, spawnError, timedOut });
    });
  });
}
