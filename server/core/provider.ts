import type { LoginSnapshot, ProviderStatus } from "../../shared/contracts";
import type { ProviderId } from "../../shared/providers";

// Everything provider-specific sits behind this interface. A new provider is
// one more implementation of it, registered in index.server.ts.
export interface AuthProvider {
  readonly id: ProviderId;
  readonly label: string;
  /** Reads the sign-in state from the provider CLI's own status command. */
  status(): Promise<ProviderStatus>;
  /** Starts the provider's sign-in on the host. Resolves when it shows a link or stops. */
  startLogin(): Promise<LoginSnapshot>;
  /** Hands the pasted code to the running sign-in. Resolves with the result. */
  submitCode(code: string): Promise<LoginSnapshot>;
  /** Stops a running sign-in. */
  cancel(): Promise<LoginSnapshot>;
  /** The current sign-in state, without side effects. */
  loginState(): LoginSnapshot;
  /** Stops any child process. Called when the plugin stops. */
  dispose(): Promise<void>;
}
