import type { PluginServerContext } from "@getpaseo/plugin/server";
import { handleProviderUsage, handleTokenAnalytics } from "./server/usage";
import { getProviderUsage, getTokenAnalytics } from "./shared/usage";

export default function contribute(server: PluginServerContext) {
  server.handle(getProviderUsage, handleProviderUsage);
  server.handle(getTokenAnalytics, handleTokenAnalytics);
  return () => {};
}
