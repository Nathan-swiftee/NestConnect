import type {
  AddParticipantInput,
  ChannelType,
  Contact,
  ContactWithConversations,
  Conversation,
  ConversationStatus,
  ConversationWithMessages,
  CreateContactInput,
  CreateGroupInput,
  CreateInboxInput,
  CreateTeamInput,
  CreateUserInput,
  Inbox,
  Member,
  Message,
  Participant,
  Team,
  UpdateContactInput,
  UpdateInboxInput,
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
}
export interface SidebarViews {
  my: ViewItem[];
  shared: { teams: ViewItem[]; inboxes: ViewItem[] };
}
export interface MeResponse {
  user: User;
  teams: Team[];
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
  createUser: (input: CreateUserInput) => post<User>("/settings/people", input),
  updateUser: (id: string, input: UpdateUserInput) => patch<User>(`/settings/people/${id}`, input),
  deleteUser: (id: string) => del<{ ok: boolean }>(`/settings/people/${id}`),
  // customers (CRM)
  contacts: () => get<Contact[]>("/contacts"),
  contact: (id: string) => get<ContactWithConversations>(`/contacts/${id}`),
  createContact: (input: CreateContactInput) => post<Contact>("/contacts", input),
  updateContact: (id: string, input: UpdateContactInput) => patch<Contact>(`/contacts/${id}`, input),
  // conversations
  conversations: (view: string) =>
    get<Conversation[]>(`/conversations?view=${encodeURIComponent(view)}`),
  conversation: (id: string) => get<ConversationWithMessages>(`/conversations/${id}`),
  sendMessage: (id: string, body: string, internal = false) =>
    post<Message>(`/conversations/${id}/messages`, { body, internal }),
  assign: (
    id: string,
    input: { assigneeUserId?: string | null; assignedTeamId?: string | null },
  ) => post<Conversation>(`/conversations/${id}/assign`, input),
  setStatus: (id: string, status: ConversationStatus) =>
    post<Conversation>(`/conversations/${id}/status`, { status }),
  snooze: (id: string, until: string) =>
    post<Conversation>(`/conversations/${id}/snooze`, { until }),
  // groups
  createGroup: (input: CreateGroupInput) => post<ConversationWithMessages>("/groups", input),
  addParticipant: (conversationId: string, input: AddParticipantInput) =>
    post<Participant>(`/groups/${conversationId}/participants`, input),
  removeParticipant: (conversationId: string, contactId: string) =>
    request<{ ok: boolean }>(`/groups/${conversationId}/participants/${contactId}`, { method: "DELETE" }),
};
