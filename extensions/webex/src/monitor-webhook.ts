import type { IncomingMessage, ServerResponse } from "node:http";
import {
  beginWebhookRequestPipelineOrReject,
  readJsonWebhookBodyOrReject,
  resolveInboundRouteEnvelopeBuilderWithRuntime,
  resolveWebhookTargets,
} from "openclaw/plugin-sdk/webex";
import { getWebexMessage, sendWebexMessage } from "./api.js";
import type { WebexWebhookTarget } from "./monitor.js";
import { getWebexRuntime } from "./runtime.js";
import type { WebexWebhookData } from "./types.js";

export async function handleWebexWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  webhookTargets: Map<string, WebexWebhookTarget[]>,
): Promise<boolean> {
  const resolved = resolveWebhookTargets(req, webhookTargets);
  if (!resolved) {
    return false;
  }
  const { path, targets } = resolved;
  const target = targets[0];
  if (!target) {
    return false;
  }

  const lifecycle = beginWebhookRequestPipelineOrReject({
    req,
    res,
    allowMethods: ["POST"],
    requireJsonContentType: true,
    inFlightLimiter: target.limiter,
    inFlightKey: `${path}:${req.socket?.remoteAddress ?? "unknown"}`,
  });
  if (!lifecycle.ok) {
    return true;
  }

  try {
    const bodyResult = await readJsonWebhookBodyOrReject({
      req,
      res,
      profile: "pre-auth",
      emptyObjectOnEmpty: false,
    });
    if (!bodyResult.ok) {
      return true;
    }

    const payload = bodyResult.value as WebexWebhookData;

    // Only handle message:created events
    if (payload.resource !== "messages" || payload.event !== "created") {
      res.statusCode = 200;
      res.end("OK");
      return true;
    }

    const messageId = payload.data?.id;
    if (!messageId) {
      res.statusCode = 200;
      res.end("OK");
      return true;
    }

    // Respond immediately; process async
    res.statusCode = 200;
    res.end("OK");

    const dispatchTarget = target;
    processWebexMessage({ target: dispatchTarget, messageId }).catch((err) => {
      dispatchTarget.statusSink?.({ lastError: String(err) });
    });

    return true;
  } finally {
    lifecycle.release();
  }
}

async function processWebexMessage(params: {
  target: WebexWebhookTarget;
  messageId: string;
}): Promise<void> {
  const { target, messageId } = params;
  const { account, config } = target;

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
  console.log(`[webex] processing message ${messageId} from ${message.personId} in ${message.roomType}`);

  const roomId = message.roomId;
  const text = message.text ?? message.markdown ?? "";
  const senderId = message.personId ?? "";
  const roomType = message.roomType ?? "direct";

  if (!roomId || !text) {
    return;
  }

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
    ConversationLabel: senderId,
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
          await sendWebexMessage({
            account,
            roomId,
            text: payload.text,
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
