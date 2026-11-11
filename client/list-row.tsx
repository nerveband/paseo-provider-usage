import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { CRITICAL_USED_PERCENT, displayPercent, keyBalance, tightestWindow } from "../shared/layout";
import type { ProviderUsage } from "../shared/usage";
import { Chip, ShareBar, TIGHT_FONT_SCALE, Tint, space, type Styles } from "./parts";
import { headlineFor } from "./provider-card";

/**
 * One provider as a dense row: name and plan tag, the headline figure, a thin bar for the
 * tightest limit, and the key balance. Pressing it opens the full card in place.
 */
export function ListRow({
  provider,
  theme,
  styles,
  wide,
  padding,
  onOpen,
  grip,
  below,
}: {
  provider: ProviderUsage;
  theme: PluginTheme;
  styles: Styles;
  /** Room for one line of columns instead of stacked lines. */
  wide: boolean;
  /** The card padding, so a row's text lines up with an open card's. */
  padding: number;
  onOpen(): void;
  grip: React.ReactNode;
  below?: React.ReactNode;
}) {
  const headline = headlineFor(provider);
  const tightest = tightestWindow(provider);
  const used = tightest ? displayPercent(tightest) : null;
  const critical = used !== null && used >= CRITICAL_USED_PERCENT;
  const key = keyBalance(provider);
  // A provider without limits already leads with its balance; do not repeat it.
  const balance = key && !(tightest === null && headline?.value === key.value) ? key : null;

  const tags = [
    provider.plan ? <Chip key="plan" text={provider.plan} theme={theme} /> : null,
    headline?.flag ? <Chip key="flag" text={headline.flag} theme={theme} color={theme.colors.statusDanger} /> : null,
    headline?.estimated ? <Chip key="estimate" text="Estimate" theme={theme} color={theme.colors.accent} /> : null,
    provider.error ? <Chip key="error" text="Couldn't load usage" theme={theme} color={theme.colors.statusDanger} /> : null,
  ];

  const name = (
    <View style={[styles.nameLine, wide ? { width: "28%", flexShrink: 0, paddingRight: space.sm } : { flex: 1 }]}>
      <Text style={styles.name} numberOfLines={1}>
        {provider.name}
      </Text>
      {tags}
    </View>
  );

  const figure = headline ? (
    <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={[styles.rowValue, wide ? { minWidth: 72, textAlign: "right" } : null]}>
      {headline.value}
    </Text>
  ) : null;

  const caption = provider.error ?? headline?.caption ?? null;
  const bar =
    tightest && used !== null ? (
      <ShareBar
        percent={tightest.usedPercent}
        color={critical ? theme.colors.statusDanger : theme.colors.accent}
        theme={theme}
      />
    ) : null;

  // The label may shorten; the figure never does.
  const balanceText = balance ? (
    <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "flex-end", gap: space.xs, minWidth: 0 }}>
      <Text style={[styles.subtle, { flexShrink: 1 }]} numberOfLines={1}>
        {balance.label}
      </Text>
      <Text style={[styles.value, { flexShrink: 0 }]}>{balance.value}</Text>
    </View>
  ) : null;

  const accessibilityLabel = [
    provider.name,
    provider.plan ? `plan ${provider.plan}` : null,
    provider.error ? `couldn't load usage: ${provider.error}` : headline?.accessibilityLabel,
    balance ? `${balance.label}: ${balance.value}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <View style={styles.listRow}>
      <Tint color={theme.colors.foreground} opacity={0.045} />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
          aria-expanded={false}
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Opens the full card"
          onPress={onOpen}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: 56,
            flexDirection: "row",
            alignItems: "center",
            gap: space.sm,
            paddingLeft: padding,
            paddingVertical: space.sm + 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {wide ? (
            <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: space.md }}>
              {name}
              {figure}
              <View style={{ flex: 1, minWidth: 0, gap: space.xs + 2 }}>
                {bar}
                {caption ? (
                  <Text style={styles.subtle} numberOfLines={1}>
                    {caption}
                  </Text>
                ) : null}
              </View>
              {/* A fixed column, so the bars end at the same place on every row. */}
              <View style={{ width: "24%", flexShrink: 0, alignItems: "flex-end" }}>{balanceText}</View>
            </View>
          ) : (
            <View style={{ flex: 1, minWidth: 0, gap: space.xs + 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                {name}
                {figure}
              </View>
              {bar}
              {caption || balanceText ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: space.md, rowGap: 2 }}>
                  {caption ? (
                    <Text style={[styles.subtle, { flexShrink: 1 }]} numberOfLines={1}>
                      {caption}
                    </Text>
                  ) : null}
                  {balanceText ? <View style={{ marginLeft: "auto" }}>{balanceText}</View> : null}
                </View>
              ) : null}
            </View>
          )}
          <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} />
        </Pressable>
        <View style={{ marginRight: space.xs }}>{grip}</View>
      </View>
      {below ? <View style={{ paddingHorizontal: padding, paddingBottom: space.md }}>{below}</View> : null}
    </View>
  );
}
