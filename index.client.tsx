import type { PluginClientContext } from "@getpaseo/plugin/client";
import { SignInScreen } from "./client/screen";
import { NoticeSettings } from "./client/settings";
import { SCREEN_ID, SignInItem } from "./client/sidebar";

export default function contribute(client: PluginClientContext) {
  client.addScreen({ id: SCREEN_ID, title: "Sign-in", Component: SignInScreen });
  client.addSidebarFooterItem({ id: "notice", title: "Sign-in", Component: SignInItem });
  client.addSettingsScreen({ id: "notice", title: "Notice", icon: "Bell", Component: NoticeSettings });
  client.addCommandCenterItem({
    id: "open-status",
    title: "Open sign-in status",
    icon: "KeyRound",
    context: "global",
    onSelect({ openScreen }) {
      openScreen({ screenId: SCREEN_ID });
    },
  });
  return () => {};
}
