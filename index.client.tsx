import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { MainSurface } from "./client/main";

function UsageItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  return (
    <SidebarRow
      icon="Gauge"
      active={currentScreen?.screenId === "main"}
      onPress={() => openScreen({ screenId: "main" })}
    />
  );
}

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: "main", title: "Usage", Component: MainSurface });
  client.addSidebarHeaderItem({
    id: "usage",
    title: "Usage",
    Component: UsageItem,
  });
  client.addCommandCenterItem({
    id: "open-usage",
    title: "Open plan usage",
    icon: "Gauge",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: "main" });
    },
  });
  return () => {};
}
