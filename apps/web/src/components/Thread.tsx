import { useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";
import type { Message, Attachment } from "@ding/schemas";
import { useConversation, useMe, useSendMessage, useAssign, useSetStatus, useSnooze, useTeams } from "../hooks";
import { relativeTime, clockTime, initials, formatBytes, formatDuration } from "../lib/format";
import { useHoverGlide } from "../lib/useHoverGlide";
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
  PlayIcon,
  PauseIcon,
  DocIcon,
  DownloadIcon,
  XIcon,
} from "../lib/icons";

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

/** Compact WhatsApp-style player for audio + voice notes. One <audio> element
 *  driven by state/refs: round play/pause, a seekable waveform (or progress
 *  bar), and an m:ss readout. */
function AudioPlayer({ att }: { att: Attachment }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const fallback = (att.durationMs ?? 0) / 1000;
  const [dur, setDur] = useState(fallback);
  const total = dur > 0 ? dur : fallback;
  const pct = total > 0 ? Math.min(1, cur / total) : 0;
  const wave = att.waveform && att.waveform.length ? att.waveform : null;

  const toggle = () => {
    const a = ref.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };
  // elapsed once engaged; total duration while idle at the start
  const shown = playing || cur > 0 ? cur : total;

  return (
    <div className={"att voice" + (att.kind === "voice" ? " voice--note" : "")}>
      <button type="button" className="voice__btn" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <div className="voice__body">
        <div
          className="voice__track"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          tabIndex={0}
          onClick={(e) => {
            const a = ref.current;
            if (!a || total <= 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
            a.currentTime = ratio * total;
            setCur(a.currentTime);
          }}
          onKeyDown={(e) => {
            const a = ref.current;
            if (!a || total <= 0) return;
            if (e.key === "ArrowRight") { a.currentTime = Math.min(total, a.currentTime + 5); setCur(a.currentTime); }
            else if (e.key === "ArrowLeft") { a.currentTime = Math.max(0, a.currentTime - 5); setCur(a.currentTime); }
          }}
        >
          {wave ? (
            <div className="voice__wave" aria-hidden="true">
              {wave.map((v, i) => (
                <span
                  key={i}
                  className={"voice__wbar" + ((i + 0.5) / wave.length <= pct ? " on" : "")}
                  style={{ height: `${Math.round(Math.max(0.08, Math.min(1, v)) * 100)}%` }}
                />
              ))}
            </div>
          ) : (
            <div className="voice__bar" aria-hidden="true">
              <div className="voice__fill" style={{ width: `${pct * 100}%` }} />
            </div>
          )}
        </div>
        <div className="voice__time tnum">{formatDuration(shown * 1000)}</div>
      </div>
      <audio
        ref={ref}
        src={att.url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCur(0); }}
        onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDur(d);
        }}
      />
    </div>
  );
}

/** One attachment, rendered by kind. `onImage` opens the lightbox. */
function AttachmentView({ att, onImage }: { att: Attachment; onImage: (url: string) => void }) {
  if (att.kind === "audio" || att.kind === "voice") return <AudioPlayer att={att} />;

  if (att.kind === "video") {
    return <video className="att att-video" src={att.url} controls preload="metadata" />;
  }

  if (att.kind === "image" || att.kind === "sticker") {
    const sticker = att.kind === "sticker";
    return (
      <img
        className={"att att-img" + (sticker ? " att-img--sticker" : "")}
        src={att.url}
        alt={att.filename || (sticker ? "Sticker" : "Image")}
        loading="lazy"
        width={att.width || undefined}
        height={att.height || undefined}
        role="button"
        tabIndex={0}
        onClick={() => onImage(att.url)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onImage(att.url); }
        }}
      />
    );
  }

  // document / file
  const ext = att.filename.includes(".")
    ? att.filename.split(".").pop()!.toUpperCase()
    : (att.mime.split("/").pop() ?? "file").toUpperCase();
  return (
    <a className="att att-file" href={att.url} download={att.filename} title={att.filename}>
      <span className="att-file__ic"><DocIcon /></span>
      <span className="att-file__meta">
        <span className="att-file__name">{att.filename || "Download"}</span>
        <span className="att-file__sub tnum">{formatBytes(att.size)} · {ext}</span>
      </span>
      <span className="att-file__dl" aria-hidden="true"><DownloadIcon /></span>
    </a>
  );
}

/** A single customer/agent message bubble, with any media rendered above an
 *  optional caption. Text-only messages keep their original markup exactly. */
function MessageBubble({ m, onImage }: { m: Message; onImage: (url: string) => void }) {
  const out = m.direction === "out";
  const atts = m.attachments ?? [];
  const hasMedia = atts.length > 0;
  const hasCaption = !!m.body && m.body.trim().length > 0;
  const single = atts.length === 1 ? atts[0] : null;
  const stickerOnly = !!single && single.kind === "sticker" && !hasCaption;
  // a lone image/video with no caption carries the floating timestamp chip
  const overlay = !!single && !hasCaption && (single.kind === "image" || single.kind === "video");
  // other media with no caption gets the timestamp on its own row underneath
  const blockStamp = hasMedia && !hasCaption && !overlay;
  const fallback = m.messageType === "location" ? "Location shared" : m.messageType === "contact" ? "Contact shared" : "";
  const showText = hasCaption || !hasMedia;
  const bodyText = hasCaption ? m.body : hasMedia ? "" : m.body || fallback;

  return (
    <div className={"msg " + (out ? "out" : "in")}>
      {!out && m.authorName && <div className="sender">{m.authorName}</div>}
      <div className={"bubble" + (hasMedia ? " has-media" : "") + (stickerOnly ? " bubble--plain" : "")}>
        {hasMedia && atts.map((a) => <AttachmentView key={a.id} att={a} onImage={onImage} />)}
        {showText && (
          <span className="txt">
            {bodyText}
            <span className="stampspace" aria-hidden="true" />
          </span>
        )}
        <span className={"stamp" + (overlay ? " stamp--over" : blockStamp ? " stamp--block" : "")}>
          {clockTime(m.createdAt)}
          {out && (
            <span className={"tick" + (m.status === "read" ? " read" : "")}>
              {m.status === "read" || m.status === "delivered" ? <CheckDouble /> : <CheckSingle />}
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function dayLabel(iso?: string): string {
  if (!iso) return "Today";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

/** Split messages into consecutive same-day groups so each day's sticky pill
 *  lives in its own section and gets pushed out by the next day's pill. */
function groupMessagesByDay(messages: Message[]): { key: string; label: string; items: Message[] }[] {
  const groups: { key: string; label: string; items: Message[] }[] = [];
  for (const m of messages) {
    const key = new Date(m.createdAt).toDateString();
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(m);
    else groups.push({ key, label: dayLabel(m.createdAt), items: [m] });
  }
  return groups;
}

export function Thread({ conversationId, showPanel, onTogglePanel, onToast, onBack, onClosed }: Props) {
  const { data: conv } = useConversation(conversationId);
  const { data: me } = useMe();
  const { data: teams } = useTeams();
  const send = useSendMessage();
  const assign = useAssign();
  const setStatus = useSetStatus();
  const snooze = useSnooze();

  const [text, setText] = useState("");
  const [menu, setMenu] = useState(false);
  const [snoozeMenu, setSnoozeMenu] = useState(false);
  const [internal, setInternal] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const replyBtnRef = useRef<HTMLButtonElement>(null);
  const noteBtnRef = useRef<HTMLButtonElement>(null);
  const modeThumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: modeRef, thumbRef: modeHoverRef, hoverProps: modeHover } = useHoverGlide<HTMLDivElement>(".modebtn", "x");

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv?.messages.length, conversationId]);

  // Close the image lightbox on Esc while it's open.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // Slide the Reply|Note thumb under the active tab. Written to the DOM directly
  // (no state → no extra render) so the slide starts on the same frame as the click.
  useLayoutEffect(() => {
    const btn = internal ? noteBtnRef.current : replyBtnRef.current;
    const thumb = modeThumbRef.current;
    if (btn && thumb) {
      thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
      thumb.style.width = `${btn.offsetWidth}px`;
    }
  }, [internal, conversationId, conv?.status]);

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
  const routeTeam = (teamId: string, name: string) => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null, assignedTeamId: teamId } });
    setMenu(false);
    onToast(`Routed to ${name}`);
  };
  const unassign = () => {
    assign.mutate({ id: conv.id, input: { assigneeUserId: null } });
    setMenu(false);
    onToast("Sent back to queue");
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
  const doSnooze = (until: string, label: string) => {
    setSnoozeMenu(false);
    snooze.mutate(
      { id: conv.id, until },
      { onSuccess: () => { onToast(`Snoozed · ${label}`); onClosed?.(); } },
    );
  };
  const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
  const tomorrow9am = () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d.toISOString();
  };
  const snoozeOpts = [
    { label: "10 minutes", short: "10 min", until: () => inMin(10) },
    { label: "30 minutes", short: "30 min", until: () => inMin(30) },
    { label: "1 hour", short: "1 hour", until: () => inMin(60) },
    { label: "Tomorrow, 9 AM", short: "tomorrow 9 AM", until: tomorrow9am },
  ];

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
          <button className="assignbtn" onClick={() => { setMenu((v) => !v); setSnoozeMenu(false); }}>
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
          <div className="snoozewrap">
            <button
              className={"iconbtn" + (snoozeMenu ? " on" : "")}
              title="Snooze"
              onClick={() => { setSnoozeMenu((v) => !v); setMenu(false); }}
            >
              <SnoozeIcon />
            </button>
            {snoozeMenu && (
              <>
                <div className="menu-backdrop" onClick={() => setSnoozeMenu(false)} />
                <div className="menu snoozemenu" role="menu">
                  <div className="menu__hd">Snooze until</div>
                  {snoozeOpts.map((o) => (
                    <button key={o.short} onClick={() => doSnooze(o.until(), o.short)}>
                      <SnoozeIcon /> {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="iconbtn hide-sm" title="Add label" onClick={() => onToast("Add label")}>
            <TagIcon />
          </button>
          <button className={"iconbtn" + (showPanel ? " on" : "")} title="Details" onClick={onTogglePanel}>
            <DetailsIcon />
          </button>
        </div>
      </header>

      {menu && (
        <>
          <div className="menu-backdrop" onClick={() => setMenu(false)} />
          <div className="menu" role="menu">
            {conv.assigneeUserId !== me?.user.id && (
              <button onClick={take}>
                <ProfileIcon /> Assign to me
              </button>
            )}
            {(teams ?? [])
              .filter((t) => t.id !== conv.assignedTeamId)
              .map((t) => (
                <button key={t.id} onClick={() => routeTeam(t.id, t.name)}>
                  <RouteIcon /> Route to {t.name}
                </button>
              ))}
            {conv.assigneeUserId && (
              <button onClick={unassign}>
                <InboxIcon /> Send back to queue
              </button>
            )}
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

      <div className={"msgs" + (isClosed ? " is-closed" : "")}>
        {groupMessagesByDay(conv.messages).map((group) => (
          <section className="daygroup" key={group.key}>
            <div className="daysep">{group.label}</div>
            {group.items.map((m) =>
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
                <MessageBubble key={m.id} m={m} onImage={setLightbox} />
              ),
            )}
          </section>
        ))}
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
            <div className="compmode" role="tablist" ref={modeRef} {...modeHover}>
              <span className="seg-hover" ref={modeHoverRef} />
              <span className="seg-thumb" ref={modeThumbRef} />
              <button
                type="button"
                role="tab"
                ref={replyBtnRef}
                aria-selected={!internal}
                className={"modebtn" + (!internal ? " active" : "")}
                onClick={() => setInternal(false)}
              >
                <span className="modebtn__ic" style={!internal ? { color: cm.color } : undefined}>
                  <Glyph />
                </span>
                Reply
              </button>
              <button
                type="button"
                role="tab"
                ref={noteBtnRef}
                aria-selected={internal}
                className={"modebtn modenote" + (internal ? " active" : "")}
                onClick={() => setInternal(true)}
              >
                <span className="modebtn__ic">
                  <NoteIcon />
                </span>
                Note
              </button>
            </div>
            <span className="compctx">
              {internal
                ? "Only your team can see this"
                : isEmail
                  ? `Email · ${conv.contact.displayName}`
                  : conv.channel === "whatsapp_group"
                    ? `Group · ${conv.contact.displayName}`
                    : "WhatsApp · within 24h window"}
            </span>
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

      {lightbox && (
        <div
          className="lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
          onClick={() => setLightbox(null)}
        >
          <img className="lightbox__img" src={lightbox} alt="" />
          <button className="lightbox__close" onClick={() => setLightbox(null)} aria-label="Close preview">
            <XIcon />
          </button>
        </div>
      )}
    </main>
  );
}
