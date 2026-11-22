import { createCliProvider } from "../core/cli-provider";
import type { Launch } from "../core/launch";
import { findFirstUrl } from "../core/text";
import { parseClaudeStatus } from "./status";

export const CLAUDE_DEFAULT_COMMAND = ["claude"] as const;

/**
 * Claude Code. Status comes from `claude auth status --json`. The sign-in is
 * `claude auth login`: it prints a link, the user approves in a browser and
 * pastes a code back. The command reads the code from its standard input and
 * needs no terminal.
 */
export function createClaudeProvider(resolveLaunch: () => Promise<Launch>) {
  return createCliProvider({
    id: "claude",
    label: "Claude Code",
    resolveLaunch,
    statusArgs: ["auth", "status", "--json"],
    parseStatus: parseClaudeStatus,
    loginArgs: ["auth", "login"],
    findLoginUrl: findFirstUrl,
  });
}
