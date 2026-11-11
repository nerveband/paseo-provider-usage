import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import React from "react";
import { Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { displayPercent, limitFlag, sourceLabel, tightestWindow } from "../shared/layout";
import type { ProviderUsage, SpendGroupKind } from "../shared/usage";
import {
  CRITICAL_USED_PERCENT,
  Card,
  Chip,
  Divider,
  Reveal,
  ShareBar,
  TIGHT_FONT_SCALE,
  Tint,
  space,
  type Styles,
} from "./parts";

type UsageWindow = ProviderUsage["windows"][number];

/** Header room kept clear for the grip, which sits in the top-right corner. */
const GRIP_ROOM = 36;
type Group = NonNullable<ProviderUsage["spend"]>["groups"][number];
type Row = Group["rows"][number];

/** The figure sections, in reading order. Limits sit above them and details below. */
const PANELS: { kind: SpendGroupKind; title: string }[] = [
  { kind: "plan", title: "Plan" },
  { kind: "balance", title: "Balance and credits" },
  { kind: "spend", title: "Spend and activity" },
];

/** Absolute reset time when reported, else the provider's reset text, else the window length. */
export function resetLabel(window: UsageWindow): string | null {
  if (window.resetsAt) {
    const date = new Date(window.resetsAt);
    if (!Number.isNaN(date.getTime())) {
      return `resets ${date.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`;
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

/** A field the API does not expose, named by its group, plus the row when the group has several. */
function unavailableName(group: Group, row: Row): string {
  return group.rows.length === 1 ? group.title : `${group.title} ${row.label.toLowerCase()}`;
}

export type Headline = {
  value: string;
  unit: string | null;
  caption: string;
  flag: string | null;
  estimated: boolean;
  accessibilityLabel: string;
};

/** The tightest limit when the provider has windows, else the server's own at-a-glance figure. */
export function headlineFor(provider: ProviderUsage): Headline | null {
  const tightest = tightestWindow(provider);
  if (tightest) {
    const used = displayPercent(tightest);
    const reset = resetLabel(tightest);
    const flag = limitFlag(used);
    const estimated = tightest.estimated === true;
    return {
      value: `${used}%`,
      unit: "used",
      caption: [tightest.label, reset].filter(Boolean).join(" · "),
      flag,
      estimated,
      accessibilityLabel: [
        `Tightest limit: ${tightest.label}, ${used}% used${estimated ? ", estimated" : ""}`,
        flag,
        reset,
      ]
        .filter(Boolean)
        .join(", "),
    };
  }
  const headline = provider.spend?.headline;
  if (!headline) return null;
  return {
    value: headline.value,
    unit: null,
    caption: headline.label,
    flag: null,
    estimated: false,
    accessibilityLabel: `${headline.label}: ${headline.value}`,
  };
}

function shareText(share: number): string {
  return share > 0 && share < 1 ? "less than 1%" : `${Math.round(share)}%`;
}

function HeadlineBlock({
  headline,
  narrow,
  theme,
  styles,
}: {
  headline: Headline;
  narrow: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  const value = (
    <Text key="value" maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={styles.headlineValue}>
      {headline.value}
      {headline.unit ? <Text style={styles.headlineUnit}>{` ${headline.unit}`}</Text> : null}
    </Text>
  );
  const tags = [
    headline.flag ? <Chip key="flag" text={headline.flag} theme={theme} color={theme.colors.statusDanger} /> : null,
    headline.estimated ? <Chip key="estimate" text="Estimate" theme={theme} color={theme.colors.accent} /> : null,
  ];
  return (
    <View
      accessible
      accessibilityLabel={headline.accessibilityLabel}
      style={narrow ? { gap: 2 } : { alignItems: "flex-end", flexShrink: 1, maxWidth: "58%" }}
    >
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: narrow ? "flex-start" : "flex-end",
          columnGap: space.sm,
          rowGap: space.xs,
        }}
      >
        {narrow ? [value, ...tags] : [...tags, value]}
      </View>
      <Text style={[styles.caption, narrow ? null : { textAlign: "right" }]}>{headline.caption}</Text>
    </View>
  );
}

function WindowRow({
  window,
  tagEstimate,
  theme,
  styles,
}: {
  window: UsageWindow;
  /** False when the Limits heading already says every window is an estimate. */
  tagEstimate: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  const used = displayPercent(window);
  const critical = used >= CRITICAL_USED_PERCENT;
  const estimated = window.estimated === true;
  const reset = resetLabel(window);
  return (
    <View
      style={{ gap: space.sm - 2 }}
      accessible
      accessibilityLabel={[
        window.label,
        `${used}% used${estimated ? ", estimated" : ""}${critical ? ", near the limit" : ""}`,
        reset,
        window.amount,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        {/* The reset text wraps as one piece under the label when the row is narrow. */}
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", columnGap: space.sm }}>
          <Text style={styles.label}>{window.label}</Text>
          {reset ? <Text style={styles.subtle}>{reset}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, minHeight: 20 }}>
          {estimated && tagEstimate ? <Chip text="Estimate" theme={theme} color={theme.colors.accent} /> : null}
          {window.amount ? <Text style={styles.subtleNumber}>{window.amount}</Text> : null}
          {critical ? <Icon name="CircleAlert" size={14} color={theme.colors.statusDanger} /> : null}
          <Text style={[styles.percent, critical ? { fontWeight: "700" } : null]}>{used}%</Text>
        </View>
      </View>
      <ShareBar
        percent={window.usedPercent}
        color={critical ? theme.colors.statusDanger : theme.colors.accent}
        theme={theme}
        height={6}
      />
    </View>
  );
}

function ValueRow({ row, emphasized, styles }: { row: Row; emphasized: boolean; styles: Styles }) {
  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={`${row.label}: ${row.value}${row.detail ? `, ${row.detail}` : ""}`}
    >
      <Text style={styles.label}>{row.label}</Text>
      <View style={styles.trailing}>
        {row.detail ? <Text style={styles.subtleNumber}>{row.detail}</Text> : null}
        <Text style={emphasized ? styles.keyValue : styles.value}>{row.value}</Text>
      </View>
    </View>
  );
}

/** A per-model row: its bar is the server's share of the group total, from zero, never rescaled. */
function ShareRow({ row, narrow, theme, styles }: { row: Row; narrow: boolean; theme: PluginTheme; styles: Styles }) {
  return (
    <View
      style={{ gap: space.sm - 2 }}
      accessible
      accessibilityLabel={[
        `${row.label}: ${row.value}`,
        row.share !== undefined ? `${shareText(row.share)} of the total` : null,
        row.detail,
      ]
        .filter(Boolean)
        .join(", ")}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.md }}>
        {/* On a narrow card the count moves under the name, so a long model id keeps its room. */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.label} numberOfLines={2}>
            {row.label}
          </Text>
          {narrow && row.detail ? <Text style={styles.subtle}>{row.detail}</Text> : null}
        </View>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm }}>
          {!narrow && row.detail ? <Text style={styles.subtleNumber}>{row.detail}</Text> : null}
          <Text style={[styles.value, { minWidth: 56 }]}>{row.value}</Text>
        </View>
      </View>
      {row.share !== undefined ? <ShareBar percent={row.share} color={theme.colors.accent} theme={theme} /> : null}
    </View>
  );
}

export function ProviderCard({
  provider,
  theme,
  styles,
  narrow,
  expanded,
  onToggle,
  collapsed = false,
  onToggleCollapse,
  grip,
  below,
  animateReveal = false,
}: {
  provider: ProviderUsage;
  theme: PluginTheme;
  styles: Styles;
  /** The card's content is too narrow for the headline beside the name. */
  narrow: boolean;
  /** The Details section is open. */
  expanded: boolean;
  onToggle(): void;
  /** Only the header shows: name, plan tag, account, and headline. */
  collapsed?: boolean;
  /**
   * Makes the whole header one button that collapses and expands the card; a collapsed card is
   * then pressable anywhere outside its grip.
   */
  onToggleCollapse?: () => void;
  /** The reorder handle, pinned to the header's top-right corner. */
  grip?: React.ReactNode;
  /** Shown under the header whether or not the card is collapsed (the move buttons). */
  below?: React.ReactNode;
  /** Fade the body in when it mounts, after the owner expands the card. */
  animateReveal?: boolean;
}) {
  const groups = provider.spend?.groups ?? [];
  const meta = [provider.account, sourceLabel(provider)].filter(Boolean).join(" · ");
  const headline = headlineFor(provider);
  const limitGroups = groups.filter((group) => group.kind === "limits");
  const allEstimated = provider.windows.length > 0 && provider.windows.every((window) => window.estimated === true);

  // A plan row that only repeats the plan tag is left out; every other available row is shown.
  const panels = PANELS.map((panel) => ({
    ...panel,
    groups: groups
      .filter((group) => group.kind === panel.kind)
      .map((group) => ({
        group,
        rows: group.rows
          .map((row, index) => ({ row, index }))
          .filter(({ row }) => !row.unavailable && !(panel.kind === "plan" && row.value === provider.plan)),
      }))
      .filter((entry) => entry.rows.length > 0),
  })).filter((panel) => panel.groups.length > 0);

  const unavailable = groups.flatMap((group) =>
    group.rows.filter((row) => row.unavailable).map((row) => unavailableName(group, row)),
  );

  const breakdowns = groups.filter((group) => group.kind === "breakdown" && group.rows.length > 0);
  const details = groups.filter((group) => group.kind === "detail" && group.rows.some((row) => !row.unavailable));
  const notes = [
    ...groups
      .filter((group) => group.kind !== "limits" && group.note)
      .map((group) => ({ title: group.title as string | null, text: group.note as string })),
    ...(provider.spend?.note ? [{ title: null, text: provider.spend.note }] : []),
  ];
  const hasDetails = breakdowns.length > 0 || details.length > 0 || notes.length > 0;
  // Short, fixed words so the hint fits beside the toggle on a phone.
  const hint = [
    ...(breakdowns.length > 0 ? ["Per model"] : []),
    ...(details.length > 0 ? ["Activity"] : []),
    ...(notes.length > 0 ? [`${notes.length} ${notes.length === 1 ? "note" : "notes"}`] : []),
  ].join(" · ");

  const pad = styles.card.padding;
  const header = (
    <>
      <View style={styles.cardHeader}>
        <View style={{ flexShrink: 1, flexGrow: 1 }}>
          <View style={styles.nameLine}>
            <Text accessibilityRole={onToggleCollapse ? undefined : "header"} style={styles.name}>
              {provider.name}
            </Text>
            {provider.plan ? (
              <View accessible accessibilityLabel={`Plan: ${provider.plan}`}>
                <Chip text={provider.plan} theme={theme} />
              </View>
            ) : null}
          </View>
          {meta ? (
            <Text style={styles.meta} numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>
        {headline && !narrow ? <HeadlineBlock headline={headline} narrow={false} theme={theme} styles={styles} /> : null}
        {onToggleCollapse ? (
          // The chevron shows the state; the whole header is the button.
          <View style={{ height: 22, justifyContent: "center" }}>
            <Icon name={collapsed ? "ChevronRight" : "ChevronDown"} size={18} color={theme.colors.foregroundMuted} />
          </View>
        ) : null}
      </View>
      {headline && narrow ? <HeadlineBlock headline={headline} narrow theme={theme} styles={styles} /> : null}
      {collapsed && provider.error ? (
        // A collapsed card still says it failed; the message is one tap away.
        <View accessible accessibilityLabel={`Couldn't load usage. ${provider.error}`} style={{ alignSelf: "flex-start" }}>
          <Chip text="Couldn't load usage" theme={theme} color={theme.colors.statusDanger} />
        </View>
      ) : null}
    </>
  );

  return (
    <Card theme={theme} styles={styles}>
      <View>
        {/* A heading that holds the toggle button, as in an accordion; the grip stays outside it. */}
        <View accessibilityRole={onToggleCollapse ? "header" : undefined}>
          {onToggleCollapse ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={[
                provider.name,
                provider.plan ? `plan ${provider.plan}` : null,
                meta || null,
                headline?.accessibilityLabel,
                collapsed && provider.error ? `couldn't load usage: ${provider.error}` : null,
              ]
                .filter(Boolean)
                .join(", ")}
              accessibilityHint={collapsed ? "Expands the card" : "Collapses the card"}
              accessibilityState={{ expanded: !collapsed }}
              aria-expanded={!collapsed}
              onPress={onToggleCollapse}
              style={({ pressed }) => [
                // Reach the card's edges, so the padding around the header presses too; a collapsed
                // card is all header, so all of it presses.
                {
                  gap: space.md,
                  marginTop: -pad,
                  marginHorizontal: -pad,
                  paddingTop: pad,
                  paddingLeft: pad,
                  paddingRight: pad + GRIP_ROOM,
                  marginBottom: collapsed ? -pad : -space.sm,
                  paddingBottom: collapsed ? pad : space.sm,
                  opacity: pressed ? 0.6 : 1,
                },
                // Keep the keyboard focus ring inside the card, which clips its corners.
                Platform.OS === "web" ? ({ outlineOffset: -2 } as ViewStyle) : null,
              ]}
            >
              {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
                <>
                  {hovered ? <Tint color={theme.colors.foreground} opacity={0.03} /> : null}
                  {header}
                </>
              )}
            </Pressable>
          ) : (
            <View style={{ gap: space.md, paddingRight: grip ? GRIP_ROOM : 0 }}>{header}</View>
          )}
        </View>
        {grip ? <View style={{ position: "absolute", top: -11, right: -space.md }}>{grip}</View> : null}
      </View>

      {below}

      {collapsed ? null : (
        <Reveal animate={animateReveal} style={styles.cardBody}>
          {provider.error ? (
            <View style={styles.callout} accessible accessibilityLabel={`Couldn't load usage. ${provider.error}`}>
              <Tint color={theme.colors.statusDanger} opacity={0.1} />
              <View style={{ paddingTop: 2 }}>
                <Icon name="CircleAlert" size={16} color={theme.colors.statusDanger} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.calloutTitle}>Couldn't load usage</Text>
                <Text style={styles.calloutText}>{provider.error}</Text>
              </View>
            </View>
          ) : null}

          {provider.windows.length > 0 || limitGroups.length > 0 ? (
            <View style={styles.block}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <Text style={styles.kicker} accessibilityRole="header" maxFontSizeMultiplier={TIGHT_FONT_SCALE}>
                  Limits
                </Text>
                {allEstimated ? (
                  <View accessible accessibilityLabel="All limits on this card are estimates">
                    <Chip text="Estimates" theme={theme} color={theme.colors.accent} />
                  </View>
                ) : null}
              </View>
              {provider.windows.map((window) => (
                <WindowRow key={window.id} window={window} tagEstimate={!allEstimated} theme={theme} styles={styles} />
              ))}
              {limitGroups.map((group) => (
                <View key={group.title} style={{ gap: space.xs }}>
                  {group.rows
                    .filter((row) => !row.unavailable)
                    .map((row) => (
                      <ValueRow key={row.label} row={row} emphasized={false} styles={styles} />
                    ))}
                  {group.note ? <Text style={styles.note}>{group.note}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {panels.length > 0 ? (
            <View style={styles.panels}>
              {panels.map((panel) => (
                <View key={panel.kind} style={styles.panel}>
                  <Text style={styles.kicker} accessibilityRole="header" maxFontSizeMultiplier={TIGHT_FONT_SCALE}>
                    {panel.title}
                  </Text>
                  {panel.groups.map(({ group, rows }) => (
                    <View key={group.title} style={{ gap: space.xs }}>
                      {group.title.toLowerCase() !== panel.title.toLowerCase() ? (
                        <Text style={styles.groupTitle}>{group.title}</Text>
                      ) : null}
                      {rows.map(({ row, index }) => (
                        <ValueRow
                          key={row.label}
                          row={row}
                          emphasized={index === 0 && panel.kind !== "plan"}
                          styles={styles}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {unavailable.length > 0 ? (
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: space.sm }}>
              <View style={{ paddingTop: 2 }}>
                <Icon name="Info" size={14} color={theme.colors.foregroundMuted} />
              </View>
              <Text style={[styles.note, { flex: 1 }]}>
                <Text style={styles.noteTitle}>Not available from the API: </Text>
                {unavailable.join(", ")}
              </Text>
            </View>
          ) : null}

          {hasDetails ? (
            <View style={styles.footer}>
              <Divider theme={theme} styles={styles} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                aria-expanded={expanded}
                accessibilityLabel={`${expanded ? "Hide" : "Show"} ${provider.name} details`}
                accessibilityHint={hint}
                onPress={onToggle}
                style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Icon name={expanded ? "ChevronDown" : "ChevronRight"} size={16} color={theme.colors.foregroundMuted} />
                <Text style={styles.toggleText}>{expanded ? "Hide details" : "Details"}</Text>
                {hint && !expanded ? (
                  <Text style={[styles.subtle, { flexShrink: 1 }]} numberOfLines={1}>
                    {hint}
                  </Text>
                ) : null}
              </Pressable>

              {expanded ? (
                <View style={{ gap: space.lg, paddingBottom: space.xs }}>
                  {breakdowns.map((group) => (
                    <View key={group.title} style={{ gap: space.md }}>
                      <Text style={styles.subheading} accessibilityRole="header">
                        {group.title}
                      </Text>
                      {group.rows
                        .filter((row) => !row.unavailable)
                        .map((row, index) => (
                          <ShareRow key={`${index}-${row.label}`} row={row} narrow={narrow} theme={theme} styles={styles} />
                        ))}
                    </View>
                  ))}
                  {details.length > 0 ? (
                    <View style={styles.panels}>
                      {details.map((group) => (
                        <View key={group.title} style={styles.panel}>
                          <Text style={styles.subheading} accessibilityRole="header">
                            {group.title}
                          </Text>
                          {group.rows
                            .filter((row) => !row.unavailable)
                            .map((row) => (
                              <ValueRow key={row.label} row={row} emphasized={false} styles={styles} />
                            ))}
                        </View>
                      ))}
                    </View>
                  ) : null}
                  {notes.length > 0 ? (
                    <View style={{ gap: space.sm }}>
                      {notes.map((note, index) => (
                        <Text key={index} style={styles.note}>
                          {note.title ? <Text style={styles.noteTitle}>{`${note.title}: `}</Text> : null}
                          {note.text}
                        </Text>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}
        </Reveal>
      )}
    </Card>
  );
}
