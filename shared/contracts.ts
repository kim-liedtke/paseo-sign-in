import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PROVIDER_IDS } from "./providers";

const providerId = z.enum(PROVIDER_IDS);

export const MAX_CODE_LENGTH = 2048;

// A pasted code is one line of visible characters: no C0 or C1 controls, no
// DEL, no Unicode line or paragraph separator.
export const CODE_PATTERN = /^[^\u0000-\u001f\u007f-\u009f\u2028\u2029]+$/;

export const providerStatusSchema = z.object({
  provider: providerId,
  label: z.string(),
  // "unavailable": the status could not be read (CLI missing, timeout, unknown output).
  state: z.enum(["signed_in", "signed_out", "unavailable"]),
  email: z.string().nullable(),
  organization: z.string().nullable(),
  plan: z.string().nullable(),
  method: z.string().nullable(),
  // ISO 8601 time at which the sign-in ends, when the provider reports one.
  expiresAt: z.string().nullable(),
  detail: z.string().nullable(),
  checkedAt: z.string(),
});

export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const loginPhaseSchema = z.enum([
  "idle",
  "starting",
  "awaiting_code",
  "verifying",
  "succeeded",
  "failed",
  "cancelled",
  "timed_out",
]);

export type LoginPhase = z.infer<typeof loginPhaseSchema>;

export const loginSnapshotSchema = z.object({
  provider: providerId,
  phase: loginPhaseSchema,
  // Present only while the sign-in waits for the code.
  url: z.string().nullable(),
  message: z.string().nullable(),
  // ISO 8601 time at which an unfinished sign-in is stopped.
  deadline: z.string().nullable(),
});

export type LoginSnapshot = z.infer<typeof loginSnapshotSchema>;

export const listStatusRpc = defineRpc({
  name: "status.list",
  input: z.object({}),
  output: z.object({ providers: z.array(providerStatusSchema) }),
});

export const loginStateRpc = defineRpc({
  name: "login.state",
  input: z.object({ provider: providerId }),
  output: loginSnapshotSchema,
});

export const startLoginRpc = defineRpc({
  name: "login.start",
  input: z.object({ provider: providerId }),
  output: loginSnapshotSchema,
});

export const submitCodeRpc = defineRpc({
  name: "login.submit-code",
  input: z.object({ provider: providerId, code: z.string().min(1).max(MAX_CODE_LENGTH).regex(CODE_PATTERN) }),
  output: loginSnapshotSchema,
});

export const cancelLoginRpc = defineRpc({
  name: "login.cancel",
  input: z.object({ provider: providerId }),
  output: loginSnapshotSchema,
});
