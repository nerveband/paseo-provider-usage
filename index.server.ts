import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleProviderUsage, handleTokenAnalytics } from "./server/usage";
import { getProviderUsage, getTokenAnalytics, layoutSettings } from "./shared/usage";

export default function contribute(server: PluginServerContext) {
  server.handle(getProviderUsage, handleProviderUsage);
  server.handle(getTokenAnalytics, handleTokenAnalytics);
  // The host stores and syncs the screen layout; this registers its read, write, and reset calls.
  server.registerSettings(layoutSettings);
  return () => {};
}
