import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CHAT_MESSAGE_MAX, mentionsToNames, namesToHandles, type ChatSharedConversation, type Mentionable } from "@ding/schemas";
import {
  api,
  chatNameColour,
  clockTime,
  useChatDiscussions,
  useChatRooms,
  useChatStatus,
  useChatRoom,
  useChatThread,
  useMe,
  usePeople,
  useShareConversation,
} from "../../hooks";
import { channelMeta, SearchIcon, SendIcon, TeamChatIcon, XIcon } from "../../lib/icons";
import { Avatar } from "../Avatar";
import { RoomAvatar } from "./RoomAvatar";

/*
 * A customer conversation, discussed in Team Chat: the card it makes in a
 * chat, picking where to send it, the bar on the thread that says where it's
 * being talked about, and that discussion opened beside the thread. See
 * docs/team-chat.md.
 */

const STATUS: Record<string, string> = { open: "Open", pending: "Pending", snoozed: "Snoozed", closed: "Resolved" };

/** The card a shared customer conversation makes. Live: its status and owner follow the conversation. */
export function SharedCard({ shared, onOpen }: { shared: ChatSharedConversation; onOpen?: () => void }) {
  const ch = channelMeta(shared.channel);
  const gone = shared.status === null;
  const body = (
    <>
      <span className="tc-card__head">
        <Avatar name={shared.contactName} color={shared.contactAvatarColor} size={30} fontSize={11} />
        <span className="tc-card__who">
          <span className="tc-card__name">{shared.contactName}</span>
          <span className="tc-card__ch" style={{ color: ch.color }}>
            {ch.label}
            {shared.subject ? <span className="tc-card__subject"> · {shared.subject}</span> : null}
          </span>
        </span>
      </span>
      {shared.quote && (
        <span className={"tc-card__quote" + (shared.quote.internal ? " note" : "")}>
          <span className="tc-card__qwho">{shared.quote.internal ? `Note · ${shared.quote.authorName}` : shared.quote.authorName}</span>
          <span className="tc-card__qtext">{shared.quote.body}</span>
        </span>
      )}
      <span className="tc-card__foot">
        {gone ? (
          <span className="tc-card__gone">This conversation was deleted</span>
        ) : (
          <>
            <span className={"tc-card__status s-" + shared.status}>{shared.status === "closed" ? "✓ " : ""}{STATUS[shared.status!] ?? shared.status}</span>
            <span className="tc-card__owner">{shared.assigneeName ? `Assigned to ${shared.assigneeName}` : "Unassigned"}</span>
          </>
        )}
      </span>
    </>
  );
  return onOpen && !gone ? (
    <button type="button" className="tc-card" onClick={onOpen} aria-label={`${shared.contactName} — open the conversation`}>
      {body}
    </button>
  ) : (
    <div className="tc-card">{body}</div>
  );
}

/** Pick a chat — a group, a team's, or one person — and send a customer conversation there to discuss. */
export function ShareDialog({
  conversationId,
  contactName,
  message,
  onClose,
  onToast,
}: {
  conversationId: string;
  contactName: string;
  /** Sharing one message from it: "Discuss…" on a bubble. */
  message?: { id: string; who: string; text: string } | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const rooms = useChatRooms(false);
  const share = useShareConversation();
  const [q, setQ] = useState("");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [line, setLine] = useState("");
  const writable = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rooms.data ?? []).filter((r) => r.isMember && !r.archived && (!term || r.name.toLowerCase().includes(term)));
  }, [rooms.data, q]);
  const room = (rooms.data ?? []).find((r) => r.id === roomId);

  const send = () => {
    if (!roomId) return;
    share.mutate(
      { roomId, conversationId, messageId: message?.id ?? null, body: line.trim() },
      {
        onSuccess: () => {
          onToast(`Shared with ${room?.name ?? "the chat"}`);
          onClose();
        },
        onError: (e) => onToast((e as Error).message || "Couldn't share it"),
      },
    );
  };

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box tc-newchat tc-share" role="dialog" aria-label="Discuss with the team" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Discuss with the team</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body tc-newchat__body">
          <div className="tc-share__what">
            <TeamChatIcon />
            <span>
              <b>{contactName}</b>
              {message ? (
                <span className="tc-share__msg">
                  {message.who}: “{message.text}”
                </span>
              ) : (
                <span className="tc-share__msg">The whole conversation</span>
              )}
            </span>
          </div>
          <div className="tc-search tc-search--dialog">
            <SearchIcon />
            <input type="search" placeholder="Search chats" aria-label="Search chats" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          </div>
          <div className="tc-picklist" role="radiogroup" aria-label="Send to">
            {writable.map((r) => (
              <button
                key={r.id}
                type="button"
                role="radio"
                aria-checked={roomId === r.id}
                className={"tc-pickrow" + (roomId === r.id ? " on" : "")}
                onClick={() => setRoomId(r.id)}
              >
                <RoomAvatar room={r} size={38} />
                <span className="tc-pickrow__main">
                  <span className="tc-pickrow__name">{r.name}</span>
                  <span className="tc-pickrow__sub">{r.kind === "team" ? "Team chat" : r.kind === "group" ? `${r.memberCount} people` : "Direct message"}</span>
                </span>
              </button>
            ))}
            {!writable.length && <p className="tc-empty">{rooms.isLoading ? "Loading…" : "No chats match."}</p>}
          </div>
          <label className="field tc-share__line">
            <span>Add a message</span>
            <textarea
              rows={2}
              value={line}
              maxLength={CHAT_MESSAGE_MAX}
              placeholder="Can someone check stock for this?"
              onChange={(e) => setLine(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </label>
        </div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary" disabled={!roomId || share.isPending} onClick={send}>
            {room ? `Send to ${room.name}` : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Under the thread's header: where this conversation is being discussed, the
 * replies so far, and the latest one. Nothing at all when it isn't, or when
 * Team Chat is off.
 */
export function DiscussionBar({ conversationId, active, onOpen }: { conversationId: string; active: string | null; onOpen: (cardId: string) => void }) {
  const status = useChatStatus();
  const found = useChatDiscussions(conversationId, !!status.data?.enabled);
  const people = usePeople();
  const list = found.data ?? [];
  if (!list.length) return null;
  const first = list[0]!;
  const mentionables = (people.data ?? []).map((m) => m.user);
  const latest = first.latest;
  return (
    <div className="tc-discbar" role="region" aria-label="Discussed in Team Chat">
      <button type="button" className={"tc-discbar__main" + (active === first.card.id ? " on" : "")} onClick={() => onOpen(first.card.id)}>
        <TeamChatIcon />
        <span className="tc-discbar__text">
          <span className="tc-discbar__where">
            Discussed in <b>{first.roomName}</b>
            {first.replies ? ` · ${first.replies} ${first.replies === 1 ? "reply" : "replies"}` : ""}
          </span>
          {latest ? (
            <span className="tc-discbar__latest">
              {latest.author?.name.split(" ")[0] ?? "Someone"}: {mentionsToNames(latest.body, mentionables) || "📎"}
            </span>
          ) : (
            <span className="tc-discbar__latest">
              {first.card.author?.name.split(" ")[0] ?? "Someone"} shared it{first.card.body ? `: ${mentionsToNames(first.card.body, mentionables)}` : ""}
            </span>
          )}
        </span>
      </button>
      {list.slice(1, 4).map((d) => (
        <button key={d.card.id} type="button" className={"tc-discbar__more" + (active === d.card.id ? " on" : "")} onClick={() => onOpen(d.card.id)} title={`Discussed in ${d.roomName}`}>
          {d.roomName}
          {d.replies ? ` · ${d.replies}` : ""}
        </button>
      ))}
    </div>
  );
}

/** One discussion, beside the thread: the card, what's been said, and a box to answer in. */
export function DiscussionPanel({
  cardId,
  onClose,
  onOpenChat,
  onToast,
}: {
  cardId: string;
  onClose: () => void;
  onOpenChat: (roomId: string) => void;
  onToast: (m: string) => void;
}) {
  const qc = useQueryClient();
  const t = useChatThread(cardId);
  const people = usePeople();
  const mentionables: Mentionable[] = useMemo(() => (people.data ?? []).map((m) => m.user), [people.data]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const d = t.data;
  const box = useRef<HTMLTextAreaElement>(null);
  const room = useChatRoom(d?.roomId);
  const me = useMe();
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [mentionIdx, setMentionIdx] = useState(0);
  // As in the chat itself: only people in that chat, and never yourself.
  const inRoom = useMemo(() => {
    const members = room.data?.members;
    const ids = members ? new Set(members.map((m) => m.id)) : null;
    return mentionables.filter((p) => {
      const id = (p as Mentionable & { id?: string }).id ?? "";
      return id !== me.data?.user.id && (!ids || ids.has(id));
    });
  }, [mentionables, room.data?.members, me.data?.user.id]);
  const matches = mention
    ? inRoom.filter((p) => p.name.toLowerCase().startsWith(mention.query.toLowerCase()) || p.name.toLowerCase().includes(` ${mention.query.toLowerCase()}`)).slice(0, 6)
    : [];

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value.slice(0, CHAT_MESSAGE_MAX);
    setText(v);
    const caret = e.target.selectionStart ?? v.length;
    const at = /(^|\s)@([^\s@]{0,24})$/.exec(v.slice(0, caret));
    setMention(at ? { query: at[2]!, start: caret - at[2]!.length - 1 } : null);
    setMentionIdx(0);
  };
  const pickMention = (p: Mentionable) => {
    if (!mention) return;
    const caret = box.current?.selectionStart ?? text.length;
    setText(`${text.slice(0, mention.start)}@${p.name} ${text.slice(caret)}`);
    setMention(null);
    requestAnimationFrame(() => {
      const pos = mention.start + p.name.length + 2;
      box.current?.focus();
      box.current?.setSelectionRange(pos, pos);
    });
  };

  const send = async () => {
    const body = namesToHandles(text.trim(), mentionables);
    if (!d || !body || busy) return;
    setBusy(true);
    try {
      await api.sendChatMessage(d.roomId, { body, replyToId: d.card.id, clientId: null, attachments: [] });
      setText("");
      qc.invalidateQueries({ queryKey: ["chat", "thread", cardId] });
      qc.invalidateQueries({ queryKey: ["chat", "discussions"] });
    } catch (e) {
      onToast((e as Error).message || "Couldn't send that");
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && matches.length) {
      if (e.key === "ArrowDown") return e.preventDefault(), setMentionIdx((i) => (i + 1) % matches.length);
      if (e.key === "ArrowUp") return e.preventDefault(), setMentionIdx((i) => (i - 1 + matches.length) % matches.length);
      if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pickMention(matches[mentionIdx]!);
      if (e.key === "Escape") return e.preventDefault(), setMention(null);
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <aside className="panel tc-discpanel" aria-label="Discussion">
      <header className="tc-discpanel__head">
        <TeamChatIcon />
        <span className="tc-discpanel__title">
          <span>Discussion</span>
          {d && <b>{d.roomName}</b>}
        </span>
        {d && (
          <button type="button" className="btn-ghost tc-discpanel__open" onClick={() => onOpenChat(d.roomId)}>
            Open chat
          </button>
        )}
        <button type="button" className="iconbtn" aria-label="Close discussion" onClick={onClose}>
          <XIcon />
        </button>
      </header>
      <div className="tc-discpanel__body">
        {t.isError ? (
          <p className="tc-empty">This discussion isn't available — the card may have been deleted, or you aren't in that chat.</p>
        ) : !d ? (
          <p className="tc-empty">Loading…</p>
        ) : (
          <>
            <div className="tc-discpanel__card">
              <span className="tc-discpanel__by">
                {d.card.author?.name ?? "Someone"} shared it · {clockTime(d.card.createdAt)}
              </span>
              {d.card.shared && <SharedCard shared={d.card.shared} />}
              {d.card.body && <p className="tc-discpanel__line">{mentionsToNames(d.card.body, mentionables)}</p>}
            </div>
            {d.replies.map((r) => (
              <div key={r.id} className="tc-discpanel__reply">
                <span className="tc-discpanel__who" style={{ color: chatNameColour(r.author?.id) }}>
                  {r.author?.name ?? "Former teammate"}
                  <time dateTime={r.createdAt}>{clockTime(r.createdAt)}</time>
                </span>
                <span className={"tc-discpanel__text" + (r.deletedAt ? " tc-deleted" : "")}>
                  {r.deletedAt ? "This message was deleted" : mentionsToNames(r.body, mentionables) || (r.attachments.length ? "📎 Attachment" : "")}
                </span>
              </div>
            ))}
            {!d.replies.length && <p className="tc-discpanel__none">No replies yet.</p>}
          </>
        )}
      </div>
      {d?.canPost && (
        <div className="tc-discpanel__compose">
          {mention && matches.length > 0 && (
            <div className="mentionpop tc-mentionpop" role="listbox" aria-label="Mention someone">
              {matches.map((p, i) => (
                <button
                  key={p.email}
                  type="button"
                  role="option"
                  aria-selected={i === mentionIdx}
                  className={i === mentionIdx ? "on" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickMention(p);
                  }}
                >
                  <Avatar name={p.name} email={p.email} color={p.avatarColor} src={p.avatarUrl} size={22} fontSize={9} />
                  <span>{p.name}</span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={box}
            rows={1}
            value={text}
            maxLength={CHAT_MESSAGE_MAX}
            placeholder={`Reply in ${d.roomName}`}
            aria-label="Reply in the discussion"
            onChange={onChange}
            onKeyDown={onKey}
            onBlur={() => window.setTimeout(() => setMention(null), 120)}
          />
          <button type="button" className="tc-send" aria-label="Send" disabled={!text.trim() || busy} onClick={() => void send()}>
            <SendIcon />
          </button>
        </div>
      )}
    </aside>
  );
}

/** On a note: send it on to a chat too. */
export function AlsoSendTo({ value, onChange }: { value: string | null; onChange: (roomId: string | null) => void }) {
  const status = useChatStatus();
  const rooms = useChatRooms(false, !!status.data?.enabled);
  const writable = (rooms.data ?? []).filter((r) => r.isMember && !r.archived);
  if (!status.data?.enabled || !writable.length) return null;
  return (
    <label className={"tc-alsoto" + (value ? " on" : "")}>
      <TeamChatIcon />
      <span>Also send to</span>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} aria-label="Also send this note to a chat">
        <option value="">No chat</option>
        {writable.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
