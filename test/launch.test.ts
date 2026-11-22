import { describe, expect, it } from "vitest";
import { resolveLaunch } from "../server/core/launch";

const base = { PATH: "/usr/bin", HOME: "/home/user" };

describe("resolveLaunch", () => {
  it("uses the default command when nothing is configured", () => {
    expect(resolveLaunch(["claude"], undefined, base)).toEqual({ command: "claude", args: [], env: base });
  });

  it("uses a configured command and keeps its arguments", () => {
    const launch = resolveLaunch(["claude"], { command: ["/opt/nightly/claude", "--flag"] }, base);
    expect(launch.command).toBe("/opt/nightly/claude");
    expect(launch.args).toEqual(["--flag"]);
  });

  it("adds configured environment variables over the base environment", () => {
    const launch = resolveLaunch(["claude"], { env: { CLAUDE_CONFIG_DIR: "/data/profile", PATH: "/opt/bin" } }, base);
    expect(launch.env).toEqual({ PATH: "/opt/bin", HOME: "/home/user", CLAUDE_CONFIG_DIR: "/data/profile" });
    expect(base.PATH).toBe("/usr/bin");
  });

  it("ignores a malformed configuration", () => {
    for (const config of [null, "claude", { command: [] }, { command: "claude" }, { command: [""] }, { env: "x" }]) {
      expect(resolveLaunch(["claude"], config, base)).toEqual({ command: "claude", args: [], env: base });
    }
    expect(resolveLaunch(["claude"], { env: { A: 1, B: "ok" } }, base).env).toEqual({ ...base, B: "ok" });
  });
});
