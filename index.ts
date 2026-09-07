import type { PluginContext } from "@getpaseo/plugin";
import { MainSurface } from "./main.client";
import { handleProviderUsage, handleTokenAnalytics } from "./usage.server";
import { getProviderUsage, getTokenAnalytics } from "./usage.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getProviderUsage, handleProviderUsage);
  plugin.handle(getTokenAnalytics, handleTokenAnalytics);
  plugin.addSurface("main", MainSurface);
  plugin.addSidebarItem({
    id: "usage",
    title: "Usage",
    icon: "Gauge",
    surface: "main",
  });
  plugin.addCommandCenterItem({
    id: "open-usage",
    title: "Open plan usage",
    icon: "Gauge",
    context: "global",
    onSelect({ openSurface }) {
      openSurface("main");
    },
  });
  return () => {};
}
