import { describe, expect, it } from "vitest";
import { findFirstUrl, safeMessage, stripTerminalCodes } from "../server/core/text";

describe("stripTerminalCodes", () => {
  it("removes colors, hyperlinks and control characters", () => {
    const input = "\u001b[1mBold\u001b[0m \u001b]8;;https://a.test/x\u0007link\u001b]8;;\u0007\u0000 end";
    expect(stripTerminalCodes(input)).toBe("Bold link end");
  });

  it("removes a hyperlink closed with ESC backslash", () => {
    expect(stripTerminalCodes("\u001b]8;;https://a.test\u001b\\text\u001b]8;;\u001b\\")).toBe("text");
  });
});

describe("findFirstUrl", () => {
  it("finds the visible link inside a terminal hyperlink", () => {
    const link = "https://auth.example.test/authorize?code=true&state=abc";
    const output = `visit: \u001b]8;;${link}\u0007${link}\u001b]8;;\u0007\nPaste code > `;
    expect(findFirstUrl(output)).toBe(link);
  });

  it("returns null when there is no link yet", () => {
    expect(findFirstUrl("Opening browser to sign in…")).toBeNull();
  });

  it("ignores other schemes", () => {
    expect(findFirstUrl("file:///etc/passwd javascript:alert(1)")).toBeNull();
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
