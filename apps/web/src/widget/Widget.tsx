import { useCallback, useEffect, useRef, useState } from "react";
import type { NestChatAppearance, NestChatMessage } from "@ding/schemas";
import {
  attachmentUrl,
  fetchConfig,
  fetchMessages,
  identify,
  openSession,
  pingTyping,
  sendMessage,
  streamUrl,
} from "./api";

/** Where this browser's visitor id lives between visits. Scoped per widget key
 *  so two businesses embedding us on the same domain don't share an identity. */
const storageKey = (widgetKey: string) => `nestchat:visitor:${widgetKey}`;

function readVisitorId(widgetKey: string): string | undefined {
  try {
    return localStorage.getItem(storageKey(widgetKey)) ?? undefined;
  } catch {
    // Private mode, or a browser set to block site data. A visitor without a
    // remembered id simply starts a fresh chat, which is a working widget.
    return undefined;
  }
}

function writeVisitorId(widgetKey: string, id: string): void {
  try {
    localStorage.setItem(storageKey(widgetKey), id);
  } catch {
    /* see readVisitorId */
  }
}

function initials(name: string | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "•";
  const parts = trimmed.split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function clockTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Paint the business's colours onto the document. Values are validated hex on
 *  the way in, and set as custom properties rather than interpolated into a
 *  stylesheet, so nothing here can become a style injection. */
function applyAppearance(a: NestChatAppearance): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", a.accent);
  root.style.setProperty("--accent-text", a.accentText);
  const dark =
    a.theme === "dark" ||
    (a.theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
}

type Phase = "loading" | "ready" | "unavailable";

export function Widget({ widgetKey }: { widgetKey: string }): JSX.Element {
  const [phase, setPhase] = useState<Phase>("loading");
  const [appearance, setAppearance] = useState<NestChatAppearance>();
  const [online, setOnline] = useState(false);
  const [token, setToken] = useState<string>();
  const [messages, setMessages] = useState<NestChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [agentTyping, setAgentTyping] = useState(false);
  // A stream only exists once there is a thread to stream. Opening one before
  // the visitor's first message means EventSource retrying a 400 forever, on
  // someone else's website, for a widget nobody has typed into.
  const [live, setLive] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingPing = useRef(0);
  const typingTimer = useRef<ReturnType<typeof setTimeout>>();

  /* ---- boot: appearance, then session ---- */

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const config = await fetchConfig(widgetKey);
        if (!alive) return;
        applyAppearance(config.appearance);
        setAppearance(config.appearance);
        setOnline(config.online);

        const session = await openSession(widgetKey, { visitorId: readVisitorId(widgetKey) });
        if (!alive) return;
        writeVisitorId(widgetKey, session.visitorId);
        setToken(session.token);
        setLive(session.hasConversation);
        setMessages(session.messages);
        setPhase("ready");
      } catch {
        // A key that doesn't resolve, or an API that can't be reached. Either
        // way there is no chat to show, and a broken-looking box on someone's
        // website is worse than a quiet line of text.
        if (alive) setPhase("unavailable");
      }
    })();
    return () => {
      alive = false;
    };
  }, [widgetKey]);

  /* ---- live: agent replies pushed over SSE ---- */

  useEffect(() => {
    if (!token || !live) return;
    let source: EventSource;
    try {
      source = new EventSource(streamUrl(token));
    } catch {
      return;
    }
    source.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data) as
          | { kind: "message"; payload: NestChatMessage }
          | { kind: "typing"; typing: boolean }
          | { kind: "closed" };
        if (event.kind === "typing") {
          setAgentTyping(event.typing);
          // The agent's client sends "typing", never "stopped" — so the widget
          // times it out itself rather than waiting for a signal that may not
          // come (they closed the tab mid-sentence).
          clearTimeout(typingTimer.current);
          if (event.typing) typingTimer.current = setTimeout(() => setAgentTyping(false), 4000);
          return;
        }
        if (event.kind !== "message") return;
        setAgentTyping(false);
        setMessages((prev) =>
          // The reply may already be here: an optimistic echo, or a reconnect
          // that refetched. Matching on id keeps it to one bubble.
          prev.some((m) => m.id === event.payload.id) ? prev : [...prev, event.payload],
        );
      } catch {
        /* a frame we can't read is a frame we skip */
      }
    };
    // EventSource reconnects on its own, but it can't know what it missed while
    // it was away — so a reconnect refetches the thread.
    source.onerror = () => {
      void fetchMessages(token)
        .then((res) => setMessages(res.messages))
        .catch(() => {});
    };
    return () => source.close();
  }, [token, live]);

  /* ---- is anyone at the desk? ---- */

  // Re-asked rather than answered once: a visitor can sit with the widget open
  // for an hour, and a header still promising "we reply in minutes" after
  // everyone has gone home is worse than no header at all.
  useEffect(() => {
    if (phase !== "ready") return;
    const id = setInterval(() => {
      void fetchConfig(widgetKey)
        .then((c) => setOnline(c.online))
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [phase, widgetKey]);

  /* ---- keep the newest message in view ---- */

  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, agentTyping]);

  /* ---- sending ---- */

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !token || sending) return;
    setSending(true);
    setDraft("");
    // Show it immediately. The id is replaced by the server's on the way back,
    // so the reconciliation in the SSE handler still matches on one id.
    const optimistic: NestChatMessage = {
      id: `local:${Date.now()}`,
      from: "visitor",
      body,
      at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const res = await sendMessage(token, body, window.location.href);
      if (res.token) setToken(res.token);
      setLive(true);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id && res.message ? res.message : m)),
      );
    } catch {
      // Put it back in the box rather than losing what they wrote.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(body);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [draft, token, sending]);

  const onDraft = (value: string) => {
    setDraft(value);
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 116)}px`;
    }
    // One ping every two seconds is enough to hold an indicator up, and keeps a
    // fast typist from sending one request per keystroke.
    const now = Date.now();
    if (token && value.trim() && now - lastTypingPing.current > 2000) {
      lastTypingPing.current = now;
      pingTyping(token);
    }
  };

  const saveEmail = () => {
    const value = email.trim();
    if (!value || !token) return;
    setEmailSaved(true);
    void identify(token, { email: value }).catch(() => setEmailSaved(false));
  };

  if (phase === "loading") return <div className="nc__state">Loading…</div>;
  if (phase === "unavailable" || !appearance) {
    return <div className="nc__state">This chat isn’t available right now.</div>;
  }

  const askingEmail = appearance.askEmail && !emailSaved && messages.length > 0;

  return (
    <div className="nc">
      <header className="nc__head">
        <div className="nc__headtext">
          <div className="nc__title">{appearance.title}</div>
          <div className="nc__sub">
            <span className={online ? "nc__dot nc__dot--online" : "nc__dot"} />
            {online ? appearance.subtitle : appearance.awayMessage}
          </div>
        </div>
      </header>

      <div className="nc__thread" ref={threadRef}>
        {messages.length === 0 && appearance.greeting ? (
          <div className="nc__greeting">{appearance.greeting}</div>
        ) : null}

        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const next = messages[i + 1];
          // A run is consecutive messages from the same side: the name goes on
          // the first, the face and the time on the last.
          const startsRun = !prev || prev.from !== m.from || prev.authorName !== m.authorName;
          const endsRun = !next || next.from !== m.from;
          return (
            <div key={m.id} className={`nc__msg nc__msg--${m.from}`}>
              {m.from === "agent" && startsRun && m.authorName ? (
                <div className="nc__author">{m.authorName}</div>
              ) : null}
              <div className="nc__row">
                {m.from === "agent" ? (
                  <div className={endsRun ? "nc__avatar nc__avatar--shown" : "nc__avatar"}>
                    {initials(m.authorName)}
                  </div>
                ) : null}
                <div className="nc__bubble">
                  {m.body}
                  {m.attachments?.length ? (
                    <div className="nc__files">
                      {m.attachments.map((a) => (
                        <a
                          key={a.id}
                          className="nc__file"
                          href={token ? attachmentUrl(token, a.id) : undefined}
                          target="_blank"
                          rel="noreferrer"
                        >
                          📎 {a.filename}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
              {endsRun ? <div className="nc__time">{clockTime(m.at)}</div> : null}
            </div>
          );
        })}

        {agentTyping ? (
          <div className="nc__typing" aria-label="Typing">
            <i />
            <i />
            <i />
          </div>
        ) : null}
      </div>

      {askingEmail ? (
        <div className="nc__ask">
          <label>
            {appearance.askEmailLabel}
            <input
              type="email"
              value={email}
              placeholder="you@example.com"
              onChange={(e) => setEmail(e.target.value)}
              onBlur={saveEmail}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  saveEmail();
                }
              }}
            />
          </label>
        </div>
      ) : null}

      <div className="nc__composer">
        <textarea
          ref={inputRef}
          className="nc__input"
          rows={1}
          value={draft}
          placeholder={appearance.placeholder}
          aria-label={appearance.placeholder}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter breaks the line — what a chat box does.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          className="nc__send"
          disabled={!draft.trim() || sending}
          onClick={() => void send()}
          aria-label="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M2 21l20-9L2 3l0 7 14 2-14 2z" fill="currentColor" />
          </svg>
        </button>
      </div>

      {appearance.showBranding ? (
        <div className="nc__brand">
          Powered by{" "}
          <a href="https://nestconnect.io" target="_blank" rel="noreferrer">
            Nest Connect
          </a>
        </div>
      ) : null}
    </div>
  );
}
