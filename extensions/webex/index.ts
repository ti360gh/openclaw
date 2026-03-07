import type { OpenClawPluginApi } from "openclaw/plugin-sdk/webex";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/webex";
import { webexDock, webexPlugin } from "./src/channel.js";
import { setWebexRuntime } from "./src/runtime.js";

const plugin = {
  id: "webex",
  name: "Webex",
  description: "OpenClaw Webex channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setWebexRuntime(api.runtime);
    api.registerChannel({ plugin: webexPlugin, dock: webexDock });
  },
};

export default plugin;
