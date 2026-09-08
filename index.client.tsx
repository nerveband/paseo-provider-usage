import type { PluginClientContext } from "@getpaseo/plugin/client";
import { MainSurface } from "./client/main";

export default function contribute(client: PluginClientContext) {
  client.addSurface("main", MainSurface);
  client.addSidebarItem({
    id: "usage",
    title: "Usage",
    icon: "Gauge",
    surface: "main",
  });
  client.addCommandCenterItem({
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
