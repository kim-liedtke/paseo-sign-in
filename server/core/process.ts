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
export function releasePipes(child: ChildProcessWithoutNullStreams): void {
  child.stdin.destroy();
  child.stdout.destroy();
  child.stderr.destroy();
}

/**
 * True while the process group that the child leads has a member. A group
 * outlives its leader as long as one member runs, and its id cannot be given
 * to another process in that time.
 */
function groupHasMembers(pid: number): boolean {
  if (IS_WINDOWS) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops a child and the process group it leads: SIGTERM, then SIGKILL after
 * the grace period. Resolves when the child has exited and its group is
 * empty. The SIGKILL also comes when the child itself ended on SIGTERM but a
 * member of its group ignored the signal. It does not wait for the pipes to
 * close, because a process outside the group can hold them open. If nothing
 * is reported after SIGKILL, it resolves anyway after a hard deadline.
 */
export function stopProcess(
  child: ChildProcessWithoutNullStreams,
  graceMs: number,
  hardDeadlineMs: number = HARD_DEADLINE_MS,
): Promise<void> {
  return new Promise((resolve) => {
    const pid = child.pid;
    let finished = false;
    let force: NodeJS.Timeout | null = null;
    let giveUp: NodeJS.Timeout | null = null;
    let poll: NodeJS.Timeout | null = null;
    const done = () => {
      if (finished) return;
      finished = true;
      if (force) clearTimeout(force);
      if (giveUp) clearTimeout(giveUp);
      if (poll) clearInterval(poll);
      child.off("exit", check);
      child.off("error", done);
      releasePipes(child);
      resolve();
    };
    const gone = () => hasExited(child) && (pid === undefined || !groupHasMembers(pid));
    function check() {
      if (gone()) done();
    }
    // No pid: the process never started. Nothing to stop.
    if (pid === undefined || gone()) return done();
    child.once("exit", check);
    child.once("error", done);
    // The exit of the leader does not tell when the last group member is gone.
    poll = setInterval(check, 50);
    force = setTimeout(() => {
      signalProcess(child, "SIGKILL");
      if (groupHasMembers(pid)) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          // The group is already gone.
        }
      }
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
