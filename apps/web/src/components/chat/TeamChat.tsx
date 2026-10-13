import { useEffect, useMemo, useState } from "react";
import type { ChatMessage, ChatRoomSummary } from "@ding/schemas";
import {
  chatListTime,
  chatPreview,
  useChatRooms,
  useChatSearch,
  useChatStarred,
  useChatStatus,
  useMe,
  useMediaQuery,
  usePeople,
} from "../../hooks";
import { BackIcon, ComposeIcon, EyeIcon, SearchIcon, SoundOffIcon, StarIcon, TeamChatIcon, XIcon } from "../../lib/icons";
import { ChatConversation } from "./ChatConversation";
import { NewChatDialog } from "./ChatDialogs";
import { RoomAvatar } from "./RoomAvatar";

type Filter = "all" | "unread" | "groups" | "direct";

/**
 * Team Chat, the whole screen: the list of chats on the left, the open chat on
 * the right — WhatsApp Web's shape, because that's the one everybody already
 * knows. On a phone-width window it's one or the other. See docs/team-chat.md.
 */
export function TeamChat({
  focusRoomId,
  onToast,
  onOpenConversation,
}: {
  focusRoomId?: string | null;
  onToast: (m: string) => void;
  /** A shared customer conversation's card was opened. */
  onOpenConversation?: (id: string) => void;
}) {
  const isMobile = useMediaQuery("(max-width: 820px)");
  const me = useMe().data?.user;
  const status = useChatStatus();
  const [oversee, setOversee] = useState(false);
  const rooms = useChatRooms(oversee);
  const people = usePeople();
  const [selected, setSelected] = useState<string | null>(focusRoomId ?? null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [showStarred, setShowStarred] = useState(false);
  const [focusMessage, setFocusMessage] = useState<string | null>(null);
  // Search messages once typing pauses.
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(q.trim()), 250);
    return () => window.clearTimeout(t);
  }, [q]);
  const found = useChatSearch(oversee ? "" : term);
  const starred = useChatStarred(showStarred);

  useEffect(() => {
    if (focusRoomId) setSelected(focusRoomId);
  }, [focusRoomId]);

  const openAt = (roomId: string, messageId: string | null) => {
    setFocusMessage(messageId);
    setSelected(roomId);
  };

  const mentionables = useMemo(() => (people.data ?? []).map((m) => m.user), [people.data]);
  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (rooms.data ?? []).filter((r) => {
      if (filter === "unread" && !r.unread) return false;
      if (filter === "groups" && r.kind === "direct") return false;
      if (filter === "direct" && r.kind !== "direct") return false;
      if (!term) return true;
      return r.name.toLowerCase().includes(term) || (r.lastMessage?.body ?? "").toLowerCase().includes(term);
    });
  }, [rooms.data, q, filter]);
  const unreadChats = (rooms.data ?? []).filter((r) => r.unread > 0).length;

  const showList = !isMobile || !selected;
  const showChat = !isMobile || !!selected;

  return (
    <div className="tc">
      {showList && (
        <aside className="tc-list" aria-label="Chats">
          {showStarred ? (
            <StarredList
              items={starred.data ?? []}
              loading={starred.isLoading}
              meId={me?.id}
              people={mentionables}
              onBack={() => setShowStarred(false)}
              onOpen={(roomId, id) => openAt(roomId, id)}
            />
          ) : (
          <>
          <header className="tc-list__head">
            <h1>{oversee ? "All chats" : "Chats"}</h1>
            <div className="tc-list__acts">
              <button type="button" className="iconbtn" title="Starred messages" aria-label="Starred messages" onClick={() => setShowStarred(true)}>
                <StarIcon />
              </button>
              {status.data?.canOversee && (
                <button
                  type="button"
                  className={"iconbtn" + (oversee ? " on" : "")}
                  title={oversee ? "Back to my chats" : "All chats (admin)"}
                  aria-label={oversee ? "Back to my chats" : "All chats in the workspace"}
                  aria-pressed={oversee}
                  onClick={() => setOversee((v) => !v)}
                >
                  <EyeIcon />
                </button>
              )}
              <button type="button" className="iconbtn" title="New chat" aria-label="New chat" onClick={() => setNewOpen(true)}>
                <ComposeIcon />
              </button>
            </div>
          </header>
          {oversee && (
            <div className="tc-oversee" role="note">
              Every chat in the workspace. You can read ones you aren't in, but not write in them — and each time you open one, it's recorded.
            </div>
          )}
          <div className="tc-search">
            <SearchIcon />
            <input
              type="search"
              placeholder={oversee ? "Search chats" : "Search chats and messages"}
              aria-label="Search chats and messages"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {q && (
              <button type="button" aria-label="Clear search" onClick={() => setQ("")}>
                <XIcon />
              </button>
            )}
          </div>
          <div className="tc-chips" role="tablist" aria-label="Show">
            {(
              [
                ["all", "All"],
                ["unread", unreadChats ? `Unread ${unreadChats}` : "Unread"],
                ["groups", "Groups"],
                ["direct", "Direct"],
              ] as Array<[Filter, string]>
            ).map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={filter === k} className={"tc-chip" + (filter === k ? " on" : "")} onClick={() => setFilter(k)}>
                {label}
              </button>
            ))}
          </div>
          <div className="tc-rows" role="list">
            {rooms.isLoading ? (
              <p className="tc-empty">Loading…</p>
            ) : !list.length && !(found.data?.length && term.length >= 2) ? (
              <div className="tc-empty">
                <TeamChatIcon />
                <p>{q || filter !== "all" ? "Nothing matches." : "No chats yet. Start one with the pencil above."}</p>
              </div>
            ) : (
              <>
                {term.length >= 2 && list.length > 0 && <div className="tc-rows__label">Chats</div>}
                {list.map((r) => (
                  <ChatRow
                    key={r.id}
                    r={r}
                    active={selected === r.id}
                    meId={me?.id}
                    people={mentionables}
                    onOpen={() => openAt(r.id, null)}
                  />
                ))}
                {term.length >= 2 && !!found.data?.length && (
                  <>
                    <div className="tc-rows__label">Messages</div>
                    {found.data.map((h) => (
                      <MessageRow
                        key={h.message.id}
                        where={h.roomName}
                        m={h.message}
                        group={h.roomKind !== "direct"}
                        highlight={term}
                        meId={me?.id}
                        people={mentionables}
                        onOpen={() => openAt(h.roomId, h.message.id)}
                      />
                    ))}
                  </>
                )}
              </>
            )}
          </div>
          <footer className="tc-list__foot">Admins in your workspace can read team chats.</footer>
          </>
          )}
        </aside>
      )}
      {showChat &&
        (selected ? (
          <ChatConversation
            key={selected}
            roomId={selected}
            focusMessageId={focusMessage}
            onOpenConversation={onOpenConversation}
            onBack={isMobile ? () => setSelected(null) : undefined}
            onClosed={() => setSelected(null)}
            onOpenRoom={(id) => openAt(id, null)}
            onToast={onToast}
          />
        ) : (
          <section className="tc-welcome">
            <span className="tc-welcome__ic" aria-hidden="true">
              <TeamChatIcon />
            </span>
            <h2>Team Chat</h2>
            <p>Message anyone on the team, or talk in your team's own chat. Pick a chat on the left, or start a new one.</p>
            <button type="button" className="btn-primary" onClick={() => setNewOpen(true)}>
              <ComposeIcon /> New chat
            </button>
          </section>
        ))}
      {newOpen && (
        <NewChatDialog
          canCreateGroups={!!status.data?.canCreateGroups}
          onClose={() => setNewOpen(false)}
          onOpened={(id) => {
            setNewOpen(false);
            setOversee(false);
            openAt(id, null);
          }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function ChatRow({
  r,
  active,
  meId,
  people,
  onOpen,
}: {
  r: ChatRoomSummary;
  active: boolean;
  meId: string | undefined;
  people: Array<{ name: string; email: string }>;
  onOpen: () => void;
}) {
  const last = r.lastMessage;
  const preview = chatPreview(last, { meId, group: r.kind !== "direct", people });
  return (
    <button
      type="button"
      role="listitem"
      className={"tc-row" + (active ? " active" : "") + (r.unread ? " unread" : "") + (r.isMember ? "" : " oversee")}
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
    >
      <RoomAvatar room={r} size={46} />
      <span className="tc-row__main">
        <span className="tc-row__top">
          <span className="tc-row__name">{r.name}</span>
          <span className="tc-row__time">{chatListTime(r.lastActivityAt)}</span>
        </span>
        <span className="tc-row__bottom">
          <span className={"tc-row__preview" + (last?.deletedAt ? " deleted" : "")}>
            {preview || (r.kind === "team" ? "Your team's chat" : r.archived ? "Archived" : "")}
          </span>
          {r.muted && (
            <span className="tc-row__muted" title="Muted" aria-label="Muted">
              <SoundOffIcon />
            </span>
          )}
          {r.mentioned && r.unread > 0 && (
            <span className="tc-row__at" aria-label="You were mentioned">
              @
            </span>
          )}
          {r.unread > 0 && <span className={"tc-row__badge" + (r.muted ? " muted" : "")}>{r.unread > 99 ? "99+" : r.unread}</span>}
          {!r.isMember && <span className="tc-row__tag">{r.archived ? "Archived" : "Not in it"}</span>}
        </span>
      </span>
    </button>
  );
}

/** A message found by search, or starred: where it was said, who said it, when. */
function MessageRow({
  where,
  m,
  group,
  highlight,
  meId,
  people,
  onOpen,
}: {
  where: string;
  m: ChatMessage;
  group: boolean;
  highlight?: string;
  meId: string | undefined;
  people: Array<{ name: string; email: string }>;
  onOpen: () => void;
}) {
  const text = chatPreview(m, { meId, group, people });
  const at = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1;
  return (
    <button type="button" role="listitem" className="tc-row tc-row--msg" onClick={onOpen}>
      <span className="tc-row__main">
        <span className="tc-row__top">
          <span className="tc-row__name">{where}</span>
          <span className="tc-row__time">{chatListTime(m.createdAt)}</span>
        </span>
        <span className="tc-row__bottom">
          <span className="tc-row__preview">
            {at >= 0 && highlight ? (
              <>
                {text.slice(0, at)}
                <mark>{text.slice(at, at + highlight.length)}</mark>
                {text.slice(at + highlight.length)}
              </>
            ) : (
              text
            )}
          </span>
        </span>
      </span>
    </button>
  );
}

function StarredList({
  items,
  loading,
  meId,
  people,
  onBack,
  onOpen,
}: {
  items: Array<{ roomId: string; roomName: string; message: ChatMessage; starredAt: string }>;
  loading: boolean;
  meId: string | undefined;
  people: Array<{ name: string; email: string }>;
  onBack: () => void;
  onOpen: (roomId: string, messageId: string) => void;
}) {
  return (
    <>
      <header className="tc-list__head tc-list__head--sub">
        <button type="button" className="iconbtn" aria-label="Back to chats" onClick={onBack}>
          <BackIcon />
        </button>
        <h1>Starred messages</h1>
      </header>
      <div className="tc-rows" role="list">
        {loading ? (
          <p className="tc-empty">Loading…</p>
        ) : !items.length ? (
          <div className="tc-empty">
            <StarIcon />
            <p>Nothing starred yet. Star a message from its menu to find it here later.</p>
          </div>
        ) : (
          items.map((s) => (
            <MessageRow
              key={s.message.id}
              where={s.roomName}
              m={s.message}
              group
              meId={meId}
              people={people}
              onOpen={() => onOpen(s.roomId, s.message.id)}
            />
          ))
        )}
      </div>
    </>
  );
}
