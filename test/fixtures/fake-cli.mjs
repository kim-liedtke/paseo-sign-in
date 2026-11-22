// A stand-in for a provider CLI, used by the tests. It needs no account.
// FAKE_MODE selects the behavior; see the cases below.
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "login";
const args = process.argv.slice(2).join(" ");
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));

const LINK = "https://auth.example.test/authorize?state=fake-state&code_challenge=fake";
// Terminal hyperlink (OSC 8) around the visible link, as real CLIs print it.
const printLink = () =>
  process.stdout.write(
    `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${LINK}\u0007${LINK}\u001b]8;;\u0007\nPaste code here if prompted > `,
  );

if (args.startsWith("auth status")) {
  process.stdout.write(process.env.FAKE_STATUS ?? "{}");
  process.exit(Number(process.env.FAKE_STATUS_EXIT ?? 0));
} else if (mode === "no-link") {
  setInterval(() => {}, 1000);
} else if (mode === "stubborn") {
  // Prints the link, then ignores its input and SIGTERM.
  process.on("SIGTERM", () => {});
  printLink();
  setInterval(() => {}, 1000);
} else {
  printLink();
  const lines = createInterface({ input: process.stdin });
  lines.once("line", (code) => {
    if (code === "good-code") {
      process.stdout.write("Login successful.\n");
      process.exit(0);
    }
    process.stderr.write(
      `Login failed: the code ${code} wasn't accepted. See https://auth.example.test/help\n`,
    );
    process.exit(1);
  });
}
