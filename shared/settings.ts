import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const DEFAULT_WARN_DAYS = 7;

export const noticeSettings = defineSettings({
  id: "notice",
  scope: "host",
  version: 1,
  schema: z.object({
    // Show the notice when the sign-in ends within this many days.
    warnDays: z.number().int().min(1).max(60).default(DEFAULT_WARN_DAYS),
  }),
});
