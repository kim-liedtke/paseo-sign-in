import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";
import { CLAUDE_DEFAULT_COMMAND, createClaudeProvider } from "./server/claude/provider";
import { resolveLaunch } from "./server/core/launch";
import { ProviderRegistry } from "./server/core/registry";
import {
  cancelLoginRpc,
  listStatusRpc,
  loginStateRpc,
  startLoginRpc,
  submitCodeRpc,
} from "./shared/contracts";
import type { ProviderId } from "./shared/providers";
import { noticeSettings } from "./shared/settings";

type Paseo = PluginHandlerContext["paseo"];

export default function contribute(server: PluginServerContext) {
  // The newest daemon connection, kept so a provider can read how the daemon
  // starts its CLI. It is set by every request before a provider runs.
  let paseo: Paseo | null = null;

  async function launchFor(id: ProviderId, defaultCommand: readonly string[]) {
    let providerConfig: unknown;
    try {
      const { config } = await paseo!.config.get();
      providerConfig = (config as { providers?: Record<string, unknown> }).providers?.[id];
    } catch {
      providerConfig = undefined;
    }
    return resolveLaunch(defaultCommand, providerConfig, process.env);
  }

  const claude = createClaudeProvider(() => launchFor("claude", CLAUDE_DEFAULT_COMMAND));
  const registry = new ProviderRegistry([claude]);

  // If this process exits without cleanup, do not leave a sign-in behind.
  const killAll = () => claude.killNow();
  process.on("exit", killAll);

  server.registerSettings(noticeSettings);

  server.handle(listStatusRpc, async (_input, context) => {
    paseo = context.paseo;
    return { providers: await Promise.all(registry.all().map((provider) => provider.status())) };
  });
  server.handle(loginStateRpc, ({ provider }) => registry.get(provider).loginState());
  server.handle(startLoginRpc, ({ provider }, context) => {
    paseo = context.paseo;
    return registry.get(provider).startLogin();
  });
  server.handle(submitCodeRpc, ({ provider, code }) => registry.get(provider).submitCode(code));
  server.handle(cancelLoginRpc, ({ provider }) => registry.get(provider).cancel());

  return async () => {
    process.off("exit", killAll);
    await registry.disposeAll();
  };
}
