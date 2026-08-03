import type {
  ChannelType,
  Conversation,
  ConversationWithMessages,
  CreateInboxInput,
  Inbox,
  Message,
  Team,
  User,
} from "@ding/schemas";

export interface ViewItem {
  key: string;
  title: string;
  count: number;
  channel?: ChannelType;
  handle?: string;
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
};
