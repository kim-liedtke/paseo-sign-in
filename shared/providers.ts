// The fixed list of providers this plugin knows. Client requests can name
// only these ids; nothing else selects what runs on the host.
export const PROVIDER_IDS = ["claude"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
