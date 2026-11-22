import type { QueryClient } from "@tanstack/react-query";
import type { ProviderId } from "../shared/providers";

// Keys of everything in the app's query cache that can hold a sign-in link:
// the polled sign-in state and the results of the start, submit and cancel calls.
export const loginKey = (provider: ProviderId) => ["sign-in", "login", provider] as const;
export const loginMutationKey = (provider: ProviderId) => ["sign-in", "login-call", provider] as const;

/**
 * Removes every cached answer that can hold the sign-in link of a provider.
 * Called when the sign-in screen closes, so the link does not stay in the
 * app's memory after the user left the screen.
 */
export function clearLoginTraces(queryClient: QueryClient, provider: ProviderId): void {
  queryClient.removeQueries({ queryKey: loginKey(provider) });
  const mutations = queryClient.getMutationCache();
  for (const mutation of mutations.findAll({ mutationKey: loginMutationKey(provider) })) {
    mutations.remove(mutation);
  }
}
