import { describe, expect, it } from "vitest";
import { noticeFor, noticeText, worstNotice } from "../shared/expiry";

const now = Date.parse("2030-01-10T12:00:00.000Z");
const signedIn = (expiresAt: string | null) => ({ state: "signed_in" as const, expiresAt });

describe("noticeFor", () => {
  it("is quiet when the end is far away", () => {
    expect(noticeFor(signedIn("2030-02-10T12:00:00.000Z"), now, 7)).toEqual({ level: "none", daysLeft: 31 });
  });

  it("warns inside the warning window, including its edge", () => {
    expect(noticeFor(signedIn("2030-01-17T12:00:00.000Z"), now, 7)).toEqual({ level: "warning", daysLeft: 7 });
    expect(noticeFor(signedIn("2030-01-17T12:00:01.000Z"), now, 7).level).toBe("none");
    expect(noticeFor(signedIn("2030-01-10T18:00:00.000Z"), now, 7)).toEqual({ level: "warning", daysLeft: 1 });
  });

  it("follows the configured number of days", () => {
    expect(noticeFor(signedIn("2030-01-20T12:00:00.000Z"), now, 14).level).toBe("warning");
    expect(noticeFor(signedIn("2030-01-20T12:00:00.000Z"), now, 3).level).toBe("none");
  });

  it("reports an ended sign-in", () => {
    expect(noticeFor(signedIn("2030-01-10T12:00:00.000Z"), now, 7)).toEqual({ level: "ended", daysLeft: 0 });
    expect(noticeFor(signedIn("2029-12-01T00:00:00.000Z"), now, 7).level).toBe("ended");
  });

  it("reports signed out, and stays quiet when the state is unknown", () => {
    expect(noticeFor({ state: "signed_out", expiresAt: null }, now, 7).level).toBe("signed_out");
    expect(noticeFor({ state: "unavailable", expiresAt: null }, now, 7).level).toBe("none");
    expect(noticeFor(signedIn(null), now, 7).level).toBe("none");
    expect(noticeFor(signedIn("not a date"), now, 7).level).toBe("none");
  });
});

describe("worstNotice", () => {
  it("picks the most severe, then the soonest", () => {
    expect(worstNotice([]).level).toBe("none");
    expect(
      worstNotice([
        { level: "warning", daysLeft: 5 },
        { level: "ended", daysLeft: 0 },
        { level: "none", daysLeft: 30 },
      ]).level,
    ).toBe("ended");
    expect(
      worstNotice([
        { level: "warning", daysLeft: 5 },
        { level: "warning", daysLeft: 2 },
      ]).daysLeft,
    ).toBe(2);
  });
});

describe("noticeText", () => {
  it("writes the notice", () => {
    expect(noticeText("Claude Code", { level: "warning", daysLeft: 3 })).toBe("Claude Code sign-in ends in 3 days");
    expect(noticeText("Claude Code", { level: "warning", daysLeft: 1 })).toBe(
      "Claude Code sign-in ends in less than a day",
    );
    expect(noticeText("Claude Code", { level: "ended", daysLeft: 0 })).toBe("Claude Code sign-in has ended");
    expect(noticeText("Claude Code", { level: "signed_out", daysLeft: null })).toBe("Claude Code is not signed in");
    expect(noticeText("Claude Code", { level: "none", daysLeft: 30 })).toBeNull();
  });
});
