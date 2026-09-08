import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import {
  getProviderUsage,
  getTokenAnalytics,
  type ProviderUsage,
  type TokenAnalyticsFilter,
  type TokenTimeBucket,
} from "../shared/usage";

/** Used share at or above which a window is reported as nearly exhausted. */
const CRITICAL_USED_PERCENT = 90;

const MODEL_PALETTE = [
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#10b981", // Emerald
  "#ec4899", // Pink
  "#f59e0b", // Amber
  "#06b6d4", // Cyan
  "#ef4444", // Red
  "#6366f1", // Indigo
];

function getModelColor(index: number): string {
  return MODEL_PALETTE[index % MODEL_PALETTE.length];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatCost(usd: number | null): string {
  if (usd === null) return "—";
  if (usd < 0.01 && usd > 0) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function resetLabel(window: ProviderUsage["windows"][number]): string | null {
  if (window.resetsAt) {
    const date = new Date(window.resetsAt);
    if (!Number.isNaN(date.getTime())) {
      return `resets ${date.toLocaleString([], {
        weekday: "short",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    }
  }
  if (window.resetDescription) return `resets ${window.resetDescription}`;
  if (window.windowMinutes && window.windowMinutes > 0) {
    const hours = window.windowMinutes / 60;
    if (hours >= 24) return `${Math.round(hours / 24)}-day window`;
    if (hours >= 1) return `${Math.round(hours)}-hour window`;
    return `${Math.round(window.windowMinutes)}-minute window`;
  }
  return null;
}

function UsageBar({ usedPercent, theme }: { usedPercent: number; theme: PluginTheme }) {
  const critical = usedPercent >= CRITICAL_USED_PERCENT;
  return (
    <View
      style={{ height: 6, borderRadius: 3, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(usedPercent) }}
    >
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.colors.foreground,
          opacity: 0.12,
        }}
      />
      <View
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          bottom: 0,
          width: `${Math.max(0, Math.min(100, usedPercent))}%`,
          backgroundColor: critical ? theme.colors.statusDanger : theme.colors.accent,
        }}
      />
    </View>
  );
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  // Filter state for token activity
  const [range, setRange] = useState<TokenAnalyticsFilter["range"]>("7d");
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null);

  // 1. Quota Query (CodexBar)
  const fetchUsage = useRpc(getProviderUsage);
  const forceNextQuotaFetch = useRef(false);
  const quotaQuery = useQuery({
    queryKey: ["provider-usage"],
    queryFn: () => {
      const force = forceNextQuotaFetch.current;
      forceNextQuotaFetch.current = false;
      return fetchUsage({ force });
    },
    staleTime: 60_000,
    refetchInterval: ({ state }) => (state.data?.stale ? 2_000 : 5 * 60_000),
  });

  // 2. Token Analytics Query (Paseo Sessions)
  const fetchAnalytics = useRpc(getTokenAnalytics);
  const analyticsQuery = useQuery({
    queryKey: ["token-analytics", range, selectedProvider, selectedModel],
    queryFn: () =>
      fetchAnalytics({
        range,
        providerId: selectedProvider,
        modelId: selectedModel,
      }),
    staleTime: 30_000,
  });

  const refreshAll = useCallback(() => {
    forceNextQuotaFetch.current = true;
    void quotaQuery.refetch();
    void analyticsQuery.refetch();
  }, [quotaQuery, analyticsQuery]);

  const isUpdating =
    (Boolean(quotaQuery.data) && quotaQuery.data?.stale === true) ||
    quotaQuery.isFetching ||
    analyticsQuery.isFetching;

  const styles = useMemo(() => {
    const borderColor = "rgba(128, 128, 128, 0.2)";
    const cardBg = "rgba(128, 128, 128, 0.08)";
    const innerCardBg = "rgba(128, 128, 128, 0.14)";

    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        paddingVertical: layout.compact ? 16 : 24,
        paddingHorizontal: layout.compact ? 16 : 28,
        width: "100%" as const,
        maxWidth: 720,
        alignSelf: "center" as const,
        gap: 20,
      },

      /* Top Header */
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 16,
        paddingBottom: 4,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 17,
        fontWeight: "700" as const,
        letterSpacing: 0.2,
      },
      captionRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        marginTop: 2,
      },
      caption: { color: theme.colors.foregroundMuted, fontSize: 12 },
      captionUpdating: { color: theme.colors.accent, fontSize: 12 },
      refreshBtn: {
        minHeight: 32,
        paddingHorizontal: 14,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderRadius: 6,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor,
      },
      refreshBtnText: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },

      /* Section Containers */
      section: {
        backgroundColor: cardBg,
        borderRadius: 10,
        padding: layout.compact ? 14 : 18,
        borderWidth: 1,
        borderColor,
        gap: 16,
      },
      sectionHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      sectionTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "700" as const,
        letterSpacing: 0.4,
        textTransform: "uppercase" as const,
      },
      sectionBadge: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },

      /* Quota Provider Rows */
      providerItem: {
        gap: 12,
        paddingTop: 8,
      },
      providerDivider: {
        height: 1,
        backgroundColor: borderColor,
      },
      providerHeading: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "baseline" as const,
      },
      providerName: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      providerMeta: { color: theme.colors.foregroundMuted, fontSize: 11 },
      windowRow: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        justifyContent: "space-between" as const,
        gap: 8,
      },
      windowLabel: { color: theme.colors.foreground, fontSize: 12, flexShrink: 1 },
      windowReset: { color: theme.colors.foregroundMuted, fontSize: 11 },
      percentage: { color: theme.colors.foreground, fontSize: 12, fontWeight: "600" as const },
      percentageCritical: { color: theme.colors.statusDanger, fontSize: 12, fontWeight: "600" as const },

      /* Pricing Source Callout Banner */
      pricingBanner: {
        backgroundColor: innerCardBg,
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        borderLeftWidth: 3,
        borderLeftColor: theme.colors.accent,
      },
      pricingBannerText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        lineHeight: 16,
        flexShrink: 1,
      },

      /* Filter Controls */
      filterBar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        alignItems: "center" as const,
        gap: 6,
      },
      rangePill: {
        paddingVertical: 5,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: innerCardBg,
        borderWidth: 1,
        borderColor,
      },
      rangePillActive: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      rangePillText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      rangePillTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "700" as const,
      },
      filterChip: {
        paddingVertical: 4,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: innerCardBg,
        borderWidth: 1,
        borderColor,
      },
      filterChipActive: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      filterChipText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      filterChipTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },

      /* Model Comparison Trajectory Bar */
      trajectoryCard: {
        backgroundColor: innerCardBg,
        borderRadius: 8,
        padding: 12,
        gap: 8,
      },
      trajectoryTitle: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      stackedBarTrack: {
        height: 12,
        borderRadius: 6,
        backgroundColor: "rgba(128, 128, 128, 0.2)",
        flexDirection: "row" as const,
        overflow: "hidden" as const,
      },
      trajectoryLegend: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
        marginTop: 4,
      },
      trajectoryLegendItem: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 5,
      },
      legendDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
      },
      legendLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },

      /* Activity Block Showcase (Heatmap Cards) */
      blockRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        justifyContent: "space-between" as const,
      },
      dayCard: {
        flex: 1,
        minWidth: layout.compact ? 42 : 54,
        borderRadius: 6,
        paddingVertical: 8,
        paddingHorizontal: 4,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderWidth: 1,
        borderColor,
        gap: 4,
      },
      dayCardSelected: {
        borderColor: theme.colors.foreground,
        borderWidth: 2,
      },
      dayName: {
        fontSize: 10,
        fontWeight: "600" as const,
        textTransform: "uppercase" as const,
      },
      dayDate: {
        fontSize: 11,
        fontWeight: "500" as const,
      },
      dayVolumeBadge: {
        fontSize: 10,
        fontWeight: "700" as const,
        marginTop: 2,
      },

      /* Selected Day Inspection Card */
      inspectionCard: {
        backgroundColor: innerCardBg,
        borderRadius: 8,
        padding: 12,
        gap: 8,
        borderWidth: 1,
        borderColor: theme.colors.accent,
      },
      inspectionHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      inspectionTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "700" as const,
      },
      inspectionCost: {
        color: theme.colors.accent,
        fontSize: 13,
        fontWeight: "700" as const,
      },
      inspectionStatsRow: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      inspectionStatText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      inspectionModelList: {
        borderTopWidth: 1,
        borderColor,
        paddingTop: 6,
        gap: 4,
      },
      inspectionModelRow: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      inspectionModelName: {
        color: theme.colors.foreground,
        fontSize: 11,
      },
      inspectionModelTokens: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },

      /* Model Breakdown List */
      modelList: {
        gap: 10,
      },
      modelCard: {
        backgroundColor: innerCardBg,
        borderRadius: 8,
        padding: 12,
        gap: 8,
      },
      modelTopRow: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      modelTitleWrap: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        flexShrink: 1,
      },
      modelNameText: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      pricingBasisTag: {
        color: theme.colors.foregroundMuted,
        fontSize: 10,
        backgroundColor: cardBg,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
      },
      modelTokensText: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "700" as const,
      },
      modelDetailRow: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      modelSubText: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      modelCostText: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      modelProgressBar: {
        height: 5,
        borderRadius: 2.5,
        backgroundColor: "rgba(128, 128, 128, 0.2)",
        overflow: "hidden" as const,
      },

      /* State and error rows */
      stateBox: {
        paddingVertical: 24,
        alignItems: "center" as const,
        gap: 8,
      },
      stateText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        textAlign: "center" as const,
      },
    };
  }, [theme, layout.compact]);

  const quotaSnapshot = quotaQuery.data;
  const quotaFetchedAt = quotaSnapshot?.fetchedAt
    ? new Date(quotaSnapshot.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  const analytics = analyticsQuery.data;
  const buckets = analytics?.buckets ?? [];
  const selectedBucket =
    selectedBucketIndex !== null && selectedBucketIndex < buckets.length
      ? buckets[selectedBucketIndex]
      : buckets.length > 0
      ? buckets[buckets.length - 1]
      : null;

  function getBucketCardStyle(intensity: number, isSelected: boolean) {
    let bg = "rgba(128, 128, 128, 0.08)";
    let textColor = theme.colors.foregroundMuted;
    let badgeColor = theme.colors.foregroundMuted;

    if (intensity === 1) {
      bg = "rgba(59, 130, 246, 0.18)";
      badgeColor = theme.colors.accent;
    } else if (intensity === 2) {
      bg = "rgba(59, 130, 246, 0.35)";
      textColor = theme.colors.foreground;
      badgeColor = theme.colors.accent;
    } else if (intensity === 3) {
      bg = "rgba(59, 130, 246, 0.60)";
      textColor = theme.colors.foreground;
      badgeColor = theme.colors.accentForeground;
    } else if (intensity === 4) {
      bg = theme.colors.accent;
      textColor = theme.colors.accentForeground;
      badgeColor = theme.colors.accentForeground;
    }

    return {
      style: [styles.dayCard, { backgroundColor: bg }, isSelected && styles.dayCardSelected],
      textColor,
      badgeColor,
    };
  }

  return (
    <ScrollView testID="provider-usage-surface" style={styles.screen} contentContainerStyle={styles.content}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            Provider & Token Usage
          </Text>
          <View style={styles.captionRow}>
            <Text style={styles.caption}>
              {quotaFetchedAt ? `Plan quotas updated ${quotaFetchedAt}` : "Claude, Codex, Antigravity, and Agent Telemetry"}
            </Text>
            {isUpdating ? (
              <Text style={styles.captionUpdating} accessibilityLiveRegion="polite">
                Updating…
              </Text>
            ) : null}
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh usage and analytics"
          disabled={isUpdating}
          onPress={refreshAll}
          style={({ pressed }) => [styles.refreshBtn, { opacity: isUpdating ? 0.5 : pressed ? 0.7 : 1 }]}
        >
          <Text style={styles.refreshBtnText}>{isUpdating ? "Refreshing" : "Refresh"}</Text>
        </Pressable>
      </View>

      {/* ==================================================================== */}
      {/* SECTION 1: Plan Limits & Headroom (CodexBar)                          */}
      {/* ==================================================================== */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Plan Limits & Quota Headroom</Text>
          <Text style={styles.sectionBadge}>CodexBar direct quota</Text>
        </View>

        {!quotaSnapshot && quotaQuery.isLoading ? (
          <View style={styles.stateBox} accessibilityLiveRegion="polite">
            <ActivityIndicator color={theme.colors.accent} />
            <Text style={styles.stateText}>Reading live quota windows…</Text>
          </View>
        ) : quotaQuery.isError && !quotaSnapshot ? (
          <View style={styles.stateBox} accessibilityLiveRegion="assertive">
            <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>Quota windows could not be loaded.</Text>
            <Text style={styles.stateText}>{quotaQuery.error.message}</Text>
          </View>
        ) : (
          quotaSnapshot?.providers.map((provider: ProviderUsage, idx: number) => (
            <View key={provider.id} style={styles.providerItem}>
              {idx > 0 ? <View style={styles.providerDivider} /> : null}
              <View style={styles.providerHeading}>
                <Text style={styles.providerName}>{provider.name}</Text>
                <Text style={styles.providerMeta}>
                  {[provider.plan, provider.account].filter(Boolean).join(" · ") || "Account limits"}
                </Text>
              </View>

              {provider.error ? (
                <Text style={{ color: theme.colors.statusDanger, fontSize: 12 }}>{provider.error}</Text>
              ) : null}

              <View style={{ gap: 10 }}>
                {provider.windows.map((window) => {
                  const reset = resetLabel(window);
                  const used = Math.round(window.usedPercent);
                  return (
                    <View key={window.id} style={{ gap: 5 }}>
                      <View style={styles.windowRow}>
                        <Text style={styles.windowLabel} numberOfLines={1}>
                          {window.label}
                          {reset ? <Text style={styles.windowReset}>{` (${reset})`}</Text> : null}
                        </Text>
                        <Text style={used >= CRITICAL_USED_PERCENT ? styles.percentageCritical : styles.percentage}>
                          {used}%
                        </Text>
                      </View>
                      <UsageBar usedPercent={window.usedPercent} theme={theme} />
                    </View>
                  );
                })}
              </View>
            </View>
          ))
        )}
      </View>

      {/* ==================================================================== */}
      {/* SECTION 2: Token Spend & Model Analytics                             */}
      {/* ==================================================================== */}
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Historical Token Activity</Text>
          <Text style={styles.sectionBadge}>Agent sessions & turns</Text>
        </View>

        {/* Pricing Transparency Callout */}
        <View style={styles.pricingBanner}>
          <Text style={styles.pricingBannerText}>
            <Text style={{ fontWeight: "700", color: theme.colors.foreground }}>Pricing Transparency: </Text>
            Costs reflect standard direct provider API rates ($/1M tokens) and embedded session telemetry — no OpenRouter markup.
          </Text>
        </View>

        {/* Filter Controls: Range & Provider/Model */}
        <View style={{ gap: 10 }}>
          <View style={styles.filterBar}>
            {(["24h", "7d", "14d", "30d", "all"] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => {
                  setRange(r);
                  setSelectedBucketIndex(null);
                }}
                style={[styles.rangePill, range === r && styles.rangePillActive]}
              >
                <Text style={[styles.rangePillText, range === r && styles.rangePillTextActive]}>
                  {r.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Model and Provider Filter Chips */}
          {analytics && (analytics.availableProviders.length > 1 || analytics.availableModels.length > 1) ? (
            <View style={styles.filterBar}>
              <Pressable
                onPress={() => {
                  setSelectedProvider(undefined);
                  setSelectedModel(undefined);
                }}
                style={[styles.filterChip, !selectedProvider && !selectedModel && styles.filterChipActive]}
              >
                <Text style={[styles.filterChipText, !selectedProvider && !selectedModel && styles.filterChipTextActive]}>
                  All Models
                </Text>
              </Pressable>

              {analytics.availableModels.map((m) => {
                const isSelected = selectedModel === m.id;
                return (
                  <Pressable
                    key={m.id}
                    onPress={() => setSelectedModel(isSelected ? undefined : m.id)}
                    style={[styles.filterChip, isSelected && styles.filterChipActive]}
                  >
                    <Text style={[styles.filterChipText, isSelected && styles.filterChipTextActive]}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {/* Model Trajectory Comparison Bar */}
        {analytics?.models && analytics.models.length > 0 && analytics.summary.totalTokens > 0 ? (
          <View style={styles.trajectoryCard}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
              <Text style={styles.trajectoryTitle}>Model Usage Comparison</Text>
              <Text style={styles.caption}>{formatTokens(analytics.summary.totalTokens)} total tokens</Text>
            </View>

            {/* Segmented Stacked Bar */}
            <View style={styles.stackedBarTrack}>
              {analytics.models.map((m, idx) => {
                if (m.percentage <= 0) return null;
                return (
                  <View
                    key={m.modelId}
                    style={{
                      width: `${m.percentage}%`,
                      backgroundColor: getModelColor(idx),
                      height: "100%",
                    }}
                  />
                );
              })}
            </View>

            {/* Legend chips */}
            <View style={styles.trajectoryLegend}>
              {analytics.models.map((m, idx) => (
                <Pressable
                  key={m.modelId}
                  onPress={() => setSelectedModel(selectedModel === m.modelId ? undefined : m.modelId)}
                  style={styles.trajectoryLegendItem}
                >
                  <View style={[styles.legendDot, { backgroundColor: getModelColor(idx) }]} />
                  <Text
                    style={[
                      styles.legendLabel,
                      selectedModel === m.modelId && { color: theme.colors.foreground, fontWeight: "700" },
                    ]}
                  >
                    {m.modelLabel} ({m.percentage}%)
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Activity Block Showcase (Calendar / Day Grid) */}
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={styles.sectionTitle}>Activity Block Showcase</Text>
            <Text style={styles.caption}>Tap any day to inspect details</Text>
          </View>

          {analyticsQuery.isLoading ? (
            <View style={styles.stateBox}>
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Reading agent activity blocks…</Text>
            </View>
          ) : buckets.length > 0 ? (
            <>
              {/* Row of interactive day blocks */}
              <View style={styles.blockRow}>
                {buckets.map((b, idx) => {
                  const isSelected = selectedBucket?.timestamp === b.timestamp;
                  const { style, textColor, badgeColor } = getBucketCardStyle(b.intensity, isSelected);
                  const parts = b.label.split(",");
                  const dayHeader = parts[0] || b.label;
                  const dateSub = parts[1]?.trim() || "";

                  return (
                    <Pressable
                      key={b.timestamp}
                      accessibilityRole="button"
                      accessibilityLabel={`${b.label}: ${formatTokens(b.totalTokens)} tokens`}
                      onPress={() => setSelectedBucketIndex(idx)}
                      style={style}
                    >
                      <Text style={[styles.dayName, { color: textColor }]}>{dayHeader}</Text>
                      {dateSub ? <Text style={[styles.dayDate, { color: textColor }]}>{dateSub}</Text> : null}
                      <Text style={[styles.dayVolumeBadge, { color: badgeColor }]}>
                        {b.totalTokens > 0 ? formatTokens(b.totalTokens) : "—"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Selected Day Inspection Card */}
              {selectedBucket ? (
                <View style={styles.inspectionCard}>
                  <View style={styles.inspectionHeader}>
                    <Text style={styles.inspectionTitle}>{selectedBucket.label}</Text>
                    <Text style={styles.inspectionCost}>
                      {selectedBucket.estimatedCostUsd !== null ? `Est. ${formatCost(selectedBucket.estimatedCostUsd)}` : "No cost recorded"}
                    </Text>
                  </View>

                  <View style={styles.inspectionStatsRow}>
                    <Text style={styles.inspectionStatText}>
                      Burn: <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>{formatTokens(selectedBucket.totalTokens)}</Text>
                    </Text>
                    <Text style={styles.inspectionStatText}>
                      In: {formatTokens(selectedBucket.inputTokens)} · Out: {formatTokens(selectedBucket.outputTokens)} · Cache: {formatTokens(selectedBucket.cacheReadTokens)}
                    </Text>
                    <Text style={styles.inspectionStatText}>
                      {selectedBucket.sessionCount} sessions · {selectedBucket.turnCount} turns
                    </Text>
                  </View>

                  {selectedBucket.modelBreakdown.length > 0 ? (
                    <View style={styles.inspectionModelList}>
                      {selectedBucket.modelBreakdown.map((mb) => (
                        <View key={mb.modelId} style={styles.inspectionModelRow}>
                          <Text style={styles.inspectionModelName}>{mb.modelLabel}</Text>
                          <Text style={styles.inspectionModelTokens}>
                            {formatTokens(mb.totalTokens)} {mb.estimatedCostUsd ? `(${formatCost(mb.estimatedCostUsd)})` : ""}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </>
          ) : (
            <Text style={styles.stateText}>No activity recorded in this timeframe.</Text>
          )}
        </View>

        {/* Model Breakdown List */}
        <View style={{ gap: 10 }}>
          <Text style={styles.sectionTitle}>Model Breakdown & Pricing Rates</Text>

          {analytics?.models && analytics.models.length > 0 ? (
            <View style={styles.modelList}>
              {analytics.models.map((model, idx) => {
                const color = getModelColor(idx);
                return (
                  <View key={model.modelId} style={styles.modelCard}>
                    <View style={styles.modelTopRow}>
                      <View style={styles.modelTitleWrap}>
                        <View style={[styles.legendDot, { backgroundColor: color }]} />
                        <Text style={styles.modelNameText}>{model.modelLabel}</Text>
                        {model.pricingBasis ? (
                          <Text style={styles.pricingBasisTag}>{model.pricingBasis}</Text>
                        ) : null}
                      </View>
                      <Text style={styles.modelTokensText}>{formatTokens(model.totalTokens)}</Text>
                    </View>

                    {/* Progress Bar */}
                    <View style={styles.modelProgressBar}>
                      <View
                        style={{
                          width: `${Math.max(1, Math.min(100, model.percentage))}%`,
                          height: "100%",
                          backgroundColor: color,
                        }}
                      />
                    </View>

                    <View style={styles.modelDetailRow}>
                      <Text style={styles.modelSubText}>
                        {model.percentage}% share · {formatTokens(model.inputTokens)} in · {formatTokens(model.outputTokens)} out · {formatTokens(model.cacheReadTokens)} cache
                      </Text>
                      <Text style={styles.modelCostText}>{formatCost(model.estimatedCostUsd)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.stateText}>No models discovered.</Text>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
