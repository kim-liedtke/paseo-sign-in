import { createCliProvider } from "../core/cli-provider";
import type { Launch } from "../core/launch";
import { LOGIN_LINK_HOSTS } from "../../shared/links";
import { parseClaudeStatus } from "./status";

export const CLAUDE_DEFAULT_COMMAND = ["claude"] as const;

/**
 * Claude Code. Status comes from `claude auth status --json`. The sign-in is
 * `claude auth login`: it prints a link, the user approves in a browser and
 * pastes a code back. The command reads the code from its standard input and
 * needs no terminal.
 */
export function createClaudeProvider(
  resolveLaunch: () => Promise<Launch>,
  overrides: {
    statusCacheMs?: number;
    statusTimeoutMs?: number;
    launchTimeoutMs?: number;
    linkTimeoutMs?: number;
  } = {},
) {
  return createCliProvider({
    id: "claude",
    label: "Claude Code",
    resolveLaunch,
    statusArgs: ["auth", "status", "--json"],
    parseStatus: parseClaudeStatus,
    loginArgs: ["auth", "login"],
    loginLinkHosts: LOGIN_LINK_HOSTS.claude,
    ...overrides,
  });
}
