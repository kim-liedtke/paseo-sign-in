import { describe, expect, it } from "vitest";
import { LoginSession } from "../server/core/login-session";
import { findFirstUrl } from "../server/core/text";
import { fakeLaunch, isRunning, sleep } from "./helpers";

function session(env: Record<string, string> = {}, options: { timeoutMs?: number; linkTimeoutMs?: number } = {}) {
  const { launch, pidFile } = fakeLaunch(env);
  let launches = 0;
  const login = new LoginSession({
    resolveLaunch: async () => {
      launches += 1;
      return launch;
    },
    loginArgs: ["auth", "login"],
    findUrl: findFirstUrl,
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
      findUrl: findFirstUrl,
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
