import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import {
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/webex";
import {
  getWebexMessage,
  getWdmUrl,
  registerMercuryDevice,
  sendWebexMessage,
} from "./api.js";
import type { ResolvedWebexAccount } from "./accounts.js";
import { getWebexRuntime } from "./runtime.js";
import type { WebexMercuryEvent } from "./types.js";

export type WebexWebSocketTarget = {
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  statusSink?: (patch: Record<string, unknown>) => void;
};

/** Connect once to Mercury. Resolves when the connection closes normally, rejects on error before open. */
async function connectOnce(params: {
  wsUrl: string;
  account: ResolvedWebexAccount;
  target: WebexWebSocketTarget;
  abortSignal: AbortSignal;
}): Promise<void> {
  const { wsUrl, account, target, abortSignal } = params;

  return new Promise<void>((resolve, reject) => {
    let opened = false;
    const ws = new WebSocket(wsUrl, {
      headers: { Authorization: `Bearer ${account.botToken}` },
    });

    const onAbort = () => ws.terminate();
    abortSignal.addEventListener("abort", onAbort, { once: true });

    ws.on("open", () => {
      opened = true;
      // Send authorization message
      ws.send(
        JSON.stringify({
          id: randomUUID(),
          type: "authorization",
          data: { token: `Bearer ${account.botToken}` },
        }),
      );
      console.log(`[webex:${account.accountId}] Mercury WebSocket connected`);
      target.statusSink?.({ connected: true, lastConnectedAt: Date.now() });
    });

    ws.on("message", (raw) => {
      let msg: WebexMercuryEvent;
      try {
        msg = JSON.parse(raw.toString()) as WebexMercuryEvent;
      } catch {
        return;
      }

      if (
        msg.data?.eventType === "conversation.activity" &&
        msg.data.activity?.verb === "post"
      ) {
        handleMercuryPost({ msg, target }).catch((err) => {
          target.statusSink?.({ lastError: String(err) });
        });
      }

      // ACK
      if (msg.id) {
        ws.send(JSON.stringify({ type: "ack", messageId: msg.id }));
      }
    });

    ws.on("close", (code, reason) => {
      abortSignal.removeEventListener("abort", onAbort);
      target.statusSink?.({
        connected: false,
        lastDisconnect: { at: Date.now(), code, reason: reason.toString() },
      });
      if (opened) {
        console.log(`[webex:${account.accountId}] Mercury WebSocket closed: ${code}`);
        resolve();
      } else {
        reject(new Error(`WebSocket closed before open: ${code} ${reason}`));
      }
    });

    ws.on("error", (err) => {
      console.log(`[webex:${account.accountId}] Mercury WebSocket error: ${err.message}`);
      target.statusSink?.({ lastError: err.message });
    });
  });
}

/** Resolve the message ID from a Mercury activity and process it. */
async function handleMercuryPost(params: {
  msg: WebexMercuryEvent;
  target: WebexWebSocketTarget;
}): Promise<void> {
  const { msg, target } = params;
  const { account, config } = target;
  const activity = msg.data?.activity;
  if (!activity?.id || !activity.target?.url || !activity.target?.id) return;

  // Resolve base64 message ID via conversation API
  const conversationUrl = activity.target.url;
  const convTargetId = activity.target.id;
  const messageUrl = conversationUrl.replace(
    `conversations/${convTargetId}`,
    `messages/${activity.id}`,
  );

  let messageId: string;
  try {
    const res = await fetch(messageUrl, {
      headers: { Authorization: `Bearer ${account.botToken}` },
    });
    if (!res.ok) return;
    const data = (await res.json()) as { id?: string };
    messageId = data.id ?? "";
    if (!messageId) return;
  } catch {
    return;
  }

  // Fetch full message via REST API (same as webhook flow)
  let message;
  try {
    message = await getWebexMessage({ account, messageId });
  } catch {
    return;
  }

  // Skip messages from the bot itself
  if (account.config.botId && message.personId === account.config.botId) {
    console.log(`[webex] skipping self-message ${messageId}`);
    return;
  }
  console.log(
    `[webex] processing message ${messageId} from ${message.personId} in ${message.roomType}`,
  );

  const roomId = message.roomId;
  const text = message.text ?? message.markdown ?? "";
  const senderId = message.personId ?? "";
  const roomType = message.roomType ?? "direct";

  if (!roomId || !text) return;

  target.statusSink?.({ lastInboundAt: Date.now() });

  const core = getWebexRuntime();
  const isGroup = roomType === "group";

  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg: config,
    channel: "webex",
    accountId: account.accountId,
    peer: {
      kind: isGroup ? ("group" as const) : ("direct" as const),
      id: roomId,
    },
    runtime: core.channel,
    sessionStore: (config as { session?: { store?: string } }).session?.store,
  });

  const { storePath, body } = buildEnvelope({
    channel: "Webex",
    from: senderId,
    body: text,
  });

  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    BodyForAgent: text,
    RawBody: text,
    CommandBody: text,
    From: `webex:${senderId}`,
    To: `webex:${roomId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: isGroup ? "channel" : "direct",
    SenderName: message.personEmail ?? senderId,
    ConversationLabel: message.personEmail ?? senderId,
    SenderId: senderId,
    Provider: "webex",
    Surface: "webex",
    MessageSid: messageId,
    MessageSidFull: messageId,
    ReplyToId: message.parentId,
    OriginatingChannel: "webex",
    OriginatingTo: `webex:${roomId}`,
  });

  void core.channel.session
    .recordSessionMetaFromInbound({
      storePath,
      sessionKey: ctxPayload.SessionKey ?? route.sessionKey,
      ctx: ctxPayload,
    })
    .catch(() => {});

  await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg: config,
    dispatcherOptions: {
      deliver: async (payload) => {
        if (payload.text) {
          const mention =
            isGroup && message.personEmail
              ? `<@personEmail:${message.personEmail}> `
              : "";
          await sendWebexMessage({
            account,
            roomId,
            text: mention + payload.text,
            parentId: message.parentId ?? (isGroup ? messageId : undefined),
          });
          target.statusSink?.({ lastOutboundAt: Date.now() });
        }
      },
      onError: (err: unknown) => {
        target.statusSink?.({ lastError: String(err) });
      },
    },
  });
}

/** Sleep that resolves immediately if the signal is aborted. */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Start a Mercury WebSocket monitor with automatic reconnection. */
export async function startWebexWebSocketMonitor(params: {
  account: ResolvedWebexAccount;
  config: OpenClawConfig;
  abortSignal: AbortSignal;
  statusSink: (patch: Record<string, unknown>) => void;
}): Promise<void> {
  const { account, config, abortSignal, statusSink } = params;

  const target: WebexWebSocketTarget = { account, config, statusSink };

  // Step 1: Get WDM URL
  const wdmUrl = await getWdmUrl(account);
  console.log(`[webex:${account.accountId}] WDM URL: ${wdmUrl}`);

  // Step 2: Register device
  let deviceInfo = await registerMercuryDevice(account, wdmUrl);
  const wsUrl = deviceInfo.webSocketUrl;
  if (!wsUrl) throw new Error("No webSocketUrl in device info");
  console.log(`[webex:${account.accountId}] Mercury WebSocket URL: ${wsUrl}`);

  // Step 3: Reconnection loop
  const INITIAL_DELAY = 2000;
  const MAX_DELAY = 60000;
  const JITTER = 0.2;
  let retryDelay = INITIAL_DELAY;

  while (!abortSignal.aborted) {
    try {
      await connectOnce({ wsUrl, account, target, abortSignal });
      // Normal close — reset delay, reconnect immediately
      retryDelay = INITIAL_DELAY;
    } catch (err) {
      if (abortSignal.aborted) return;
      console.log(
        `[webex:${account.accountId}] Mercury connection failed: ${err}, retrying in ${Math.round(retryDelay / 1000)}s`,
      );
      const jitter = 1 + (Math.random() * 2 - 1) * JITTER;
      await sleepAbortable(retryDelay * jitter, abortSignal);
      retryDelay = Math.min(retryDelay * 2, MAX_DELAY);

      // Re-register device on failure (URL may have changed)
      try {
        deviceInfo = await registerMercuryDevice(account, wdmUrl);
      } catch {
        // Will retry on next loop
      }
    }
  }
}
