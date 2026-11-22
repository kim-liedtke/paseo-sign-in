import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { Launch } from "./launch";

const IS_WINDOWS = process.platform === "win32";
// After SIGKILL, wait at most this long for the process to report its exit.
const HARD_DEADLINE_MS = 2000;
// After the process exits, wait at most this long for the rest of its output.
const DRAIN_MS = 300;

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

function hasExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

export function signalProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (hasExited(child)) return;
  try {
    if (!IS_WINDOWS && child.pid !== undefined) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch {
    // The process is already gone.
  }
}

/** Closes our ends of the pipes. A helper that still holds the other ends cannot keep us waiting. */
function releasePipes(child: ChildProcessWithoutNullStreams): void {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

/**
 * Stops a child: SIGTERM, then SIGKILL after the grace period. Resolves when
 * the process has exited. It does not wait for the pipes to close, because a
 * helper process can hold them open. If no exit is reported after SIGKILL, it
 * resolves anyway after a hard deadline.
 */
export function stopProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
  hardDeadlineMs: number = HARD_DEADLINE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    let force: NodeJS.Timeout | null = null;
    let giveUp: NodeJS.Timeout | null = null;
    const done = () => {
      if (force) clearTimeout(force);
      if (giveUp) clearTimeout(giveUp);
      child.off("exit", done);
      child.off("error", done);
      releasePipes(child);
      resolve();
    };
    // No pid: the process never started. Nothing to stop.
    if (hasExited(child) || child.pid === undefined) return done();
    child.once("exit", done);
    child.once("error", done);
    force = setTimeout(() => {
      signalProcess(child, "SIGKILL");
      giveUp = setTimeout(done, hardDeadlineMs);
    }, graceMs);
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

/**
 * Runs a CLI to its end and collects its output, with a time limit. It
 * resolves when the pipes close, or shortly after the process exits if a
 * helper keeps the pipes open, or at a hard deadline after the time limit.
 */
export function runToEnd(launch: Launch, extraArgs: readonly string[], timeoutMs: number): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let spawnError: string | null = null;
    let timedOut = false;
    let exitCode: number | null = null;
    let settled = false;
    const timers: NodeJS.Timeout[] = [];
    const child = startProcess(launch, extraArgs);
    const finish = () => {
      if (settled) return;
      settled = true;
      for (const timer of timers) clearTimeout(timer);
      releasePipes(child);
      resolve({ exitCode, stdout, stderr, spawnError, timedOut });
    };
    timers.push(
      setTimeout(() => {
        timedOut = true;
        signalProcess(child, "SIGKILL");
        timers.push(setTimeout(finish, HARD_DEADLINE_MS));
      }, timeoutMs),
    );
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
    child.on("exit", (code) => {
      exitCode = code;
      timers.push(setTimeout(finish, DRAIN_MS));
    });
    child.on("close", (code) => {
      exitCode = code ?? exitCode;
      finish();
    });
  });
}
