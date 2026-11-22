// Helpers for text that a CLI prints for a terminal.

// OSC sequences (for example terminal hyperlinks): ESC ] ... BEL or ESC ] ... ESC \
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;
// CSI sequences (colors, cursor movement) and other two-character escapes.
const CSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const OTHER_ESCAPE = /\u001b[@-Z\\-_]/g;
// Control characters except tab, newline and carriage return.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

export function stripTerminalCodes(text: string): string {
  return text.replace(OSC, "").replace(CSI, "").replace(OTHER_ESCAPE, "").replace(CONTROL, "");
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g;

/** The first http(s) link in terminal output, or null. */
export function findFirstUrl(text: string): string | null {
  const match = stripTerminalCodes(text).match(URL_PATTERN);
  if (!match) return null;
  try {
    const url = new URL(match[0]);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Makes CLI output safe to show as a result message: no terminal codes, no
 * links, none of the given secrets, one line, limited length.
 */
export function safeMessage(text: string, secrets: readonly string[] = [], maxLength = 300): string {
  let clean = stripTerminalCodes(text).replace(URL_PATTERN, "[link removed]");
  for (const secret of secrets) {
    if (secret.length > 0) clean = clean.split(secret).join("[removed]");
  }
  clean = clean.replace(/\s+/g, " ").trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean;
}
