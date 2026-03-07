import type { PluginRuntime } from "openclaw/plugin-sdk/webex";

let _runtime: PluginRuntime | null = null;

export function setWebexRuntime(runtime: PluginRuntime): void {
  _runtime = runtime;
}

export function getWebexRuntime(): PluginRuntime {
  if (!_runtime) throw new Error("Webex runtime not initialized");
  return _runtime;
}
