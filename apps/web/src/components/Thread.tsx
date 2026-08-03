import { useEffect, useRef, useState, type JSX } from "react";
import { useConversation, useMe, useSendMessage, useAssign, useSetStatus } from "../hooks";
import { relativeTime, initials } from "../lib/format";
import { playSent, unlock } from "../lib/sound";
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
  CheckCircleIcon,
  ReopenIcon,
  BackIcon,
  BoltIcon,
  CheckSingle,
  CheckDouble,
} from "../lib/icons";

const SALES_TEAM_ID = "team_sales";

interface Props {
  conversationId: string | null;
  showPanel: boolean;
  onTogglePanel: () => void;
  onToast: (msg: string) => void;
  onBack?: () => void;
  onClosed?: () => void;
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

export function Thread({ conversationId, showPanel, onTogglePanel, onToast, onBack, onClosed }: Props) {
  const { data: conv } = useConversation(conversationId);
  const { data: me } = useMe();
  const send = useSendMessage();
  const assign = useAssign();
  const setStatus = useSetStatus();

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
  const Glyph = cm.Glyph;
  const isEmail = conv.channel === "email";
  const isClosed = conv.status === "closed";
  const owned = !!conv.assigneeUserId;
  const sub = isEmail
    ? (conv.contact.email ?? "")
    : conv.channel === "whatsapp_group"
      ? "group · active now"
      : "online · last seen just now";

  const handleSend = () => {
    const body = text.trim();
    if (!body) return;
    unlock();
    send.mutate({ id: conv.id, body, internal });
    if (!internal) playSent();
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
  const closeConversation = () => {
    setMenu(false);
    setStatus.mutate(
      { id: conv.id, status: "closed" },
      { onSuccess: () => { onToast("Conversation closed"); onClosed?.(); } },
    );
  };
  const reopenConversation = () => {
    setStatus.mutate({ id: conv.id, status: "open" }, { onSuccess: () => onToast("Conversation reopened") });
  };

  return (
    <main className="thread" aria-label="Conversation">
      <header className="thread__head">
        {onBack && (
          <button className="thread__back" title="Back" onClick={onBack} aria-label="Back to conversations">
            <BackIcon />
          </button>
        )}
        <div className="thread__id">
          <div className="av" style={{ background: conv.contact.avatarColor, width: 40, height: 40, fontSize: 14 }}>
            {initials(conv.contact.displayName)}
          </div>
          <div className="who">
            <h2>{conv.contact.displayName}</h2>
            {conv.subject && conv.subject !== conv.contact.displayName && (
              <div className="who-subject">{conv.subject}</div>
            )}
            <div className="who-sub">
              <span className="pill" title={cm.label} aria-label={cm.label}>
                <span className="pill-ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
              </span>
              <span className="who-presence">{sub}</span>
            </div>
          </div>
        </div>
        <div className="thread__actions">
          {isClosed ? (
            <button className="resolvebtn reopened" onClick={reopenConversation} title="Reopen conversation">
              <ReopenIcon />
              <span className="lbl">Reopen</span>
            </button>
          ) : (
            <button className="resolvebtn" onClick={closeConversation} title="Close (resolve) conversation">
              <CheckCircleIcon />
              <span className="lbl">Resolve</span>
            </button>
          )}
          <button className="assignbtn" onClick={() => setMenu((v) => !v)}>
            {owned ? (
              <>
                <span className="mini" style={{ background: me?.user.avatarColor }}>
                  {me ? initials(me.user.name) : ""}
                </span>
                <span className="lbl">Assigned to you</span>
              </>
            ) : (
              <>
                <span className="assignbtn__ic">
                  <ProfileIcon />
                </span>
                <span className="lbl">Take conversation</span>
              </>
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
                <div className="sep" />
                {isClosed ? (
                  <button onClick={reopenConversation}>
                    <ReopenIcon /> Reopen conversation
                  </button>
                ) : (
                  <button onClick={closeConversation}>
                    <CheckCircleIcon /> Close conversation
                  </button>
                )}
              </div>
            </>
          )}
          <button className="iconbtn" title="Snooze" onClick={() => onToast("Snoozed until tomorrow 9:00")}>
            <SnoozeIcon />
          </button>
          <button className="iconbtn hide-sm" title="Add label" onClick={() => onToast("Add label")}>
            <TagIcon />
          </button>
          <button className={"iconbtn" + (showPanel ? " on" : "")} title="Details" onClick={onTogglePanel}>
            <DetailsIcon />
          </button>
        </div>
      </header>

      <div className={"msgs" + (isClosed ? " is-closed" : "")}>
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
              <div className="bubble">
                <span className="txt">{m.body}</span>
                <span className="stamp">
                  {relativeTime(m.createdAt)}
                  {m.direction === "out" && (
                    <span className={"tick" + (m.status === "read" ? " read" : "")}>
                      {m.status === "read" || m.status === "delivered" ? <CheckDouble /> : <CheckSingle />}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ),
        )}
        {conv.messages.length === 0 && (
          <div className="thread-empty">No messages yet — start the conversation.</div>
        )}
        <div ref={endRef} />
      </div>

      {isClosed ? (
        <div className="closedbar">
          <div className="closedbar__txt">
            <CheckCircleIcon />
            <span>This conversation is closed.</span>
          </div>
          <button className="closedbar__btn" onClick={reopenConversation}>
            <ReopenIcon /> Reopen to reply
          </button>
        </div>
      ) : (
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
              {internal ? (
                <>
                  <span className="d" style={{ background: "var(--amber)" }} />
                  Internal note · team only
                </>
              ) : (
                <>
                  <span className="chsel-ic" style={{ color: cm.color }}>
                    <Glyph />
                  </span>
                  {conv.contact.displayName}
                </>
              )}
            </button>
          </div>
          <div className="compinput">
            <button className="tool" title="Emoji">
              <EmojiIcon />
            </button>
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
              <BoltIcon />
            </button>
            <button className="tool hide-sm" title="Attach">
              <AttachIcon />
            </button>
            <button className="send" onClick={handleSend} disabled={!text.trim()}>
              <SendIcon />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
