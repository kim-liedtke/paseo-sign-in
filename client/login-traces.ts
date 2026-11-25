import type { QueryClient } from "@tanstack/react-query";
import { isActiveLoginPhase, type LoginSnapshot } from "../shared/contracts";
import type { ProviderId } from "../shared/providers";

// The status of all providers. The sidebar row and the screen share it.
export const STATUS_KEY = ["sign-in", "status"] as const;
// Keys of everything in the app's query cache that can hold a sign-in link:
// the polled sign-in state and the results of the start, submit and cancel calls.
export const loginKey = (provider: ProviderId) => ["sign-in", "login", provider] as const;
export const loginMutationKey = (provider: ProviderId) => ["sign-in", "login-call", provider] as const;

/**
 * Takes the answer of a start, submit or cancel call.
 *
 * When the sign-in has ended, the status is always read again, also when the
 * screen that made the call is closed. Otherwise the sidebar keeps the old
 * state until its slow timer runs. The answer itself, which can hold the
 * link, is cached only while the screen is open.
 */
export function applyLoginAnswer(
  queryClient: QueryClient,
  provider: ProviderId,
  snapshot: LoginSnapshot,
  screenOpen: boolean,
  readState?: () => Promise<LoginSnapshot>,
): void {
  if (!isActiveLoginPhase(snapshot.phase)) {
    void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
  } else if (!screenOpen && snapshot.phase === "verifying" && readState) {
    // The host still checks the code, and the screen that would poll the
    // result is closed. Follow the sign-in here, so the sidebar learns the
    // result when it ends.
    void watchLoginEnd(queryClient, readState);
  }
  if (screenOpen) queryClient.setQueryData(loginKey(provider), snapshot);
}

/**
 * Reads the sign-in state until the sign-in has ended, then has the status
 * read again. The answers are not cached. Gives up after the number of reads
 * that covers the longest sign-in, and has the status read again then too.
 */
export async function watchLoginEnd(
  queryClient: QueryClient,
  readState: () => Promise<LoginSnapshot>,
  intervalMs = 3000,
  maxReads = 120,
): Promise<void> {
  for (let read = 0; read < maxReads; read += 1) {
    await new Promise<void>((resolve) => setTimeout(() => resolve(), intervalMs));
    try {
      if (!isActiveLoginPhase((await readState()).phase)) break;
    } catch {
      // The host did not answer this time. Try again.
    }
  }
  await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
}

/**
 * Removes every cached answer that can hold the sign-in link of a provider.
 * Called when the sign-in screen closes, so the link does not stay in the
 * app's memory after the user left the screen.
 *
 * A call that still runs is left alone, so its answer still reaches
 * applyLoginAnswer. It holds no answer yet, and the calls are made with
 * `gcTime: 0`, so its result is dropped as soon as it ends.
 */
export function clearLoginTraces(queryClient: QueryClient, provider: ProviderId): void {
  queryClient.removeQueries({ queryKey: loginKey(provider) });
  const mutations = queryClient.getMutationCache();
  for (const mutation of mutations.findAll({ mutationKey: loginMutationKey(provider) })) {
    if (mutation.state.status !== "pending") mutations.remove(mutation);
  }
}
