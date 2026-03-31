/**
 * PoC: WebEx Mercury WebSocket connection (raw, no SDK)
 * Usage: WEBEX_BOT_TOKEN=xxx node poc-websocket.mjs
 */

import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';

const token = process.env.WEBEX_BOT_TOKEN;
if (!token) {
  console.error('WEBEX_BOT_TOKEN is required');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json;charset=utf-8',
};

// Step 1: Get WDM URL from U2C catalog
console.log('Step 1: Fetching U2C catalog...');
const catalogRes = await fetch('https://u2c.wbx2.com/u2c/api/v1/catalog?format=hostmap', { headers });
if (!catalogRes.ok) {
  console.error('U2C catalog failed:', catalogRes.status, await catalogRes.text());
  process.exit(1);
}
const catalog = await catalogRes.json();
const wdmUrl = catalog.serviceLinks?.wdm;
console.log('WDM URL:', wdmUrl);

// Step 2: Register device
console.log('Step 2: Registering device...');
const deviceData = {
  deviceName: 'openclaw-webex-bot',
  deviceType: 'DESKTOP',
  localizedModel: 'node',
  model: 'node',
  name: 'openclaw-webex-bot',
  systemName: 'openclaw-webex-bot',
  systemVersion: '0.1',
};
const deviceRes = await fetch(`${wdmUrl}/devices`, {
  method: 'POST',
  headers,
  body: JSON.stringify(deviceData),
});
if (!deviceRes.ok) {
  console.error('Device registration failed:', deviceRes.status, await deviceRes.text());
  process.exit(1);
}
const deviceInfo = await deviceRes.json();
const wsUrl = deviceInfo.webSocketUrl;
console.log('WebSocket URL:', wsUrl);

// Step 3: Connect WebSocket
console.log('Step 3: Connecting WebSocket...');
const ws = new WebSocket(wsUrl, { headers });

ws.on('open', () => {
  console.log('WebSocket connected. Sending auth...');
  // Step 4: Send authorization
  ws.send(JSON.stringify({
    id: randomUUID(),
    type: 'authorization',
    data: { token: `Bearer ${token}` },
  }));
  console.log('Auth sent. Waiting for events...');
});

ws.on('message', (raw) => {
  const text = raw.toString();
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    console.log('Non-JSON message:', text);
    return;
  }

  const eventType = msg.data?.eventType;
  const verb = msg.data?.activity?.verb;

  if (eventType === 'conversation.activity' && verb === 'post') {
    console.log('--- message:post ---');
    console.log('activity.id:', msg.data.activity.id);
    console.log('actor:', msg.data.activity.actor?.displayName);
    console.log('target.id:', msg.data.activity.target?.id);
    console.log('object.displayName:', msg.data.activity.object?.displayName);

    // ACK
    ws.send(JSON.stringify({ type: 'ack', messageId: msg.id }));
    console.log('ACK sent');
  } else {
    console.log(`Event: ${eventType} / ${verb || msg.type || 'unknown'}`);
  }
});

ws.on('close', (code, reason) => {
  console.log('WebSocket closed:', code, reason.toString());
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err.message);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  ws.close();
  process.exit(0);
});
