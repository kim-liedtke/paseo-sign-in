import { describe, expect, it } from "vitest";
import { isAllowedLoginLink, LOGIN_LINK_HOSTS } from "../shared/links";

const hosts = LOGIN_LINK_HOSTS.claude;

describe("isAllowedLoginLink", () => {
  it("accepts the sign-in link that Claude Code prints", () => {
    expect(
      isAllowedLoginLink("https://claude.com/cai/oauth/authorize?code=true&client_id=x&state=y", hosts),
    ).toBe(true);
    expect(isAllowedLoginLink("https://CLAUDE.com/cai/oauth/authorize", hosts)).toBe(true);
    expect(isAllowedLoginLink("https://claude.com", hosts)).toBe(true);
  });

  it.each([
    ["plain http", "http://claude.com/cai/oauth/authorize"],
    ["another host", "https://example.test/cai/oauth/authorize"],
    ["a host that only starts with the name", "https://claude.com.evil.test/authorize"],
    ["a host that only ends with the name", "https://evilclaude.com/authorize"],
    ["a subdomain that is not listed", "https://login.claude.com/authorize"],
    ["a user part", "https://claude.com@evil.test/authorize"],
    ["a user and password", "https://user:pass@claude.com/authorize"],
    ["a port", "https://claude.com:8443/authorize"],
    ["a backslash", "https://claude.com\\@evil.test/authorize"],
    ["a space", "https://claude.com/authorize ?x=1"],
    ["a line break", "https://claude.com/authorize\nhttps://evil.test"],
    ["a line separator", "https://claude.com/authorize\u2028"],
    ["a control character", "https://claude.com/\u0007authorize"],
    ["another scheme", "javascript:alert(1)"],
    ["no scheme", "claude.com/cai/oauth/authorize"],
    ["an empty text", ""],
  ])("refuses %s", (_name, link) => {
    expect(isAllowedLoginLink(link, hosts)).toBe(false);
  });

  it("refuses every link when no host is allowed", () => {
    expect(isAllowedLoginLink("https://claude.com/authorize", [])).toBe(false);
  });
});
