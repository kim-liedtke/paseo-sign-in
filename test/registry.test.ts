import { describe, expect, it } from "vitest";
import type { AuthProvider } from "../server/core/provider";
import { ProviderRegistry } from "../server/core/registry";
import { cancelLoginRpc, startLoginRpc, submitCodeRpc } from "../shared/contracts";

function stub(id: string): AuthProvider & { disposed: boolean } {
  const snapshot = { provider: "claude" as const, phase: "idle" as const, url: null, message: null, deadline: null };
  return {
    id: id as AuthProvider["id"],
    label: id,
    disposed: false,
    status: async () => {
      throw new Error("not used");
    },
    startLogin: async () => snapshot,
    submitCode: async () => snapshot,
    cancel: async () => snapshot,
    loginState: () => snapshot,
    async dispose() {
      this.disposed = true;
    },
  };
}

describe("ProviderRegistry", () => {
  it("returns registered providers and disposes all of them", async () => {
    const claude = stub("claude");
    const registry = new ProviderRegistry([claude]);
    expect(registry.get("claude")).toBe(claude);
    expect(registry.all()).toEqual([claude]);
    await registry.disposeAll();
    expect(claude.disposed).toBe(true);
  });

  it("refuses providers outside the fixed list and duplicates", () => {
    expect(() => new ProviderRegistry([stub("other")])).toThrow("fixed provider list");
    expect(() => new ProviderRegistry([stub("claude"), stub("claude")])).toThrow("registered twice");
  });
});

describe("RPC contracts", () => {
  it("accept only a provider id from the fixed list", () => {
    expect(startLoginRpc.input.safeParse({ provider: "claude" }).success).toBe(true);
    for (const provider of ["codex", "/usr/bin/claude", "claude; rm -rf /", "", 1, null]) {
      expect(startLoginRpc.input.safeParse({ provider }).success).toBe(false);
      expect(cancelLoginRpc.input.safeParse({ provider }).success).toBe(false);
    }
  });

  it("accept a code only as a bounded string", () => {
    expect(submitCodeRpc.input.safeParse({ provider: "claude", code: "abc#def" }).success).toBe(true);
    expect(submitCodeRpc.input.safeParse({ provider: "claude", code: "" }).success).toBe(false);
    expect(submitCodeRpc.input.safeParse({ provider: "claude", code: "x".repeat(5000) }).success).toBe(false);
    expect(submitCodeRpc.input.safeParse({ provider: "claude", code: ["a"] }).success).toBe(false);
  });
});
