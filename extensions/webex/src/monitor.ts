import type { IncomingMessage, ServerResponse } from "node:http";
import {
  createWebhookInFlightLimiter,
  registerWebhookTargetWithPluginRoute,
  resolveWebhookPath,
  type OpenClawConfig,
  type WebexAccountConfig,
  type WebhookInFlightLimiter,
} from "openclaw/plugin-sdk/webex";
import type { ResolvedWebexAccount } from "./accounts.js";
import { handleWebexWebhookRequest } from "./monitor-webhook.js";

export type WebexWebhookTarget = {
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  path: string;
  limiter: WebhookInFlightLimiter;
  statusSink?: (patch: Record<string, unknown>) => void;
};

const webhookTargets = new Map<string, WebexWebhookTarget[]>();
const webhookInFlightLimiter = createWebhookInFlightLimiter({ maxInFlightPerKey: 8 });

export function resolveWebexWebhookPath(config: WebexAccountConfig): string {
  return (
    resolveWebhookPath({ webhookPath: config.webhookPath, defaultPath: "/webex" }) ?? "/webex"
  );
}

export async function startWebexMonitor(params: {
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  abortSignal: AbortSignal;
  webhookPath: string;
  statusSink: (patch: Record<string, unknown>) => void;
}): Promise<(() => void) | undefined> {
  const { account, config, abortSignal, webhookPath, statusSink } = params;

  const target: WebexWebhookTarget = {
    account,
    config,
    path: webhookPath,
    limiter: webhookInFlightLimiter,
    statusSink,
  };

  const { unregister } = registerWebhookTargetWithPluginRoute({
    targetsByPath: webhookTargets,
    target,
    route: {
      auth: "plugin",
      match: "exact",
      pluginId: "webex",
      source: "webex-webhook",
      accountId: account.accountId,
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        const handled = await handleWebexWebhookRequest(req, res, webhookTargets);
        if (!handled && !res.headersSent) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("Not Found");
        }
      },
    },
  });

  if (abortSignal.aborted) {
    unregister();
    return undefined;
  }

  return unregister;
}
