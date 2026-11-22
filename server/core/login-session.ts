import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { CODE_PATTERN, type LoginPhase } from "../../shared/contracts";
import { isAllowedLoginLink } from "../../shared/links";
import type { Launch } from "./launch";
import { releasePipes, signalProcess, startProcess, stopGroup, stopProcess } from "./process";
import { findTerminatedUrls, safeMessage } from "./text";

export interface LoginSessionOptions {
  /** How to start the provider CLI. Resolved again for every sign-in. */
  resolveLaunch(): Promise<Launch>;
  /** Arguments of the provider's sign-in command, after the launch arguments. */
  loginArgs: readonly string[];
  /** The hosts whose sign-in links are accepted. A link to another host fails the sign-in. */
  allowedLinkHosts: readonly string[];
  /** The whole sign-in is stopped after this time. */
  timeoutMs?: number;
  /** The sign-in is stopped when the CLI shows no link within this time. */
  linkTimeoutMs?: number;
  /** Time between SIGTERM and SIGKILL when a sign-in is stopped. */
  killGraceMs?: number;
  /** After the CLI exits, wait this long for the rest of its output, then record the result. */
  exitGraceMs?: number;
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
const DEFAULT_EXIT_GRACE_MS = 300;


type Listener = (state: LoginState) => void;

/** Everything that belongs to one sign-in attempt: its process, timers, output and code. */
interface Attempt {
  child: ChildProcessWithoutNullStreams | null;
  timer: NodeJS.Timeout | null;
  linkTimer: NodeJS.Timeout | null;
  exitTimer: NodeJS.Timeout | null;
  /** The CLI printed a complete link, but none that is accepted. */
  sawOtherLink: boolean;
  /** The result of the CLI's own exit was recorded. */
  concluded: boolean;
  /** Records the result of the CLI's own exit. Set once the CLI has exited. */
  concludeNow: (() => void) | null;
  output: string;
  submittedCode: string | null;
  /** Set once the attempt is being stopped from our side. Shared by every caller. */
  stopping: Promise<void> | null;
}

/**
 * Drives one interactive CLI sign-in at a time: start the CLI, wait for the
 * link it prints, write the pasted code to its input, report how it ended.
 *
 * The link and the code exist only in the memory of this object while the
 * sign-in runs. They are never written to a log or a file, and both are
 * dropped as soon as the sign-in ends.
 *
 * Each sign-in is an Attempt. Every callback and every completion path names
 * the attempt it belongs to and does nothing when that attempt is no longer
 * the current one. A late callback of an old attempt can therefore never
 * touch the process or the timers of a newer one.
 */
export class LoginSession {
  private readonly options: Required<LoginSessionOptions>;
  private state: LoginState = { phase: "idle", url: null, message: null, deadline: null };
  private current: Attempt | null = null;
  private listeners = new Set<Listener>();
  private starting: Promise<LoginState> | null = null;
  /** Clean-ups of process groups whose CLI has ended by itself. */
  private lingering = new Set<Promise<void>>();

  constructor(options: LoginSessionOptions) {
    this.options = {
      resolveLaunch: options.resolveLaunch,
      loginArgs: options.loginArgs,
      allowedLinkHosts: options.allowedLinkHosts,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      linkTimeoutMs: options.linkTimeoutMs ?? DEFAULT_LINK_TIMEOUT_MS,
      killGraceMs: options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      exitGraceMs: options.exitGraceMs ?? DEFAULT_EXIT_GRACE_MS,
      now: options.now ?? Date.now,
    };
  }

  snapshot(): LoginState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.current !== null;
  }

  /**
   * Starts a sign-in, or returns the running one. A second process is never
   * started while an attempt exists, also not while that attempt is being
   * stopped. Resolves when the link is known or the sign-in has stopped.
   */
  start(): Promise<LoginState> {
    if (this.starting) return this.starting;
    if (this.current) return Promise.resolve(this.snapshot());
    this.starting = this.begin().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  /** Writes the pasted code to the CLI and resolves with the result of the sign-in. */
  async submitCode(rawCode: string): Promise<LoginState> {
    const attempt = this.current;
    // Controls and line separators could end the input line early. The same
    // rule is in the RPC contract; it is checked here again for other callers.
    const code = rawCode.trim();
    if (!attempt || !attempt.child || attempt.stopping || this.state.phase !== "awaiting_code") {
      throw new Error("No sign-in is waiting for a code. Start the sign-in again.");
    }
    if (!CODE_PATTERN.test(code)) {
      throw new Error("The code is empty or contains characters that are not allowed.");
    }
    attempt.submittedCode = code;
    attempt.output = "";
    this.setState({ phase: "verifying", url: null, message: null });
    const done = this.waitFor(() => this.current !== attempt);
    attempt.child.stdin.write(`${code}\n`);
    return done;
  }

  /** Stops a running sign-in. Does nothing when none is active. */
  async cancel(): Promise<LoginState> {
    const attempt = this.current;
    if (attempt) await this.finish(attempt, "cancelled", "The sign-in was cancelled.");
    return this.snapshot();
  }

  /** Stops the child process and forgets everything. Called when the plugin stops. */
  async dispose(): Promise<void> {
    const attempt = this.current;
    if (attempt) await this.finish(attempt, "cancelled", null);
    await Promise.all(this.lingering);
    this.listeners.clear();
  }

  /** Last resort for a process that exits without running cleanup. Synchronous. */
  killNow(): void {
    if (this.current?.child) signalProcess(this.current.child, "SIGKILL");
  }

  private async begin(): Promise<LoginState> {
    const attempt: Attempt = {
      child: null,
      timer: null,
      linkTimer: null,
      exitTimer: null,
      sawOtherLink: false,
      concluded: false,
      concludeNow: null,
      output: "",
      submittedCode: null,
      stopping: null,
    };
    this.current = attempt;
    const deadline = new Date(this.options.now() + this.options.timeoutMs).toISOString();
    this.setState({ phase: "starting", url: null, message: null, deadline });

    // The timers start before the launch is resolved. If that lookup never
    // answers, the link timer still ends the attempt.
    attempt.timer = setTimeout(() => {
      void this.finish(attempt, "timed_out", "The sign-in was not finished in time and was stopped.");
    }, this.options.timeoutMs);
    attempt.linkTimer = setTimeout(() => {
      if (this.current !== attempt || this.state.phase !== "starting") return;
      const message = attempt.sawOtherLink
        ? "The provider showed no sign-in link that this plugin accepts."
        : "The provider did not show a sign-in link.";
      void this.finish(attempt, "failed", message);
    }, this.options.linkTimeoutMs);

    let child: ChildProcessWithoutNullStreams;
    try {
      // Do not wait for the lookup longer than the attempt lives.
      const ended = this.waitFor(() => this.current !== attempt).then(() => null);
      const launch = await Promise.race([this.options.resolveLaunch(), ended]);
      // Cancelled or timed out while the launch was resolved: start nothing.
      if (!launch || this.current !== attempt || attempt.stopping) return this.snapshot();
      child = startProcess(launch, this.options.loginArgs);
    } catch {
      this.settle(attempt, "failed", "The provider command could not be started.");
      return this.snapshot();
    }
    attempt.child = child;

    const onData = (chunk: Buffer) => this.onOutput(attempt, chunk.toString("utf8"));
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.stdin.on("error", () => {});
    child.on("error", (error: NodeJS.ErrnoException) => {
      const message =
        error.code === "ENOENT"
          ? "The provider command was not found on the host."
          : "The provider command could not be started.";
      if (!attempt.stopping) this.settle(attempt, "failed", message);
    });
    // The CLI ended by itself. Its exit code is the result of the sign-in.
    const conclude = (exitCode: number | null) => {
      // An attempt that we stop is settled by finish(), not by its exit.
      if (attempt.stopping || attempt.concluded) return;
      attempt.concluded = true;
      releasePipes(child);
      // The CLI is gone. Stop what it left in its process group, so that a
      // sign-in leaves no process behind however it ended.
      const cleanup = stopGroup(child, this.options.killGraceMs);
      this.lingering.add(cleanup);
      void cleanup.then(() => this.lingering.delete(cleanup));
      if (exitCode === 0) {
        this.settle(attempt, "succeeded", null);
      } else {
        const secrets = attempt.submittedCode ? [attempt.submittedCode] : [];
        const detail = safeMessage(lastLines(attempt.output, 3), secrets);
        this.settle(attempt, "failed", detail || "The sign-in did not succeed.");
      }
    };
    // "close" comes when the pipes are closed, which is the normal case. A
    // helper that the CLI started can keep the pipes open long after the CLI
    // is gone. So "exit" also records the result, after a short time in which
    // the rest of the output can arrive.
    child.on("close", (exitCode) => conclude(exitCode));
    child.on("exit", (exitCode) => {
      attempt.concludeNow = () => conclude(exitCode);
      attempt.exitTimer = setTimeout(() => conclude(exitCode), this.options.exitGraceMs);
    });

    return this.waitFor((state) => this.current !== attempt || state.phase !== "starting");
  }

  private onOutput(attempt: Attempt, text: string): void {
    if (this.current !== attempt || attempt.stopping) return;
    attempt.output = (attempt.output + text).slice(-MAX_OUTPUT);
    if (this.state.phase !== "starting") return;
    // Wait until the CLI has printed a whole link. Output arrives in pieces.
    // A CLI can print other links first, for example an update notice. Links
    // that are not accepted are skipped, never shown. The link timer ends the
    // sign-in if no accepted link arrives.
    const links = findTerminatedUrls(attempt.output);
    const url = links.find((link) => isAllowedLoginLink(link, this.options.allowedLinkHosts));
    if (!url) {
      if (links.length > 0) attempt.sawOtherLink = true;
      return;
    }
    // Output before the code is not needed again. Drop it, it contains the link.
    attempt.output = "";
    this.setState({ phase: "awaiting_code", url });
  }

  /**
   * Ends an attempt from our side: stop its process, then record the result.
   * Single-flight: every caller for the same attempt gets the same promise,
   * and the first reason wins. The sign-in stays active until the process is
   * gone, so no new one can start in between.
   */
  private finish(attempt: Attempt, phase: LoginPhase, message: string | null): Promise<void> {
    if (attempt.stopping) return attempt.stopping;
    if (this.current !== attempt) return Promise.resolve();
    // The CLI has already ended by itself and its result is only waiting for
    // the rest of the output. That result is the truth: record it, and not a
    // cancel or a time-out that arrived a moment later.
    if (attempt.concludeNow) {
      attempt.concludeNow();
      return Promise.resolve();
    }
    attempt.stopping = (async () => {
      if (attempt.child) await stopProcess(attempt.child, this.options.killGraceMs);
      this.settle(attempt, phase, message);
    })();
    return attempt.stopping;
  }

  /** Records the end of an attempt and drops its link, code and output. */
  private settle(attempt: Attempt, phase: LoginPhase, message: string | null): void {
    if (attempt.timer) clearTimeout(attempt.timer);
    if (attempt.linkTimer) clearTimeout(attempt.linkTimer);
    if (attempt.exitTimer) clearTimeout(attempt.exitTimer);
    attempt.exitTimer = null;
    attempt.timer = null;
    attempt.linkTimer = null;
    attempt.child = null;
    attempt.output = "";
    attempt.submittedCode = null;
    // An attempt that is no longer the current one must not change the state.
    if (this.current !== attempt) return;
    this.current = null;
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
