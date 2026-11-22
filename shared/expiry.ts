// Decides what the user is told about a sign-in. Plain functions, no runtime APIs.

export type NoticeLevel = "none" | "warning" | "ended" | "signed_out";

export interface Notice {
  level: NoticeLevel;
  // Whole days left, rounded up. Only for "warning" and "none" with a known end.
  daysLeft: number | null;
}

export interface ExpiryInput {
  state: "signed_in" | "signed_out" | "unavailable";
  expiresAt: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function noticeFor(status: ExpiryInput, nowMs: number, warnDays: number): Notice {
  if (status.state === "signed_out") return { level: "signed_out", daysLeft: null };
  if (status.state !== "signed_in" || !status.expiresAt) return { level: "none", daysLeft: null };
  const endMs = Date.parse(status.expiresAt);
  if (Number.isNaN(endMs)) return { level: "none", daysLeft: null };
  const leftMs = endMs - nowMs;
  if (leftMs <= 0) return { level: "ended", daysLeft: 0 };
  const daysLeft = Math.ceil(leftMs / DAY_MS);
  return { level: leftMs <= warnDays * DAY_MS ? "warning" : "none", daysLeft };
}

const SEVERITY: Record<NoticeLevel, number> = { none: 0, warning: 1, signed_out: 2, ended: 3 };

// The notice that matters most across all providers.
export function worstNotice(notices: readonly Notice[]): Notice {
  let worst: Notice = { level: "none", daysLeft: null };
  for (const notice of notices) {
    const moreSevere = SEVERITY[notice.level] > SEVERITY[worst.level];
    const sooner =
      notice.level === worst.level &&
      notice.daysLeft !== null &&
      (worst.daysLeft === null || notice.daysLeft < worst.daysLeft);
    if (moreSevere || sooner) worst = notice;
  }
  return worst;
}

export function timeLeftText(daysLeft: number): string {
  if (daysLeft <= 1) return "in less than a day";
  return `in ${daysLeft} days`;
}

export function noticeText(label: string, notice: Notice): string | null {
  switch (notice.level) {
    case "ended":
      return `${label} sign-in has ended`;
    case "signed_out":
      return `${label} is not signed in`;
    case "warning":
      return `${label} sign-in ends ${timeLeftText(notice.daysLeft ?? 0)}`;
    default:
      return null;
  }
}
