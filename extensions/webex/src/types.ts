// Webex REST API types

export type WebexRoom = {
  id?: string;
  title?: string;
  type?: "direct" | "group";
  isLocked?: boolean;
  lastActivity?: string;
  created?: string;
};

export type WebexPerson = {
  id?: string;
  emails?: string[];
  displayName?: string;
  nickName?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  orgId?: string;
  type?: "person" | "bot";
};

export type WebexMessage = {
  id?: string;
  roomId?: string;
  roomType?: "direct" | "group";
  text?: string;
  markdown?: string;
  html?: string;
  files?: string[];
  personId?: string;
  personEmail?: string;
  mentionedPeople?: string[];
  mentionedGroups?: string[];
  parentId?: string;
  created?: string;
};

// Mercury WebSocket types

export type WebexDeviceInfo = {
  url?: string;
  webSocketUrl?: string;
  deviceName?: string;
};

export type WebexMercuryActivity = {
  id?: string;
  verb?: string;
  actor?: { id?: string; displayName?: string; type?: string };
  object?: { id?: string; displayName?: string; objectType?: string };
  target?: { id?: string; url?: string };
};

export type WebexMercuryEvent = {
  id?: string;
  type?: string;
  data?: {
    eventType?: string;
    activity?: WebexMercuryActivity;
  };
};

export type WebexWebhookData = {
  id?: string;
  name?: string;
  resource?: string;
  event?: string;
  orgId?: string;
  createdBy?: string;
  appId?: string;
  ownedBy?: string;
  status?: string;
  actorId?: string;
  data?: WebexMessage;
};
