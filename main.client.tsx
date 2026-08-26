import type { PluginSurfaceProps, PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useMemo, useRef } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { getProviderUsage, type ProviderUsage } from "./usage.shared";

/** Used share at or above which a window is reported as nearly exhausted. */
const CRITICAL_USED_PERCENT = 90;

/**
 * Every window shows when it resets. Prefer the absolute timestamp so it renders in the
 * viewer's locale, fall back to the provider's own reset text, and finally name the
 * window length so a row is never left without timing context.
 */
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
  const fetchUsage = useRpc(getProviderUsage);
  // The daemon answers instantly with its last snapshot and revalidates behind it, so the
  // surface paints known numbers rather than a spinner. While a snapshot is marked stale,
  // poll quickly to pick up the fresh numbers; otherwise stay quiet, because provider
  // quota endpoints are rate limited.
  const forceNextFetch = useRef(false);
  const query = useQuery({
    queryKey: ["provider-usage"],
    queryFn: () => {
      const force = forceNextFetch.current;
      forceNextFetch.current = false;
      return fetchUsage({ force });
    },
    staleTime: 60_000,
    refetchInterval: ({ state }) => (state.data?.stale ? 2_000 : 5 * 60_000),
  });
  const refresh = useCallback(() => {
    forceNextFetch.current = true;
    void query.refetch();
  }, [query]);
  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: {
        paddingVertical: layout.compact ? 20 : 28,
        paddingHorizontal: layout.compact ? 20 : 32,
        width: "100%" as const,
        maxWidth: 640,
        alignSelf: "center" as const,
      },
      header: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        justifyContent: "space-between" as const,
        gap: 16,
        paddingBottom: 20,
      },
      title: {
        color: theme.colors.foreground,
        fontSize: 15,
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
        minHeight: 32,
        paddingHorizontal: 12,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        borderRadius: 6,
      },
      refreshText: { color: theme.colors.accent, fontSize: 13, fontWeight: "600" as const },
      divider: { height: 1, backgroundColor: theme.colors.foreground, opacity: 0.12 },
      provider: { paddingVertical: 22, gap: 18 },
      windows: { gap: 16 },
      providerName: {
        color: theme.colors.foreground,
        fontSize: 13,
        fontWeight: "600" as const,
        letterSpacing: 0.3,
        textTransform: "uppercase" as const,
      },
      providerMeta: { color: theme.colors.foregroundMuted, fontSize: 12, marginTop: 3 },
      window: { gap: 7 },
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
      error: { color: theme.colors.statusDanger, fontSize: 13, lineHeight: 19 },
      state: { paddingVertical: 48, alignItems: "center" as const, gap: 12 },
      stateText: {
        color: theme.colors.foregroundMuted,
        fontSize: 13,
        textAlign: "center" as const,
      },
    }),
    [theme, layout.compact],
  );

  const snapshot = query.data;
  const fetchedAt = snapshot?.fetchedAt
    ? new Date(snapshot.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : null;
  // Revalidating behind cached numbers is inline status, not a blocking state.
  const updating = Boolean(snapshot) && (snapshot?.stale === true || query.isFetching);

  return (
    <ScrollView
      testID="provider-usage-surface"
      style={styles.screen}
      contentContainerStyle={styles.content}
    >
      <View style={styles.header}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            Plan usage
          </Text>
          <View style={styles.captionRow}>
            <Text style={styles.caption}>
              {fetchedAt ? `Updated ${fetchedAt}` : "Claude, Codex, and Antigravity"}
            </Text>
            {updating ? (
              <Text style={styles.captionUpdating} accessibilityLiveRegion="polite">
                Updating…
              </Text>
            ) : null}
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh plan usage"
          disabled={updating}
          onPress={refresh}
          style={({ pressed }) => [
            styles.refresh,
            { opacity: updating ? 0.5 : pressed ? 0.7 : 1 },
          ]}
        >
          <Text style={styles.refreshText}>{updating ? "Refreshing" : "Refresh"}</Text>
        </Pressable>
      </View>

      {!snapshot && query.isLoading ? (
        <View style={styles.state} accessibilityLiveRegion="polite">
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.stateText}>Reading plan limits…</Text>
        </View>
      ) : query.isError && !snapshot ? (
        <View style={styles.state} accessibilityLiveRegion="assertive">
          <Text style={styles.error}>Usage could not be loaded.</Text>
          <Text style={styles.stateText}>{query.error.message}</Text>
        </View>
      ) : (
        snapshot?.providers.map((provider: ProviderUsage) => (
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
                          style={
                            used >= CRITICAL_USED_PERCENT
                              ? styles.percentageCritical
                              : styles.percentage
                          }
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
    </ScrollView>
  );
}
