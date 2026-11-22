import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { clearLoginTraces, loginKey, loginMutationKey } from "../client/login-traces";

const LINK = "https://claude.com/cai/oauth/authorize?state=fake";
const snapshot = { provider: "claude", phase: "awaiting_code", url: LINK, message: null, deadline: null };

// What the app's cache holds after a sign-in was started from the screen.
async function cacheWithStartedLogin() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(loginKey("claude"), snapshot);
  const mutation = queryClient
    .getMutationCache()
    .build(queryClient, { mutationKey: loginMutationKey("claude"), mutationFn: async () => snapshot });
  await mutation.execute(undefined);
  return queryClient;
}

const cacheText = (queryClient: QueryClient) =>
  JSON.stringify([
    queryClient.getQueryCache().getAll().map((query) => query.state.data),
    queryClient.getMutationCache().getAll().map((mutation) => mutation.state.data),
  ]);

describe("clearLoginTraces", () => {
  it("removes the start result and the sign-in state that hold the link", async () => {
    const queryClient = await cacheWithStartedLogin();
    expect(cacheText(queryClient)).toContain(LINK);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

    clearLoginTraces(queryClient, "claude");

    expect(queryClient.getQueryData(loginKey("claude"))).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(cacheText(queryClient)).not.toContain(LINK);
  });

  it("leaves other cached data alone", async () => {
    const queryClient = await cacheWithStartedLogin();
    queryClient.setQueryData(["sign-in", "status"], [{ provider: "claude" }]);
    clearLoginTraces(queryClient, "claude");
    expect(queryClient.getQueryData(["sign-in", "status"])).toEqual([{ provider: "claude" }]);
  });
});
