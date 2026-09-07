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
