import type {
  ChannelType,
  Conversation,
  ConversationWithMessages,
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

const base = import.meta.env.VITE_API_URL ?? "";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}/api${path}`);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const api = {
  me: () => get<MeResponse>("/me"),
  views: () => get<SidebarViews>("/views"),
  inboxes: () => get<Inbox[]>("/inboxes"),
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
