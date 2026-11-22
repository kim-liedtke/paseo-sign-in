import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon, SidebarRow, useToast, type PluginIconProps } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef } from "react";
import {
  needsAction,
  nextAnnouncement,
  noticeFor,
  noticeText,
  overallNotice,
  timeLeftText,
  type Notice,
} from "../shared/expiry";
import { useStatuses, useWarnDays } from "./data";

export const SCREEN_ID = "status";

function rowLabel(notice: Notice): string {
  if (notice.level === "ended") return "Sign-in ended";
  if (notice.level === "signed_out") return "Not signed in";
  if (notice.level === "warning") return `Sign-in ends ${timeLeftText(notice.daysLeft ?? 0)}`;
  if (notice.level === "unavailable") return "Sign-in status unknown";
  if (notice.level === "no_end_date") return "Sign-in end date unknown";
  return "Sign-in";
}

/**
 * The notice the user sees without opening the screen: a sidebar row whose
 * icon, color and label change when a sign-in ends soon or has ended, and one
 * toast when that state is first seen.
 */
export function SignInItem({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
  const statuses = useStatuses();
  const warnDays = useWarnDays();
  const toast = useToast();
  const announced = useRef<string | null>(null);

  const perProvider = (statuses.data ?? []).map((status) => ({
    label: status.label,
    notice: noticeFor(status, Date.now(), warnDays),
  }));
  // A failed status call shows as "Sign-in status unknown", not as the last answer.
  const worst = overallNotice(statuses.data, statuses.isError, Date.now(), warnDays);
  // The row shows every state that is not plainly fine. A toast is raised
  // only for the states that the user must act on.
  const messages = perProvider
    .filter((entry) => needsAction(entry.notice.level))
    .map((entry) => noticeText(entry.label, entry.notice))
    .filter((message): message is string => message !== null);
  const announcement = messages.join(". ");

  useEffect(() => {
    const next = nextAnnouncement(announced.current, announcement, statuses.isError);
    announced.current = next.remembered;
    if (!next.announce) return;
    if (worst.level === "warning") toast.show(next.announce, { variant: "warning", durationMs: 6000 });
    else toast.error(next.announce);
  }, [announcement, statuses.isError, worst.level, toast]);

  const NoticeIcon = useMemo(() => {
    const unknown = worst.level === "unavailable" || worst.level === "no_end_date";
    const color = unknown
      ? theme.colors.foregroundMuted
      : worst.level === "warning"
        ? theme.colors.statusWarning
        : theme.colors.statusDanger;
    const name = unknown ? "CircleHelp" : "TriangleAlert";
    return function NoticeIcon({ size }: PluginIconProps) {
      return <Icon name={name} size={size} color={color} />;
    };
  }, [worst.level, theme]);

  return (
    <SidebarRow
      icon={worst.level === "none" ? "KeyRound" : NoticeIcon}
      label={rowLabel(worst)}
      active={currentScreen?.screenId === SCREEN_ID}
      onPress={() => openScreen({ screenId: SCREEN_ID })}
    />
  );
}
