import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { listStatusRpc, loginStateRpc, type LoginPhase } from "../shared/contracts";
import type { ProviderId } from "../shared/providers";
import { DEFAULT_WARN_DAYS, noticeSettings } from "../shared/settings";
import { loginKey } from "./login-traces";

export const STATUS_KEY = ["sign-in", "status"] as const;
export { loginKey };

// The status is read when a surface opens and then on this slow timer.
const STATUS_REFRESH_MS = 15 * 60 * 1000;
const LOGIN_POLL_MS = 3000;

const ACTIVE_PHASES: readonly LoginPhase[] = ["starting", "awaiting_code", "verifying"];
export const isActivePhase = (phase: LoginPhase | undefined) => !!phase && ACTIVE_PHASES.includes(phase);

export function useStatuses() {
  const listStatus = useRpc(listStatusRpc);
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: async () => (await listStatus({})).providers,
    refetchInterval: STATUS_REFRESH_MS,
    refetchOnMount: "always",
    staleTime: 60 * 1000,
  });
}

export function useLoginState(provider: ProviderId) {
  const loginState = useRpc(loginStateRpc);
  return useQuery({
    queryKey: loginKey(provider),
    queryFn: () => loginState({ provider }),
    // Poll only while a sign-in runs, to notice a time-out or a cancel from another client.
    refetchInterval: (query) => (isActivePhase(query.state.data?.phase) ? LOGIN_POLL_MS : false),
    // The answer can hold the sign-in link. Do not keep it after the screen closes.
    gcTime: 0,
    staleTime: 0,
  });
}

export function useWarnDays(): number {
  const settings = useSettings(noticeSettings);
  return settings.status === "ready" ? settings.values.warnDays : DEFAULT_WARN_DAYS;
}
