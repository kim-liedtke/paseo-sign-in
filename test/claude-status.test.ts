import { describe, expect, it } from "vitest";
import { createClaudeProvider } from "../server/claude/provider";
import { parseClaudeStatus } from "../server/claude/status";
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

  it("drops an end date that is not a date", () => {
    const status = parseClaudeStatus({ stdout: JSON.stringify({ loggedIn: true, loginExpiresAt: "soon" }) });
    expect(status.expiresAt).toBeNull();
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
    const { launch } = fakeLaunch();
    const provider = createClaudeProvider(async () => launch);
    expect(provider.loginState()).toMatchObject({ provider: "claude", phase: "idle" });
    const started = await provider.startLogin();
    expect(started).toMatchObject({ provider: "claude", phase: "awaiting_code" });
    expect((await provider.submitCode("good-code")).phase).toBe("succeeded");
    await provider.dispose();
  });
});
