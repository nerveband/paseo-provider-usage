import { useRpc, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  type TextInput,
  type ViewStyle,
} from "react-native";
import {
  ACTIVITY_BLOCK_ID,
  ACTIVITY_SEARCH_TEXT,
  BLOCK_IDS,
  FILTERS,
  defaultPreferences,
  filterProviders,
  hasBalance,
  isNearLimit,
  matchesTerms,
  mergeOrder,
  modelMatches,
  needsAttention,
  providerSearchText,
  reorderVisible,
  searchTerms,
  toggleId,
  type BlockId,
  type FilterId,
  type Frame,
} from "../shared/layout";
import { getProviderUsage, getTokenAnalytics, type ProviderUsage, type TokenAnalyticsFilter } from "../shared/usage";
import { ActivityCard, formatTokens } from "./activity-card";
import { ListRow } from "./list-row";
import { Reveal, Tint, makeStyles, space } from "./parts";
import { ProviderCard } from "./provider-card";
import { Grip, MoveStrip, useReorder, type ScrollMetrics } from "./reorder";
import { EmptyResults, FilterChips, FilterSummary, LayoutMenu, Toolbar, type MenuItem } from "./toolbar";
import { useLayoutPreferences } from "./use-layout";

/**
 * Layout follows the measured width of this surface, not the window: the plugin pane is
 * narrower than the window whenever the host shows a sidebar or a split view.
 */
const TWO_COLUMNS_FROM = 720;
const ONE_COLUMN_MAX = 640;
const TWO_COLUMN_MAX = 1160;
/** Below this content width a card stacks its headline under the name. */
const HEADLINE_BESIDE_NAME_FROM = 420;
/** Below this content width the activity range tabs take their own full-width row. */
const TABS_BESIDE_TITLE_FROM = 420;
/** Header room the chevron and the grip take from the name and headline (the grip reaches into the padding). */
const HEADER_CONTROLS_WIDTH = 68;
/** From this content width a list row lays its parts out in columns on one line. */
const LIST_COLUMNS_FROM = 560;
/** Below this content width the Grid and List control shows icons only. */
const TOOLBAR_WORDS_FROM = 420;

const RANGE_LABELS: Record<TokenAnalyticsFilter["range"], string> = {
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "14d": "last 14 days",
  "30d": "last 30 days",
  all: "all time",
};

const EMPTY_FILTER_TEXT: Record<Exclude<FilterId, "all">, string> = {
  "near-limit": "No provider is near a limit.",
  "has-balance": "No provider reports a balance.",
  "needs-attention": "No provider needs attention.",
};

/** Follows the system's reduced motion setting; animations are skipped while it is on. */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (active) setReduce(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      active = false;
      subscription?.remove();
    };
  }, []);
  return reduce;
}

/** Moves keyboard focus on the web, and screen reader focus on iOS and Android. */
function focusView(node: View | null) {
  if (!node) return;
  if (Platform.OS === "web") (node as unknown as { focus?: () => void }).focus?.();
  else AccessibilityInfo.sendAccessibilityEvent(node, "focus");
}

function webOnly(style: Record<string, unknown>): ViewStyle | null {
  return Platform.OS === "web" ? (style as ViewStyle) : null;
}

export function MainSurface({ theme, layout }: PluginSurfaceProps) {
  const [range, setRange] = useState<TokenAnalyticsFilter["range"]>("7d");
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined);
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [width, setWidth] = useState(0);
  const [blocksWidth, setBlocksWidth] = useState(0);
  const [pulling, setPulling] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  /** List view: rows opened in place to the full card. Not saved. */
  const [openRows, setOpenRows] = useState<string[]>([]);
  /** The block whose Move up and Move down buttons are showing. */
  const [movingId, setMovingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; width: number; height: number; containerWidth: number } | null>(
    null,
  );
  const [announcement, setAnnouncement] = useState("");
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const rootRef = useRef<View>(null);
  const searchRef = useRef<TextInput>(null);
  const menuButtonRef = useRef<View>(null);
  const menuItemRefs = useRef<(View | null)[]>([]);
  const moveUpRef = useRef<View>(null);
  const moveDownRef = useRef<View>(null);
  const pendingMoveFocus = useRef<"up" | "down" | null>(null);
  /** Set by the owner's first collapse or expand, so cards fade in only when the owner opens them. */
  const interacted = useRef(false);
  const metrics = useRef<ScrollMetrics>({ y: 0, height: 0, contentHeight: 0 });
  const scrollY = useRef(0);
  // Offset captured at the moment a range is chosen. Kept separate from scrollY
  // because a content shrink clamps the scroll position and would otherwise
  // overwrite the value we intend to restore to.
  const restoreY = useRef<number | null>(null);
  const reduceMotion = useReduceMotion();
  const { prefs, update, ready: layoutReady, saveFailed } = useLayoutPreferences();

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
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

  /** The explicit user refresh: the only path that bypasses the server's saved numbers. */
  const refreshAll = useCallback(() => {
    forceNextQuotaFetch.current = true;
    return Promise.all([quotaQuery.refetch(), analyticsQuery.refetch()]);
  }, [quotaQuery, analyticsQuery]);

  const pullToRefresh = useCallback(() => {
    setPulling(true);
    void refreshAll().finally(() => setPulling(false));
  }, [refreshAll]);

  const isUpdating =
    quotaQuery.data?.stale === true || quotaQuery.isFetching || analyticsQuery.isFetching;

  useLayoutEffect(() => {
    if (analyticsQuery.isFetching || restoreY.current === null) return;
    const y = restoreY.current;
    restoreY.current = null;
    scrollRef.current?.scrollTo({ y, animated: false });
  }, [analyticsQuery.isFetching]);

  const styles = useMemo(() => makeStyles(theme, layout.compact), [theme, layout.compact]);

  const announce = useCallback((message: string) => {
    // A polite live region on the web; the platform announcer on iOS and Android.
    if (Platform.OS === "web") setAnnouncement((previous) => (previous === message ? `${message}\u00a0` : message));
    else AccessibilityInfo.announceForAccessibility(message);
  }, []);

  // Web: "/" focuses the search field, unless the owner is typing somewhere or this screen is hidden.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const input = searchRef.current as unknown as HTMLElement | null;
      if (!input || typeof input.getClientRects !== "function" || input.getClientRects().length === 0) return;
      event.preventDefault();
      input.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const pagePadding = layout.compact ? space.lg : space.xl;
  const cardPadding = layout.compact ? space.lg : space.lg + space.xs;
  const gridGap = layout.compact ? space.md : space.lg;
  const columns = width >= TWO_COLUMNS_FROM ? 2 : 1;
  const maxWidth = columns === 2 ? TWO_COLUMN_MAX : ONE_COLUMN_MAX;
  const contentWidth = Math.min(Math.max(0, width - 2 * pagePadding), maxWidth);
  const gridMode = prefs.view === "grid";
  const twoColumns = gridMode && columns === 2;
  const cardInner = (twoColumns ? (contentWidth - gridGap) / 2 : contentWidth) - 2 * cardPadding;
  // Before the first measurement, assume the narrow layout; it fits every width.
  const narrowCards = width === 0 || cardInner - HEADER_CONTROLS_WIDTH < HEADLINE_BESIDE_NAME_FROM;
  const narrowActivity = width === 0 || contentWidth - 2 * cardPadding < TABS_BESIDE_TITLE_FROM;
  const blockGap = gridMode ? gridGap : space.sm;
  const cellWidth = Math.floor(((blocksWidth || contentWidth) - gridGap) / 2);

  const quotaSnapshot = quotaQuery.data;
  const updatedAt = quotaSnapshot?.fetchedAt
    ? new Date(quotaSnapshot.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;

  // Order, then search and filter. The order is also the reading and Tab order.
  const providers = quotaSnapshot?.providers ?? [];
  const providerIds = providers.map((provider) => provider.id);
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered = mergeOrder(prefs.order, providerIds).map((id) => byId.get(id) as ProviderUsage);
  const { visible, hiddenErrors } = filterProviders(ordered, query, filter);
  const visibleIds = visible.map((provider) => provider.id);
  const terms = searchTerms(query);
  const filtering = terms.length > 0 || filter !== "all";
  const searched = ordered.filter((provider) => matchesTerms(providerSearchText(provider), terms));
  const counts: Record<FilterId, number> = {
    all: searched.length,
    "near-limit": searched.filter(isNearLimit).length,
    "has-balance": searched.filter(hasBalance).length,
    "needs-attention": searched.filter(needsAttention).length,
  };

  // Agent activity matches on its own words or on a model name; a quick filter hides it.
  const allModels = analyticsQuery.data?.models ?? [];
  const activityWordsMatch = matchesTerms(ACTIVITY_SEARCH_TEXT, terms);
  const modelFilter = terms.length > 0 && !activityWordsMatch ? terms : null;
  const modelsMatching = modelFilter ? allModels.filter((model) => modelMatches(model, modelFilter)).length : allModels.length;
  const showActivity = filter === "all" && (terms.length === 0 || activityWordsMatch || modelsMatching > 0);

  const nameOf = (id: string) => byId.get(id as ProviderUsage["id"])?.name ?? id;

  const moveBlock = (from: number, to: number) => {
    const id = visibleIds[from];
    if (id === undefined || to < 0 || to >= visibleIds.length || from === to) return;
    update((current) => ({ ...current, order: reorderVisible(mergeOrder(current.order, providerIds), visibleIds, from, to) }));
    announce(`${nameOf(id)} moved to position ${to + 1} of ${visibleIds.length}${filtering ? " shown" : ""}`);
  };

  const moveBy = (id: string, delta: -1 | 1) => {
    const from = visibleIds.indexOf(id as ProviderUsage["id"]);
    if (from < 0) return;
    pendingMoveFocus.current = delta < 0 ? "up" : "down";
    moveBlock(from, from + delta);
  };

  const toggleMoving = (id: string) => setMovingId((current) => (current === id ? null : id));

  const reorder = useReorder({
    ids: visibleIds,
    axis: twoColumns ? "xy" : "y",
    gap: blockGap,
    reduceMotion,
    metrics,
    scrollTo: (y) => scrollRef.current?.scrollTo({ y, animated: false }),
    measureViewport: (callback) => rootRef.current?.measureInWindow((_x, y, _width, height) => callback(y, height)),
    onDrop: moveBlock,
    onTap: toggleMoving,
  });

  // Keep keyboard focus on the Move button that was pressed, wherever the block landed.
  const orderKey = visibleIds.join(",");
  useLayoutEffect(() => {
    const which = pendingMoveFocus.current;
    pendingMoveFocus.current = null;
    if (!which) return;
    const index = movingId ? visibleIds.indexOf(movingId as ProviderUsage["id"]) : -1;
    const atTop = index === 0;
    const atBottom = index === visibleIds.length - 1;
    if (which === "up") focusView(atTop ? moveDownRef.current : moveUpRef.current);
    else focusView(atBottom ? moveUpRef.current : moveDownRef.current);
  }, [orderKey]);

  const isCollapsed = (id: BlockId) => prefs.collapsed.includes(id);
  const toggleCollapsed = (id: BlockId) => {
    interacted.current = true;
    update((current) => ({ ...current, collapsed: toggleId(current.collapsed, id) }));
  };
  const toggleRow = (id: string) => {
    interacted.current = true;
    setOpenRows((rows) => (rows.includes(id) ? rows.filter((row) => row !== id) : [...rows, id]));
  };

  const everythingCollapsed = gridMode
    ? BLOCK_IDS.every((id) => prefs.collapsed.includes(id))
    : openRows.length === 0 && isCollapsed(ACTIVITY_BLOCK_ID);
  const nothingCollapsed = gridMode
    ? prefs.collapsed.length === 0
    : providerIds.every((id) => openRows.includes(id)) && !isCollapsed(ACTIVITY_BLOCK_ID);

  const closeMenu = (refocus = true) => {
    setMenu(null);
    if (refocus) requestAnimationFrame(() => focusView(menuButtonRef.current));
  };
  const openMenu = () => {
    if (menu) {
      closeMenu();
      return;
    }
    const root = rootRef.current;
    const button = menuButtonRef.current;
    if (!root || !button) return;
    root.measureInWindow((rootX, rootY, rootWidth) =>
      button.measureInWindow((x, y, buttonWidth, buttonHeight) =>
        setMenu({ x: x - rootX, y: y - rootY, width: buttonWidth, height: buttonHeight, containerWidth: rootWidth }),
      ),
    );
  };
  const menuItems: MenuItem[] = [
    {
      id: "collapse",
      label: "Collapse all",
      icon: "ChevronsDownUp",
      disabled: everythingCollapsed,
      onPress: () => {
        interacted.current = true;
        if (gridMode) update((current) => ({ ...current, collapsed: [...BLOCK_IDS] }));
        else {
          setOpenRows([]);
          update((current) => ({
            ...current,
            collapsed: current.collapsed.includes(ACTIVITY_BLOCK_ID) ? current.collapsed : [...current.collapsed, ACTIVITY_BLOCK_ID],
          }));
        }
        closeMenu();
        announce("All blocks collapsed");
      },
    },
    {
      id: "expand",
      label: "Expand all",
      icon: "ChevronsUpDown",
      disabled: nothingCollapsed,
      onPress: () => {
        interacted.current = true;
        if (gridMode) update((current) => ({ ...current, collapsed: [] }));
        else {
          setOpenRows(providerIds);
          update((current) => ({ ...current, collapsed: current.collapsed.filter((id) => id !== ACTIVITY_BLOCK_ID) }));
        }
        closeMenu();
        announce("All blocks expanded");
      },
    },
    {
      id: "reset",
      label: "Reset layout",
      icon: "RotateCcw",
      onPress: () => {
        update(() => defaultPreferences());
        setOpenRows([]);
        setMovingId(null);
        closeMenu();
        announce("Layout reset: default order, all expanded, grid view");
      },
    },
  ];

  // Web: focus the first menu item on open; arrows move between items and Escape closes.
  const menuOpen = menu !== null;
  useEffect(() => {
    if (!menuOpen || Platform.OS !== "web" || typeof document === "undefined") return;
    const enabled = () => menuItems.map((item, index) => (item.disabled ? null : menuItemRefs.current[index])).filter(Boolean);
    const frame = requestAnimationFrame(() => focusView(enabled()[0] ?? null));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeMenu();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const items = enabled() as View[];
        const current = items.findIndex((item) => (item as unknown) === document.activeElement);
        const next = (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
        focusView(items[next] ?? null);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  const clearFilters = () => {
    setQuery("");
    setFilter("all");
  };

  const grip = (provider: ProviderUsage) => (
    <Grip
      name={provider.name}
      open={movingId === provider.id}
      disabled={visibleIds.length < 2}
      handlers={reorder.gripHandlers(provider.id)}
      onPress={() => {
        if (!reorder.isClickAfterDrag()) toggleMoving(provider.id);
      }}
      onMove={(delta) => moveBy(provider.id, delta)}
      theme={theme}
      styles={styles}
    />
  );

  const moveStrip = (provider: ProviderUsage) =>
    movingId === provider.id ? (
      <MoveStrip
        name={provider.name}
        index={visibleIds.indexOf(provider.id)}
        count={visibleIds.length}
        onMove={(delta) => moveBy(provider.id, delta)}
        onDone={() => setMovingId(null)}
        upRef={moveUpRef}
        downRef={moveDownRef}
        theme={theme}
        styles={styles}
      />
    ) : null;

  const block = (provider: ProviderUsage) => {
    const id = provider.id;
    const lifted = reorder.drag?.id === id;
    const asRow = !gridMode && !openRows.includes(id);
    const collapsedCard = gridMode && isCollapsed(id);
    const content = asRow ? (
      <ListRow
        provider={provider}
        theme={theme}
        styles={styles}
        wide={contentWidth >= LIST_COLUMNS_FROM}
        padding={cardPadding}
        onOpen={() => toggleRow(id)}
        grip={grip(provider)}
        below={moveStrip(provider)}
      />
    ) : (
      <ProviderCard
        provider={provider}
        theme={theme}
        styles={styles}
        narrow={narrowCards}
        expanded={expanded[id] === true}
        onToggle={() => setExpanded((current) => ({ ...current, [id]: !current[id] }))}
        collapsed={collapsedCard}
        animateReveal={interacted.current && !reduceMotion}
        // Grid: collapse to the header. List: close back to the row.
        onToggleCollapse={gridMode ? () => toggleCollapsed(id) : () => toggleRow(id)}
        grip={grip(provider)}
        below={moveStrip(provider)}
      />
    );
    return (
      <Animated.View
        key={id}
        onLayout={reorder.onCellLayout(id)}
        style={[
          // In the grid, a collapsed card keeps its own height instead of stretching to its neighbor's.
          twoColumns ? { width: cellWidth, alignSelf: collapsedCard ? "flex-start" : "stretch" } : null,
          reorder.cellTransform(id),
          lifted ? liftedStyle(theme) : null,
        ]}
      >
        {content}
        {lifted ? <View pointerEvents="none" style={[liftedOutline, { borderColor: theme.colors.foreground }]} /> : null}
      </Animated.View>
    );
  };

  const drag = reorder.drag;
  const blocks = (
    <View
      onLayout={(event) => setBlocksWidth(event.nativeEvent.layout.width)}
      style={[
        twoColumns ? { flexDirection: "row", flexWrap: "wrap", columnGap: gridGap, rowGap: gridGap } : { gap: blockGap },
        drag ? webOnly({ userSelect: "none", cursor: "grabbing" }) : null,
      ]}
    >
      {visible.map(block)}
      {drag && twoColumns && drag.to !== drag.from ? <SlotMark frame={drag.origin} theme={theme} kind="origin" /> : null}
      {drag ? <SlotMark frame={drag.landing} theme={theme} kind="landing" /> : null}
      {drag ? <SlotMark frame={drag.landing} theme={theme} kind="outline" /> : null}
    </View>
  );

  const analytics = analyticsQuery.data;
  const activityCollapsed = isCollapsed(ACTIVITY_BLOCK_ID);
  const quotaLoading = (!quotaSnapshot && quotaQuery.isLoading) || !layoutReady;

  return (
    <View ref={rootRef} style={{ flex: 1 }}>
      <ScrollView
        ref={scrollRef}
        testID="provider-usage-surface"
        style={styles.screen}
        contentContainerStyle={[styles.content, { maxWidth: maxWidth + 2 * pagePadding }]}
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          metrics.current.height = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={(_width, height) => {
          metrics.current.contentHeight = height;
        }}
        onScroll={(event) => {
          const { contentOffset, layoutMeasurement, contentSize } = event.nativeEvent;
          metrics.current = { y: contentOffset.y, height: layoutMeasurement.height, contentHeight: contentSize.height };
          if (restoreY.current === null) {
            scrollY.current = contentOffset.y;
          }
          if (drag) reorder.onScroll();
        }}
        scrollEventThrottle={16}
        // While a block is lifted on iOS and Android, the drag owns the gesture; the page scrolls
        // only near its edges. The web keeps native scrolling, and the grip opts out of panning.
        scrollEnabled={Platform.OS === "web" || drag === null}
        refreshControl={
          // Pull to refresh is a touch gesture; the web and desktop clients use the Refresh button.
          layout.platform === "web" ? undefined : (
            <RefreshControl
              refreshing={pulling}
              onRefresh={pullToRefresh}
              tintColor={theme.colors.foregroundMuted}
              colors={[theme.colors.accent]}
              progressBackgroundColor={theme.colors.surface0}
            />
          )
        }
      >
        {/* Plans */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <View style={{ flexShrink: 1 }}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>
                Plans
              </Text>
              <Text style={styles.caption} accessibilityLiveRegion="polite">
                {isUpdating ? "Updating…" : updatedAt ? `Updated ${updatedAt}` : "Plan limits, balances, and spend"}
                {saveFailed ? " · Layout not saved" : ""}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh usage"
              accessibilityState={{ disabled: isUpdating }}
              disabled={isUpdating}
              onPress={() => void refreshAll()}
              style={({ pressed }) => [styles.pillTarget, { opacity: isUpdating ? 0.5 : pressed ? 0.6 : 1 }]}
            >
              <View style={styles.pill}>
                <Tint color={theme.colors.foreground} opacity={0.07} />
                <Icon name="RefreshCw" size={14} color={theme.colors.foreground} />
                <Text style={styles.pillText}>Refresh</Text>
              </View>
            </Pressable>
          </View>

          <View style={{ gap: space.xs }}>
            <Toolbar
              query={query}
              onQuery={setQuery}
              view={prefs.view}
              onView={(view) => {
                if (view === prefs.view) return;
                update((current) => ({ ...current, view }));
                setMovingId(null);
                announce(view === "grid" ? "Grid view" : "List view");
              }}
              menuOpen={menuOpen}
              onMenu={openMenu}
              menuButtonRef={menuButtonRef}
              searchRef={searchRef}
              iconOnly={contentWidth < TOOLBAR_WORDS_FROM}
              theme={theme}
              styles={styles}
            />
            <FilterChips filter={filter} onFilter={setFilter} counts={counts} bleed={pagePadding} theme={theme} styles={styles} />
            {filtering ? (
              <FilterSummary
                shown={visible.length}
                total={providers.length}
                hiddenErrors={hiddenErrors}
                onClear={visible.length > 0 ? clearFilters : null}
                theme={theme}
                styles={styles}
              />
            ) : null}
          </View>

          {quotaLoading ? (
            <View style={styles.state}>
              <ActivityIndicator color={theme.colors.foregroundMuted} />
            </View>
          ) : quotaQuery.isError && !quotaSnapshot ? (
            <Text style={styles.label}>Usage could not be loaded. {quotaQuery.error.message}</Text>
          ) : visible.length === 0 ? (
            <EmptyResults
              message={
                terms.length > 0
                  ? `No provider matches “${query.trim()}”${filter === "all" ? "" : ` in ${FILTERS.find((option) => option.id === filter)?.label}`}.`
                  : filter === "all"
                    ? "No providers."
                    : EMPTY_FILTER_TEXT[filter]
              }
              onClear={clearFilters}
              theme={theme}
              styles={styles}
            />
          ) : (
            blocks
          )}
        </View>

        {/* Agent activity: collapsible, always last. */}
        {showActivity ? (
          <View style={styles.section}>
            {/* The whole header row is the toggle: a heading that holds a button. */}
            <View accessibilityRole="header">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  activityCollapsed && analytics
                    ? `Agent activity, ${formatTokens(analytics.summary.totalTokens)} tokens, ${RANGE_LABELS[range]}`
                    : "Agent activity"
                }
                accessibilityHint={activityCollapsed ? "Expands the section" : "Collapses the section"}
                accessibilityState={{ expanded: !activityCollapsed }}
                aria-expanded={!activityCollapsed}
                onPress={() => toggleCollapsed(ACTIVITY_BLOCK_ID)}
                style={({ pressed }) => [styles.sectionHeader, { minHeight: 44, opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={{ flexShrink: 1 }}>
                  <Text style={styles.sectionTitle}>Agent activity</Text>
                  {activityCollapsed && analytics ? (
                    <Text style={styles.caption}>
                      {`${formatTokens(analytics.summary.totalTokens)} tokens, ${RANGE_LABELS[range]}`}
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.headerButton, { marginRight: -space.md }]}>
                  <Icon
                    name={activityCollapsed ? "ChevronRight" : "ChevronDown"}
                    size={18}
                    color={theme.colors.foregroundMuted}
                  />
                </View>
              </Pressable>
            </View>
            {activityCollapsed ? null : (
              <Reveal animate={interacted.current && !reduceMotion}>
                <ActivityCard
                  theme={theme}
                  styles={styles}
                  analytics={analytics}
                  loading={analyticsQuery.isLoading}
                  error={analyticsQuery.isError ? analyticsQuery.error.message : null}
                  range={range}
                  onRange={(next) => {
                    restoreY.current = scrollY.current;
                    setRange(next);
                    setSelectedBucketIndex(null);
                  }}
                  selectedModel={selectedModel}
                  onSelectModel={setSelectedModel}
                  selectedBucketIndex={selectedBucketIndex}
                  onSelectBucket={setSelectedBucketIndex}
                  modelFilter={modelFilter}
                  wide={columns === 2}
                  narrow={narrowActivity}
                />
              </Reveal>
            )}
          </View>
        ) : null}

        <Text style={styles.visuallyHidden} accessibilityLiveRegion="polite">
          {announcement}
        </Text>
      </ScrollView>

      {menu ? (
        <LayoutMenu
          items={menuItems}
          anchor={menu}
          onClose={() => closeMenu()}
          itemRefs={menuItemRefs}
          theme={theme}
          styles={styles}
        />
      ) : null}
    </View>
  );
}

const liftedOutline = {
  position: "absolute" as const,
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  borderRadius: 14,
  borderWidth: 1,
  opacity: 0.18,
};

/** The lifted block: an opaque surface (so cards under it do not show through) with a shadow. */
function liftedStyle(theme: PluginSurfaceProps["theme"]): ViewStyle {
  return {
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    shadowColor: theme.colors.foreground,
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  };
}

/**
 * Where the lifted block will land: an accent fill under it and an accent outline over it, so
 * the target shows even while the block covers it. In a grid, the slot it left is faintly filled.
 */
function SlotMark({
  frame,
  theme,
  kind,
}: {
  frame: Frame;
  theme: PluginSurfaceProps["theme"];
  kind: "landing" | "outline" | "origin";
}) {
  const box = { position: "absolute" as const, left: frame.x, top: frame.y, width: frame.width, height: frame.height, borderRadius: 14 };
  if (kind === "outline") {
    return <View pointerEvents="none" style={[box, { zIndex: 11, borderWidth: 2, borderColor: theme.colors.accent }]} />;
  }
  return (
    <View pointerEvents="none" style={[box, { overflow: "hidden", zIndex: kind === "landing" ? 5 : 1 }]}>
      <Tint color={kind === "landing" ? theme.colors.accent : theme.colors.foreground} opacity={kind === "landing" ? 0.1 : 0.03} />
    </View>
  );
}

