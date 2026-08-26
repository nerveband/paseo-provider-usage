import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const usageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().nullable(),
  /** Provider-rendered reset text, used when no absolute timestamp is reported. */
  resetDescription: z.string().nullable(),
  /** Window length in minutes, used to label the window when no reset time exists. */
  windowMinutes: z.number().nullable(),
});

export const providerUsageSchema = z.object({
  id: z.enum(["claude", "codex", "antigravity"]),
  name: z.string(),
  source: z.string().nullable(),
  account: z.string().nullable(),
  plan: z.string().nullable(),
  updatedAt: z.string().nullable(),
  windows: z.array(usageWindowSchema),
  error: z.string().nullable(),
});

export const getProviderUsage = defineRpc({
  name: "provider-usage.get",
  input: z.object({ force: z.boolean().optional() }),
  output: z.object({
    fetchedAt: z.string(),
    providers: z.array(providerUsageSchema),
  }),
});

export type ProviderUsage = z.infer<typeof providerUsageSchema>;
