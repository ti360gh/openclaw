import {
  deleteAccountFromConfigSection,
  formatPairingApproveHint,
  missingTargetError,
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
  setAccountEnabledInConfigSection,
  type ChannelDock,
  type ChannelPlugin,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/webex";
import {
  listWebexAccountIds,
  resolveDefaultWebexAccountId,
  resolveWebexAccount,
  type ResolvedWebexAccount,
} from "./accounts.js";
import { sendWebexMessage, probeWebex, getWebexMe } from "./api.js";
import { resolveWebexWebhookPath, startWebexMonitor } from "./monitor.js";

const CHANNEL_ID = "webex" as const;
const TEXT_CHUNK_LIMIT = 7439; // Webex markdown character limit

const meta = {
  id: CHANNEL_ID,
  label: "Webex",
  selectionLabel: "Webex (Bot Token)",
  detailLabel: "Webex",
  docsPath: "/channels/webex",
  docsLabel: "webex",
  blurb: "Cisco Webex messaging via Bot Token and webhooks.",
  aliases: ["cisco-webex", "webex-teams"] as string[],
  order: 60,
};

export const webexDock: ChannelDock = {
  id: CHANNEL_ID,
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: false,
    threads: false,
    blockStreaming: false,
  },
  outbound: { textChunkLimit: TEXT_CHUNK_LIMIT },
  config: {
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveWebexAccount({ cfg, accountId: accountId ?? undefined }).config.dm?.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map(String).filter(Boolean).map((e) => e.trim().toLowerCase()),
  },
};

export const webexPlugin: ChannelPlugin<ResolvedWebexAccount> = {
  id: CHANNEL_ID,
  meta: { ...meta },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    media: false,
    threads: false,
    blockStreaming: false,
  },
  config: {
    listAccountIds: (cfg: OpenClawConfig) => listWebexAccountIds(cfg),
    resolveAccount: (cfg: OpenClawConfig, accountId?: string | null) =>
      resolveWebexAccount({ cfg, accountId: accountId ?? undefined }),
    defaultAccountId: (cfg: OpenClawConfig) => resolveDefaultWebexAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) =>
      setAccountEnabledInConfigSection({ cfg, sectionKey: "webex", accountId, enabled }),
    deleteAccount: ({ cfg, accountId }) =>
      deleteAccountFromConfigSection({ cfg, sectionKey: "webex", accountId }),
    isConfigured: (account: ResolvedWebexAccount) => !!account.botToken,
    describeAccount: (account: ResolvedWebexAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: !!account.botToken,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveWebexAccount({ cfg, accountId: accountId ?? undefined }).config.dm?.allowFrom ?? []).map(String),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom.map(String).filter(Boolean).map((e) => e.trim().toLowerCase()),
    resolveDefaultTo: ({ cfg, accountId }) =>
      resolveWebexAccount({ cfg, accountId: accountId ?? undefined }).config.defaultTo,
  },
  reload: { configPrefixes: ["channels.webex"] },
  security: {
    resolveDmPolicy: ({ account }) => ({
      policy: account.config.dm?.policy ?? "pairing",
      allowFrom: account.config.dm?.allowFrom ?? [],
      allowFromPath: "channels.webex.dm.allowFrom",
      approveHint: formatPairingApproveHint("webex"),
    }),
    collectWarnings: ({ account, cfg }) => {
      const warnings: string[] = [];
      const defaultGroupPolicy = resolveDefaultGroupPolicy(cfg);
      const { groupPolicy } = resolveAllowlistProviderRuntimeGroupPolicy({
        providerConfigPresent: (cfg.channels as Record<string, unknown> | undefined)?.["webex"] !== undefined,
        groupPolicy: account.config.groupPolicy,
        defaultGroupPolicy,
      });
      if (groupPolicy === "open") {
        warnings.push(
          `- Webex rooms: groupPolicy="open" allows any room to trigger. Set channels.webex.groupPolicy="allowlist".`,
        );
      }
      if (account.config.dm?.policy === "open") {
        warnings.push(
          `- Webex DMs are open to anyone. Set channels.webex.dm.policy="pairing" or "allowlist".`,
        );
      }
      return warnings;
    },
  },
  outbound: {
    deliveryMode: "direct",
    textChunkLimit: TEXT_CHUNK_LIMIT,
    sendText: async ({ cfg, to, text, accountId }) => {
      const account = resolveWebexAccount({ cfg, accountId: accountId ?? undefined });
      if (!to) throw missingTargetError("Webex", "<roomId>");
      const result = await sendWebexMessage({ account, roomId: to, text });
      return {
        channel: CHANNEL_ID,
        messageId: result.id ?? "",
        chatId: to,
      };
    },
  },
  status: {
    probeAccount: async ({ account }) => probeWebex({ account }),
  },
  gateway: {
    startAccount: async (ctx) => {
      // Fetch bot's own ID to prevent self-reply loops
      try {
        const me = await getWebexMe(ctx.account);
        if (me.id) {
          ctx.account.config.botId = me.id;
          console.log(`[webex:${ctx.account.accountId}] botId resolved: ${me.id}`);
        } else {
          console.log(`[webex:${ctx.account.accountId}] /people/me returned no id`);
        }
      } catch (err) {
        console.log(`[webex:${ctx.account.accountId}] failed to fetch botId: ${err}`);
      }

      const webhookPath = resolveWebexWebhookPath(ctx.account.config);
      ctx.log?.info(`[${ctx.account.accountId}] starting Webex webhook at ${webhookPath}`);
      ctx.setStatus({ accountId: ctx.account.accountId, running: true });

      const unregister = await startWebexMonitor({
        account: ctx.account,
        config: ctx.cfg,
        abortSignal: ctx.abortSignal,
        webhookPath,
        statusSink: (patch) => ctx.setStatus({ accountId: ctx.account.accountId, ...patch }),
      });

      await new Promise<void>((resolve) => {
        if (ctx.abortSignal.aborted) resolve();
        else ctx.abortSignal.addEventListener("abort", () => resolve(), { once: true });
      });

      unregister?.();
      ctx.setStatus({ accountId: ctx.account.accountId, running: false, lastStopAt: Date.now() });
    },
  },
};

