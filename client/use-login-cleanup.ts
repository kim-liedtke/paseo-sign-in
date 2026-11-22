import type { QueryClient } from "@tanstack/react-query";
import { useEffect, useRef, type RefObject } from "react";
import type { ProviderId } from "../shared/providers";
import { clearLoginTraces } from "./login-traces";

/**
 * Removes the cached sign-in link of a provider when the component that
 * shows the sign-in goes away. Returns a ref that is false from then on, so
 * an answer that arrives late can be dropped and not cached again.
 */
export function useLoginCleanup(queryClient: QueryClient, provider: ProviderId): RefObject<boolean> {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearLoginTraces(queryClient, provider);
    };
  }, [queryClient, provider]);
  return mounted;
}
