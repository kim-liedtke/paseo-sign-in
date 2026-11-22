import { QueryClient } from "@tanstack/react-query";
import { createElement, type RefObject } from "react";
import { act, create } from "react-test-renderer";
import { describe, expect, it } from "vitest";
import { loginKey, loginMutationKey } from "../client/login-traces";
import { useLoginCleanup } from "../client/use-login-cleanup";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LINK = "https://claude.com/cai/oauth/authorize?state=fake";
const snapshot = { provider: "claude", phase: "awaiting_code", url: LINK, message: null, deadline: null };

describe("useLoginCleanup", () => {
  it("clears the cached link when the sign-in component unmounts", async () => {
    const queryClient = new QueryClient();
    let mounted: RefObject<boolean> | null = null;
    function SignIn() {
      mounted = useLoginCleanup(queryClient, "claude");
      return null;
    }

    let screen!: ReturnType<typeof create>;
    await act(async () => {
      screen = create(createElement(SignIn));
    });
    // The state of a started sign-in, as the screen caches it.
    queryClient.setQueryData(loginKey("claude"), snapshot);
    await queryClient
      .getMutationCache()
      .build(queryClient, { mutationKey: loginMutationKey("claude"), mutationFn: async () => snapshot })
      .execute(undefined);
    expect(mounted!.current).toBe(true);
    expect(queryClient.getQueryData(loginKey("claude"))).toEqual(snapshot);

    await act(async () => {
      screen.unmount();
    });

    expect(mounted!.current).toBe(false);
    expect(queryClient.getQueryData(loginKey("claude"))).toBeUndefined();
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  it("keeps the cache while the component stays mounted", async () => {
    const queryClient = new QueryClient();
    function SignIn() {
      useLoginCleanup(queryClient, "claude");
      return null;
    }
    let screen!: ReturnType<typeof create>;
    await act(async () => {
      screen = create(createElement(SignIn));
    });
    queryClient.setQueryData(loginKey("claude"), snapshot);
    await act(async () => {
      screen.update(createElement(SignIn));
    });
    expect(queryClient.getQueryData(loginKey("claude"))).toEqual(snapshot);
    await act(async () => {
      screen.unmount();
    });
  });
});
