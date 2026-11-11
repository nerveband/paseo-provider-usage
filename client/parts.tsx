import type { PluginTheme } from "@getpaseo/plugin";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Platform, Text, View, type StyleProp, type ViewStyle } from "react-native";

/** Used share at or above which a window is reported as nearly exhausted; the filters use it too. */
export { CRITICAL_USED_PERCENT } from "../shared/layout";

/** Spacing steps on a 4/8 grid. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** The whole type scale: caption, body, title, display. */
export const type = {
  caption: { fontSize: 12, lineHeight: 16 },
  body: { fontSize: 14, lineHeight: 20 },
  title: { fontSize: 16, lineHeight: 22 },
  display: { fontSize: 20, lineHeight: 26 },
} as const;

/** Smallest touch target, in points, for anything a finger presses. */
export const TOUCH = 44;

/** Caps text growth where a row cannot reflow (tags, tabs, big figures); body rows wrap instead. */
export const TIGHT_FONT_SCALE = 1.3;

const tabular = ["tabular-nums" as const];

/**
 * Every color comes from the theme; spacing comes from the host's compact flag. Text uses
 * only `foreground` and `foregroundMuted`, so it reads on light and dark themes alike. The
 * meaning colors (`accent`, `statusWarning`, `statusDanger`) fill bars and dots and tint tags;
 * the two limit levels use `statusWarning` and `statusDanger`, never the same one.
 */
export function makeStyles(theme: PluginTheme, compact: boolean) {
  const muted = theme.colors.foregroundMuted;
  const fg = theme.colors.foreground;
  return {
    screen: { flex: 1, backgroundColor: theme.colors.surface0 },
    content: {
      paddingTop: compact ? space.md : space.xl,
      paddingHorizontal: compact ? space.lg : space.xl,
      // Room past the last card for a home indicator or a floating host control.
      paddingBottom: compact ? space.xxl + space.lg : space.xxl + space.sm,
      width: "100%" as const,
      alignSelf: "center" as const,
      gap: compact ? space.xl : space.xxl,
    },
    section: { gap: compact ? space.md : space.lg },
    sectionHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      gap: space.md,
    },
    sectionTitle: { color: fg, ...type.display, fontWeight: "700" as const },
    caption: { color: muted, ...type.caption },
    grid: { gap: compact ? space.md : space.lg },
    gridRow: { flexDirection: "row" as const, alignItems: "stretch" as const, gap: compact ? space.md : space.lg },
    gridCell: { flex: 1, flexBasis: 0, minWidth: 0 },
    card: {
      flexGrow: 1,
      borderRadius: 14,
      overflow: "hidden" as const,
      padding: compact ? space.lg : space.lg + space.xs,
      gap: compact ? space.lg : space.lg + space.xs,
    },
    /** Everything under a card's header; it keeps the card's rhythm and fills a stretched cell. */
    cardBody: { flexGrow: 1, gap: compact ? space.lg : space.lg + space.xs },
    /** The grip and the activity chevron: 44 pt tall boxes that reach into the padding. */
    headerButton: { width: TOUCH, height: TOUCH, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: 10 },
    toolbar: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.sm },
    search: {
      flex: 1,
      minWidth: 0,
      height: TOUCH,
      borderRadius: 10,
      overflow: "hidden" as const,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingLeft: space.md,
    },
    searchInput: {
      flex: 1,
      minWidth: 0,
      height: TOUCH,
      paddingHorizontal: space.sm,
      color: fg,
      ...type.body,
    },
    focusRing: {
      position: "absolute" as const,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: theme.colors.accent,
    },
    chips: { flexDirection: "row" as const, alignItems: "center" as const, gap: space.sm },
    chipTarget: { height: TOUCH, justifyContent: "center" as const },
    filterChip: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: space.xs + 2,
      height: 32,
      paddingHorizontal: space.md,
      borderRadius: 16,
      overflow: "hidden" as const,
    },
    filterChipText: { color: muted, ...type.caption, fontWeight: "500" as const },
    filterChipTextActive: { color: fg, ...type.caption, fontWeight: "600" as const },
    filterChipCount: { color: muted, ...type.caption, fontVariant: tabular },
    menu: { position: "absolute" as const, minWidth: 208, borderRadius: 12, overflow: "hidden" as const, paddingVertical: space.xs },
    menuItem: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: space.sm + 2,
      minHeight: TOUCH,
      marginHorizontal: space.xs,
      paddingHorizontal: space.md - 2,
      borderRadius: 8,
      overflow: "hidden" as const,
    },
    menuText: { color: fg, ...type.body },
    listRow: { borderRadius: 14, overflow: "hidden" as const },
    rowValue: { color: fg, ...type.title, fontWeight: "600" as const, fontVariant: tabular },
    /** Present for screen readers, invisible on screen. */
    visuallyHidden: { position: "absolute" as const, width: 1, height: 1, overflow: "hidden" as const, opacity: 0 },
    cardHeader: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      justifyContent: "space-between" as const,
      gap: space.md,
    },
    nameLine: { flexDirection: "row" as const, alignItems: "center" as const, flexWrap: "wrap" as const, gap: space.sm },
    name: { color: fg, ...type.title, fontWeight: "600" as const },
    meta: { color: muted, ...type.caption, marginTop: 2 },
    headlineValue: { color: fg, ...type.display, fontWeight: "600" as const, fontVariant: tabular },
    headlineUnit: { color: muted, ...type.caption, fontWeight: "500" as const },
    block: { gap: space.md },
    kicker: {
      color: muted,
      ...type.caption,
      fontWeight: "600" as const,
      letterSpacing: 0.5,
      textTransform: "uppercase" as const,
    },
    groupTitle: { color: muted, ...type.caption },
    subheading: { color: muted, ...type.caption, fontWeight: "600" as const },
    /** Label left, value right; the value drops under a label that leaves it no room. */
    row: {
      flexDirection: "row" as const,
      flexWrap: "wrap" as const,
      alignItems: "baseline" as const,
      justifyContent: "space-between" as const,
      columnGap: space.md,
    },
    trailing: {
      flexDirection: "row" as const,
      alignItems: "baseline" as const,
      gap: space.sm,
      marginLeft: "auto" as const,
      flexShrink: 0,
    },
    // minWidth 0 lets a long unbroken label (a model id) shrink and wrap instead of pushing a value out.
    label: { color: fg, ...type.body, flexShrink: 1, minWidth: 0 },
    subtle: { color: muted, ...type.caption },
    subtleNumber: { color: muted, ...type.caption, fontVariant: tabular, textAlign: "right" as const },
    value: { color: fg, ...type.body, fontWeight: "500" as const, fontVariant: tabular, textAlign: "right" as const },
    keyValue: { color: fg, ...type.title, fontWeight: "600" as const, fontVariant: tabular, textAlign: "right" as const },
    percent: { color: fg, ...type.body, fontWeight: "600" as const, fontVariant: tabular, textAlign: "right" as const, minWidth: 40 },
    panels: { flexDirection: "row" as const, flexWrap: "wrap" as const, rowGap: space.lg, columnGap: space.xl + space.xs },
    panel: { gap: space.sm, flexGrow: 1, flexBasis: 220 },
    note: { color: muted, ...type.caption, lineHeight: 18 },
    noteTitle: { color: fg, ...type.caption, lineHeight: 18, fontWeight: "600" as const },
    // Pinned to the bottom of a stretched grid card; the 44 pt toggle already carries its own air.
    footer: { marginTop: "auto" as const, gap: space.xs, marginBottom: -space.sm },
    toggle: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: space.sm,
      minHeight: TOUCH,
    },
    toggleText: { color: fg, ...type.body, fontWeight: "600" as const, flexShrink: 0 },
    divider: { height: 1, overflow: "hidden" as const },
    /** A 44 pt pressable box around a 36 pt pill, so the touch target is real on every client. */
    pillTarget: { height: TOUCH, justifyContent: "center" as const },
    pill: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: space.xs + 2,
      height: 36,
      paddingHorizontal: space.md,
      borderRadius: 18,
      overflow: "hidden" as const,
    },
    pillText: { color: fg, ...type.body, fontWeight: "500" as const },
    callout: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: space.sm + 2,
      padding: space.md,
      borderRadius: 10,
      overflow: "hidden" as const,
    },
    calloutTitle: { color: fg, ...type.body, fontWeight: "600" as const },
    calloutText: { color: muted, ...type.body },
    /** The pressable boxes are 44 pt tall; the track and the selected pill are drawn inside them. */
    segmented: { flexDirection: "row" as const, height: TOUCH, paddingHorizontal: 2 },
    segmentTrack: { position: "absolute" as const, left: 0, right: 0, top: 2, bottom: 2, borderRadius: 10, overflow: "hidden" as const },
    segment: { height: TOUCH, minWidth: TOUCH, justifyContent: "center" as const },
    segmentPill: {
      height: 36,
      paddingHorizontal: compact ? space.sm : space.md,
      borderRadius: 8,
      overflow: "hidden" as const,
      alignItems: "center" as const,
      justifyContent: "center" as const,
    },
    segmentText: { color: muted, ...type.caption, fontWeight: "500" as const },
    segmentTextActive: { color: fg, ...type.caption, fontWeight: "600" as const },
    stats: { flexDirection: "row" as const, flexWrap: "wrap" as const, rowGap: space.md, columnGap: compact ? space.lg : space.xxl },
    statValue: { color: fg, ...type.display, fontWeight: "600" as const, fontVariant: tabular },
    iconButton: { width: TOUCH, height: TOUCH, alignItems: "center" as const, justifyContent: "center" as const, borderRadius: TOUCH / 2 },
    state: { paddingVertical: space.xl, alignItems: "center" as const, gap: space.sm },
  };
}

export type Styles = ReturnType<typeof makeStyles>;

/** A fill layer that derives a tint from a theme color, so every theme stays legible. */
export function Tint({ color, opacity }: { color: string; opacity: number }) {
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: color, opacity }}
    />
  );
}

/** Horizontal share bar measured from zero. */
export function ShareBar({
  percent,
  color,
  theme,
  height = 4,
}: {
  percent: number;
  color: string;
  theme: PluginTheme;
  height?: number;
}) {
  return (
    <View
      style={{ height, borderRadius: height / 2, overflow: "hidden" }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
    >
      <Tint color={theme.colors.foreground} opacity={0.1} />
      <View
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          height: "100%",
          borderRadius: height / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * A small tag. The text is always the foreground color; the meaning color only tints the
 * background and fills the dot, so the tag reads on light and dark surfaces alike.
 */
export function Chip({ text, theme, color }: { text: string; theme: PluginTheme; color?: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        borderRadius: 999,
        overflow: "hidden",
        paddingHorizontal: space.sm,
        minHeight: 20,
      }}
    >
      <Tint color={color ?? theme.colors.foreground} opacity={color ? 0.16 : 0.08} />
      {color ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} /> : null}
      <Text
        maxFontSizeMultiplier={TIGHT_FONT_SCALE}
        style={{ color: theme.colors.foreground, ...type.caption, fontWeight: "600" }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * The caution color for a limit getting close, derived from the theme's warning color. The
 * warning token is a brownish amber, close in hue to the danger red, so a caution reads as a
 * muddy blend of the two. This pushes it toward gold (hue up 22 degrees, more saturated) and
 * keeps the lightness, which is what keeps the label readable: the foreground text sits on a
 * pale tint of this color in both themes, and the bar is a flat fill. Measured on the surface,
 * the shift keeps the label's contrast above 9 to 1 in both themes and moves the bar's contrast
 * against the danger red from about 1.0 to 1.7, which is what separates the two levels.
 */
export function limitWarning(theme: PluginTheme): string {
  return shiftHue(theme.colors.statusWarning, 22, 0.12, -0.02);
}
/** "#rrggbb", "#rgb", or "rgb(r, g, b)" to 0-255 channels, or null. */
function parseColor(value: string): [number, number, number] | null {
  const hex = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    const n = Number.parseInt(digits, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = value.trim().match(/^rgba?\(([^)]+)\)$/i)?.[1].split(",").map(Number);
  return nums && nums.length >= 3 && nums.every(Number.isFinite) ? [nums[0], nums[1], nums[2]] : null;
}

/**
 * Moves a color's hue toward yellow, up or down in saturation, and up or down in lightness,
 * and returns it as an rgb() value. Lightness is clamped, so a color near white or black stays
 * readable. This is the only place the screen derives a color of its own from a theme token.
 */
function shiftHue(
  value: string,
  hueDegrees: number,
  saturationDelta: number,
  lightnessDelta: number,
): string {
  const rgb = parseColor(value);
  if (!rgb) return value;
  const [r, g, b] = rgb.map((n) => n / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + hueDegrees / 360 + 1) % 1;
  s = Math.min(1, Math.max(0, s + saturationDelta));
  const lightness = Math.min(1, Math.max(0, l + lightnessDelta));
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = lightness < 0.5 ? lightness * (1 + s) : lightness + s - lightness * s;
  const p = 2 * lightness - q;
  const out = [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
  return `rgb(${out.map((n) => Math.round(n * 255)).join(", ")})`;
}

/**
 * The flag a limit gets. There are two levels and they are deliberately different in weight.
 * "Limit reached" is a filled pill in `statusDanger`, the heaviest thing on the screen, with
 * bold text. "Near limit" is a lighter tint in a golden yellow derived from the warning token.
 * with plain-weight text. The word always says which level it is, so color is never the only
 * signal, and the bar and the figure use the same two colors at the same weight.
 * use the same two colors at the same weight.
 */
export function LimitChip({
  text,
  level,
  theme,
}: {
  text: string;
  level: "near" | "reached";
  theme: PluginTheme;
}) {
  const reached = level === "reached";
  const color = reached ? theme.colors.statusDanger : limitWarning(theme);
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 5,
        borderRadius: 999,
        overflow: "hidden",
        paddingHorizontal: space.sm,
        minHeight: 20,
        backgroundColor: reached ? theme.colors.statusDanger : undefined,
      }}
    >
      {reached ? null : <Tint color={color} opacity={0.16} />}
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: reached ? theme.colors.accentForeground : color }} />
      <Text
        maxFontSizeMultiplier={TIGHT_FONT_SCALE}
        style={{
          color: reached ? theme.colors.accentForeground : theme.colors.foreground,
          ...type.caption,
          fontWeight: reached ? "700" : "600",
        }}
      >
        {text}
      </Text>
    </View>
  );
}

/**
 * Fades its content in (and slides it 4 pt) when it mounts with `animate`, as when a collapsed
 * card opens. Without `animate` it is a plain view, which is what reduced motion gets.
 */
export function Reveal({
  animate,
  style,
  children,
}: {
  animate: boolean;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== "web",
    }).start();
    // Runs once, on mount: later prop changes do not replay it.
  }, []);
  return (
    <Animated.View
      style={[
        style,
        animate
          ? {
              opacity: progress,
              transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-4, 0] }) }],
            }
          : null,
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** A raised group on the screen background, drawn as a foreground tint rather than a new color. */
export function Card({ theme, styles, children }: { theme: PluginTheme; styles: Styles; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Tint color={theme.colors.foreground} opacity={0.045} />
      {children}
    </View>
  );
}

export function Divider({ theme, styles }: { theme: PluginTheme; styles: Styles }) {
  return (
    <View style={styles.divider}>
      <Tint color={theme.colors.foreground} opacity={0.08} />
    </View>
  );
}
