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
// A link counts only when whitespace follows it, so a link that is still
// being printed is never taken.
const TERMINATED_URL = /https?:\/\/[^\s"'<>]+(?=\s)/;

/**
 * The first http(s) link in terminal output that is complete, or null. A link
 * is complete when whitespace or a line end follows it. Output can arrive in
 * pieces: text after an unfinished terminal sequence is not looked at.
 */
export function findTerminatedUrl(output: string): string | null {
  let text = output.replace(OSC, "").replace(CSI, "").replace(OTHER_ESCAPE, "");
  const unfinished = text.indexOf("\u001b");
  if (unfinished !== -1) text = text.slice(0, unfinished);
  const match = TERMINATED_URL.exec(text.replace(CONTROL, ""));
  return match ? match[0] : null;
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
