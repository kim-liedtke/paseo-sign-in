import { describe, expect, it } from "vitest";
import { findTerminatedUrls, safeMessage, stripTerminalCodes } from "../server/core/text";

describe("stripTerminalCodes", () => {
  it("removes colors, hyperlinks and control characters", () => {
    const input = "\u001b[1mBold\u001b[0m \u001b]8;;https://a.test/x\u0007link\u001b]8;;\u0007\u0000 end";
    expect(stripTerminalCodes(input)).toBe("Bold link end");
  });

  it("removes a hyperlink closed with ESC backslash", () => {
    expect(stripTerminalCodes("\u001b]8;;https://a.test\u001b\\text\u001b]8;;\u001b\\")).toBe("text");
  });
});

describe("findTerminatedUrls", () => {
  const link = "https://auth.example.test/authorize?code=true&state=abc";
  const whole = `visit: \u001b]8;;${link}\u0007${link}\u001b]8;;\u0007\nPaste code > `;

  it("finds the visible link inside a terminal hyperlink", () => {
    expect(findTerminatedUrls(whole)).toEqual([link]);
  });

  it("returns nothing for every unfinished piece of the output, and the link only at its end", () => {
    const end = whole.indexOf("\nPaste");
    for (let length = 0; length <= end; length += 1) {
      expect(findTerminatedUrls(whole.slice(0, length))).toEqual([]);
    }
    expect(findTerminatedUrls(whole.slice(0, end + 1))).toEqual([link]);
  });

  it("does not take a link that no whitespace follows", () => {
    expect(findTerminatedUrls("visit: https://auth.example.test/auth")).toEqual([]);
    expect(findTerminatedUrls("visit: https://auth.example.test/auth ")).toEqual(["https://auth.example.test/auth"]);
  });

  it("returns every complete link in order, whatever its host or scheme", () => {
    const output = "update: http://other.test/a \nvisit: https://auth.example.test/b \nmore https://unfinished.test/c";
    expect(findTerminatedUrls(output)).toEqual(["http://other.test/a", "https://auth.example.test/b"]);
  });

  it("returns nothing when there is no link", () => {
    expect(findTerminatedUrls("Opening browser to sign in…\n")).toEqual([]);
    expect(findTerminatedUrls("file:///etc/passwd javascript:alert(1) \n")).toEqual([]);
  });
});

describe("safeMessage", () => {
  it("removes links and secrets and joins lines", () => {
    const message = safeMessage("Login failed:\n code abc123 see https://a.test/x?y=1", ["abc123"]);
    expect(message).toBe("Login failed: code [removed] see [link removed]");
  });

  it("limits the length", () => {
    expect(safeMessage("x".repeat(500)).length).toBe(300);
  });
});
