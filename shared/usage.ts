import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { PROVIDER_IDS, sanitizePreferences } from "./layout";

export const usageWindowSchema = z.object({
  id: z.string(),
  label: z.string(),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.string().nullable(),
  /** Provider-rendered reset text, used when no absolute timestamp is reported. */
  resetDescription: z.string().nullable(),
  /** Window length in minutes, used to label the window when no reset time exists. */
  windowMinutes: z.number().nullable(),
  /** True when the percentage is a local estimate rather than a value the provider reported. */
  estimated: z.boolean().optional(),
  /** The provider's own amounts behind the share, such as "$1.91 of $30.00". */
  amount: z.string().optional(),
});

/**
 * One label/value row. `unavailable` marks a field the provider's API does not expose, so the
 * surface can say so instead of leaving a gap or inventing a number.
 */
export const spendRowSchema = z.object({
  label: z.string(),
  value: z.string(),
  unavailable: z.boolean().optional(),
  /** Secondary text shown muted beside the value, such as a request count. */
  detail: z.string().optional(),
  /**
   * This row's share of its group's total, 0 to 100, computed by the server from the provider's
   * own amounts. Drawn as a bar from zero; rows without it get no bar.
   */
  share: z.number().min(0).max(100).optional(),
});

/**
 * What a group means, so the surface places it without reading its title. `limits` is a limit
 * that cannot be drawn as a bar (an amount, or a lane that is switched off), `plan` is plan
 * facts, `balance` is credits and balances, `spend` is spend and activity totals, `breakdown`
 * is a per-model list, and `detail` is secondary counts. The first row of a `balance` or `spend`
 * group is its key figure. Snapshots written before kinds existed read as `detail`.
 */
export const spendGroupKindSchema = z.enum(["limits", "plan", "balance", "spend", "breakdown", "detail"]);

export const spendSchema = z.object({
  /** Provider-reported groups such as Plan, Credits, or Spend, as label/value rows. */
  groups: z.array(
    z.object({
      kind: spendGroupKindSchema.default("detail"),
      title: z.string(),
      rows: z.array(spendRowSchema),
      /** Evidence or guidance that applies to this group only. */
      note: z.string().nullable().optional(),
    }),
  ),
  /** Setup guidance when part of the spend data is unavailable. */
  note: z.string().nullable(),
  /** The at-a-glance figure for a provider without usage windows, such as the credit left. */
  headline: z.object({ label: z.string(), value: z.string() }).nullable().optional(),
});

export const providerUsageSchema = z.object({
  id: z.enum(PROVIDER_IDS),
  name: z.string(),
  source: z.string().nullable(),
  account: z.string().nullable(),
  plan: z.string().nullable(),
  updatedAt: z.string().nullable(),
  windows: z.array(usageWindowSchema),
  error: z.string().nullable(),
  /** Defaults to null so snapshots written before spend existed still load. */
  spend: spendSchema.nullable().default(null),
});

export const usageSnapshotSchema = z.object({
  fetchedAt: z.string(),
  providers: z.array(providerUsageSchema),
  /** True when these numbers were served from cache while a refresh runs behind them. */
  stale: z.boolean(),
});

export const getProviderUsage = defineRpc({
  name: "provider-usage.get",
  input: z.object({ force: z.boolean().optional() }),
  output: usageSnapshotSchema,
});

export type ProviderUsage = z.infer<typeof providerUsageSchema>;
export type SpendGroupKind = z.infer<typeof spendGroupKindSchema>;

/**
 * The Usage screen's layout (block order, collapsed blocks, grid or list), kept by the Paseo host
 * in its plugin settings store: `<paseo home>/plugin-settings/provider-usage/layout.json`, mode
 * 0600, written atomically, and pushed to every client of this host. The schema keeps known block
 * ids and the view name only, and turns anything unreadable into the defaults.
 */
export const layoutSettings = defineSettings({
  id: "layout",
  scope: "host",
  version: 1,
  schema: z.unknown().transform(sanitizePreferences),
});

export const tokenAnalyticsFilterSchema = z.object({
  range: z.enum(["24h", "7d", "14d", "30d", "all"]).default("7d"),
  providerId: z.string().optional(),
  modelId: z.string().optional(),
  timezone: z.string().optional(),
});

export const tokenModelBreakdownItemSchema = z.object({
  modelId: z.string(),
  modelLabel: z.string(),
  providerId: z.string(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedCostUsd: z.number().nullable(),
});

export const tokenTimeBucketSchema = z.object({
  timestamp: z.string(),
  label: z.string(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedCostUsd: z.number().nullable(),
  turnCount: z.number(),
  sessionCount: z.number(),
  intensity: z.number().min(0).max(4),
  modelBreakdown: z.array(tokenModelBreakdownItemSchema),
});

export const tokenModelSummarySchema = z.object({
  modelId: z.string(),
  modelLabel: z.string(),
  providerId: z.string(),
  providerLabel: z.string(),
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedCostUsd: z.number().nullable(),
  pricingBasis: z.string().optional(),
  percentage: z.number(),
});

export const tokenAnalyticsSummarySchema = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  estimatedCostUsd: z.number().nullable(),
  topModelLabel: z.string().nullable(),
  topModelShare: z.number(),
  turnCount: z.number(),
  sessionCount: z.number(),
  avgDailyTokens: z.number(),
  pricingNote: z.string().optional(),
});

export const tokenAnalyticsCoverageSchema = z.object({
  earliestTimestamp: z.string().nullable(),
  latestTimestamp: z.string().nullable(),
  agentsDiscovered: z.number(),
  sessionsParsed: z.number(),
  unpricedTokens: z.number(),
});

export const filterOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  providerId: z.string().optional(),
});

export const tokenAnalyticsResponseSchema = z.object({
  generatedAt: z.string(),
  timezone: z.string(),
  bucketGranularity: z.enum(["hour", "day"]),
  summary: tokenAnalyticsSummarySchema,
  buckets: z.array(tokenTimeBucketSchema),
  models: z.array(tokenModelSummarySchema),
  availableProviders: z.array(filterOptionSchema),
  availableModels: z.array(filterOptionSchema),
  coverage: tokenAnalyticsCoverageSchema,
});

export const getTokenAnalytics = defineRpc({
  name: "provider-usage.analytics",
  input: tokenAnalyticsFilterSchema,
  output: tokenAnalyticsResponseSchema,
});

export type TokenAnalyticsFilter = z.infer<typeof tokenAnalyticsFilterSchema>;
export type TokenAnalyticsResponse = z.infer<typeof tokenAnalyticsResponseSchema>;
export type TokenTimeBucket = z.infer<typeof tokenTimeBucketSchema>;
export type TokenModelSummary = z.infer<typeof tokenModelSummarySchema>;
