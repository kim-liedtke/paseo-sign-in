// Decides what the user is told about a sign-in. Plain functions, no runtime APIs.

// "no_end_date": signed in, but the provider reported no usable end date.
// "unavailable": the status could not be read at all.
export type NoticeLevel = "none" | "no_end_date" | "unavailable" | "warning" | "ended" | "signed_out";

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
  if (status.state !== "signed_in") return { level: "unavailable", daysLeft: null };
  // Never read a missing or unreadable end date as "nothing to do".
  if (typeof status.expiresAt !== "string") return { level: "no_end_date", daysLeft: null };
  const endMs = Date.parse(status.expiresAt);
  if (Number.isNaN(endMs)) return { level: "no_end_date", daysLeft: null };
  const leftMs = endMs - nowMs;
  if (leftMs <= 0) return { level: "ended", daysLeft: 0 };
  const daysLeft = Math.ceil(leftMs / DAY_MS);
  return { level: leftMs <= warnDays * DAY_MS ? "warning" : "none", daysLeft };
}

const SEVERITY: Record<NoticeLevel, number> = {
  none: 0,
  no_end_date: 1,
  unavailable: 2,
  warning: 3,
  signed_out: 4,
  ended: 5,
};

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

/**
 * The one notice for the sidebar row. A status call that failed is shown as
 * "unavailable": an old answer must not look like the current state. Before
 * the first answer there is nothing to show.
 */
export function overallNotice(
  statuses: readonly ExpiryInput[] | undefined,
  callFailed: boolean,
  nowMs: number,
  warnDays: number,
): Notice {
  if (callFailed) return { level: "unavailable", daysLeft: null };
  return worstNotice((statuses ?? []).map((status) => noticeFor(status, nowMs, warnDays)));
}

/** True for the states that the user must act on. Only these raise a toast. */
export function needsAction(level: NoticeLevel): boolean {
  return level === "warning" || level === "ended" || level === "signed_out";
}

export function noticeText(label: string, notice: Notice): string | null {
  switch (notice.level) {
    case "ended":
      return `${label} sign-in has ended`;
    case "signed_out":
      return `${label} is not signed in`;
    case "warning":
      return `${label} sign-in ends ${timeLeftText(notice.daysLeft ?? 0)}`;
    case "no_end_date":
      return `${label} reports no end date for the sign-in`;
    case "unavailable":
      return `${label} sign-in status is not available`;
    default:
      return null;
  }
}
