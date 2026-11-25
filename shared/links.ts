import type { ProviderId } from "./providers";

// The hosts whose sign-in links the plugin accepts, for each provider. A link
// to any other host is refused on the daemon and again in the app.
// Claude Code prints its sign-in link on one of two hosts, by version. Both
// were seen in the output of `claude auth login`:
//   up to 2.1.326: https://claude.com/cai/oauth/authorize?...
//   2.1.332:       https://claude.ai/oauth/authorize?...
export const LOGIN_LINK_HOSTS: Record<ProviderId, readonly string[]> = {
  claude: ["claude.com", "claude.ai"],
};

// Backslash, whitespace, control characters (C0, DEL, C1) and the Unicode line
// separators have no place in a sign-in link.
const FORBIDDEN_IN_LINK = /[\\\s\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// The host of an accepted link is a plain name: no user, password or port.
const PLAIN_HOST = /^[a-z0-9.-]+$/;

/**
 * True when the link is an https link to one of the allowed hosts. It does
 * not use the URL class, so the daemon and the app decide in the same way.
 */
export function isAllowedLoginLink(link: string, allowedHosts: readonly string[]): boolean {
  if (FORBIDDEN_IN_LINK.test(link)) return false;
  const match = /^https:\/\/([^/?#]+)(?:[/?#].*)?$/.exec(link);
  if (!match) return false;
  const host = match[1].toLowerCase();
  return PLAIN_HOST.test(host) && allowedHosts.includes(host);
}
