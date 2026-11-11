import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import React from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { modelMatches } from "../shared/layout";
import type { TokenAnalyticsFilter, TokenAnalyticsResponse, TokenModelSummary } from "../shared/usage";
import { Card, Divider, ShareBar, TIGHT_FONT_SCALE, TOUCH, Tint, space, type Styles } from "./parts";

export const RANGES = ["24h", "7d", "14d", "30d", "all"] as const;

export function formatTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function formatCost(value: number | null): string {
  if (value === null) return "n/a";
  if (value < 0.01 && value > 0) return "<$0.01";
  return usd.format(value);
}

function ModelRow({
  model,
  active,
  onPress,
  theme,
  styles,
}: {
  model: TokenModelSummary;
  active: boolean;
  onPress(): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${model.modelLabel}: ${formatTokens(model.totalTokens)} tokens, ${model.percentage}% share, ${formatCost(model.estimatedCostUsd)}`}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: TOUCH,
        justifyContent: "center",
        gap: space.sm - 2,
        paddingVertical: space.xs,
        paddingHorizontal: space.sm,
        marginHorizontal: -space.sm,
        borderRadius: 8,
        overflow: "hidden",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      {active ? <Tint color={theme.colors.foreground} opacity={0.07} /> : null}
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.md }}>
        <Text style={[styles.label, { flex: 1, minWidth: 0 }, active ? { fontWeight: "600" } : null]} numberOfLines={2}>
          {model.modelLabel}
        </Text>
        <Text style={styles.subtleNumber}>{formatCost(model.estimatedCostUsd)}</Text>
        <Text style={[styles.value, { minWidth: 56 }]}>{formatTokens(model.totalTokens)}</Text>
      </View>
      <ShareBar percent={model.percentage} color={theme.colors.accent} theme={theme} />
    </Pressable>
  );
}

export function ActivityCard({
  theme,
  styles,
  analytics,
  loading,
  error,
  range,
  onRange,
  selectedModel,
  onSelectModel,
  selectedBucketIndex,
  onSelectBucket,
  modelFilter = null,
  wide,
  narrow,
}: {
  theme: PluginTheme;
  styles: Styles;
  analytics: TokenAnalyticsResponse | undefined;
  loading: boolean;
  error: string | null;
  range: TokenAnalyticsFilter["range"];
  onRange(range: TokenAnalyticsFilter["range"]): void;
  selectedModel: string | undefined;
  onSelectModel(modelId: string | undefined): void;
  selectedBucketIndex: number | null;
  onSelectBucket(index: number): void;
  /** Search words: only models whose name matches are listed. Null lists every model. */
  modelFilter?: readonly string[] | null;
  /** Room for a taller chart and a two-column model list. */
  wide: boolean;
  /** Too narrow for the range tabs beside the title. */
  narrow: boolean;
}) {
  const buckets = analytics?.buckets ?? [];
  const maxBucketTokens = buckets.reduce((max, b) => Math.max(max, b.totalTokens), 0);
  const activeBucketIndex =
    selectedBucketIndex !== null && selectedBucketIndex < buckets.length ? selectedBucketIndex : buckets.length - 1;
  const activeBucket = activeBucketIndex >= 0 ? buckets[activeBucketIndex] : null;
  const unit = analytics?.bucketGranularity === "hour" ? "hour" : "day";
  const selectedModelLabel = selectedModel
    ? analytics?.availableModels.find((m) => m.id === selectedModel)?.label ?? selectedModel
    : null;
  const allModels = analytics?.models ?? [];
  const models = modelFilter ? allModels.filter((model) => modelMatches(model, modelFilter)) : allModels;
  const half = Math.ceil(models.length / 2);
  const modelColumns = wide && models.length > 4 ? [models.slice(0, half), models.slice(half)] : [models];

  const tabs = (
    <View style={[styles.segmented, narrow ? { alignSelf: "stretch" } : null]} accessibilityRole="tablist">
      <View pointerEvents="none" style={styles.segmentTrack}>
        <Tint color={theme.colors.foreground} opacity={0.07} />
      </View>
      {RANGES.map((r) => {
        const active = range === r;
        return (
          <Pressable
            key={r}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            aria-selected={active}
            accessibilityLabel={r === "all" ? "All time" : `Last ${r}`}
            onPress={() => onRange(r)}
            style={[styles.segment, narrow ? { flex: 1 } : null]}
          >
            <View style={styles.segmentPill}>
              {active ? <Tint color={theme.colors.surface0} opacity={1} /> : null}
              <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={active ? styles.segmentTextActive : styles.segmentText}>
                {r === "all" ? "All" : r}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );

  const step = (delta: number) => {
    const next = activeBucketIndex + delta;
    if (next >= 0 && next < buckets.length) onSelectBucket(next);
  };
  const stepButton = (delta: -1 | 1) => {
    const disabled = delta < 0 ? activeBucketIndex <= 0 : activeBucketIndex >= buckets.length - 1;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={delta < 0 ? `Previous ${unit}` : `Next ${unit}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => step(delta)}
        style={({ pressed }) => [styles.iconButton, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
      >
        <Icon name={delta < 0 ? "ChevronLeft" : "ChevronRight"} size={18} color={theme.colors.foreground} />
      </Pressable>
    );
  };

  return (
    <Card theme={theme} styles={styles}>
      <View
        style={
          narrow
            ? { gap: space.md }
            : { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }
        }
      >
        <Text style={[styles.name, { flexShrink: 1 }]} numberOfLines={2}>
          {selectedModelLabel ?? "All models"}
        </Text>
        {tabs}
      </View>

      {selectedModelLabel ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Showing ${selectedModelLabel}. Show all models`}
          onPress={() => onSelectModel(undefined)}
          style={({ pressed }) => [styles.pillTarget, { alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={styles.pill}>
            <Tint color={theme.colors.foreground} opacity={0.07} />
            <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.pillText}>Show all models</Text>
          </View>
        </Pressable>
      ) : null}

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={theme.colors.foregroundMuted} />
        </View>
      ) : error !== null ? (
        <View style={styles.callout}>
          <Tint color={theme.colors.statusDanger} opacity={0.1} />
          <View style={{ paddingTop: 2 }}>
            <Icon name="CircleAlert" size={16} color={theme.colors.statusDanger} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.calloutTitle}>Couldn't load activity</Text>
            <Text style={styles.calloutText}>{error}</Text>
          </View>
        </View>
      ) : analytics && analytics.summary.totalTokens > 0 ? (
        <>
          <View style={styles.stats}>
            {[
              { label: "Tokens", value: formatTokens(analytics.summary.totalTokens) },
              { label: "Est. cost", value: formatCost(analytics.summary.estimatedCostUsd) },
              { label: "Sessions", value: analytics.summary.sessionCount.toLocaleString() },
            ].map((stat) => (
              <View key={stat.label} accessible accessibilityLabel={`${stat.label}: ${stat.value}`}>
                <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={styles.statValue}>
                  {stat.value}
                </Text>
                <Text style={styles.subtle}>{stat.label}</Text>
              </View>
            ))}
          </View>

          {buckets.length > 1 ? (
            <View style={{ gap: space.sm }}>
              <View style={{ flexDirection: "row", alignItems: "flex-end", height: wide ? 128 : 96, gap: 3 }}>
                {buckets.map((b, idx) => {
                  const active = idx === activeBucketIndex;
                  const height = maxBucketTokens > 0 ? (b.totalTokens / maxBucketTokens) * 100 : 0;
                  return (
                    <Pressable
                      key={`${b.timestamp}-${idx}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      accessibilityLabel={`${b.label}: ${formatTokens(b.totalTokens)} tokens`}
                      onPress={() => onSelectBucket(idx)}
                      style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
                    >
                      {/* The whole column is the touch target; the drawn bar stops at 64 so few buckets do not turn into slabs. */}
                      <View
                        style={{
                          height: b.totalTokens > 0 ? `${Math.max(3, height)}%` : 2,
                          width: "100%",
                          maxWidth: 64,
                          alignSelf: "center",
                          borderRadius: 3,
                          overflow: "hidden",
                        }}
                      >
                        {/* Neutral bars and one accent bar: the selection stays visible on dark themes too. */}
                        <Tint
                          color={active ? theme.colors.accent : theme.colors.foreground}
                          opacity={active ? 1 : b.totalTokens > 0 ? 0.18 : 0.08}
                        />
                      </View>
                    </Pressable>
                  );
                })}
              </View>
              {activeBucket ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
                  {stepButton(-1)}
                  <View style={{ flex: 1, alignItems: "center", gap: 2 }} accessible accessibilityLiveRegion="polite">
                    <Text style={[styles.label, { fontWeight: "600" }]}>{activeBucket.label}</Text>
                    <Text style={[styles.subtleNumber, { textAlign: "center" }]}>
                      {formatTokens(activeBucket.totalTokens)} tokens · {formatCost(activeBucket.estimatedCostUsd)} ·{" "}
                      {activeBucket.turnCount.toLocaleString()} turns
                    </Text>
                  </View>
                  {stepButton(1)}
                </View>
              ) : null}
            </View>
          ) : null}

          <Divider theme={theme} styles={styles} />

          <View style={{ gap: space.sm }}>
            <Text style={styles.kicker} accessibilityRole="header" maxFontSizeMultiplier={TIGHT_FONT_SCALE}>
              {modelFilter ? `Tokens by model · ${models.length} of ${allModels.length} match` : "Tokens by model"}
            </Text>
            <View style={{ flexDirection: "row", gap: space.xl, alignItems: "flex-start" }}>
              {modelColumns.map((column, columnIndex) => (
                <View key={columnIndex} style={{ flex: 1, minWidth: 0, gap: space.xs }}>
                  {column.map((model) => {
                    const active = selectedModel === model.modelId;
                    return (
                      <ModelRow
                        key={model.modelId}
                        model={model}
                        active={active}
                        onPress={() => onSelectModel(active ? undefined : model.modelId)}
                        theme={theme}
                        styles={styles}
                      />
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          <Text style={styles.note}>
            Costs are estimates at direct provider API rates, not OpenRouter billing.
            {analytics.coverage.unpricedTokens > 0
              ? ` ${formatTokens(analytics.coverage.unpricedTokens)} tokens have no known price.`
              : ""}
          </Text>
        </>
      ) : (
        <Text style={styles.subtle}>No agent activity in this range.</Text>
      )}
    </Card>
  );
}
