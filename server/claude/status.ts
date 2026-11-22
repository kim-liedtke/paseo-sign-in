import { UNAVAILABLE, type StatusFields } from "../core/cli-provider";
import type { RunResult } from "../core/process";

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isoTime(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

const PLAN_NAMES: Record<string, string> = {
  free: "Free",
  pro: "Pro",
  max: "Max",
  team: "Team",
  enterprise: "Enterprise",
};

const METHOD_NAMES: Record<string, string> = {
  "claude.ai": "Claude account",
  console: "Console account",
  api_key: "API key",
  oauth_token: "Long-lived token",
};

/**
 * Reads the output of `claude auth status --json`. The command exits with 1
 * when nobody is signed in and still prints JSON, so the exit code is not
 * used. Unknown fields are ignored.
 */
export function parseClaudeStatus(result: Pick<RunResult, "stdout">): StatusFields {
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    return {
      ...UNAVAILABLE,
      detail: "The status output was not understood. The Claude Code version may be too old.",
    };
  }
  if (typeof data.loggedIn !== "boolean") {
    return { ...UNAVAILABLE, detail: "The status output has no sign-in state." };
  }
  if (!data.loggedIn) {
    return { ...UNAVAILABLE, state: "signed_out" };
  }
  const plan = text(data.subscriptionType);
  const method = text(data.authMethod);
  return {
    state: "signed_in",
    email: text(data.email),
    organization: text(data.orgName),
    plan: plan ? (PLAN_NAMES[plan.toLowerCase()] ?? plan) : null,
    method: method ? (METHOD_NAMES[method] ?? method) : null,
    expiresAt: isoTime(data.loginExpiresAt),
    detail: null,
  };
}
