/**
 * Layout preferences and the pure helpers behind the Usage screen's customization: block order,
 * collapsed blocks, grid or list view, search, and filters. No React and no Node here, so the
 * client renders with these and the tests run them directly.
 */
import type { ProviderUsage, TokenModelSummary } from "./usage";

type UsageWindow = ProviderUsage["windows"][number];
type Group = NonNullable<ProviderUsage["spend"]>["groups"][number];

/** Used share at or above which a window is reported as nearly exhausted. */
export const CRITICAL_USED_PERCENT = 90;

/** Provider blocks in their default order, which is also the order the server reports them in. */
export const PROVIDER_IDS = ["claude", "codex", "antigravity", "openrouter", "opencodego", "baseten"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The Agent activity block: collapsible, always last. */
export const ACTIVITY_BLOCK_ID = "activity";
export const BLOCK_IDS = [...PROVIDER_IDS, ACTIVITY_BLOCK_ID] as const;
export type BlockId = (typeof BLOCK_IDS)[number];

export const VIEW_MODES = ["grid", "list"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * Everything the screen remembers between sessions. It holds block ids and a view name only:
 * never a token, an account, or a number from a provider.
 */
export type LayoutPreferences = {
  /** Provider ids in the owner's order. Empty means the default order. */
  order: ProviderId[];
  /** Blocks that show only their header. */
  collapsed: BlockId[];
  view: ViewMode;
};

export function defaultPreferences(): LayoutPreferences {
  return { order: [], collapsed: [], view: "grid" };
}

function knownIds<T extends string>(value: unknown, known: readonly T[]): T[] {
  if (!Array.isArray(value)) return [];
  const ids: T[] = [];
  for (const item of value) {
    if (typeof item === "string" && (known as readonly string[]).includes(item) && !ids.includes(item as T)) {
      ids.push(item as T);
    }
  }
  return ids;
}

/**
 * Reads stored preferences strictly: unknown fields, unknown or repeated ids, and an unknown view
 * are dropped, and anything unreadable becomes the default. It never throws.
 */
export function sanitizePreferences(raw: unknown): LayoutPreferences {
  const record = raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const view = (VIEW_MODES as readonly unknown[]).includes(record.view) ? (record.view as ViewMode) : "grid";
  return {
    order: knownIds(record.order, PROVIDER_IDS),
    collapsed: knownIds(record.collapsed, BLOCK_IDS),
    view,
  };
}

/**
 * Stored values when the host's settings hook is `ready`, else the defaults: still loading, a
 * corrupt or unreadable file (`invalid`), or a failed read (`error`).
 */
export function preferencesFromState(state: { status: string; values?: unknown }): LayoutPreferences {
  return state.status === "ready" ? sanitizePreferences(state.values) : defaultPreferences();
}

export function samePreferences(a: LayoutPreferences, b: LayoutPreferences): boolean {
  return (
    a.view === b.view &&
    a.order.length === b.order.length &&
    a.order.every((id, index) => b.order[index] === id) &&
    a.collapsed.length === b.collapsed.length &&
    a.collapsed.every((id) => b.collapsed.includes(id))
  );
}

/**
 * The display order: stored ids that still exist, in the stored order, then every current id the
 * stored order does not mention, in the current (default) order. Removed providers drop out and
 * new ones append.
 */
export function mergeOrder<T extends string>(stored: readonly string[], current: readonly T[]): T[] {
  const kept = stored.filter((id, index): id is T => current.includes(id as T) && stored.indexOf(id) === index);
  return [...kept, ...current.filter((id) => !kept.includes(id))];
}

/** Moves one entry; an index out of range or an unchanged slot returns an unchanged copy. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) return next;
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Moves a block between two positions of the visible subset (a search or filter may hide some)
 * and returns the full order. The block lands just before the visible block it displaces when it
 * moves up, and just after it when it moves down; hidden blocks keep their places.
 */
export function reorderVisible<T>(order: readonly T[], visible: readonly T[], from: number, to: number): T[] {
  if (from < 0 || from >= visible.length || to < 0 || to >= visible.length || from === to) return [...order];
  const moving = visible[from];
  const target = visible[to];
  if (!order.includes(moving) || !order.includes(target)) return [...order];
  const without = order.filter((id) => id !== moving);
  const targetIndex = without.indexOf(target);
  without.splice(to > from ? targetIndex + 1 : targetIndex, 0, moving);
  return without;
}

export type Frame = { x: number; y: number; width: number; height: number };

/**
 * The slot under a point, from measured layout: the frame that contains it, else the nearest
 * frame by distance to its edges. Works for one column and for a grid alike. -1 without frames.
 */
export function slotAt(point: { x: number; y: number }, frames: readonly Frame[]): number {
  let best = -1;
  let bestDistance = Infinity;
  frames.forEach((frame, index) => {
    const dx = Math.max(frame.x - point.x, 0, point.x - (frame.x + frame.width));
    const dy = Math.max(frame.y - point.y, 0, point.y - (frame.y + frame.height));
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

export function toggleId<T extends string>(list: readonly T[], id: T): T[] {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

/* -------------------------------------------------------------------------- */
/* What a card shows, shared by the card, the list row, and the search        */
/* -------------------------------------------------------------------------- */

/** The provider's own percentage, clamped to 0-100 and rounded only for display. */
export function displayPercent(window: UsageWindow): number {
  return Math.round(Math.max(0, Math.min(100, window.usedPercent)));
}

export function sourceLabel(provider: ProviderUsage): string | null {
  if (!provider.source) return null;
  if (provider.id === "antigravity" && provider.source === "cli") return "Antigravity CLI";
  if (provider.id === "claude" && provider.source === "oauth") return "OMP token";
  if (provider.id === "codex" && provider.source === "oauth") return "Codex login";
  if (provider.source === "api") return "API key";
  if (provider.source === "local") return "local session";
  return provider.source;
}

/** The most-used window, which the header and the list row lead with. */
export function tightestWindow(provider: ProviderUsage): UsageWindow | null {
  if (provider.windows.length === 0) return null;
  return provider.windows.reduce((top, window) => (window.usedPercent > top.usedPercent ? window : top));
}


/** How close a limit is to its end. `ok` is under the threshold, `near` is at it, `reached` is at or over 100. */
export type LimitLevel = "ok" | "near" | "reached";

export function limitLevel(used: number): LimitLevel {
  return used >= 100 ? "reached" : used >= CRITICAL_USED_PERCENT ? "near" : "ok";
}

/** The header flag for a used share: color is never the only signal. */
export function limitFlag(used: number): string | null {
  const level = limitLevel(used);
  return level === "reached" ? "Limit reached" : level === "near" ? "Near limit" : null;
}

/** The first figure of the first balance group that has one, named by its group. */
export function keyBalance(provider: ProviderUsage): { label: string; value: string } | null {
  for (const group of provider.spend?.groups ?? []) {
    if (group.kind !== "balance") continue;
    const row = group.rows.find((entry) => !entry.unavailable && entry.value.trim() !== "");
    if (row) return { label: group.title, value: row.value };
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "near-limit", label: "Near limit" },
  { id: "has-balance", label: "Has balance" },
  { id: "needs-attention", label: "Needs attention" },
] as const;
export type FilterId = (typeof FILTERS)[number]["id"];

/** Any window at or above the shared threshold, on the provider's own percentages. */
export function isNearLimit(provider: ProviderUsage): boolean {
  return provider.windows.some((window) => displayPercent(window) >= CRITICAL_USED_PERCENT);
}

/** A balance group with at least one reported value. */
export function hasBalance(provider: ProviderUsage): boolean {
  return keyBalance(provider) !== null;
}

/** A provider error, an estimated window, or a field the provider's API does not expose. */
export function needsAttention(provider: ProviderUsage): boolean {
  return (
    provider.error !== null ||
    provider.windows.some((window) => window.estimated === true) ||
    (provider.spend?.groups ?? []).some((group) => group.rows.some((row) => row.unavailable === true))
  );
}

export function matchesFilter(provider: ProviderUsage, filter: FilterId): boolean {
  if (filter === "near-limit") return isNearLimit(provider);
  if (filter === "has-balance") return hasBalance(provider);
  if (filter === "needs-attention") return needsAttention(provider);
  return true;
}

/* -------------------------------------------------------------------------- */
/* Search                                                                     */
/* -------------------------------------------------------------------------- */

/** Lowercase words; every word must appear somewhere in a block for it to match. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = text.toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

const PANEL_TITLES: Partial<Record<Group["kind"], string>> = {
  limits: "Limits",
  plan: "Plan",
  balance: "Balance and credits",
  spend: "Spend and activity",
};

/** Every label and value the provider's card shows, including what sits under Details. */
export function providerSearchText(provider: ProviderUsage): string {
  const parts: (string | null | undefined)[] = [provider.name, provider.plan, provider.account, sourceLabel(provider)];
  if (provider.error) parts.push("Couldn't load usage", "error", provider.error);
  if (provider.windows.length > 0) parts.push("Limits", "used");
  for (const window of provider.windows) {
    const used = displayPercent(window);
    parts.push(window.label, `${used}%`, window.amount, window.resetDescription, limitFlag(used));
    if (window.resetsAt || window.resetDescription) parts.push("resets");
    if (window.estimated) parts.push("Estimate", "Estimates");
  }
  const spend = provider.spend;
  if (spend?.headline) parts.push(spend.headline.label, spend.headline.value);
  for (const group of spend?.groups ?? []) {
    parts.push(PANEL_TITLES[group.kind], group.title, group.note);
    for (const row of group.rows) {
      if (row.unavailable) parts.push("Not available from the API", row.label);
      else parts.push(row.label, row.value, row.detail);
    }
  }
  parts.push(spend?.note);
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
}

/** The words the Agent activity card shows, so "activity", "sessions", or "estimate" find it. */
export const ACTIVITY_SEARCH_TEXT = [
  "Agent activity",
  "Tokens",
  "Est. cost",
  "Estimated cost",
  "Sessions",
  "Tokens by model",
  "Costs are estimates at direct provider API rates, not OpenRouter billing.",
].join("\n");

export function modelMatches(model: Pick<TokenModelSummary, "modelId" | "modelLabel">, terms: readonly string[]) {
  return matchesTerms(`${model.modelLabel}\n${model.modelId}`, terms);
}

export type ProviderFilterResult<P extends ProviderUsage> = {
  visible: P[];
  /** Hidden providers that failed to load, so the screen can say so instead of hiding it. */
  hiddenErrors: number;
};

export function filterProviders<P extends ProviderUsage>(
  providers: readonly P[],
  query: string,
  filter: FilterId,
): ProviderFilterResult<P> {
  const terms = searchTerms(query);
  const visible = providers.filter(
    (provider) => matchesFilter(provider, filter) && matchesTerms(providerSearchText(provider), terms),
  );
  const hiddenErrors = providers.filter((provider) => provider.error !== null && !visible.includes(provider)).length;
  return { visible, hiddenErrors };
}
