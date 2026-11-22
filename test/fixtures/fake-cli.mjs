// A stand-in for a provider CLI, used by the tests. It needs no account.
// FAKE_MODE selects the behavior; see the cases below.
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const mode = process.env.FAKE_MODE ?? "login";
const args = process.argv.slice(2).join(" ");
if (process.env.FAKE_PID_FILE) writeFileSync(process.env.FAKE_PID_FILE, String(process.pid));

const LINK = process.env.FAKE_LINK ?? "https://auth.example.test/authorize?state=fake-state&code_challenge=fake";
// FAKE_PRELINK: text that the CLI prints first, for example a notice with another link.
const BEFORE = (process.env.FAKE_PRELINK ?? "") + "Opening browser to sign in…\nIf the browser didn't open, visit: ";
// Terminal hyperlink (OSC 8) around the visible link, as real CLIs print it.
const HYPERLINK = `\u001b]8;;${LINK}\u0007${LINK}\u001b]8;;\u0007`;
const AFTER = "\nPaste code here if prompted > ";
const printLink = () => process.stdout.write(BEFORE + HYPERLINK + AFTER);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A helper process in its own process group that keeps our output pipes open
// for a while, like a browser opener that outlives the CLI.
const startHelper = () =>
  spawn(process.execPath, ["-e", "setTimeout(() => {}, 4000)"], {
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  }).unref();

if (args.startsWith("auth status")) {
  if (process.env.FAKE_COUNT_FILE) appendFileSync(process.env.FAKE_COUNT_FILE, "x");
  if (process.env.FAKE_HELPER) startHelper();
  await sleep(Number(process.env.FAKE_STATUS_DELAY ?? 0));
  process.stdout.write(process.env.FAKE_STATUS ?? "{}");
  process.exit(Number(process.env.FAKE_STATUS_EXIT ?? 0));
} else if (mode === "no-link") {
  setInterval(() => {}, 1000);
} else if (mode === "stubborn") {
  // Prints the link, then ignores its input and SIGTERM.
  process.on("SIGTERM", () => {});
  printLink();
  setInterval(() => {}, 1000);
} else if (mode === "helper") {
  startHelper();
  printLink();
  setInterval(() => {}, 1000);
} else if (mode === "member") {
  // Starts a helper in the same process group that ignores SIGTERM and holds
  // no pipes. The CLI itself ends on SIGTERM.
  const file = process.env.FAKE_MEMBER_PID_FILE;
  spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", file],
    { stdio: "ignore" },
  ).unref();
  while (!existsSync(file)) await sleep(20);
  printLink();
  setInterval(() => {}, 1000);
} else if (mode === "chunked") {
  // Prints the link in pieces: cut inside the hyperlink sequence, and twice
  // inside the visible link. The link is complete only with the last piece.
  const text = BEFORE + HYPERLINK;
  const visibleStart = text.lastIndexOf(LINK);
  const cuts = [BEFORE.length + 20, visibleStart + 12, visibleStart + LINK.length - 9];
  let from = 0;
  for (const cut of cuts) {
    process.stdout.write(text.slice(from, cut));
    from = cut;
    await sleep(120);
  }
  process.stdout.write(text.slice(from));
  await sleep(120);
  process.stdout.write(AFTER);
  setInterval(() => {}, 1000);
} else {
  printLink();
  const lines = createInterface({ input: process.stdin });
  lines.once("line", async (code) => {
    // FAKE_EXIT_HELPER: a helper keeps the output pipes open after the CLI exits.
    if (process.env.FAKE_EXIT_HELPER) startHelper();
    // FAKE_EXIT_MEMBER: a process in the CLI's own group outlives the CLI and ignores SIGTERM.
    if (process.env.FAKE_EXIT_MEMBER) {
      const file = process.env.FAKE_EXIT_MEMBER;
      spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM',()=>{});require('fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000)", file],
        { stdio: "ignore" },
      ).unref();
      while (!existsSync(file)) await sleep(20);
    }
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
