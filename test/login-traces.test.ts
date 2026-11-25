import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import {
  applyLoginAnswer,
  clearLoginTraces,
  loginKey,
  loginMutationKey,
  STATUS_KEY,
  watchLoginEnd,
} from "../client/login-traces";
import type { LoginSnapshot } from "../shared/contracts";

const LINK = "https://claude.com/cai/oauth/authorize?state=fake";
const snapshot: LoginSnapshot = { provider: "claude", phase: "awaiting_code", url: LINK, message: null, deadline: null };
const succeeded: LoginSnapshot = { provider: "claude", phase: "succeeded", url: null, message: null, deadline: null };

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

describe("clearLoginTraces with a call that still runs", () => {
  it("leaves the running call alone, so its answer still arrives, and keeps nothing afterwards", async () => {
    const queryClient = new QueryClient();
    let answer!: (value: LoginSnapshot) => void;
    const received: LoginSnapshot[] = [];
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationKey: loginMutationKey("claude"),
      gcTime: 0,
      mutationFn: () => new Promise<LoginSnapshot>((resolve) => (answer = resolve)),
      onSuccess: (data: LoginSnapshot) => {
        received.push(data);
      },
    });
    const running = mutation.execute(undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));

    clearLoginTraces(queryClient, "claude");
    expect(queryClient.getMutationCache().getAll()).toHaveLength(1);

    answer(snapshot);
    await running;
    expect(received).toEqual([snapshot]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });
});

describe("applyLoginAnswer", () => {
  function clientWithStatus() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(STATUS_KEY, [{ provider: "claude", state: "signed_out" }]);
    return queryClient;
  }
  const statusIsStale = (queryClient: QueryClient) => queryClient.getQueryState(STATUS_KEY)?.isInvalidated;

  it("reads the status again after the sign-in ended, also when the screen is closed", () => {
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", succeeded, false);
    expect(statusIsStale(queryClient)).toBe(true);
    // The answer is not cached for a closed screen.
    expect(queryClient.getQueryData(loginKey("claude"))).toBeUndefined();
  });

  it.each(["failed", "cancelled", "timed_out"] as const)("reads the status again after %s", (phase) => {
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", { ...succeeded, phase }, false);
    expect(statusIsStale(queryClient)).toBe(true);
  });

  it("caches the answer and reads the status again while the screen is open", () => {
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", succeeded, true);
    expect(statusIsStale(queryClient)).toBe(true);
    expect(queryClient.getQueryData(loginKey("claude"))).toEqual(succeeded);
  });

  it("does not read the status again while the sign-in still runs", () => {
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", snapshot, true);
    expect(statusIsStale(queryClient)).toBe(false);
    expect(queryClient.getQueryData(loginKey("claude"))).toEqual(snapshot);
  });

  it("does not cache a link for a closed screen", () => {
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", snapshot, false);
    expect(queryClient.getQueryData(loginKey("claude"))).toBeUndefined();
  });
});

describe("a slow sign-in that ends after the screen closed", () => {
  const verifying: LoginSnapshot = { provider: "claude", phase: "verifying", url: null, message: null, deadline: null };
  const statusIsStale = (queryClient: QueryClient) => queryClient.getQueryState(STATUS_KEY)?.isInvalidated;
  function clientWithStatus() {
    const queryClient = new QueryClient();
    queryClient.setQueryData(STATUS_KEY, [{ provider: "claude", state: "signed_out" }]);
    return queryClient;
  }

  it("follows the sign-in and reads the status again when it ends", async () => {
    const queryClient = clientWithStatus();
    const answers: LoginSnapshot[] = [verifying, verifying, succeeded];
    let reads = 0;
    const watching = watchLoginEnd(queryClient, async () => answers[reads++], 10);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect(statusIsStale(queryClient)).toBe(false);
    await watching;
    expect(reads).toBe(3);
    expect(statusIsStale(queryClient)).toBe(true);
    // The answers of the reads are not cached.
    expect(queryClient.getQueryData(loginKey("claude"))).toBeUndefined();
  });

  it("goes on when a read fails, and stops after the last allowed read", async () => {
    const queryClient = clientWithStatus();
    let reads = 0;
    await watchLoginEnd(
      queryClient,
      async () => {
        reads += 1;
        if (reads === 1) throw new Error("host did not answer");
        return verifying;
      },
      5,
      4,
    );
    expect(reads).toBe(4);
    expect(statusIsStale(queryClient)).toBe(true);
  });

  it("starts to follow only for a closed screen and a code that is being checked", async () => {
    const calls: string[] = [];
    const readState = async () => {
      calls.push("read");
      return succeeded;
    };
    const wait = () => new Promise((resolve) => setTimeout(resolve, 3200));
    // Open screen: the screen polls by itself.
    applyLoginAnswer(clientWithStatus(), "claude", verifying, true, readState);
    // Closed screen, but no code was submitted: the sign-in cannot succeed.
    applyLoginAnswer(clientWithStatus(), "claude", snapshot, false, readState);
    const queryClient = clientWithStatus();
    applyLoginAnswer(queryClient, "claude", verifying, false, readState);
    await wait();
    expect(calls).toEqual(["read"]);
    expect(statusIsStale(queryClient)).toBe(true);
  }, 10_000);
});
