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
  "#60a5fa", // Blue
  "#a78bfa", // Purple
  "#34d399", // Emerald
  "#f472b6", // Pink
  "#fbbf24", // Amber
  "#38bdf8", // Sky
  "#f87171", // Rose
  "#818cf8", // Indigo
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
  const [activeTab, setActiveTab] = useState<"quotas" | "analytics">("quotas");

  // Filter state for analytics
  const [range, setRange] = useState<TokenAnalyticsFilter["range"]>("7d");
  const [selectedProvider, setSelectedProvider] = useState<string | undefined>(undefined);
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [hoveredBucket, setHoveredBucket] = useState<TokenTimeBucket | null>(null);

  // Quota Query
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

  const refreshQuota = useCallback(() => {
    forceNextQuotaFetch.current = true;
    void quotaQuery.refetch();
  }, [quotaQuery]);

  // Analytics Query
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

  const refreshAnalytics = useCallback(() => {
    void analyticsQuery.refetch();
  }, [analyticsQuery]);

  const styles = useMemo(() => {
    const borderColor = "rgba(128, 128, 128, 0.2)";
    const cardBg = "rgba(128, 128, 128, 0.08)";
    const subCardBg = "rgba(128, 128, 128, 0.14)";

    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        paddingVertical: layout.compact ? 16 : 24,
        paddingHorizontal: layout.compact ? 16 : 28,
        width: "100%" as const,
        maxWidth: 720,
        alignSelf: "center" as const,
      },
      topNav: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 12,
        marginBottom: 20,
      },
      segmentedControl: {
        flexDirection: "row" as const,
        backgroundColor: cardBg,
        borderRadius: 8,
        padding: 3,
        borderWidth: 1,
        borderColor,
      },
      tabButton: {
        paddingVertical: 6,
        paddingHorizontal: 14,
        borderRadius: 6,
      },
      tabButtonActive: {
        backgroundColor: theme.colors.accent,
      },
      tabText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      tabTextActive: {
        color: theme.colors.accentForeground,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 16,
        paddingBottom: 16,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 16,
        fontWeight: "600" as const,
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
      refresh: {
        minHeight: 30,
        paddingHorizontal: 12,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderRadius: 6,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor,
      },
      refreshText: { color: theme.colors.accent, fontSize: 12, fontWeight: "600" as const },
      divider: { height: 1, backgroundColor: borderColor, marginVertical: 12 },
      provider: { paddingVertical: 18, gap: 16 },
      windows: { gap: 14 },
      providerName: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        letterSpacing: 0.3,
        textTransform: "uppercase" as const,
      },
      providerMeta: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 2 },
      window: { gap: 6 },
      windowRow: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      windowLabel: { color: theme.colors.foreground, fontSize: 13, flexShrink: 1 },
      windowReset: { color: theme.colors.foregroundMuted, fontSize: 12 },
      percentage: { color: theme.colors.foreground, fontSize: 13, fontWeight: "600" as const },
      percentageCritical: {
        color: theme.colors.statusDanger,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 18 },
      state: { paddingVertical: 48, alignItems: "center" as const, gap: 12 },
      stateText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        textAlign: "center" as const,
      },

      /* Analytics UI styles */
      filterBar: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        alignItems: "center" as const,
        marginBottom: 16,
      },
      filterPill: {
        paddingVertical: 5,
        paddingHorizontal: 10,
        borderRadius: 6,
        backgroundColor: cardBg,
        borderWidth: 1,
        borderColor,
      },
      filterPillActive: {
        backgroundColor: theme.colors.accent,
        borderColor: theme.colors.accent,
      },
      filterPillText: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500" as const,
      },
      filterPillTextActive: {
        color: theme.colors.accentForeground,
        fontWeight: "600" as const,
      },
      kpiGrid: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 10,
        marginBottom: 20,
      },
      kpiCard: {
        flex: 1,
        minWidth: layout.compact ? 130 : 150,
        backgroundColor: cardBg,
        borderRadius: 8,
        padding: 12,
        borderWidth: 1,
        borderColor,
        gap: 4,
      },
      kpiLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        textTransform: "uppercase" as const,
        letterSpacing: 0.3,
      },
      kpiValue: {
        color: theme.colors.foreground,
        fontSize: 18,
        fontWeight: "700" as const,
      },
      kpiSub: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      sectionBox: {
        backgroundColor: cardBg,
        borderRadius: 8,
        padding: 14,
        borderWidth: 1,
        borderColor,
        marginBottom: 16,
        gap: 12,
      },
      sectionTitle: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        letterSpacing: 0.2,
      },
      sectionSubtitle: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        marginTop: 1,
      },

      /* Activity block showcase styles */
      gridContainer: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 6,
        alignItems: "center" as const,
      },
      blockCell: {
        width: layout.compact ? 24 : 28,
        height: layout.compact ? 24 : 28,
        borderRadius: 4,
        borderWidth: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      legendRow: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "flex-end" as const,
        gap: 6,
        marginTop: 6,
      },
      legendText: {
        color: theme.colors.foregroundMuted,
        fontSize: 10,
      },
      legendBox: {
        width: 12,
        height: 12,
        borderRadius: 2,
        borderWidth: 1,
      },

      /* Tooltip Inspection Box */
      tooltipCard: {
        backgroundColor: subCardBg,
        borderRadius: 6,
        padding: 10,
        borderWidth: 1,
        borderColor,
        gap: 6,
      },
      tooltipHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
      },
      tooltipDate: {
        color: theme.colors.foreground,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      tooltipCost: {
        color: theme.colors.accent,
        fontSize: 12,
        fontWeight: "600" as const,
      },
      tooltipDetails: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 12,
      },
      tooltipItem: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },
      tooltipModelRow: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "center" as const,
        paddingTop: 2,
      },
      tooltipModelName: {
        color: theme.colors.foreground,
        fontSize: 11,
      },
      tooltipModelTokens: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
      },

      /* Model Breakdown list */
      modelRow: {
        gap: 6,
        paddingVertical: 6,
      },
      modelHeader: {
        flexDirection: "row" as const,
        justifyContent: "space-between" as const,
        alignItems: "baseline" as const,
      },
      modelNameWrap: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        flexShrink: 1,
      },
      modelDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
      },
      modelLabel: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "500" as const,
      },
      modelProviderTag: {
        color: theme.colors.foregroundMuted,
        fontSize: 10,
        backgroundColor: subCardBg,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
      },
      modelStats: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        gap: 8,
      },
      modelTokens: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
      },
      modelCost: {
        color: theme.colors.foregroundMuted,
        fontSize: 12,
      },
      progressBarTrack: {
        height: 6,
        borderRadius: 3,
        backgroundColor: subCardBg,
        overflow: "hidden" as const,
      },
      progressBarFill: {
        height: "100%" as const,
        borderRadius: 3,
      },
    };
  }, [theme, layout.compact]);

  const quotaSnapshot = quotaQuery.data;
  const quotaFetchedAt = quotaSnapshot?.fetchedAt
    ? new Date(quotaSnapshot.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  const quotaUpdating = Boolean(quotaSnapshot) && (quotaSnapshot?.stale === true || quotaQuery.isFetching);

  const analytics = analyticsQuery.data;
  const activeBucket =
    hoveredBucket ??
    (analytics?.buckets && analytics.buckets.length > 0 ? analytics.buckets[analytics.buckets.length - 1] : null);

  function getIntensityStyle(intensity: number) {
    const borderColor = "rgba(128, 128, 128, 0.2)";
    const emptyBg = "rgba(128, 128, 128, 0.12)";
    switch (intensity) {
      case 1:
        return { backgroundColor: theme.colors.accent, opacity: 0.35, borderColor: theme.colors.accent };
      case 2:
        return { backgroundColor: theme.colors.accent, opacity: 0.6, borderColor: theme.colors.accent };
      case 3:
        return { backgroundColor: theme.colors.accent, opacity: 0.85, borderColor: theme.colors.accent };
      case 4:
        return { backgroundColor: theme.colors.accent, opacity: 1.0, borderColor: theme.colors.accent };
      case 0:
      default:
        return { backgroundColor: emptyBg, opacity: 0.6, borderColor };
    }
  }

  return (
    <ScrollView testID="provider-usage-surface" style={styles.screen} contentContainerStyle={styles.content}>
      {/* Top Navigation: Plan Quotas vs Token Analytics */}
      <View style={styles.topNav}>
        <View style={styles.segmentedControl}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch to Plan Quotas"
            onPress={() => setActiveTab("quotas")}
            style={[styles.tabButton, activeTab === "quotas" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, activeTab === "quotas" && styles.tabTextActive]}>Plan Quotas</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Switch to Token Analytics"
            onPress={() => setActiveTab("analytics")}
            style={[styles.tabButton, activeTab === "analytics" && styles.tabButtonActive]}
          >
            <Text style={[styles.tabText, activeTab === "analytics" && styles.tabTextActive]}>Token Analytics</Text>
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh current view"
          disabled={activeTab === "quotas" ? quotaUpdating : analyticsQuery.isFetching}
          onPress={activeTab === "quotas" ? refreshQuota : refreshAnalytics}
          style={({ pressed }) => [
            styles.refresh,
            { opacity: (activeTab === "quotas" ? quotaUpdating : analyticsQuery.isFetching) ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.refreshText}>
            {(activeTab === "quotas" ? quotaUpdating : analyticsQuery.isFetching) ? "Refreshing" : "Refresh"}
          </Text>
        </Pressable>
      </View>

      {/* ==================================================================== */}
      {/* TAB 1: Plan Quotas                                                   */}
      {/* ==================================================================== */}
      {activeTab === "quotas" ? (
        <View>
          <View style={styles.header}>
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                Plan usage & rate limits
              </Text>
              <View style={styles.captionRow}>
                <Text style={styles.caption}>
                  {quotaFetchedAt ? `Updated ${quotaFetchedAt}` : "Claude, Codex, and Antigravity"}
                </Text>
                {quotaUpdating ? (
                  <Text style={styles.captionUpdating} accessibilityLiveRegion="polite">
                    Updating…
                  </Text>
                ) : null}
              </View>
            </View>
          </View>

          {!quotaSnapshot && quotaQuery.isLoading ? (
            <View style={styles.state} accessibilityLiveRegion="polite">
              <ActivityIndicator color={theme.colors.accent} />
              <Text style={styles.stateText}>Reading plan limits…</Text>
            </View>
          ) : quotaQuery.isError && !quotaSnapshot ? (
            <View style={styles.state} accessibilityLiveRegion="assertive">
              <Text style={styles.error}>Usage could not be loaded.</Text>
              <Text style={styles.stateText}>{quotaQuery.error.message}</Text>
            </View>
          ) : (
            quotaSnapshot?.providers.map((provider: ProviderUsage) => (
              <View key={provider.id}>
                <View style={styles.divider} />
                <View style={styles.provider}>
                  <View>
                    <Text style={styles.providerName}>{provider.name}</Text>
                    <Text style={styles.providerMeta}>
                      {[provider.plan, provider.account, provider.source].filter(Boolean).join(" · ") ||
                        "Local authentication"}
                    </Text>
                  </View>

                  {provider.error ? <Text style={styles.error}>{provider.error}</Text> : null}
                  {!provider.error && provider.windows.length === 0 ? (
                    <Text style={styles.stateText}>No usage windows were reported.</Text>
                  ) : null}

                  <View style={styles.windows}>
                    {provider.windows.map((window) => {
                      const reset = resetLabel(window);
                      const used = Math.round(window.usedPercent);
                      return (
                        <View
                          key={window.id}
                          style={styles.window}
                          accessibilityLabel={`${provider.name} ${window.label}: ${used}% used${
                            reset ? `, ${reset}` : ""
                          }`}
                        >
                          <View style={styles.windowRow}>
                            <Text style={styles.windowLabel} numberOfLines={1}>
                              {window.label}
                              {reset ? <Text style={styles.windowReset}>{`  ${reset}`}</Text> : null}
                            </Text>
                            <Text
                              style={used >= CRITICAL_USED_PERCENT ? styles.percentageCritical : styles.percentage}
                            >
                              {used}%
                            </Text>
                          </View>
                          <UsageBar usedPercent={window.usedPercent} theme={theme} />
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            ))
          )}
        </View>
      ) : (
        /* ==================================================================== */
        /* TAB 2: Token Analytics & Block Showcase                              */
        /* ==================================================================== */
        <View>
          {/* Filter Bar */}
          <View style={styles.filterBar}>
            {(["24h", "7d", "14d", "30d", "all"] as const).map((r) => (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                style={[styles.filterPill, range === r && styles.filterPillActive]}
              >
                <Text style={[styles.filterPillText, range === r && styles.filterPillTextActive]}>
                  {r.toUpperCase()}
                </Text>
              </Pressable>
            ))}

            {/* Provider Filter */}
            {analytics?.availableProviders && analytics.availableProviders.length > 1 ? (
              <>
                <View style={{ width: 1, height: 16, backgroundColor: "rgba(128, 128, 128, 0.2)", marginHorizontal: 4 }} />
                <Pressable
                  onPress={() => setSelectedProvider(undefined)}
                  style={[styles.filterPill, selectedProvider === undefined && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, selectedProvider === undefined && styles.filterPillTextActive]}>
                    All Providers
                  </Text>
                </Pressable>
                {analytics.availableProviders.map((p) => (
                  <Pressable
                    key={p.id}
                    onPress={() => setSelectedProvider(selectedProvider === p.id ? undefined : p.id)}
                    style={[styles.filterPill, selectedProvider === p.id && styles.filterPillActive]}
                  >
                    <Text style={[styles.filterPillText, selectedProvider === p.id && styles.filterPillTextActive]}>
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </>
            ) : null}
            {/* Model Filter */}
            {analytics?.availableModels && analytics.availableModels.length > 1 ? (
              <>
                <View style={{ width: 1, height: 16, backgroundColor: "rgba(128, 128, 128, 0.2)", marginHorizontal: 4 }} />
                <Pressable
                  onPress={() => setSelectedModel(undefined)}
                  style={[styles.filterPill, selectedModel === undefined && styles.filterPillActive]}
                >
                  <Text style={[styles.filterPillText, selectedModel === undefined && styles.filterPillTextActive]}>
                    All Models
                  </Text>
                </Pressable>
                {analytics.availableModels
                  .filter((m) => !selectedProvider || m.providerId === selectedProvider)
                  .map((m) => (
                    <Pressable
                      key={m.id}
                      onPress={() => setSelectedModel(selectedModel === m.id ? undefined : m.id)}
                      style={[styles.filterPill, selectedModel === m.id && styles.filterPillActive]}
                    >
                      <Text style={[styles.filterPillText, selectedModel === m.id && styles.filterPillTextActive]}>
                        {m.label}
                      </Text>
                    </Pressable>
                  ))}
              </>
            ) : null}
          </View>

          {/* KPI Summary Cards */}
          {analytics ? (
            <View style={styles.kpiGrid}>
              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Total Burn</Text>
                <Text style={styles.kpiValue}>{formatTokens(analytics.summary.totalTokens)}</Text>
                <Text style={styles.kpiSub}>
                  {formatTokens(analytics.summary.inputTokens)} in · {formatTokens(analytics.summary.outputTokens)} out
                </Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Est. API Cost</Text>
                <Text style={styles.kpiValue}>{formatCost(analytics.summary.estimatedCostUsd)}</Text>
                <Text style={styles.kpiSub}>Equivalent API rate</Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Top Model</Text>
                <Text style={styles.kpiValue} numberOfLines={1}>
                  {analytics.summary.topModelLabel ?? "None"}
                </Text>
                <Text style={styles.kpiSub}>
                  {analytics.summary.topModelShare > 0 ? `${analytics.summary.topModelShare}% of total` : "No activity"}
                </Text>
              </View>

              <View style={styles.kpiCard}>
                <Text style={styles.kpiLabel}>Daily Pace</Text>
                <Text style={styles.kpiValue}>{formatTokens(analytics.summary.avgDailyTokens)}</Text>
                <Text style={styles.kpiSub}>
                  {analytics.summary.sessionCount} sessions · {analytics.summary.turnCount} turns
                </Text>
              </View>
            </View>
          ) : null}

          {/* Activity Block Showcase (Heatmap Grid) */}
          <View style={styles.sectionBox}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View>
                <Text style={styles.sectionTitle}>Activity Block Showcase</Text>
                <Text style={styles.sectionSubtitle}>
                  {range === "24h"
                    ? "Hourly token consumption (last 24 hours)"
                    : `Daily activity blocks (${range.toUpperCase()})`}
                </Text>
              </View>
            </View>

            {analyticsQuery.isLoading ? (
              <View style={styles.state}>
                <ActivityIndicator color={theme.colors.accent} />
                <Text style={styles.stateText}>Scanning agent token logs…</Text>
              </View>
            ) : analytics && analytics.buckets.length > 0 ? (
              <View style={{ gap: 12 }}>
                {/* Blocks Grid */}
                <View style={styles.gridContainer}>
                  {analytics.buckets.map((bucket, idx) => {
                    const isSelected = activeBucket?.timestamp === bucket.timestamp;
                    const intensityStyle = getIntensityStyle(bucket.intensity);
                    return (
                      <Pressable
                        key={bucket.timestamp || idx}
                        accessibilityRole="button"
                        accessibilityLabel={`${bucket.label}: ${formatTokens(bucket.totalTokens)} tokens`}
                        onPress={() => setHoveredBucket(bucket)}
                        style={[
                          styles.blockCell,
                          intensityStyle,
                          isSelected && { borderColor: theme.colors.foreground, borderWidth: 2 },
                        ]}
                      />
                    );
                  })}
                </View>

                {/* Legend */}
                <View style={styles.legendRow}>
                  <Text style={styles.legendText}>Less</Text>
                  {[0, 1, 2, 3, 4].map((lvl) => (
                    <View key={lvl} style={[styles.legendBox, getIntensityStyle(lvl)]} />
                  ))}
                  <Text style={styles.legendText}>More</Text>
                </View>

                {/* Interactive Tooltip Card for Selected Block */}
                {activeBucket ? (
                  <View style={styles.tooltipCard}>
                    <View style={styles.tooltipHeader}>
                      <Text style={styles.tooltipDate}>{activeBucket.label}</Text>
                      <Text style={styles.tooltipCost}>
                        {activeBucket.estimatedCostUsd !== null
                          ? `Est. ${formatCost(activeBucket.estimatedCostUsd)}`
                          : "No cost recorded"}
                      </Text>
                    </View>

                    <View style={styles.tooltipDetails}>
                      <Text style={styles.tooltipItem}>
                        Total:{" "}
                        <Text style={{ color: theme.colors.foreground, fontWeight: "600" }}>
                          {formatTokens(activeBucket.totalTokens)}
                        </Text>
                      </Text>
                      <Text style={styles.tooltipItem}>
                        In: {formatTokens(activeBucket.inputTokens)} · Out: {formatTokens(activeBucket.outputTokens)} ·
                        Cache: {formatTokens(activeBucket.cacheReadTokens)}
                      </Text>
                      <Text style={styles.tooltipItem}>
                        {activeBucket.sessionCount} sessions · {activeBucket.turnCount} turns
                      </Text>
                    </View>

                    {activeBucket.modelBreakdown.length > 0 ? (
                      <View
                        style={{
                          borderTopWidth: 1,
                          borderColor: "rgba(128, 128, 128, 0.2)",
                          paddingTop: 4,
                          gap: 2,
                        }}
                      >
                        {activeBucket.modelBreakdown.map((mb) => (
                          <View key={mb.modelId} style={styles.tooltipModelRow}>
                            <Text style={styles.tooltipModelName}>{mb.modelLabel}</Text>
                            <Text style={styles.tooltipModelTokens}>
                              {formatTokens(mb.totalTokens)}{" "}
                              {mb.estimatedCostUsd ? `(${formatCost(mb.estimatedCostUsd)})` : ""}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : (
              <Text style={styles.stateText}>No token usage recorded for this timeframe.</Text>
            )}
          </View>

          {/* Model Breakdown & Trends */}
          <View style={styles.sectionBox}>
            <Text style={styles.sectionTitle}>Model Breakdown & Trajectory</Text>
            <Text style={styles.sectionSubtitle}>Share of token burn and estimated cost by model</Text>

            {analytics?.models && analytics.models.length > 0 ? (
              <View style={{ gap: 12 }}>
                {analytics.models.map((model, idx) => {
                  const color = getModelColor(idx);
                  return (
                    <View key={model.modelId} style={styles.modelRow}>
                      <View style={styles.modelHeader}>
                        <View style={styles.modelNameWrap}>
                          <View style={[styles.modelDot, { backgroundColor: color }]} />
                          <Text style={styles.modelLabel}>{model.modelLabel}</Text>
                          <Text style={styles.modelProviderTag}>{model.providerLabel}</Text>
                        </View>
                        <View style={styles.modelStats}>
                          <Text style={styles.modelTokens}>{formatTokens(model.totalTokens)}</Text>
                          <Text style={styles.modelCost}>({model.percentage}%)</Text>
                          {model.estimatedCostUsd !== null ? (
                            <Text style={[styles.modelCost, { color: theme.colors.accent }]}>
                              {formatCost(model.estimatedCostUsd)}
                            </Text>
                          ) : null}
                        </View>
                      </View>

                      {/* Progress bar */}
                      <View style={styles.progressBarTrack}>
                        <View
                          style={[
                            styles.progressBarFill,
                            {
                              width: `${Math.max(1, Math.min(100, model.percentage))}%`,
                              backgroundColor: color,
                            },
                          ]}
                        />
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text style={styles.stateText}>No models discovered in the current filter.</Text>
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}
