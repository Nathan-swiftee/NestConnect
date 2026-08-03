import { useEffect, useRef, useState, type JSX } from "react";
import { useConversation, useMe, useSendMessage, useAssign } from "../hooks";
import { relativeTime, initials } from "../lib/format";
import {
  channelMeta,
  ChevronDown,
  SnoozeIcon,
  TagIcon,
  DetailsIcon,
  SendIcon,
  AttachIcon,
  EmojiIcon,
  NoteIcon,
  ProfileIcon,
  RouteIcon,
  InboxIcon,
} from "../lib/icons";

const SALES_TEAM_ID = "team_sales";

interface Props {
  conversationId: string | null;
  showPanel: boolean;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
}

function renderMention(body: string): JSX.Element[] {
  return body.split(/(@\w+)/g).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="men">
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function dayLabel(iso?: string): string {
  if (!iso) return "Today";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? "Today"
    : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

export function Thread({ conversationId, showPanel, onTogglePanel, onToast }: Props) {
  const { data: conv } = useConversation(conversationId);
  const { data: me } = useMe();
  const send = useSendMessage();
  const assign = useAssign();

  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [internal, setInternal] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages.length, conversationId]);

  if (!conversationId) {
    return (
      <main className="thread">
        <div className="center-note">Select a conversation to get started.</div>
      </main>
    );
  }
  if (!conv) {
    return (
      <main className="thread">
        <div className="center-note">Loading…</div>
      </main>
    );
  }

  const cm = channelMeta(conv.channel);
  const isEmail = conv.channel === "email";
  const owned = !!conv.assigneeUserId;
  const sub = isEmail
    ? (conv.contact.email ?? "")
    : conv.channel === "whatsapp_group"
      ? "group · active now"
      : "online · last seen just now";

  const handleSend = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate({ id: conv.id, body, internal });
    setText("");
    setInternal(false);
  };

  const take = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: me?.user.id ?? null, assignedTeamId: conv.assignedTeamId } });
    setMenu(false);
    onToast("Assigned to you");
  };
  const routeSales = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null, assignedTeamId: SALES_TEAM_ID } });
    setMenu(false);
    onToast("Routed to Sales team");
  };
  const unassign = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null } });
    setMenu(false);
    onToast("Moved to Up for grabs");
  };

  return (
    <main className="thread" aria-label="Conversation">
      <header className="thread__head">
        <div className="thread__id">
          <div className="av" style={{ background: conv.contact.avatarColor, width: 40, height: 40, fontSize: 14 }}>
            {initials(conv.contact.displayName)}
          </div>
          <div className="who">
            <h2>{conv.contact.displayName}</h2>
            <div className="who-sub">
              <span className="pill">
                <span className="d" style={{ background: cm.color }} />
                {cm.label}
              </span>
              <span>{sub}</span>
            </div>
          </div>
        </div>
        <div className="thread__actions">
          <button className="assignbtn" onClick={() => setMenu((v) => !v)}>
            {owned ? (
              <>
                <span className="mini" style={{ background: me?.user.avatarColor }}>
                  {me ? initials(me.user.name) : ""}
                </span>
                Assigned to you
              </>
            ) : (
              "Take conversation"
            )}
            <ChevronDown />
          </button>
          {menu && (
            <>
              <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setMenu(false)} />
              <div className="menu" role="menu">
                <button onClick={take}>
                  <ProfileIcon /> Assign to me
                </button>
                <button onClick={routeSales}>
                  <RouteIcon /> Route to Sales team
                </button>
                <div className="sep" />
                <button onClick={unassign}>
                  <InboxIcon /> Move to Up for grabs
                </button>
              </div>
            </>
          )}
          <button className="iconbtn" title="Snooze" onClick={() => onToast("Snoozed until tomorrow 9:00")}>
            <SnoozeIcon />
          </button>
          <button className="iconbtn" title="Add label" onClick={() => onToast("Add label")}>
            <TagIcon />
          </button>
          <button className={"iconbtn" + (showPanel ? " on" : "")} title="Details" onClick={onTogglePanel}>
            <DetailsIcon />
          </button>
        </div>
      </header>

      <div className="msgs">
        <div className="daysep">{dayLabel(conv.messages[0]?.createdAt)}</div>
        {conv.messages.map((m) =>
          m.internal ? (
            <div key={m.id} className="note">
              <div className="ic">
                <NoteIcon />
              </div>
              <div className="body">
                <div className="h">
                  Internal note<span className="t">{relativeTime(m.createdAt)}</span>
                </div>
                <div>{renderMention(m.body)}</div>
              </div>
            </div>
          ) : (
            <div key={m.id} className={"msg " + (m.direction === "out" ? "out" : "in")}>
              {m.direction === "in" && m.authorName && <div className="sender">{m.authorName}</div>}
              <div className="bubble">{m.body}</div>
              <div className="meta">
                {relativeTime(m.createdAt)}
                {m.direction === "out" && <span className="tick"> {m.status === "read" ? "✓✓" : "✓"}</span>}
              </div>
            </div>
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <div className="compbar">
          {internal ? (
            <span className="winhint" style={{ background: "var(--amber-tint)", color: "var(--amber)" }}>
              <span className="d" style={{ background: "var(--amber)" }} /> Internal note — your team only
            </span>
          ) : isEmail ? (
            <span className="winhint" style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}>
              <span className="d" style={{ background: "var(--email)" }} /> Email reply
            </span>
          ) : (
            <span className="winhint">
              <span className="d" /> Replying within the 24-hour window
            </span>
          )}
          <button
            className="chsel"
            onClick={() => setInternal((v) => !v)}
            title="Toggle internal note"
          >
            <span className="d" style={{ background: internal ? "var(--amber)" : cm.color }} />
            {internal ? "Internal note · team only" : `${cm.label} · ${conv.contact.displayName}`}
          </button>
        </div>
        <div className="compinput">
          <textarea
            value={text}
            rows={1}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              internal ? "Write an internal note… use @name to mention" : `Message ${conv.contact.displayName}…`
            }
          />
          <button className="tool" title="Template" onClick={() => onToast("Template picker")}>
            ⚡
          </button>
          <button className="tool" title="Attach">
            <AttachIcon />
          </button>
          <button className="tool" title="Emoji">
            <EmojiIcon />
          </button>
          <button className="send" onClick={handleSend} disabled={!text.trim()}>
            <SendIcon />
          </button>
        </div>
      </div>
    </main>
  );
}
