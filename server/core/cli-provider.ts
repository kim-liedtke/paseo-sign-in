import type { LoginSnapshot, ProviderStatus } from "../../shared/contracts";
import type { ProviderId } from "../../shared/providers";
import type { Launch } from "./launch";
import { LoginSession, type LoginState } from "./login-session";
import { runToEnd, type RunResult } from "./process";
import type { AuthProvider } from "./provider";

/** The provider-specific part of a status answer. */
export type StatusFields = Omit<ProviderStatus, "provider" | "label" | "checkedAt">;

export interface CliProviderDefinition {
  id: ProviderId;
  label: string;
  /** How the daemon would start this provider's CLI. */
  resolveLaunch(): Promise<Launch>;
  statusArgs: readonly string[];
  /** Turns the output of the status command into status fields. */
  parseStatus(result: RunResult): StatusFields;
  loginArgs: readonly string[];
  /** The hosts whose sign-in links are accepted. */
  loginLinkHosts: readonly string[];
  /** A status answer is reused for this long, and a running status call is shared. */
  statusCacheMs?: number;
  statusTimeoutMs?: number;
  /** The lookup of the launch for a status call is given up after this time. */
  launchTimeoutMs?: number;
  loginTimeoutMs?: number;
  linkTimeoutMs?: number;
  now?: () => number;
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export const UNAVAILABLE: StatusFields = {
  state: "unavailable",
  email: null,
  organization: null,
  plan: null,
  method: null,
  expiresAt: null,
  detail: null,
};

/**
 * An AuthProvider for a CLI that has a status command and an interactive
 * sign-in command that prints a link and reads a code. A provider with that
 * shape needs only a definition; one with another shape implements
 * AuthProvider itself.
 */
export function createCliProvider(definition: CliProviderDefinition): AuthProvider & { killNow(): void } {
  const now = definition.now ?? Date.now;
  const session = new LoginSession({
    resolveLaunch: definition.resolveLaunch,
    loginArgs: definition.loginArgs,
    allowedLinkHosts: definition.loginLinkHosts,
    timeoutMs: definition.loginTimeoutMs,
    linkTimeoutMs: definition.linkTimeoutMs,
    now,
  });
  const toSnapshot = (state: LoginState): LoginSnapshot => ({ provider: definition.id, ...state });
  const statusCacheMs = definition.statusCacheMs ?? 5000;
  // One status call at a time. Several clients and surfaces ask at the same
  // moment, and each call starts a process.
  // A running call is shared for as long as it runs, also when that is longer
  // than the cache time. A finished answer is reused for the cache time.
  let cached: { value: Promise<ProviderStatus>; settledAt: number | null } | null = null;
  const forgetStatus = () => {
    cached = null;
  };

  async function readStatus(): Promise<ProviderStatus> {
    let fields: StatusFields;
    try {
      // Every step of a status call has a time limit. A running call is shared
      // by all callers, so one that never ended would block every later one.
      const launch = await withTimeout(definition.resolveLaunch(), definition.launchTimeoutMs ?? 5000);
      const result = await runToEnd(launch, definition.statusArgs, definition.statusTimeoutMs ?? 15_000);
      if (result.spawnError === "ENOENT") {
        fields = { ...UNAVAILABLE, detail: "The provider command was not found on the host." };
      } else if (result.spawnError) {
        fields = { ...UNAVAILABLE, detail: "The provider command could not be started." };
      } else if (result.timedOut) {
        fields = { ...UNAVAILABLE, detail: "The status command did not answer in time." };
      } else {
        fields = definition.parseStatus(result);
      }
    } catch {
      fields = { ...UNAVAILABLE, detail: "The status could not be read." };
    }
    return {
      provider: definition.id,
      label: definition.label,
      ...fields,
      checkedAt: new Date(now()).toISOString(),
    };
  }

  return {
    id: definition.id,
    label: definition.label,

    status(): Promise<ProviderStatus> {
      if (cached && (cached.settledAt === null || now() - cached.settledAt < statusCacheMs)) {
        return cached.value;
      }
      const entry: NonNullable<typeof cached> = { value: readStatus(), settledAt: null };
      void entry.value.then(() => {
        entry.settledAt = now();
      });
      cached = entry;
      return entry.value;
    },

    // A sign-in changes the status. Every step drops the cached answer.
    async startLogin() {
      forgetStatus();
      return toSnapshot(await session.start());
    },
    async submitCode(code: string) {
      try {
        return toSnapshot(await session.submitCode(code));
      } finally {
        forgetStatus();
      }
    },
    async cancel() {
      try {
        return toSnapshot(await session.cancel());
      } finally {
        forgetStatus();
      }
    },
    loginState() {
      return toSnapshot(session.snapshot());
    },
    dispose() {
      return session.dispose();
    },
    killNow() {
      session.killNow();
    },
  };
}
