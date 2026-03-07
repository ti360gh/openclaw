declare const process: { env: Record<string, string | undefined> };

import {
  DEFAULT_ACCOUNT_ID,
  isSecretRef,
  normalizeAccountId,
  type OpenClawConfig,
  type WebexAccountConfig,
  type WebexConfig,
} from "openclaw/plugin-sdk/webex";

export type ResolvedWebexAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  config: WebexAccountConfig;
  botToken: string;
};

const getWebexChannelConfig = (cfg: OpenClawConfig): WebexConfig | undefined =>
  (cfg.channels as Record<string, unknown> | undefined)?.["webex"] as WebexConfig | undefined;

const getAccountConfig = (
  channelCfg: WebexConfig,
  accountId: string,
): WebexAccountConfig => {
  if (accountId === DEFAULT_ACCOUNT_ID) {
    return channelCfg;
  }
  return { ...channelCfg, ...channelCfg.accounts?.[accountId] };
};

export function listWebexAccountIds(cfg: OpenClawConfig): string[] {
  const channelCfg = getWebexChannelConfig(cfg);
  if (!channelCfg) return [];
  const extraAccounts = Object.keys(channelCfg.accounts ?? {});
  if (extraAccounts.length === 0) return [DEFAULT_ACCOUNT_ID];
  return [DEFAULT_ACCOUNT_ID, ...extraAccounts].filter(
    (id, i, arr) => arr.indexOf(id) === i,
  );
}

export function resolveDefaultWebexAccountId(cfg: OpenClawConfig): string {
  const channelCfg = getWebexChannelConfig(cfg);
  return channelCfg?.defaultAccount ?? DEFAULT_ACCOUNT_ID;
}

function resolveToken(
  config: WebexAccountConfig,
  accountId: string,
): string | undefined {
  const raw = config.botToken;
  if (!raw) {
    if (accountId === DEFAULT_ACCOUNT_ID) {
      return process.env["WEBEX_BOT_TOKEN"];
    }
    return undefined;
  }
  if (isSecretRef(raw)) return undefined; // resolved at runtime via secret store
  return raw;
}

export function resolveWebexAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedWebexAccount {
  const channelCfg = getWebexChannelConfig(params.cfg) ?? {};
  const accountId = normalizeAccountId(params.accountId ?? DEFAULT_ACCOUNT_ID);
  const config = getAccountConfig(channelCfg, accountId);
  const botToken = resolveToken(config, accountId) ?? "";

  return {
    accountId,
    name: config.name,
    enabled: config.enabled !== false,
    config,
    botToken,
  };
}

export function listEnabledWebexAccounts(cfg: OpenClawConfig): ResolvedWebexAccount[] {
  return listWebexAccountIds(cfg)
    .map((id) => resolveWebexAccount({ cfg, accountId: id }))
    .filter((a) => a.enabled);
}
