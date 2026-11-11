import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import React, { useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View, type TextStyle } from "react-native";
import { FILTERS, type FilterId, type ViewMode } from "../shared/layout";
import { TIGHT_FONT_SCALE, Tint, space, type Styles } from "./parts";

/** Search field, Grid and List, and the layout menu button: the screen's one toolbar row. */
export function Toolbar({
  query,
  onQuery,
  view,
  onView,
  menuOpen,
  onMenu,
  menuButtonRef,
  searchRef,
  iconOnly,
  theme,
  styles,
}: {
  query: string;
  onQuery(query: string): void;
  view: ViewMode;
  onView(view: ViewMode): void;
  menuOpen: boolean;
  onMenu(): void;
  menuButtonRef: React.Ref<View>;
  searchRef: React.Ref<TextInput>;
  /** Too narrow for words beside the Grid and List icons. */
  iconOnly: boolean;
  theme: PluginTheme;
  styles: Styles;
}) {
  const [focused, setFocused] = useState(false);
  const muted = theme.colors.foregroundMuted;
  return (
    <View style={styles.toolbar}>
      <View style={styles.search}>
        <Tint color={theme.colors.foreground} opacity={0.06} />
        <View>
          <Icon name="Search" size={16} color={muted} />
        </View>
        <TextInput
          ref={searchRef}
          value={query}
          onChangeText={onQuery}
          placeholder={iconOnly ? "Search" : "Search providers, limits, models"}
          placeholderTextColor={muted}
          accessibilityLabel="Search usage"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          returnKeyType="search"
          enterKeyHint="search"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Escape" && query) onQuery("");
          }}
          // The field draws its own focus ring on the web.
          style={[styles.searchInput, Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null]}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => onQuery("")}
            style={({ pressed }) => [styles.headerButton, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Icon name="X" size={16} color={muted} />
          </Pressable>
        ) : null}
        {focused ? <View pointerEvents="none" style={styles.focusRing} /> : null}
      </View>

      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel="View">
        <View pointerEvents="none" style={styles.segmentTrack}>
          <Tint color={theme.colors.foreground} opacity={0.07} />
        </View>
        {(
          [
            { id: "grid", label: "Grid", icon: "LayoutGrid" },
            { id: "list", label: "List", icon: "List" },
          ] as const
        ).map((option) => {
          const active = view === option.id;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              aria-checked={active}
              accessibilityLabel={`${option.label} view`}
              onPress={() => onView(option.id)}
              style={styles.segment}
            >
              <View style={[styles.segmentPill, { flexDirection: "row", gap: space.xs + 2, minWidth: 40 }]}>
                {active ? <Tint color={theme.colors.surface0} opacity={1} /> : null}
                {/* A view keeps the icon above the pill's fill; a bare SVG paints under it on the web. */}
                <View>
                  <Icon name={option.icon} size={16} color={active ? theme.colors.foreground : muted} />
                </View>
                {iconOnly ? null : (
                  <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={active ? styles.segmentTextActive : styles.segmentText}>
                    {option.label}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        ref={menuButtonRef}
        accessibilityRole="button"
        accessibilityLabel="Layout options"
        accessibilityState={{ expanded: menuOpen }}
        aria-expanded={menuOpen}
        aria-haspopup="menu"
        onPress={onMenu}
        style={({ pressed }) => [styles.iconButton, { borderRadius: 10, overflow: "hidden", opacity: pressed ? 0.6 : 1 }]}
      >
        <Tint color={theme.colors.foreground} opacity={menuOpen ? 0.12 : 0.06} />
        <View>
          <Icon name="Ellipsis" size={18} color={theme.colors.foreground} />
        </View>
      </Pressable>
    </View>
  );
}

/** One row of quick filters; it scrolls sideways when the pane is too narrow for all four. */
export function FilterChips({
  filter,
  onFilter,
  counts,
  bleed,
  theme,
  styles,
}: {
  filter: FilterId;
  onFilter(filter: FilterId): void;
  /** Providers each filter would show, after the search. */
  counts: Record<FilterId, number>;
  /** The page padding: the row scrolls to the pane's edges instead of stopping at the padding. */
  bleed: number;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="radiogroup"
      accessibilityLabel="Filter providers"
      style={{ marginHorizontal: -bleed }}
      contentContainerStyle={[styles.chips, { paddingHorizontal: bleed }]}
    >
      {FILTERS.map((option) => {
        const active = filter === option.id;
        const count = option.id === "all" ? null : counts[option.id];
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            aria-checked={active}
            accessibilityLabel={count === null ? option.label : `${option.label}, ${count}`}
            onPress={() => onFilter(active && option.id !== "all" ? "all" : option.id)}
            style={({ pressed }) => [styles.chipTarget, { opacity: pressed ? 0.6 : 1 }]}
          >
            <View style={styles.filterChip}>
              <Tint
                color={active ? theme.colors.accent : theme.colors.foreground}
                opacity={active ? 0.18 : 0.06}
              />
              {active ? (
                <View>
                  <Icon name="Check" size={14} color={theme.colors.foreground} />
                </View>
              ) : null}
              <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={active ? styles.filterChipTextActive : styles.filterChipText}>
                {option.label}
              </Text>
              {count !== null ? (
                <Text maxFontSizeMultiplier={TIGHT_FONT_SCALE} style={styles.filterChipCount}>
                  {count}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** "Showing 3 of 6", any hidden provider that failed to load, and a way back to everything. */
export function FilterSummary({
  shown,
  total,
  hiddenErrors,
  onClear,
  theme,
  styles,
}: {
  shown: number;
  total: number;
  hiddenErrors: number;
  /** Null while the empty state shows its own Clear button. */
  onClear: (() => void) | null;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <View
      style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: space.sm, minHeight: 32, marginTop: -space.xs }}
    >
      <Text style={styles.caption} accessibilityLiveRegion="polite">
        {`Showing ${shown} of ${total}`}
        {hiddenErrors > 0 ? (
          <Text style={[styles.caption, { color: theme.colors.foreground, fontWeight: "600" }]}>
            {` · ${hiddenErrors} hidden ${hiddenErrors === 1 ? "provider" : "providers"} couldn't load`}
          </Text>
        ) : null}
      </Text>
      {onClear ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search and filter"
          onPress={onClear}
          style={({ pressed }) => [styles.pillTarget, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={[styles.pill, { height: 32 }]}>
            <Tint color={theme.colors.foreground} opacity={0.07} />
            <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            <Text style={styles.pillText}>Clear</Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Shown in place of the cards when nothing matches; one tap brings everything back. */
export function EmptyResults({
  message,
  onClear,
  theme,
  styles,
}: {
  message: string;
  onClear(): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <View style={[styles.card, { flexGrow: 0, alignItems: "center", gap: space.md, paddingVertical: space.xl }]}>
      <Tint color={theme.colors.foreground} opacity={0.045} />
      <Icon name="SearchX" size={22} color={theme.colors.foregroundMuted} />
      <Text style={[styles.label, { textAlign: "center" }]}>{message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear search and filter"
        onPress={onClear}
        style={({ pressed }) => [styles.pillTarget, { opacity: pressed ? 0.6 : 1 }]}
      >
        <View style={styles.pill}>
          <Tint color={theme.colors.foreground} opacity={0.07} />
          <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
          <Text style={styles.pillText}>Clear</Text>
        </View>
      </Pressable>
    </View>
  );
}

export type MenuItem = { id: string; label: string; icon: string; disabled?: boolean; onPress(): void };

/**
 * The layout menu, drawn over the screen next to its button. A press outside, Escape, or a
 * choice closes it; focus returns to the button.
 */
export function LayoutMenu({
  items,
  anchor,
  onClose,
  itemRefs,
  theme,
  styles,
}: {
  items: MenuItem[];
  /** The button's frame in the overlay's coordinates. */
  anchor: { x: number; y: number; width: number; height: number; containerWidth: number };
  onClose(): void;
  itemRefs: React.MutableRefObject<(View | null)[]>;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <>
      <Pressable
        accessibilityLabel="Close layout options"
        onPress={onClose}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        // Not a tab stop: Escape and the menu items close it from the keyboard.
        focusable={false}
        tabIndex={-1}
      />
      <View
        accessibilityRole="menu"
        accessibilityLabel="Layout options"
        style={[
          styles.menu,
          { top: anchor.y + anchor.height + space.xs, right: anchor.containerWidth - anchor.x - anchor.width },
          // The shadow is drawn from the theme's foreground, so it reads on light and dark themes.
          { overflow: "visible", shadowColor: theme.colors.foreground, shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
        ]}
      >
        <View
          pointerEvents="none"
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 12, overflow: "hidden", backgroundColor: theme.colors.surface0 }}
        >
          <Tint color={theme.colors.foreground} opacity={0.06} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: theme.colors.foreground,
            opacity: 0.14,
          }}
        />
        {items.map((item, index) => (
          <Pressable
            key={item.id}
            ref={(node) => {
              itemRefs.current[index] = node;
            }}
            accessibilityRole="menuitem"
            accessibilityLabel={item.label}
            accessibilityState={{ disabled: item.disabled === true }}
            disabled={item.disabled}
            onPress={item.onPress}
            style={({ pressed }) => [styles.menuItem, { opacity: item.disabled ? 0.4 : pressed ? 0.6 : 1 }]}
          >
            {({ hovered, focused }: { pressed: boolean; hovered?: boolean; focused?: boolean }) => (
              <>
                {(hovered || focused) && !item.disabled ? <Tint color={theme.colors.foreground} opacity={0.08} /> : null}
                <View>
                  <Icon name={item.icon} size={16} color={theme.colors.foregroundMuted} />
                </View>
                <Text style={styles.menuText}>{item.label}</Text>
              </>
            )}
          </Pressable>
        ))}
      </View>
    </>
  );
}
