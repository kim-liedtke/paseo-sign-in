import { describe, expect, it } from "vitest";
import { findTerminatedUrl, safeMessage, stripTerminalCodes } from "../server/core/text";

describe("stripTerminalCodes", () => {
  it("removes colors, hyperlinks and control characters", () => {
    const input = "\u001b[1mBold\u001b[0m \u001b]8;;https://a.test/x\u0007link\u001b]8;;\u0007\u0000 end";
    expect(stripTerminalCodes(input)).toBe("Bold link end");
  });

  it("removes a hyperlink closed with ESC backslash", () => {
    expect(stripTerminalCodes("\u001b]8;;https://a.test\u001b\\text\u001b]8;;\u001b\\")).toBe("text");
  });
});

describe("findTerminatedUrl", () => {
  const link = "https://auth.example.test/authorize?code=true&state=abc";
  const whole = `visit: \u001b]8;;${link}\u0007${link}\u001b]8;;\u0007\nPaste code > `;

  it("finds the visible link inside a terminal hyperlink", () => {
    expect(findTerminatedUrl(whole)).toBe(link);
  });

  it("returns null for every unfinished piece of the output, and the link only at its end", () => {
    const end = whole.indexOf("\nPaste");
    for (let length = 0; length <= end; length += 1) {
      expect(findTerminatedUrl(whole.slice(0, length))).toBeNull();
    }
    expect(findTerminatedUrl(whole.slice(0, end + 1))).toBe(link);
  });

  it("does not take a link that no whitespace follows", () => {
    expect(findTerminatedUrl("visit: https://auth.example.test/auth")).toBeNull();
    expect(findTerminatedUrl("visit: https://auth.example.test/auth ")).toBe("https://auth.example.test/auth");
  });

  it("returns the first complete link, whatever its host or scheme", () => {
    expect(findTerminatedUrl("see http://other.test/a and https://auth.example.test/b \n")).toBe("http://other.test/a");
  });

  it("returns null when there is no link", () => {
    expect(findTerminatedUrl("Opening browser to sign in…\n")).toBeNull();
    expect(findTerminatedUrl("file:///etc/passwd javascript:alert(1) \n")).toBeNull();
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
