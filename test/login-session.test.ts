import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LoginSession } from "../server/core/login-session";
import { fakeLaunch, isRunning, sleep } from "./helpers";

function session(
  env: Record<string, string> = {},
  options: { timeoutMs?: number; linkTimeoutMs?: number; exitGraceMs?: number } = {},
) {
  const { launch, pidFile } = fakeLaunch(env);
  let launches = 0;
  const login = new LoginSession({
    resolveLaunch: async () => {
      launches += 1;
      return launch;
    },
    loginArgs: ["auth", "login"],
    allowedLinkHosts: ["auth.example.test"],
    killGraceMs: 200,
    ...options,
  });
  return { login, pidFile, launches: () => launches };
}

describe("LoginSession", () => {
  it("starts idle", () => {
    const { login } = session();
    expect(login.snapshot()).toEqual({ phase: "idle", url: null, message: null, deadline: null });
  });

  it("shows the link, accepts the code and reports success", async () => {
    const { login, pidFile } = session();
    const started = await login.start();
    expect(started.phase).toBe("awaiting_code");
    expect(started.url).toBe("https://auth.example.test/authorize?state=fake-state&code_challenge=fake");
    expect(started.deadline).not.toBeNull();

    const done = await login.submitCode("  good-code  ");
    expect(done).toEqual({ phase: "succeeded", url: null, message: null, deadline: null });
    expect(isRunning(pidFile)).toBe(false);
  });

  it("reports a rejected code without the code or a link in the message", async () => {
    const { login } = session();
    await login.start();
    const done = await login.submitCode("secret-wrong-code");
    expect(done.phase).toBe("failed");
    expect(done.url).toBeNull();
    expect(done.message).toContain("Login failed");
    expect(done.message).not.toContain("secret-wrong-code");
    expect(done.message).not.toContain("https://");
  });

  it("runs one sign-in at a time", async () => {
    const { login, launches } = session();
    const [first, second] = await Promise.all([login.start(), login.start()]);
    const third = await login.start();
    expect(first.url).toBe(second.url);
    expect(third.phase).toBe("awaiting_code");
    expect(launches()).toBe(1);
    await login.cancel();
  });

  it("can start again after a sign-in ended", async () => {
    const { login, launches } = session();
    await login.start();
    await login.cancel();
    const again = await login.start();
    expect(again.phase).toBe("awaiting_code");
    expect(launches()).toBe(2);
    await login.cancel();
  });

  it("cancel stops the process and drops the link", async () => {
    const { login, pidFile } = session();
    await login.start();
    const cancelled = await login.cancel();
    expect(cancelled.phase).toBe("cancelled");
    expect(cancelled.url).toBeNull();
    expect(isRunning(pidFile)).toBe(false);
  });

  it("stops an unfinished sign-in after the time limit", async () => {
    const { login, pidFile } = session({}, { timeoutMs: 400 });
    await login.start();
    await sleep(900);
    expect(login.snapshot().phase).toBe("timed_out");
    expect(login.snapshot().url).toBeNull();
    expect(isRunning(pidFile)).toBe(false);
  });

  it("kills a process that ignores the stop signal", async () => {
    const { login, pidFile } = session({ FAKE_MODE: "stubborn" });
    await login.start();
    await login.cancel();
    expect(isRunning(pidFile)).toBe(false);
  });

  it("fails when the CLI shows no link", async () => {
    const { login, pidFile } = session({ FAKE_MODE: "no-link" }, { linkTimeoutMs: 400 });
    const started = await login.start();
    expect(started.phase).toBe("failed");
    expect(started.message).toBe("The provider did not show a sign-in link.");
    expect(isRunning(pidFile)).toBe(false);
  });

  it("fails cleanly when the command does not exist", async () => {
    const login = new LoginSession({
      resolveLaunch: async () => ({ command: "/nonexistent/provider-cli", args: [], env: {} }),
      loginArgs: ["auth", "login"],
      allowedLinkHosts: ["auth.example.test"],
    });
    const started = await login.start();
    expect(started).toEqual({
      phase: "failed",
      url: null,
      message: "The provider command was not found on the host.",
      deadline: null,
    });
  });

  it("rejects a code when no sign-in waits for one", async () => {
    const { login } = session();
    await expect(login.submitCode("x")).rejects.toThrow("No sign-in is waiting");
  });

  it("rejects an empty code and a code with control characters", async () => {
    const { login } = session();
    await login.start();
    await expect(login.submitCode("   ")).rejects.toThrow("not allowed");
    await expect(login.submitCode("a\nb")).rejects.toThrow("not allowed");
    // Unicode line separator, paragraph separator and C1 controls (NEL, CSI).
    for (const bad of ["a\u2028b", "a\u2029b", "a\u0085b", "a\u009bb", "a\u007fb"]) {
      await expect(login.submitCode(bad)).rejects.toThrow("not allowed");
    }
    expect(login.snapshot().phase).toBe("awaiting_code");
    await login.cancel();
  });

  it("dispose leaves no child process behind", async () => {
    const { login, pidFile } = session({ FAKE_MODE: "stubborn" });
    await login.start();
    await login.dispose();
    expect(isRunning(pidFile)).toBe(false);
  });
});

describe("LoginSession: sign-in link", () => {
  it("waits for the whole link when the output arrives in pieces", async () => {
    const { login } = session({ FAKE_MODE: "chunked" });
    const started = await login.start();
    expect(started.phase).toBe("awaiting_code");
    expect(started.url).toBe("https://auth.example.test/authorize?state=fake-state&code_challenge=fake");
    await login.cancel();
  });

  it.each([
    ["another host", "https://auth.example.test.evil.test/authorize?state=1"],
    ["plain http", "http://auth.example.test/authorize?state=1"],
    ["a user part before the host", "https://auth.example.test@evil.test/authorize"],
    ["a port", "https://auth.example.test:8443/authorize"],
  ])("never shows a link with %s, and fails when the link time ends", async (_name, link) => {
    const { login, pidFile } = session({ FAKE_LINK: link }, { linkTimeoutMs: 400 });
    const started = await login.start();
    expect(started.phase).toBe("failed");
    expect(started.url).toBeNull();
    expect(started.message).toBe("The provider showed no sign-in link that this plugin accepts.");
    expect(isRunning(pidFile)).toBe(false);
    expect(login.isActive()).toBe(false);
  });

  it("skips a link to another host and takes the accepted link that follows", async () => {
    const { login } = session({
      FAKE_PRELINK: "Update available: https://downloads.other.test/release-notes \nDocs: http://docs.other.test/x \n",
    });
    const started = await login.start();
    expect(started.phase).toBe("awaiting_code");
    expect(started.url).toBe("https://auth.example.test/authorize?state=fake-state&code_challenge=fake");
    expect((await login.submitCode("good-code")).phase).toBe("succeeded");
  });

  it("keeps waiting after another link, also when the accepted link arrives in pieces", async () => {
    const { login } = session({ FAKE_MODE: "chunked", FAKE_PRELINK: "See https://other.test/notice \n" });
    const started = await login.start();
    expect(started.url).toBe("https://auth.example.test/authorize?state=fake-state&code_challenge=fake");
    await login.cancel();
  });
});

describe("LoginSession: overlapping stops", () => {
  // Every launch gets its own pid file, so each started process can be checked.
  function tracked(env: Record<string, string>, options: { timeoutMs?: number } = {}) {
    const pidFiles: string[] = [];
    const login = new LoginSession({
      resolveLaunch: async () => {
        const { launch, pidFile } = fakeLaunch(env);
        pidFiles.push(pidFile);
        return launch;
      },
      loginArgs: ["auth", "login"],
      allowedLinkHosts: ["auth.example.test"],
      killGraceMs: 200,
      ...options,
    });
    return { login, pidFiles };
  }

  it("two cancels and a new start leave no process without an owner", async () => {
    const { login, pidFiles } = tracked({ FAKE_MODE: "stubborn" });
    await login.start();

    const first = login.cancel();
    const second = login.cancel();
    // While the old process is being stopped, start() must not begin a new one.
    const during = await login.start();
    expect(pidFiles).toHaveLength(1);
    expect(during.phase).toBe("awaiting_code");

    await second;
    const restarted = await login.start();
    await first;

    // The new sign-in is still the current one and still owns its process.
    expect(pidFiles).toHaveLength(2);
    expect(restarted.phase).toBe("awaiting_code");
    expect(login.snapshot().phase).toBe("awaiting_code");
    expect(login.isActive()).toBe(true);
    expect(isRunning(pidFiles[0])).toBe(false);
    expect(isRunning(pidFiles[1])).toBe(true);

    await login.cancel();
    expect(isRunning(pidFiles[1])).toBe(false);
    expect(login.snapshot().phase).toBe("cancelled");
  });

  it("a cancel during a time-out stop shares that stop, and the first reason wins", async () => {
    const { login, pidFiles } = tracked({ FAKE_MODE: "stubborn" }, { timeoutMs: 300 });
    await login.start();
    await sleep(350);
    // The time limit has started to stop the process. It needs 200 ms more.
    expect(login.isActive()).toBe(true);
    const cancelled = await login.cancel();
    expect(cancelled.phase).toBe("timed_out");
    expect(isRunning(pidFiles[0])).toBe(false);

    const restarted = await login.start();
    expect(restarted.phase).toBe("awaiting_code");
    await sleep(250);
    // No timer or late callback of the first attempt has touched the second.
    expect(login.snapshot().phase).toBe("awaiting_code");
    expect(isRunning(pidFiles[1])).toBe(true);
    await login.dispose();
    expect(isRunning(pidFiles[1])).toBe(false);
  });

  it("a cancel before the process exists starts nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const pidFiles: string[] = [];
    const login = new LoginSession({
      resolveLaunch: async () => {
        await gate;
        const { launch, pidFile } = fakeLaunch();
        pidFiles.push(pidFile);
        return launch;
      },
      loginArgs: ["auth", "login"],
      allowedLinkHosts: ["auth.example.test"],
    });
    const starting = login.start();
    expect((await login.cancel()).phase).toBe("cancelled");
    release();
    expect((await starting).phase).toBe("cancelled");
    await sleep(150);
    expect(login.isActive()).toBe(false);
    expect(() => readFileSync(pidFiles[0])).toThrow();
  });

  it("stops a sign-in although a helper process keeps the pipes open", async () => {
    const { login, pidFiles } = tracked({ FAKE_MODE: "helper" });
    await login.start();
    const before = Date.now();
    await login.cancel();
    expect(Date.now() - before).toBeLessThan(1500);
    expect(isRunning(pidFiles[0])).toBe(false);
  });
});

describe("LoginSession: the CLI ends by itself", () => {
  it("reports success soon after the exit, although a helper keeps the pipes open", async () => {
    const { login, pidFile } = session({ FAKE_EXIT_HELPER: "1" });
    await login.start();
    const before = Date.now();
    const done = await login.submitCode("good-code");
    expect(done).toEqual({ phase: "succeeded", url: null, message: null, deadline: null });
    expect(Date.now() - before).toBeLessThan(1500);
    expect(isRunning(pidFile)).toBe(false);
    expect(login.isActive()).toBe(false);
  });

  it("reports a rejected code with its message in the same situation", async () => {
    const { login } = session({ FAKE_EXIT_HELPER: "1" });
    await login.start();
    const before = Date.now();
    const done = await login.submitCode("wrong-code");
    expect(done.phase).toBe("failed");
    expect(done.message).toContain("Login failed");
    expect(done.message).not.toContain("wrong-code");
    expect(Date.now() - before).toBeLessThan(1500);
  });

  it("records the result once when exit and close both arrive", async () => {
    const { login } = session();
    const phases: string[] = [];
    await login.start();
    const done = login.submitCode("good-code");
    phases.push((await done).phase);
    await sleep(500);
    expect(login.snapshot().phase).toBe("succeeded");
    // A new sign-in is not disturbed by a late timer of the finished one.
    expect((await login.start()).phase).toBe("awaiting_code");
    await sleep(400);
    expect(login.snapshot().phase).toBe("awaiting_code");
    await login.cancel();
    expect(phases).toEqual(["succeeded"]);
  });
});

describe("LoginSession: process group", () => {
  it("kills a group member that ignores the stop signal after the CLI itself ended", async () => {
    const memberPidFile = join(mkdtempSync(join(tmpdir(), "sign-in-member-")), "pid");
    const { login, pidFile } = session({ FAKE_MODE: "member", FAKE_MEMBER_PID_FILE: memberPidFile });
    await login.start();
    expect(isRunning(memberPidFile)).toBe(true);
    await login.cancel();
    expect(isRunning(pidFile)).toBe(false);
    expect(isRunning(memberPidFile)).toBe(false);
  });
});

describe("LoginSession: review of the second pull request", () => {
  it("ends the attempt when the lookup of the launch never answers", async () => {
    const login = new LoginSession({
      resolveLaunch: () => new Promise(() => {}),
      loginArgs: ["auth", "login"],
      allowedLinkHosts: ["auth.example.test"],
      linkTimeoutMs: 300,
    });
    const started = await login.start();
    expect(started.phase).toBe("failed");
    expect(started.message).toBe("The provider did not show a sign-in link.");
    expect(login.isActive()).toBe(false);
  });

  it("records the real result when a cancel arrives just after the CLI ended with success", async () => {
    // The helper keeps the pipes open, so only the exit is known, and the
    // result waits for the rest of the output for 2 seconds.
    const { login } = session({ FAKE_EXIT_HELPER: "1" }, { exitGraceMs: 2000 });
    await login.start();
    const submitted = login.submitCode("good-code");
    await sleep(250);
    expect(login.snapshot().phase).toBe("verifying");
    const cancelled = await login.cancel();
    expect(cancelled.phase).toBe("succeeded");
    expect((await submitted).phase).toBe("succeeded");
  });

  it("records a rejected code, not a cancel, in the same situation", async () => {
    const { login } = session({ FAKE_EXIT_HELPER: "1" }, { exitGraceMs: 2000 });
    await login.start();
    const submitted = login.submitCode("wrong-code");
    await sleep(250);
    expect((await login.cancel()).phase).toBe("failed");
    expect((await submitted).message).toContain("Login failed");
  });

  it("stops a group member that outlives a sign-in that ended normally", async () => {
    const memberPidFile = join(mkdtempSync(join(tmpdir(), "sign-in-member-")), "pid");
    const { login } = session({ FAKE_EXIT_MEMBER: memberPidFile });
    await login.start();
    expect((await login.submitCode("good-code")).phase).toBe("succeeded");
    expect(isRunning(memberPidFile)).toBe(true);
    // dispose waits for the clean-up of the group: SIGTERM, then SIGKILL after 200 ms.
    await login.dispose();
    expect(isRunning(memberPidFile)).toBe(false);
  });

  it("stops that member also without a dispose", async () => {
    const memberPidFile = join(mkdtempSync(join(tmpdir(), "sign-in-member-")), "pid");
    const { login } = session({ FAKE_EXIT_MEMBER: memberPidFile });
    await login.start();
    await login.submitCode("good-code");
    await sleep(500);
    expect(isRunning(memberPidFile)).toBe(false);
  });
});
