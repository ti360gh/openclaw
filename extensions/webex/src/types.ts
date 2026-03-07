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
