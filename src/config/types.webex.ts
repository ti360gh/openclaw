import type { DmPolicy, GroupPolicy } from "./types.base.js";
import type { SecretRef } from "./types.secrets.js";

export type WebexDmConfig = {
  /** If false, ignore all incoming Webex DMs. Default: true. */
  enabled?: boolean;
  /** Direct message access policy (default: pairing). */
  policy?: DmPolicy;
  /** Allowlist for DM senders (person ids or emails). */
  allowFrom?: Array<string | number>;
};

export type WebexGroupConfig = {
  /** If false, disable the bot in this room. */
  enabled?: boolean;
  /** Require mentioning the bot to trigger replies. */
  requireMention?: boolean;
  /** Allowlist of users that can invoke the bot in this room. */
  users?: Array<string | number>;
  /** Optional system prompt for this room. */
  systemPrompt?: string;
};

export type WebexAccountConfig = {
  /** Optional display name for this account (used in CLI/UI lists). */
  name?: string;
  /** If false, do not start this Webex account. Default: true. */
  enabled?: boolean;
  /** Webex Bot Token (Bearer token for API calls). */
  botToken?: string | SecretRef;
  /** Webex Bot person ID (used to filter self-messages). */
  botId?: string;
  /** Webhook path for receiving Webex events (default: /webex). */
  webhookPath?: string;
  /** Webhook secret for HMAC-SHA1 signature verification. */
  webhookSecret?: string | SecretRef;
  /** Default mention requirement for room messages (default: true). */
  requireMention?: boolean;
  /**
   * Controls how room messages are handled:
   * - "open": rooms bypass allowlists
   * - "disabled": block all room messages
   * - "allowlist": only allow rooms present in channels.webex.groups
   */
  groupPolicy?: GroupPolicy;
  /** Optional allowlist for room senders (person ids or emails). */
  groupAllowFrom?: Array<string | number>;
  /** Per-room configuration keyed by room id or title. */
  groups?: Record<string, WebexGroupConfig>;
  /** Default delivery target for CLI --deliver. */
  defaultTo?: string;
  /** Outbound text chunk size (chars). Default: 7439 (Webex markdown limit). */
  textChunkLimit?: number;
  /** Max media upload size in MB. */
  mediaMaxMb?: number;
  /** Per-DM config overrides keyed by person id. */
  dm?: WebexDmConfig;
  /** Outbound response prefix override. */
  responsePrefix?: string;
};

export type WebexConfig = {
  /** Optional per-account Webex configuration (multi-account). */
  accounts?: Record<string, WebexAccountConfig>;
  /** Optional default account id when multiple accounts are configured. */
  defaultAccount?: string;
} & WebexAccountConfig;
