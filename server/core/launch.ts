// How to start a provider CLI: an executable, leading arguments and an environment.
// It mirrors what the daemon does for the same provider: the provider's default
// command, replaced by `command` and extended by `env` from the daemon's provider
// configuration (agents.providers.<id> in the daemon's config.json).

export interface Launch {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.length > 0)
  );
}

export function resolveLaunch(
  defaultCommand: readonly string[],
  providerConfig: unknown,
  baseEnv: NodeJS.ProcessEnv,
): Launch {
  const config =
    providerConfig && typeof providerConfig === "object"
      ? (providerConfig as { command?: unknown; env?: unknown })
      : {};
  const command = isNonEmptyStringArray(config.command) ? config.command : [...defaultCommand];
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (config.env && typeof config.env === "object") {
    for (const [key, value] of Object.entries(config.env as Record<string, unknown>)) {
      if (typeof value === "string") env[key] = value;
    }
  }
  return { command: command[0], args: command.slice(1), env };
}
