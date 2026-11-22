import { PROVIDER_IDS, type ProviderId } from "../../shared/providers";
import type { AuthProvider } from "./provider";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderId, AuthProvider>();

  constructor(providers: readonly AuthProvider[]) {
    for (const provider of providers) {
      if (!PROVIDER_IDS.includes(provider.id)) {
        throw new Error(`Provider "${provider.id}" is not in the fixed provider list`);
      }
      if (this.providers.has(provider.id)) {
        throw new Error(`Provider "${provider.id}" is registered twice`);
      }
      this.providers.set(provider.id, provider);
    }
  }

  get(id: ProviderId): AuthProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error("Unknown provider");
    return provider;
  }

  all(): AuthProvider[] {
    return [...this.providers.values()];
  }

  async disposeAll(): Promise<void> {
    await Promise.allSettled(this.all().map((provider) => provider.dispose()));
  }
}
