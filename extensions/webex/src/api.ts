import type { ResolvedWebexAccount } from "./accounts.js";
import type { WebexDeviceInfo, WebexMessage, WebexPerson } from "./types.js";

const WEBEX_API_BASE = "https://webexapis.com/v1";
const U2C_CATALOG_URL = "https://u2c.wbx2.com/u2c/api/v1/catalog";

const MERCURY_DEVICE_DATA = {
  deviceName: "openclaw-webex-bot",
  deviceType: "DESKTOP",
  localizedModel: "node",
  model: "node",
  name: "openclaw-webex-bot",
  systemName: "openclaw-webex-bot",
  systemVersion: "0.1",
};

async function webexFetch(
  account: ResolvedWebexAccount,
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const url = `${WEBEX_API_BASE}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.botToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return res;
}

async function webexFetchJson<T>(
  account: ResolvedWebexAccount,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await webexFetch(account, path, options);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Webex API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function sendWebexMessage(params: {
  account: ResolvedWebexAccount;
  roomId: string;
  text: string;
  parentId?: string;
}): Promise<WebexMessage> {
  const body: Record<string, string> = {
    roomId: params.roomId,
    markdown: params.text,
  };
  if (params.parentId) {
    body["parentId"] = params.parentId;
  }
  return webexFetchJson<WebexMessage>(params.account, "/messages", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getWebexMessage(params: {
  account: ResolvedWebexAccount;
  messageId: string;
}): Promise<WebexMessage> {
  return webexFetchJson<WebexMessage>(params.account, `/messages/${params.messageId}`);
}

export async function getWebexMe(account: ResolvedWebexAccount): Promise<WebexPerson> {
  return webexFetchJson<WebexPerson>(account, "/people/me");
}

// Mercury WebSocket device registration

export async function getWdmUrl(account: ResolvedWebexAccount): Promise<string> {
  const res = await fetch(`${U2C_CATALOG_URL}?format=hostmap`, {
    headers: {
      Authorization: `Bearer ${account.botToken}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`U2C catalog error ${res.status}`);
  }
  const data = (await res.json()) as { serviceLinks?: { wdm?: string } };
  const wdm = data.serviceLinks?.wdm;
  if (!wdm) throw new Error("WDM URL not found in U2C catalog");
  return wdm;
}

export async function registerMercuryDevice(
  account: ResolvedWebexAccount,
  wdmUrl: string,
): Promise<WebexDeviceInfo> {
  const res = await fetch(`${wdmUrl}/devices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(MERCURY_DEVICE_DATA),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Device registration error ${res.status}: ${body}`);
  }
  return res.json() as Promise<WebexDeviceInfo>;
}

export async function probeWebex(params: {
  account: ResolvedWebexAccount;
}): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await webexFetch(params.account, "/people/me");
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
