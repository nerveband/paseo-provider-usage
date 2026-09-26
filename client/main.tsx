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
} from "../shared/usage";

/** Used share at or above which a window is reported as nearly exhausted. */
const CRITICAL_USED_PERCENT = 90;

const RANGES = ["24h", "7d", "14d", "30d", "all"] as const;

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

/** A fill layer that derives a tint from a theme color, so every theme stays legible. */
function Tint({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color, opacity }}
    />
  );
}

/** Horizontal share bar measured from zero. */
function ShareBar({ percent, color, theme }: { percent: number; color: string; theme: PluginTheme }) {
  return (
    <View
      style={{ height: 4, borderRadius: 2, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
    >
      <Tint color={theme.colors.foreground} opacity={0.08} />
      <View
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height: "100%",
          borderRadius: 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const [range, setRange] = useState<TokenAnalyticsFilter["range"]>("7d");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null);

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

  const fetchAnalytics = useRpc(getTokenAnalytics);
  const analyticsQuery = useQuery({
    queryKey: ["token-analytics", range, selectedModel],
    queryFn: () => fetchAnalytics({ range, modelId: selectedModel }),
    staleTime: 30_000,
  });

  const refreshAll = useCallback(() => {
    forceNextQuotaFetch.current = true;
    void quotaQuery.refetch();
    void analyticsQuery.refetch();
  }, [quotaQuery, analyticsQuery]);

  const isUpdating =
    quotaQuery.data?.stale === true || quotaQuery.isFetching || analyticsQuery.isFetching;

  const styles = useMemo(() => {
    const muted = theme.colors.foregroundMuted;
    const fg = theme.colors.foreground;
    return {
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        paddingVertical: layout.compact ? 16 : 28,
        paddingHorizontal: layout.compact ? 16 : 28,
        width: "100%" as const,
        maxWidth: 640,
        alignSelf: "center" as const,
        gap: layout.compact ? 24 : 32,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "flex-start" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      title: { color: fg, fontSize: 17, fontWeight: "600" as const },
      caption: { color: muted, fontSize: 12, marginTop: 2 },
      textButton: { color: theme.colors.accent, fontSize: 13, fontWeight: "500" as const },
      section: { gap: layout.compact ? 14 : 16 },
      sectionTitle: { color: muted, fontSize: 12, fontWeight: "600" as const },
      block: { gap: 10 },
      rowBetween: {
        flexDirection: "row" as const,
        alignItems: "baseline" as const,
        justifyContent: "space-between" as const,
        gap: 12,
      },
      name: { color: fg, fontSize: 14, fontWeight: "600" as const },
      meta: { color: muted, fontSize: 12, flexShrink: 1, textAlign: "right" as const },
      label: { color: fg, fontSize: 13, flexShrink: 1 },
      subtle: { color: muted, fontSize: 12 },
      value: { color: fg, fontSize: 13, fontWeight: "500" as const, fontVariant: ["tabular-nums" as const] },
      valueCritical: {
        color: theme.colors.statusDanger,
        fontSize: 13,
        fontWeight: "600" as const,
        fontVariant: ["tabular-nums" as const],
      },
      danger: { color: theme.colors.statusDanger, fontSize: 12 },
      divider: { height: 1, overflow: "hidden" as const },
      segmented: {
        flexDirection: "row" as const,
        alignSelf: "flex-start" as const,
        borderRadius: 8,
        padding: 2,
        overflow: "hidden" as const,
      },
      segment: { overflow: "hidden" as const, paddingVertical: 4, paddingHorizontal: layout.compact ? 9 : 12, borderRadius: 6 },
      segmentText: { color: muted, fontSize: 12, fontWeight: "500" as const },
      segmentTextActive: { color: fg, fontSize: 12, fontWeight: "600" as const },
      stats: { flexDirection: "row" as const, gap: layout.compact ? 20 : 32 },
      statValue: { color: fg, fontSize: 20, fontWeight: "600" as const, fontVariant: ["tabular-nums" as const] },
      chart: { flexDirection: "row" as const, alignItems: "flex-end" as const, height: 72, gap: 3 },
      footnote: { color: muted, fontSize: 11, lineHeight: 16 },
      state: { paddingVertical: 20, alignItems: "center" as const, gap: 8 },
    };
  }, [theme, layout.compact]);

  const divider = (
    <View style={styles.divider}>
      <Tint color={theme.colors.foreground} opacity={0.08} />
    </View>
  );

  const quotaSnapshot = quotaQuery.data;
  const updatedAt = quotaSnapshot?.fetchedAt
    ? new Date(quotaSnapshot.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  const analytics = analyticsQuery.data;
  const buckets = analytics?.buckets ?? [];
  const maxBucketTokens = buckets.reduce((max, b) => Math.max(max, b.totalTokens), 0);
  const activeBucketIndex =
    selectedBucketIndex !== null && selectedBucketIndex < buckets.length
      ? selectedBucketIndex
      : buckets.length - 1;
  const activeBucket = activeBucketIndex >= 0 ? buckets[activeBucketIndex] : null;
  const selectedModelLabel = selectedModel
    ? analytics?.availableModels.find((m) => m.id === selectedModel)?.label ?? selectedModel
    : null;

  return (
    <ScrollView testID="provider-usage-surface" style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={{ flexShrink: 1 }}>
          <Text accessibilityRole="header" style={styles.title}>
            Usage
          </Text>
          <Text style={styles.caption} accessibilityLiveRegion="polite">
            {isUpdating ? "Updating…" : updatedAt ? `Updated ${updatedAt}` : "Plans and agent activity"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh usage"
          disabled={isUpdating}
          onPress={refreshAll}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: isUpdating ? 0.4 : pressed ? 0.6 : 1, paddingVertical: 2 })}
        >
          <Text style={styles.textButton}>Refresh</Text>
        </Pressable>
      </View>

      {/* Plans */}
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          Plans
        </Text>

        {!quotaSnapshot && quotaQuery.isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : quotaQuery.isError && !quotaSnapshot ? (
          <Text style={styles.danger}>Usage could not be loaded. {quotaQuery.error.message}</Text>
        ) : (
          quotaSnapshot?.providers.map((provider, idx) => {
            const spend = provider.spend;
            const meta = [provider.plan, provider.account].filter(Boolean).join(" · ");
            return (
              <View key={provider.id} style={{ gap: 14 }}>
                {idx > 0 ? divider : null}
                <View style={styles.block}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.name}>{provider.name}</Text>
                    {meta ? (
                      <Text style={styles.meta} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>

                  {provider.error ? <Text style={styles.danger}>{provider.error}</Text> : null}

                  {provider.windows.map((window) => {
                    const reset = resetLabel(window);
                    const used = Math.round(window.usedPercent);
                    const critical = used >= CRITICAL_USED_PERCENT;
                    return (
                      <View
                        key={window.id}
                        style={{ gap: 6 }}
                        accessible
                        accessibilityLabel={`${window.label}, ${used}% used${reset ? `, ${reset}` : ""}`}
                      >
                        <View style={styles.rowBetween}>
                          <Text style={styles.label} numberOfLines={1}>
                            {window.label}
                            {reset ? <Text style={styles.subtle}>{`  ${reset}`}</Text> : null}
                          </Text>
                          <Text style={critical ? styles.valueCritical : styles.value}>{used}%</Text>
                        </View>
                        <ShareBar
                          percent={window.usedPercent}
                          color={critical ? theme.colors.statusDanger : theme.colors.accent}
                          theme={theme}
                        />
                      </View>
                    );
                  })}

                  {spend?.groups.map((group) => (
                    <View key={group.title} style={{ gap: 6 }}>
                      <Text style={styles.subtle}>{group.title}</Text>
                      {group.rows.map((row) => (
                        <View
                          key={row.label}
                          style={styles.rowBetween}
                          accessible
                          accessibilityLabel={`${row.label}: ${row.value}`}
                        >
                          <Text style={styles.label}>{row.label}</Text>
                          <Text style={styles.value}>{row.value}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                  {spend?.note ? <Text style={styles.footnote}>{spend.note}</Text> : null}
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Agent activity */}
      <View style={styles.section}>
        <View style={styles.rowBetween}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            Agent activity
          </Text>
          <View style={styles.segmented} accessibilityRole="tablist">
            <Tint color={theme.colors.foreground} opacity={0.06} />
            {RANGES.map((r) => {
              const active = range === r;
              return (
                <Pressable
                  key={r}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={r === "all" ? "All time" : `Last ${r}`}
                  onPress={() => {
                    setRange(r);
                    setSelectedBucketIndex(null);
                  }}
                  style={styles.segment}
                >
                  {active ? <Tint color={theme.colors.surface0} opacity={1} /> : null}
                  <Text style={active ? styles.segmentTextActive : styles.segmentText}>
                    {r === "all" ? "All" : r}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {selectedModelLabel ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Showing ${selectedModelLabel}. Show all models`}
            onPress={() => setSelectedModel(undefined)}
          >
            <Text style={styles.subtle}>
              Showing {selectedModelLabel} · <Text style={styles.textButton}>All models</Text>
            </Text>
          </Pressable>
        ) : null}

        {analyticsQuery.isLoading ? (
          <View style={styles.state}>
            <ActivityIndicator color={theme.colors.accent} />
          </View>
        ) : analyticsQuery.isError ? (
          <Text style={styles.danger}>Activity could not be loaded. {analyticsQuery.error.message}</Text>
        ) : analytics && analytics.summary.totalTokens > 0 ? (
          <>
            <View style={styles.stats}>
              {[
                { label: "Tokens", value: formatTokens(analytics.summary.totalTokens) },
                { label: "Est. cost", value: formatCost(analytics.summary.estimatedCostUsd) },
                { label: "Sessions", value: analytics.summary.sessionCount.toLocaleString() },
              ].map((stat) => (
                <View key={stat.label} accessible accessibilityLabel={`${stat.label}: ${stat.value}`}>
                  <Text style={styles.statValue}>{stat.value}</Text>
                  <Text style={styles.subtle}>{stat.label}</Text>
                </View>
              ))}
            </View>

            {buckets.length > 1 ? (
              <View style={{ gap: 8 }}>
                <View style={styles.chart}>
                  {buckets.map((b, idx) => {
                    const active = idx === activeBucketIndex;
                    const height = maxBucketTokens > 0 ? (b.totalTokens / maxBucketTokens) * 100 : 0;
                    return (
                      <Pressable
                        key={b.timestamp}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`${b.label}: ${formatTokens(b.totalTokens)} tokens`}
                        onPress={() => setSelectedBucketIndex(idx)}
                        style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
                      >
                        <View
                          style={{
                            height: b.totalTokens > 0 ? `${Math.max(3, height)}%` : 2,
                            borderRadius: 2,
                            overflow: "hidden",
                          }}
                        >
                          <Tint color={theme.colors.accent} opacity={active ? 1 : b.totalTokens > 0 ? 0.35 : 0.12} />
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                {activeBucket ? (
                  <View style={styles.rowBetween}>
                    <Text style={styles.label}>{activeBucket.label}</Text>
                    <Text style={styles.subtle}>
                      {formatTokens(activeBucket.totalTokens)} tokens · {formatCost(activeBucket.estimatedCostUsd)} ·{" "}
                      {activeBucket.turnCount} turns
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {divider}

            <View style={{ gap: 14 }}>
              {analytics.models.map((model) => {
                const active = selectedModel === model.modelId;
                return (
                  <Pressable
                    key={model.modelId}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`${model.modelLabel}: ${formatTokens(model.totalTokens)} tokens, ${model.percentage}% share, ${formatCost(model.estimatedCostUsd)}`}
                    onPress={() => setSelectedModel(active ? undefined : model.modelId)}
                    style={({ pressed }) => ({ gap: 6, opacity: pressed ? 0.6 : 1 })}
                  >
                    <View style={styles.rowBetween}>
                      <Text style={[styles.label, active && { fontWeight: "600" }]} numberOfLines={1}>
                        {model.modelLabel}
                      </Text>
                      <Text style={styles.value}>
                        {formatTokens(model.totalTokens)}
                        <Text style={styles.subtle}>{`  ${formatCost(model.estimatedCostUsd)}`}</Text>
                      </Text>
                    </View>
                    <ShareBar percent={model.percentage} color={theme.colors.accent} theme={theme} />
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.footnote}>
              Costs are estimates at direct provider API rates, not OpenRouter billing.
              {analytics.coverage.unpricedTokens > 0
                ? ` ${formatTokens(analytics.coverage.unpricedTokens)} tokens have no known price.`
                : ""}
            </Text>
          </>
        ) : (
          <Text style={styles.subtle}>No agent activity in this range.</Text>
        )}
      </View>
    </ScrollView>
  );
}
