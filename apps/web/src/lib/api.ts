import type {
  AddParticipantInput,
  Attachment,
  ChannelType,
  Contact,
  CreateTemplateInput,
  Template,
  UpdateTemplateInput,
  ContactWithConversations,
  Conversation,
  ConversationPage,
  ConversationStatus,
  MessagePage,
  Priority,
  ConversationWithMessages,
  CreateContactInput,
  CreateGroupInput,
  CreateInboxInput,
  CreateTeamInput,
  CreateUserInput,
  Inbox,
  IntegrationSettings,
  Member,
  Message,
  Participant,
  Team,
  UpdateContactInput,
  UpdateInboxInput,
  UpdateIntegrationSettingsInput,
  UpdateTeamInput,
  UpdateUserInput,
  User,
} from "@ding/schemas";

export interface ViewItem {
  key: string;
  title: string;
  count: number;
  channel?: ChannelType;
  handle?: string;
  groups?: { id: string; title: string }[];
  /** For "Later": how many snoozed items are now due (wake time passed). */
  due?: number;
}
export interface SidebarViews {
  my: ViewItem[];
  shared: { teams: ViewItem[]; inboxes: ViewItem[] };
}
export interface MeResponse {
  user: User;
  teams: Team[];
}
export interface CreateUserResult {
  user: User;
  /** Present when the person was invited (not seeded): the set-password link and
   *  whether it was emailed. Surface the link when `emailed` is false. */
  invite?: { url: string; emailed: boolean };
}

export interface ApiError extends Error {
  status: number;
}

const base = import.meta.env.VITE_API_URL ?? "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}/api${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    const err = new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`) as ApiError;
    err.status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  // auth
  session: () => get<MeResponse>("/auth/session"),
  login: (email: string, password: string) => post<MeResponse>("/auth/login", { email, password }),
  // Set an initial password from an emailed invite link, then sign in.
  setPassword: (token: string, password: string) => post<MeResponse>("/auth/set-password", { token, password }),
  logout: () => post<{ ok: boolean }>("/auth/logout", {}),
  // workspace
  me: () => get<MeResponse>("/me"),
  views: () => get<SidebarViews>("/views"),
  inboxes: () => get<Inbox[]>("/inboxes"),
  createInbox: (input: CreateInboxInput) => post<Inbox>("/inboxes", input),
  updateInbox: (id: string, input: UpdateInboxInput) => patch<Inbox>(`/inboxes/${id}`, input),
  deleteInbox: (id: string) => del<{ ok: boolean }>(`/inboxes/${id}`),
  // settings
  teams: () => get<Team[]>("/settings/teams"),
  people: () => get<Member[]>("/settings/people"),
  createTeam: (input: CreateTeamInput) => post<Team>("/settings/teams", input),
  updateTeam: (id: string, input: UpdateTeamInput) => patch<Team>(`/settings/teams/${id}`, input),
  deleteTeam: (id: string) => del<{ ok: boolean }>(`/settings/teams/${id}`),
  reorderTeams: (orderedIds: string[]) => post<Team[]>("/settings/teams/reorder", { orderedIds }),
  createUser: (input: CreateUserInput) => post<CreateUserResult>("/settings/people", input),
  updateUser: (id: string, input: UpdateUserInput) => patch<User>(`/settings/people/${id}`, input),
  deleteUser: (id: string) => del<{ ok: boolean }>(`/settings/people/${id}`),
  // integrations (Settings › Setup)
  getIntegrations: () => get<IntegrationSettings>("/settings/integrations"),
  updateIntegrations: (input: UpdateIntegrationSettingsInput) =>
    patch<IntegrationSettings>("/settings/integrations", input),
  // pull-to-refresh: fetch any new Gmail on demand
  syncGmail: () => post<{ ok: boolean; synced: number }>("/channels/google/sync", {}),
  // customers (CRM)
  contacts: () => get<Contact[]>("/contacts"),
  contact: (id: string) => get<ContactWithConversations>(`/contacts/${id}`),
  createContact: (input: CreateContactInput) => post<Contact>("/contacts", input),
  updateContact: (id: string, input: UpdateContactInput) => patch<Contact>(`/contacts/${id}`, input),
  // Open (or start) this customer's conversation on another channel.
  reachContact: (contactId: string, channel: "whatsapp" | "email") =>
    post<{ conversationId: string; created: boolean }>(`/contacts/${contactId}/reach`, { channel }),
  // conversations (cursor-paginated — one page per call, never the whole inbox)
  conversations: (view: string, cursor?: string) =>
    get<ConversationPage>(
      `/conversations?view=${encodeURIComponent(view)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  // Global search across every conversation (contact, subject, preview, message body).
  searchConversations: (q: string, cursor?: string) =>
    get<ConversationPage>(
      `/conversations/search?q=${encodeURIComponent(q)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  conversation: (id: string) => get<ConversationWithMessages>(`/conversations/${id}`),
  // Older thread history (scroll-up), before a seq cursor.
  olderMessages: (id: string, before?: string) =>
    get<MessagePage>(`/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  // Stage a composer upload; the returned attachment id is referenced on send.
  uploadMedia: (
    file: File | Blob,
    meta?: { filename?: string; kind?: string; durationMs?: number; width?: number; height?: number; waveform?: number[] },
  ) => {
    const form = new FormData();
    form.append("file", file, meta?.filename ?? (file instanceof File ? file.name : "file"));
    if (meta?.kind) form.append("kind", meta.kind);
    if (meta?.durationMs != null) form.append("durationMs", String(Math.round(meta.durationMs)));
    if (meta?.width != null) form.append("width", String(Math.round(meta.width)));
    if (meta?.height != null) form.append("height", String(Math.round(meta.height)));
    if (meta?.waveform) form.append("waveform", JSON.stringify(meta.waveform));
    return request<Attachment>("/media", { method: "POST", body: form });
  },
  sendMessage: (
    id: string,
    body: string,
    internal = false,
    attachmentIds?: string[],
    extras?: {
      template?: { id: string; params: string[] };
      quotedMsgId?: string;
      bodyHtml?: string;
      cc?: string[];
      bcc?: string[];
      channel?: ChannelType;
    },
  ) =>
    post<Message>(`/conversations/${id}/messages`, {
      body,
      internal,
      ...(attachmentIds?.length ? { attachmentIds } : {}),
      ...(extras?.template ? { template: extras.template } : {}),
      ...(extras?.quotedMsgId ? { quotedMsgId: extras.quotedMsgId } : {}),
      ...(extras?.bodyHtml ? { bodyHtml: extras.bodyHtml } : {}),
      ...(extras?.cc?.length ? { cc: extras.cc } : {}),
      ...(extras?.bcc?.length ? { bcc: extras.bcc } : {}),
      ...(extras?.channel ? { channel: extras.channel } : {}),
    }),
  // React to a message with an emoji (empty string removes the agent's reaction).
  react: (conversationId: string, messageId: string, emoji: string) =>
    post<Message>(`/conversations/${conversationId}/messages/${messageId}/react`, { emoji }),
  // WhatsApp message templates (for replying once a 24-hour window has closed)
  templates: () => get<Template[]>("/templates"),
  createTemplate: (input: CreateTemplateInput) => post<Template>("/templates", input),
  updateTemplate: (id: string, input: UpdateTemplateInput) => patch<Template>(`/templates/${id}`, input),
  deleteTemplate: (id: string) => del<{ ok: boolean }>(`/templates/${id}`),
  syncTemplates: () => post<{ synced: number }>("/templates/sync", {}),
  assign: (
    id: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
  ) => post<Conversation>(`/conversations/${id}/assign`, input),
  setStatus: (id: string, status: ConversationStatus) =>
    post<Conversation>(`/conversations/${id}/status`, { status }),
  setPriority: (id: string, priority: Priority) =>
    post<Conversation>(`/conversations/${id}/priority`, { priority }),
  snooze: (id: string, until: string) =>
    post<Conversation>(`/conversations/${id}/snooze`, { until }),
  // Mark a conversation read: clears its unread badge + sends a WhatsApp read receipt.
  markRead: (id: string) => post<Conversation>(`/conversations/${id}/read`, {}),
  // Agent is typing → show the customer a WhatsApp "typing…" indicator.
  sendTyping: (id: string) => post<{ ok: boolean }>(`/conversations/${id}/typing`, {}),
  // groups
  createGroup: (input: CreateGroupInput) => post<ConversationWithMessages>("/groups", input),
  addParticipant: (conversationId: string, input: AddParticipantInput) =>
    post<Participant>(`/groups/${conversationId}/participants`, input),
  removeParticipant: (conversationId: string, contactId: string) =>
    request<{ ok: boolean }>(`/groups/${conversationId}/participants/${contactId}`, { method: "DELETE" }),
};
