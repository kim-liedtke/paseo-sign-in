import { describe, expect, it } from "vitest";
import { createClaudeProvider } from "../server/claude/provider";
import { parseClaudeStatus } from "../server/claude/status";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeLaunch } from "./helpers";

// Shaped like the output of `claude auth status --json`, with invented values.
const SIGNED_IN = JSON.stringify({
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
  loginExpiresAt: "2030-03-01T08:00:00.000Z",
  email: "user@example.test",
  orgId: "00000000-0000-0000-0000-000000000000",
  orgName: "Example Org",
  subscriptionType: "team",
  storedClaudeAiLogin: true,
});
const SIGNED_OUT = JSON.stringify({ loggedIn: false, authMethod: "none", loginExpiresAt: null });

describe("parseClaudeStatus", () => {
  it("reads a signed-in account", () => {
    expect(parseClaudeStatus({ stdout: SIGNED_IN })).toEqual({
      state: "signed_in",
      email: "user@example.test",
      organization: "Example Org",
      plan: "Team",
      method: "Claude account",
      expiresAt: "2030-03-01T08:00:00.000Z",
      detail: null,
    });
  });

  it("reads a signed-out state", () => {
    const status = parseClaudeStatus({ stdout: SIGNED_OUT });
    expect(status.state).toBe("signed_out");
    expect(status.email).toBeNull();
    expect(status.expiresAt).toBeNull();
  });

  it("accepts a sign-in without an end date or account details", () => {
    const status = parseClaudeStatus({ stdout: JSON.stringify({ loggedIn: true, authMethod: "api_key" }) });
    expect(status).toMatchObject({ state: "signed_in", method: "API key", expiresAt: null, email: null, plan: null });
  });

  it("keeps unknown plan and method names as they are", () => {
    const status = parseClaudeStatus({
      stdout: JSON.stringify({ loggedIn: true, authMethod: "new-method", subscriptionType: "ultra" }),
    });
    expect(status).toMatchObject({ plan: "ultra", method: "new-method" });
  });

  it("drops an end date that is not a date or not a string, and stays signed in", () => {
    for (const loginExpiresAt of ["soon", 1893456000000, { at: "2030-03-01" }, true, null]) {
      const status = parseClaudeStatus({ stdout: JSON.stringify({ loggedIn: true, loginExpiresAt }) });
      expect(status.state).toBe("signed_in");
      expect(status.expiresAt).toBeNull();
    }
  });

  it("reports unavailable for output it does not understand", () => {
    for (const stdout of ["", "Not logged in.", "[1,2]", "null", JSON.stringify({ email: "user@example.test" })]) {
      const status = parseClaudeStatus({ stdout });
      expect(status.state).toBe("unavailable");
      expect(status.detail).not.toBeNull();
      expect(status.email).toBeNull();
    }
  });
});

describe("Claude provider with a stand-in CLI", () => {
  it("runs the status command and returns the parsed status", async () => {
    const { launch } = fakeLaunch({ FAKE_STATUS: SIGNED_IN });
    const provider = createClaudeProvider(async () => launch);
    const status = await provider.status();
    expect(status).toMatchObject({
      provider: "claude",
      label: "Claude Code",
      state: "signed_in",
      plan: "Team",
      expiresAt: "2030-03-01T08:00:00.000Z",
    });
    expect(Number.isNaN(Date.parse(status.checkedAt))).toBe(false);
  });

  it("reads the signed-out state although the command exits with 1", async () => {
    const { launch } = fakeLaunch({ FAKE_STATUS: SIGNED_OUT, FAKE_STATUS_EXIT: "1" });
    const status = await createClaudeProvider(async () => launch).status();
    expect(status.state).toBe("signed_out");
  });

  it("reports unavailable when the command is missing", async () => {
    const provider = createClaudeProvider(async () => ({ command: "/nonexistent/claude", args: [], env: {} }));
    const status = await provider.status();
    expect(status).toMatchObject({ state: "unavailable", detail: "The provider command was not found on the host." });
  });

  it("signs in through the provider interface", async () => {
    const { launch } = fakeLaunch({ FAKE_LINK: "https://claude.com/cai/oauth/authorize?code=true&state=fake" });
    const provider = createClaudeProvider(async () => launch);
    expect(provider.loginState()).toMatchObject({ provider: "claude", phase: "idle" });
    const started = await provider.startLogin();
    expect(started).toMatchObject({ provider: "claude", phase: "awaiting_code" });
    expect((await provider.submitCode("good-code")).phase).toBe("succeeded");
    await provider.dispose();
  });
});

describe("Claude provider: sign-in link hosts", () => {
  it("refuses a link that is not on a Claude host", async () => {
    const { launch, pidFile } = fakeLaunch({ FAKE_LINK: "https://claude.com.evil.test/cai/oauth/authorize?state=1" });
    const provider = createClaudeProvider(async () => launch, { linkTimeoutMs: 400 });
    const started = await provider.startLogin();
    expect(started).toMatchObject({ phase: "failed", url: null });
    expect(() => process.kill(Number(readFileSync(pidFile, "utf8")), 0)).toThrow();
  });
});

describe("Claude provider: status cache", () => {
  const countRuns = (file: string) => {
    try {
      return readFileSync(file, "utf8").length;
    } catch {
      return 0;
    }
  };
  function counted(env: Record<string, string> = {}, statusCacheMs?: number) {
    const countFile = join(mkdtempSync(join(tmpdir(), "sign-in-count-")), "runs");
    const { launch } = fakeLaunch({
      FAKE_STATUS: SIGNED_IN,
      FAKE_COUNT_FILE: countFile,
      FAKE_LINK: "https://claude.com/cai/oauth/authorize?state=fake",
      ...env,
    });
    return { provider: createClaudeProvider(async () => launch, { statusCacheMs }), countFile };
  }

  it("shares one running status call between callers", async () => {
    const { provider, countFile } = counted({ FAKE_STATUS_DELAY: "200" });
    const answers = await Promise.all([provider.status(), provider.status(), provider.status()]);
    expect(countRuns(countFile)).toBe(1);
    expect(answers.every((answer) => answer.checkedAt === answers[0].checkedAt)).toBe(true);
  });

  it("reuses an answer for a few seconds, then asks again", async () => {
    const { provider, countFile } = counted({}, 300);
    await provider.status();
    await provider.status();
    expect(countRuns(countFile)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 350));
    await provider.status();
    expect(countRuns(countFile)).toBe(2);
  });

  it("shares a running call also when it runs longer than the cache time", async () => {
    const { provider, countFile } = counted({ FAKE_STATUS_DELAY: "500" }, 100);
    const first = provider.status();
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 300 ms is past the cache time of 100 ms, but the first call still runs.
    const second = provider.status();
    expect((await second).checkedAt).toBe((await first).checkedAt);
    expect(countRuns(countFile)).toBe(1);
    // The cache time counts from the answer, not from the start of the call.
    await provider.status();
    expect(countRuns(countFile)).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await provider.status();
    expect(countRuns(countFile)).toBe(2);
  });

  it("gives up a status call whose launch lookup never answers, and the next call starts fresh", async () => {
    const { launch } = fakeLaunch({ FAKE_STATUS: SIGNED_IN });
    let lookups = 0;
    const provider = createClaudeProvider(
      () => {
        lookups += 1;
        // The first lookup hangs for ever. Later ones answer.
        return lookups === 1 ? new Promise(() => {}) : Promise.resolve(launch);
      },
      { launchTimeoutMs: 200, statusCacheMs: 0 },
    );
    const before = Date.now();
    const [first, shared] = await Promise.all([provider.status(), provider.status()]);
    expect(Date.now() - before).toBeLessThan(1000);
    expect(first).toMatchObject({ state: "unavailable", detail: "The status could not be read." });
    expect(shared.checkedAt).toBe(first.checkedAt);
    expect(lookups).toBe(1);

    const next = await provider.status();
    expect(next.state).toBe("signed_in");
    expect(lookups).toBe(2);
  });

  it("asks again after a sign-in step, because that changes the status", async () => {
    const { provider, countFile } = counted();
    await provider.status();
    await provider.startLogin();
    await provider.cancel();
    await provider.status();
    expect(countRuns(countFile)).toBe(2);
  });

  it("answers although a helper process keeps the pipes of the status command open", async () => {
    const { provider } = counted({ FAKE_HELPER: "1" });
    const before = Date.now();
    const status = await provider.status();
    expect(status.state).toBe("signed_in");
    expect(Date.now() - before).toBeLessThan(2000);
  });
});
