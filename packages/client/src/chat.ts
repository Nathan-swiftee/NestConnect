import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import {
  ChatClientEvent,
  ChatServerEvent,
  type ChatMessage,
  type ChatMessagePage,
  type ChatPerson,
  type ChatRoom,
  type ChatRoomSummary,
} from "@ding/schemas";
import { api } from "./api";
import { clientConfig } from "./config";
import { getSocket } from "./socket";

/*
 * Team Chat on the client: the queries, sending (with the bubble showing before
 * the server has answered), and keeping every open screen current from the
 * socket. Shared by the web app and the native apps. See docs/team-chat.md.
 */

/** A message as a screen holds it: the server's, or mine on its way there. */
export type ChatBubble = ChatMessage & { pending?: boolean; failed?: boolean };

type Pages = InfiniteData<ChatMessagePage, string | undefined>;

const keys = {
  status: ["chat", "status"] as const,
  rooms: (all: boolean) => ["chat", "rooms", all] as const,
  room: (id: string) => ["chat", "room", id] as const,
  messages: (id: string) => ["chat", "messages", id] as const,
};

/* ---- which chat is on screen ---- */

let openRoom: string | null = null;

/** The chat screen says which chat it has open, so a sound for that one isn't made. */
export function setOpenChatRoom(id: string | null): void {
  openRoom = id;
}

const looking = () => clientConfig().attention?.isLooking() ?? true;

/* ---- queries ---- */

export function useChatStatus(enabled = true) {
  return useQuery({ queryKey: keys.status, queryFn: () => api.chatStatus(), staleTime: 30_000, enabled });
}

export function useChatRooms(all = false, enabled = true) {
  return useQuery({ queryKey: keys.rooms(all), queryFn: () => api.chatRooms(all), staleTime: 10_000, enabled });
}

export function useChatRoom(id: string | null | undefined) {
  return useQuery({ queryKey: keys.room(id ?? ""), queryFn: () => api.chatRoom(id!), enabled: !!id, staleTime: 10_000, retry: false });
}

/** A chat's messages, oldest first, with older pages loaded on demand. */
export function useChatMessages(id: string | null | undefined) {
  const q = useInfiniteQuery({
    queryKey: keys.messages(id ?? ""),
    queryFn: ({ pageParam }) => api.chatMessages(id!, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => (last.hasMore ? last.messages[0]?.id : undefined),
    enabled: !!id,
    staleTime: 30_000,
    retry: false,
  });
  // Pages arrive newest first; a chat reads oldest first.
  const messages: ChatBubble[] = q.data ? [...q.data.pages].reverse().flatMap((p) => p.messages) : [];
  return { ...q, messages };
}

/* ---- the cache, patched from wherever news arrives ---- */

/** Add a message at the end, or put a newer copy of it in place. */
function upsertMessage(qc: QueryClient, roomId: string, message: ChatBubble): void {
  qc.setQueryData<Pages>(keys.messages(roomId), (cur) => {
    if (!cur) return cur;
    let found = false;
    const pages = cur.pages.map((p) => {
      const idx = p.messages.findIndex(
        (m) => m.id === message.id || (!!message.clientId && (m as ChatBubble).pending !== undefined && m.clientId === message.clientId),
      );
      if (idx < 0) return p;
      found = true;
      const next = p.messages.slice();
      next[idx] = message;
      return { ...p, messages: next };
    });
    if (found) {
      // The socket and the send's own answer can both bring the real message; keep one.
      return { ...cur, pages: pages.map((p) => ({ ...p, messages: dedupe(p.messages) })) };
    }
    const [newest, ...rest] = pages;
    if (!newest) return cur;
    return { ...cur, pages: [{ ...newest, messages: [...newest.messages, message] }, ...rest] };
  });
}

function dedupe(list: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

function refreshLists(qc: QueryClient): void {
  qc.invalidateQueries({ queryKey: ["chat", "rooms"] });
  qc.invalidateQueries({ queryKey: keys.status });
}

/* ---- sending ---- */

let localSeq = 0;

/**
 * Send, showing the bubble straight away with a clock on it. When the server
 * answers it becomes the real message; if it can't be sent it stays, marked,
 * to try again.
 */
export function useSendChatMessage(roomId: string, me: ChatPerson | null) {
  const qc = useQueryClient();
  return useCallback(
    async (body: string, replyTo?: ChatMessage | null): Promise<void> => {
      const clientId = `c${Date.now().toString(36)}${(++localSeq).toString(36)}`;
      const draft: ChatBubble = {
        id: `local_${clientId}`,
        roomId,
        kind: "text",
        author: me,
        body,
        system: null,
        replyTo: replyTo
          ? { id: replyTo.id, authorId: replyTo.author?.id ?? null, authorName: replyTo.author?.name ?? "", body: replyTo.body, deleted: false }
          : null,
        reactions: [],
        mentions: [],
        editedAt: null,
        deletedAt: null,
        createdAt: new Date().toISOString(),
        clientId,
        pending: true,
      };
      upsertMessage(qc, roomId, draft);
      try {
        const sent = await api.sendChatMessage(roomId, { body, replyToId: replyTo?.id ?? null, clientId });
        upsertMessage(qc, roomId, { ...sent, clientId });
        refreshLists(qc);
      } catch {
        upsertMessage(qc, roomId, { ...draft, pending: false, failed: true });
      }
    },
    [qc, roomId, me],
  );
}

/** Try a message that didn't go again: it leaves where it was and goes to the end. */
export function useRetryChatMessage(roomId: string, me: ChatPerson | null) {
  const qc = useQueryClient();
  const send = useSendChatMessage(roomId, me);
  return useCallback(
    async (failed: ChatBubble) => {
      qc.setQueryData<Pages>(keys.messages(roomId), (cur) =>
        cur ? { ...cur, pages: cur.pages.map((p) => ({ ...p, messages: p.messages.filter((m) => m.id !== failed.id) })) } : cur,
      );
      await send(failed.body, failed.replyTo ? ({ id: failed.replyTo.id, author: null, body: failed.replyTo.body } as unknown as ChatMessage) : null);
    },
    [qc, roomId, send],
  );
}

/**
 * Anything else that changes chats — edit, delete, react, mute, pin, a group's
 * name or people. A message that comes back is put in place; everything else
 * refreshes.
 */
export function useChatMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result) => {
      const m = result as Partial<ChatMessage> | undefined;
      if (m && typeof m === "object" && m.id && m.roomId && "reactions" in m) upsertMessage(qc, m.roomId, m as ChatMessage);
      const room = result as Partial<ChatRoom> | undefined;
      if (room && typeof room === "object" && room.id && Array.isArray(room.members)) qc.setQueryData(keys.room(room.id), room);
      qc.invalidateQueries({ queryKey: ["chat", "room"] });
      refreshLists(qc);
    },
  });
}

/** I've seen this chat. Cheap to call often: it only goes out when there's news. */
export function useMarkChatRead(roomId: string | null | undefined, newestId: string | undefined, canRead: boolean) {
  const qc = useQueryClient();
  const last = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!roomId || !newestId || !canRead || newestId.startsWith("local_") || last.current === newestId) return;
    const mark = () => {
      if (!looking()) return;
      last.current = newestId;
      void api.readChatRoom(roomId).then(() => refreshLists(qc), () => undefined);
    };
    mark();
    return clientConfig().attention?.onReturn(mark);
  }, [qc, roomId, newestId, canRead]);
}

/* ---- typing ---- */

type Typists = Map<string, { name: string; until: number }>;
const typing = new Map<string, Typists>();
const typingListeners = new Set<() => void>();
let typingVersion = 0;
const bumpTyping = () => {
  typingVersion++;
  for (const l of typingListeners) l();
};

function setTyping(roomId: string, userId: string, name: string, on: boolean): void {
  const room = typing.get(roomId) ?? new Map();
  if (on) room.set(userId, { name, until: Date.now() + 6_000 });
  else room.delete(userId);
  typing.set(roomId, room);
  bumpTyping();
}

/** Who is typing in this chat right now. */
export function useChatTyping(roomId: string | null | undefined): string[] {
  useSyncExternalStore(
    (l) => {
      typingListeners.add(l);
      const t = setInterval(l, 2_000);
      return () => {
        typingListeners.delete(l);
        clearInterval(t);
      };
    },
    () => typingVersion + Math.floor(Date.now() / 2_000),
    () => 0,
  );
  if (!roomId) return [];
  const now = Date.now();
  return [...(typing.get(roomId)?.values() ?? [])].filter((t) => t.until > now).map((t) => t.name);
}

/** Tell the chat I'm typing: at most every few seconds, and "stopped" after a pause. */
export function useChatTypingSignal(roomId: string | null | undefined) {
  const lastSent = useRef(0);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = null;
    if (!roomId || !lastSent.current) return;
    lastSent.current = 0;
    getSocket().emit(ChatClientEvent.Typing, { roomId, typing: false });
  }, [roomId]);
  const typed = useCallback(() => {
    if (!roomId) return;
    const now = Date.now();
    if (now - lastSent.current > 3_000) {
      lastSent.current = now;
      getSocket().emit(ChatClientEvent.Typing, { roomId, typing: true });
    }
    if (stopTimer.current) clearTimeout(stopTimer.current);
    stopTimer.current = setTimeout(stop, 4_000);
  }, [roomId, stop]);
  useEffect(() => stop, [stop]);
  return { typed, stop };
}

/* ---- presence in one chat ---- */

/** Join the chat's room while it's open — so pushes about it aren't sent here, and typing reaches me. */
export function useChatRoomOpen(roomId: string | null | undefined): void {
  useEffect(() => {
    if (!roomId) return;
    setOpenChatRoom(roomId);
    const socket = getSocket();
    const join = () => socket.emit(ChatClientEvent.Join, { roomId });
    join();
    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
      socket.emit(ChatClientEvent.Leave, { roomId });
      if (openRoom === roomId) setOpenChatRoom(null);
    };
  }, [roomId]);
}

/* ---- the socket ---- */

/**
 * Keep every chat screen current. Mounted once, near the top of the app, for
 * as long as Team Chat is on.
 */
export function useChatRealtime(enabled: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const onMessage = (p: { roomId: string; message: ChatMessage }) => {
      upsertMessage(qc, p.roomId, p.message);
      if (p.message.author) setTyping(p.roomId, p.message.author.id, p.message.author.name, false);
      // The list and the badge refetch — which is also my app telling the
      // server it has this message (the second grey tick).
      refreshLists(qc);
      if (p.message.kind === "system") qc.invalidateQueries({ queryKey: keys.room(p.roomId) });
    };
    const onUpdated = (p: { roomId: string; message: ChatMessage }) => {
      upsertMessage(qc, p.roomId, p.message);
      qc.invalidateQueries({ queryKey: ["chat", "rooms"] });
    };
    const onReceipt = (p: { roomId: string; userId: string; lastReadAt: string | null; lastDeliveredAt: string | null }) => {
      qc.setQueryData<ChatRoom>(keys.room(p.roomId), (cur) =>
        cur
          ? {
              ...cur,
              members: cur.members.map((m) =>
                m.id === p.userId ? { ...m, lastReadAt: p.lastReadAt, lastDeliveredAt: p.lastDeliveredAt } : m,
              ),
            }
          : cur,
      );
    };
    const onRoom = (p: { roomId: string; removed?: boolean }) => {
      qc.invalidateQueries({ queryKey: keys.room(p.roomId) });
      if (p.removed) qc.removeQueries({ queryKey: keys.messages(p.roomId) });
      refreshLists(qc);
    };
    const onTyping = (p: { roomId: string; userId: string; name: string; typing: boolean }) => setTyping(p.roomId, p.userId, p.name, p.typing);
    const onPresence = (p: { userId: string; online: boolean; lastSeenAt: string | null }) => {
      for (const all of [false, true]) {
        qc.setQueryData<ChatRoomSummary[]>(keys.rooms(all), (cur) =>
          cur?.map((r) => (r.other?.id === p.userId ? { ...r, other: { ...r.other, online: p.online, lastSeenAt: p.lastSeenAt ?? r.other.lastSeenAt } } : r)),
        );
      }
      for (const [key, room] of qc.getQueriesData<ChatRoom>({ queryKey: ["chat", "room"] })) {
        if (!room?.members.some((m) => m.id === p.userId)) continue;
        qc.setQueryData<ChatRoom>(key, {
          ...room,
          members: room.members.map((m) => (m.id === p.userId ? { ...m, online: p.online, lastSeenAt: p.lastSeenAt ?? m.lastSeenAt } : m)),
          other: room.other?.id === p.userId ? { ...room.other, online: p.online, lastSeenAt: p.lastSeenAt ?? room.other.lastSeenAt } : room.other,
        });
      }
    };
    // The server already left out everyone muted or not asking; this only skips
    // the chat that's open in front of me.
    const onCue = (p: { roomId: string; mention: boolean }) => {
      if (openRoom === p.roomId && looking()) return;
      clientConfig().cues.received?.();
    };
    socket.on(ChatServerEvent.Message, onMessage);
    socket.on(ChatServerEvent.MessageUpdated, onUpdated);
    socket.on(ChatServerEvent.Receipt, onReceipt);
    socket.on(ChatServerEvent.Room, onRoom);
    socket.on(ChatServerEvent.Typing, onTyping);
    socket.on(ChatServerEvent.Presence, onPresence);
    socket.on(ChatServerEvent.Cue, onCue);
    return () => {
      socket.off(ChatServerEvent.Message, onMessage);
      socket.off(ChatServerEvent.MessageUpdated, onUpdated);
      socket.off(ChatServerEvent.Receipt, onReceipt);
      socket.off(ChatServerEvent.Room, onRoom);
      socket.off(ChatServerEvent.Typing, onTyping);
      socket.off(ChatServerEvent.Presence, onPresence);
      socket.off(ChatServerEvent.Cue, onCue);
    };
  }, [qc, enabled]);
}
