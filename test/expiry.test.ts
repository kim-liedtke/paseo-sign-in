import { describe, expect, it } from "vitest";
import {
  needsAction,
  nextAnnouncement,
  noticeFor,
  noticeText,
  overallNotice,
  worstNotice,
  type ExpiryInput,
} from "../shared/expiry";

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

  it("reports signed out", () => {
    expect(noticeFor({ state: "signed_out", expiresAt: null }, now, 7).level).toBe("signed_out");
  });

  it("never reads a missing or unreadable end date as nothing to do", () => {
    expect(noticeFor({ state: "unavailable", expiresAt: null }, now, 7).level).toBe("unavailable");
    expect(noticeFor(signedIn(null), now, 7).level).toBe("no_end_date");
    expect(noticeFor(signedIn("not a date"), now, 7).level).toBe("no_end_date");
    for (const value of [undefined, 1893456000000, {}, true]) {
      const input = { state: "signed_in", expiresAt: value } as unknown as ExpiryInput;
      expect(noticeFor(input, now, 7).level).toBe("no_end_date");
    }
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
    expect(noticeText("Claude Code", { level: "no_end_date", daysLeft: null })).toBe(
      "Claude Code reports no end date for the sign-in",
    );
    expect(noticeText("Claude Code", { level: "unavailable", daysLeft: null })).toBe(
      "Claude Code sign-in status is not available",
    );
  });

  it("ranks the unknown states above fine and below the states that need action", () => {
    const unknown = { level: "no_end_date" as const, daysLeft: null };
    const unavailable = { level: "unavailable" as const, daysLeft: null };
    expect(worstNotice([{ level: "none", daysLeft: 30 }, unknown]).level).toBe("no_end_date");
    expect(worstNotice([unknown, unavailable]).level).toBe("unavailable");
    expect(worstNotice([unavailable, { level: "warning", daysLeft: 2 }]).level).toBe("warning");
    expect(needsAction("no_end_date")).toBe(false);
    expect(needsAction("unavailable")).toBe(false);
    expect(["warning", "ended", "signed_out"].every((level) => needsAction(level as "warning"))).toBe(true);
  });
});

describe("overallNotice", () => {
  const fine = signedIn("2030-02-10T12:00:00.000Z");
  const soon = signedIn("2030-01-12T12:00:00.000Z");

  it("shows a failed status call as unavailable, also when an old answer exists", () => {
    expect(overallNotice(undefined, true, now, 7).level).toBe("unavailable");
    expect(overallNotice([fine], true, now, 7).level).toBe("unavailable");
    expect(overallNotice([soon], true, now, 7).level).toBe("unavailable");
  });

  it("shows nothing before the first answer", () => {
    expect(overallNotice(undefined, false, now, 7).level).toBe("none");
  });

  it("shows the worst state of the providers when the call worked", () => {
    expect(overallNotice([fine], false, now, 7).level).toBe("none");
    expect(overallNotice([fine, soon], false, now, 7)).toEqual({ level: "warning", daysLeft: 2 });
  });
});

describe("nextAnnouncement", () => {
  const message = "Claude Code is not signed in";

  it("announces a message once", () => {
    expect(nextAnnouncement(null, message, false)).toEqual({ announce: message, remembered: message });
    expect(nextAnnouncement(message, message, false)).toEqual({ announce: null, remembered: message });
  });

  it("does not repeat the message after a failed status call", () => {
    let state = nextAnnouncement(null, message, false);
    // The call fails. Depending on the cache there is an old answer or none.
    state = nextAnnouncement(state.remembered, message, true);
    expect(state.announce).toBeNull();
    state = nextAnnouncement(state.remembered, "", true);
    expect(state.announce).toBeNull();
    // The call works again and reports the same state.
    state = nextAnnouncement(state.remembered, message, false);
    expect(state).toEqual({ announce: null, remembered: message });
  });

  it("announces again when the message changes or comes back after the state was fine", () => {
    const other = "Claude Code sign-in has ended";
    expect(nextAnnouncement(message, other, false)).toEqual({ announce: other, remembered: other });
    const fine = nextAnnouncement(message, "", false);
    expect(fine).toEqual({ announce: null, remembered: null });
    expect(nextAnnouncement(fine.remembered, message, false).announce).toBe(message);
  });
});
