import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createClaudeProvider } from "../server/claude/provider";

// Opt-in: runs the installed `claude` CLI. It needs no account and touches no
// existing sign-in, because the CLI is pointed at a new, empty config folder.
//   SIGN_IN_REAL_CLI=1 npm test
const enabled = process.env.SIGN_IN_REAL_CLI === "1";

describe.skipIf(!enabled)("installed Claude Code CLI, empty config folder", () => {
  const configDir = mkdtempSync(join(tmpdir(), "sign-in-real-"));
  const provider = createClaudeProvider(async () => ({
    // SIGN_IN_REAL_CLI_COMMAND: test another Claude Code binary than the one on PATH.
    command: process.env.SIGN_IN_REAL_CLI_COMMAND ?? "claude",
    args: [],
    // BROWSER points at a no-op so the test opens no browser window.
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir, BROWSER: "true" },
  }));

  it("reports signed out", async () => {
    const status = await provider.status();
    expect(status.state).toBe("signed_out");
  });

  it("shows a link without a terminal and rejects a wrong code", async () => {
    const started = await provider.startLogin();
    expect(started.phase).toBe("awaiting_code");
    expect(new URL(started.url!).protocol).toBe("https:");
    expect(["claude.com", "claude.ai"]).toContain(new URL(started.url!).hostname);

    const done = await provider.submitCode("not-a-real-code#not-a-real-state");
    expect(done.phase).toBe("failed");
    expect(done.url).toBeNull();
    expect(done.message).not.toContain("not-a-real-code");
    expect(done.message).not.toContain("https://");
  }, 60_000);

  it("can be cancelled while it waits for the code", async () => {
    const started = await provider.startLogin();
    expect(started.phase).toBe("awaiting_code");
    expect((await provider.cancel()).phase).toBe("cancelled");
    expect(provider.loginState().url).toBeNull();
    await provider.dispose();
  }, 60_000);
});
