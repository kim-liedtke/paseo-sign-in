import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { LoginPhase } from "../../shared/contracts";
import type { Launch } from "./launch";
import { signalProcess, startProcess, stopProcess } from "./process";
import { safeMessage } from "./text";

export interface LoginSessionOptions {
  /** How to start the provider CLI. Resolved again for every sign-in. */
  resolveLaunch(): Promise<Launch>;
  /** Arguments of the provider's sign-in command, after the launch arguments. */
  loginArgs: readonly string[];
  /** Returns the sign-in link once the CLI has printed it, else null. */
  findUrl(output: string): string | null;
  /** The whole sign-in is stopped after this time. */
  timeoutMs?: number;
  /** The sign-in is stopped when the CLI shows no link within this time. */
  linkTimeoutMs?: number;
  /** Time between SIGTERM and SIGKILL when a sign-in is stopped. */
  killGraceMs?: number;
  now?: () => number;
}

export interface LoginState {
  phase: LoginPhase;
  url: string | null;
  message: string | null;
  deadline: string | null;
}

const ACTIVE: readonly LoginPhase[] = ["starting", "awaiting_code", "verifying"];
const MAX_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LINK_TIMEOUT_MS = 30 * 1000;
const DEFAULT_KILL_GRACE_MS = 2000;

type Listener = (state: LoginState) => void;

/**
 * Drives one interactive CLI sign-in at a time: start the CLI, wait for the
 * link it prints, write the pasted code to its input, report how it ended.
 *
 * The link and the code exist only in the memory of this object while the
 * sign-in runs. They are never written to a log or a file, and both are
 * dropped as soon as the sign-in ends.
 */
export class LoginSession {
  private readonly options: Required<LoginSessionOptions>;
  private state: LoginState = { phase: "idle", url: null, message: null, deadline: null };
  private child: ChildProcessWithoutNullStreams | null = null;
  private timer: NodeJS.Timeout | null = null;
  private linkTimer: NodeJS.Timeout | null = null;
  private output = "";
  private submittedCode: string | null = null;
  private listeners = new Set<Listener>();
  private starting: Promise<LoginState> | null = null;

  constructor(options: LoginSessionOptions) {
    this.options = {
      resolveLaunch: options.resolveLaunch,
      loginArgs: options.loginArgs,
      findUrl: options.findUrl,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      linkTimeoutMs: options.linkTimeoutMs ?? DEFAULT_LINK_TIMEOUT_MS,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      now: options.now ?? Date.now,
    };
  }

  snapshot(): LoginState {
    return { ...this.state };
  }

  isActive(): boolean {
    return ACTIVE.includes(this.state.phase);
  }

  /**
   * Starts a sign-in, or returns the running one. A second process is never
   * started while one is active. Resolves when the link is known or the
   * sign-in has stopped.
   */
  start(): Promise<LoginState> {
    if (this.starting) return this.starting;
    if (this.isActive()) return Promise.resolve(this.snapshot());
    this.starting = this.begin().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Writes the pasted code to the CLI and resolves with the result of the sign-in. */
  async submitCode(rawCode: string): Promise<LoginState> {
    const code = rawCode.trim();
    if (this.state.phase !== "awaiting_code" || !this.child) {
      throw new Error("No sign-in is waiting for a code. Start the sign-in again.");
    }
    if (code.length === 0 || /[\u0000-\u001f\u007f]/.test(code)) {
      throw new Error("The code is empty or contains characters that are not allowed.");
    }
    this.submittedCode = code;
    this.output = "";
    this.setState({ phase: "verifying", url: null, message: null });
    const done = this.waitFor((state) => !ACTIVE.includes(state.phase));
    this.child.stdin.write(`${code}\n`);
    return done;
  }

  /** Stops a running sign-in. Does nothing when none is active. */
  async cancel(): Promise<LoginState> {
    if (!this.isActive()) return this.snapshot();
    await this.finish("cancelled", "The sign-in was cancelled.");
    return this.snapshot();
  }

  /** Stops the child process and forgets everything. Called when the plugin stops. */
  async dispose(): Promise<void> {
    if (this.isActive()) await this.finish("cancelled", null);
    this.listeners.clear();
  }

  /** Last resort for a process that exits without running cleanup. Synchronous. */
  killNow(): void {
    if (this.child) signalProcess(this.child, "SIGKILL");
  }

  private async begin(): Promise<LoginState> {
    this.output = "";
    this.submittedCode = null;
    const deadline = new Date(this.options.now() + this.options.timeoutMs).toISOString();
    this.setState({ phase: "starting", url: null, message: null, deadline });

    let child: ChildProcessWithoutNullStreams;
    try {
      const launch = await this.options.resolveLaunch();
      // Cancelled while the launch was resolved: start nothing.
      if (this.state.phase !== "starting") return this.snapshot();
      child = startProcess(launch, this.options.loginArgs);
    } catch {
      this.setState({
        phase: "failed",
        message: "The provider command could not be started.",
        deadline: null,
      });
      return this.snapshot();
    }
    this.child = child;
    this.timer = setTimeout(() => {
      void this.finish("timed_out", "The sign-in was not finished in time and was stopped.");
    }, this.options.timeoutMs);
    this.linkTimer = setTimeout(() => {
      if (this.state.phase !== "starting") return;
      void this.finish("failed", "The provider did not show a sign-in link.");
    }, this.options.linkTimeoutMs);

    const onData = (chunk: Buffer) => this.onOutput(chunk.toString("utf8"));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.stdin.on("error", () => {});
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (this.child !== child) return;
      const message =
        error.code === "ENOENT"
          ? "The provider command was not found on the host."
          : "The provider command could not be started.";
      this.settle("failed", message);
    });
    child.on("close", (exitCode) => {
      if (this.child !== child) return;
      if (exitCode === 0) {
        this.settle("succeeded", null);
      } else {
        const secrets = this.submittedCode ? [this.submittedCode] : [];
        const detail = safeMessage(lastLines(this.output, 3), secrets);
        this.settle("failed", detail || "The sign-in did not succeed.");
      }
    });

    return this.waitFor((state) => state.phase !== "starting");
  }

  private onOutput(text: string): void {
    this.output = (this.output + text).slice(-MAX_OUTPUT);
    if (this.state.phase !== "starting") return;
    const url = this.options.findUrl(this.output);
    if (!url) return;
    // Output before the code is not needed again. Drop it, it contains the link.
    this.output = "";
    this.setState({ phase: "awaiting_code", url });
  }

  /** Ends the sign-in from our side: stop the process, then record the result. */
  private async finish(phase: LoginPhase, message: string | null): Promise<void> {
    const child = this.child;
    // Detach first, so the exit of the stopped process is not read as a result.
    this.child = null;
    if (child) await stopProcess(child, this.options.killGraceMs);
    if (this.isActive()) this.settle(phase, message);
  }

  /** Records the end of the sign-in and drops the link, the code and the output. */
  private settle(phase: LoginPhase, message: string | null): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.linkTimer) clearTimeout(this.linkTimer);
    this.timer = null;
    this.linkTimer = null;
    this.child = null;
    this.output = "";
    this.submittedCode = null;
    this.setState({ phase, url: null, message, deadline: null });
  }

  private setState(patch: Partial<LoginState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of [...this.listeners]) listener(this.snapshot());
  }

  private waitFor(done: (state: LoginState) => boolean): Promise<LoginState> {
    if (done(this.state)) return Promise.resolve(this.snapshot());
    return new Promise((resolve) => {
      const listener: Listener = (state) => {
        if (!done(state)) return;
        this.listeners.delete(listener);
        resolve(state);
      };
      this.listeners.add(listener);
    });
  }
}

function lastLines(text: string, count: number): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .slice(-count)
    .join(" ");
}
