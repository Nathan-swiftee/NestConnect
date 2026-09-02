import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type {
  NestChatAppearance,
  NestChatConfig,
  NestChatMessage,
  NestChatPreChat,
  NestChatPublicRouting,
} from "@ding/schemas";
import { fillVisitorName, TYPING_PREVIEW_MS } from "@ding/schemas";
import {
  attachmentUrl,
  fetchConfig,
  fetchMessages,
  identify,
  openSession,
  pingTyping,
  reportRead,
  sendMessage,
  start,
  streamUrl,
} from "./api";
import { gateFor } from "./prechat";

/**
 * What this browser remembers between visits, per widget key — so two
 * businesses embedding us on the same domain don't share an identity.
 *
 * Three slots, and what is *not* among them is the point: `visitor` (the
 * browser's own id), `name` (so the greeting can use it and the visitor can see
 * who we think they are), and `identified` (whether the pre-chat form has been
 * answered). The email and phone are deliberately never stored. Prefilling a
 * form from them would hand the next person on a shared machine somebody else's
 * address, and the form isn't shown again anyway once `identified` is set.
 */
type Slot = "visitor" | "name" | "identified";

const storageKey = (widgetKey: string, slot: Slot) => `nestchat:${slot}:${widgetKey}`;

function readLocal(widgetKey: string, slot: Slot): string | undefined {
  try {
    return localStorage.getItem(storageKey(widgetKey, slot)) ?? undefined;
  } catch {
    // Private mode, or a browser set to block site data. A visitor without a
    // remembered id simply starts a fresh chat, which is a working widget.
    return undefined;
  }
}

function writeLocal(widgetKey: string, slot: Slot, value: string): void {
  try {
    localStorage.setItem(storageKey(widgetKey, slot), value);
  } catch {
    /* see readLocal */
  }
}

function clearLocal(widgetKey: string, slot: Slot): void {
  try {
    localStorage.removeItem(storageKey(widgetKey, slot));
  } catch {
    /* see readLocal */
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

/**
 * Whether the chat is actually in front of the visitor.
 *
 * Both halves matter and neither is enough alone. The launcher hides the whole
 * iframe with `display:none`, which leaves the document running and reporting
 * itself visible — an element with no box never intersects, so the observer
 * catches that. Switching browser tabs leaves the box intact and flips
 * `visibilityState`, which the observer doesn't see. "Read" is a claim about a
 * person's eyes, so it should need both.
 */
function useOnScreen(ref: RefObject<HTMLElement>): boolean {
  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      // No observer (a very old browser): fall back to the tab's own state
      // rather than never reporting a read.
      setOnScreen(document.visibilityState === "visible");
      return;
    }
    let intersecting = false;
    const settle = () => setOnScreen(intersecting && document.visibilityState === "visible");
    const io = new IntersectionObserver((entries) => {
      intersecting = entries.some((e) => e.isIntersecting);
      settle();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", settle);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", settle);
    };
  }, [ref]);
  return onScreen;
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
  const [team, setTeam] = useState<NestChatConfig["team"]>();
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  /* ---- the pre-chat form ---- */

  const [preChat, setPreChat] = useState<NestChatPreChat>();
  const [routing, setRouting] = useState<NestChatPublicRouting>();
  /** Their name, as they gave it — for the greeting, and so they can see who we
   *  think they are before they start typing to us. */
  const [visitorName, setVisitorName] = useState(() => readLocal(widgetKey, "name"));
  /**
   * Whether this browser has already answered the identity half.
   *
   * Remembered across visits, unlike the routing choice below: who you are
   * doesn't change between conversations, and what you need doesn't stay the
   * same. Somebody coming back next week should be asked what it's about, not
   * asked their name again.
   */
  const [identified, setIdentified] = useState(() => readLocal(widgetKey, "identified") === "1");
  const [form, setForm] = useState({ name: "", email: "", phone: "" });
  const [optionId, setOptionId] = useState<string>();
  const [chosen, setChosen] = useState<{ id: string; label: string }>();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  /** They're through the form — by answering it, or by skipping it. */
  const [startDone, setStartDone] = useState(false);
  /** An agent has closed this chat: it is read-only until they start a new one. */
  const [closed, setClosed] = useState(false);
  /** What we told them we saved — the confirmation that used to be missing. */
  const [detailsSaved, setDetailsSaved] = useState<{ linked: boolean } | null>(null);
  const [detailsError, setDetailsError] = useState(false);
  /** When an agent last read this thread — the "Seen" under our own messages. */
  const [seenAt, setSeenAt] = useState<string>();

  const threadRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // What we have already told the server, so a re-render doesn't re-report it.
  const acked = useRef<{ delivered?: string; read?: string }>({});
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTypingPing = useRef(0);
  /** The trailing half of the typing throttle — see `sendTyping`. */
  const previewTimer = useRef<ReturnType<typeof setTimeout>>();
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
        setTeam(config.team);
        setPreChat(config.preChat);
        setRouting(config.routing);

        const session = await openSession(widgetKey, { visitorId: readLocal(widgetKey, "visitor") });
        if (!alive) return;
        writeLocal(widgetKey, "visitor", session.visitorId);
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
          | { kind: "read"; at: string }
          | { kind: "closed" }
          | { kind: "reopened" };
        if (event.kind === "read") {
          setSeenAt(event.at);
          return;
        }
        if (event.kind === "closed") {
          setClosed(true);
          // Whatever they were mid-way through saying, nobody is going to read
          // it — take it off the agent's screen rather than leave a draft
          // hanging under a chat that has ended.
          setAgentTyping(false);
          clearTimeout(previewTimer.current);
          return;
        }
        if (event.kind === "reopened") {
          setClosed(false);
          return;
        }
        if (event.kind === "typing") {
          setAgentTyping(event.typing);
          // The agent's client sends "typing", never "stopped" — so the widget
          // times it out itself rather than waiting for a signal that may not
          // come (they closed the tab mid-sentence). Comfortably longer than
          // the agent's ping interval, or the dots blink off and on again
          // while somebody is still mid-sentence.
          clearTimeout(typingTimer.current);
          if (event.typing) typingTimer.current = setTimeout(() => setAgentTyping(false), 6000);
          return;
        }
        if (event.kind !== "message") return;
        setAgentTyping(false);
        // A reply is proof the chat is live, whether or not we caught the
        // "reopened" frame — an agent typing to somebody who can't answer is
        // the worse failure of the two.
        setClosed(false);
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
        .then((c) => {
          setOnline(c.online);
          // Not once they've chosen: the header has been narrowed to the team
          // that is actually going to answer them, and the channel-wide list
          // this returns would quietly widen it back every minute.
          if (!chosen) setTeam(c.team);
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(id);
  }, [phase, widgetKey, chosen]);

  /* ---- receipts: what the agent's ticks are made of ---- */

  const onScreen = useOnScreen(rootRef);
  useEffect(() => {
    if (!token) return;
    // The newest agent message is the high-water mark; the server moves
    // everything up to it, so one call says the whole thing.
    const newest = [...messages].reverse().find((m) => m.from === "agent");
    if (!newest) return;
    if (acked.current.delivered !== newest.id) {
      acked.current.delivered = newest.id;
      reportRead(token, newest.id, "delivered");
    }
    if (onScreen && acked.current.read !== newest.id) {
      acked.current.read = newest.id;
      reportRead(token, newest.id, "read");
    }
  }, [messages, token, onScreen]);

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
    // Take the draft off the agent's screen now. The typing indicator times
    // itself out in a few seconds, but those are the seconds where the message
    // has arrived and the ghost of it is still sitting underneath — the same
    // sentence twice, one of them apparently still being written. A pending
    // trailing send would put it back, so that goes too.
    clearTimeout(previewTimer.current);
    lastTypingPing.current = 0;
    pingTyping(token, "");
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
    // The agent sees this text as it's written, so the cadence is now what the
    // *content* needs rather than what an indicator needs: a couple of seconds
    // was plenty to keep three dots alive and reads as a stutter when there are
    // words behind them. Still throttled — one request per keystroke is a
    // request per keystroke.
    //
    // Not gated on the box being non-empty: deleting what you wrote is exactly
    // the moment the agent's copy needs to catch up, and skipping the empty send
    // would leave them reading a sentence that no longer exists.
    //
    // Leading edge AND trailing, because a throttle with only a leading edge
    // drops the tail — stop typing inside the window and the last few characters
    // are never sent, so the agent is left holding a word that isn't finished.
    // The trailing send is what makes "what they're typing" settle on the truth.
    sendTyping(value);
  };

  /** Throttled, with a trailing send so the final state always lands. */
  const sendTyping = (value: string) => {
    if (!token) return;
    clearTimeout(previewTimer.current);
    const now = Date.now();
    const wait = TYPING_PREVIEW_MS - (now - lastTypingPing.current);
    if (wait <= 0) {
      lastTypingPing.current = now;
      pingTyping(token, value);
      return;
    }
    previewTimer.current = setTimeout(() => {
      lastTypingPing.current = Date.now();
      pingTyping(token, value);
    }, wait);
  };

  /* ---- the pre-chat form ---- */

  /**
   * Submit it — or skip it.
   *
   * One call, not one per answer: these are answers to a single form, and
   * half-applying them (the name saved, the routing lost) would put somebody in
   * front of the wrong team under their own name.
   */
  const startChat = useCallback(
    async (skip = false) => {
      if (!token || starting) return;
      const name = skip ? "" : form.name.trim();
      const mail = skip ? "" : form.email.trim();
      const tel = skip ? "" : form.phone.trim();

      // Skipped a form that asked nothing we have to record. There is no call
      // to make, so don't make one — just open the composer.
      if (!name && !mail && !tel && !optionId) {
        setStartDone(true);
        return;
      }

      setStarting(true);
      setStartError(undefined);
      try {
        const res = await start(token, {
          name: name || undefined,
          email: mail || undefined,
          phone: tel || undefined,
          optionId,
        });
        // A match merged this visitor onto a customer we already had, which
        // deletes the contact the old token named — take the new one. It also
        // carries the routing choice, so this is never optional here.
        if (res.token) setToken(res.token);
        if (res.team) setTeam(res.team);
        if (res.option) setChosen(res.option);
        if (name) {
          setVisitorName(name);
          writeLocal(widgetKey, "name", name);
        }
        // Only when they actually answered it. A skipped form is "not now",
        // not "asked and done", and should come back next time.
        if (!skip && (name || mail || tel)) {
          setIdentified(true);
          writeLocal(widgetKey, "identified", "1");
        }
        setStartDone(true);
      } catch {
        setStartError("That didn’t go through — check your details and try again.");
      } finally {
        setStarting(false);
      }
    },
    [token, starting, form, optionId, widgetKey],
  );

  /**
   * "Start a new chat", after an agent has closed the last one.
   *
   * Their identity is deliberately kept: we know who they are, and asking a
   * returning customer their name again is the widget forgetting somebody it
   * has already met. What is cleared is the routing choice — the whole reason
   * for asking is that the next conversation may be for a different team than
   * the last, so "what's it about?" is put again and the answer re-routes.
   *
   * Emptying the thread is what makes the pre-chat gate reopen (it stands down
   * once there are messages), and it is also honest: the closed conversation
   * has ended, and the next message starts a new one server-side rather than
   * continuing this one.
   */
  const startNewChat = useCallback(() => {
    setClosed(false);
    setMessages([]);
    setLive(false);
    setSeenAt(undefined);
    acked.current = {};
    setStartDone(false);
    setChosen(undefined);
    setOptionId(undefined);
    setStartError(undefined);
    setDetailsSaved(null);
  }, []);

  /**
   * "Not you?" — hand the widget back to whoever is actually sitting there.
   *
   * The browser id goes with the name, and a fresh session is opened against a
   * new one. Anything less would leave the next person's messages landing on
   * the previous person's customer record, which on a shared machine is the
   * whole reason somebody would press this.
   *
   * Only offered before the first message, so there is never a live thread to
   * lose on the way.
   */
  const forgetMe = useCallback(async () => {
    for (const slot of ["visitor", "name", "identified"] as const) clearLocal(widgetKey, slot);
    setVisitorName(undefined);
    setIdentified(false);
    setStartDone(false);
    setChosen(undefined);
    setOptionId(undefined);
    setForm({ name: "", email: "", phone: "" });
    setMessages([]);
    setLive(false);
    setStartError(undefined);
    try {
      const session = await openSession(widgetKey, {});
      writeLocal(widgetKey, "visitor", session.visitorId);
      setToken(session.token);
      setLive(session.hasConversation);
      setMessages(session.messages);
    } catch {
      setPhase("unavailable");
    }
  }, [widgetKey]);

  const saveDetails = () => {
    const e = email.trim();
    const p = phone.trim();
    if ((!e && !p) || !token) return;
    setDetailsError(false);
    void identify(token, { email: e || undefined, phone: p || undefined })
      .then((res) => {
        // A match merged this visitor onto a customer we already had, which
        // deletes the contact the old token named — take the new one.
        if (res.token) setToken(res.token);
        if (res.saved.length) setDetailsSaved({ linked: res.linked });
        else setDetailsError(true);
      })
      .catch(() => setDetailsError(true));
  };

  if (phase === "loading") return <div className="nc__state">Loading…</div>;
  if (phase === "unavailable" || !appearance) {
    return <div className="nc__state">This chat isn’t available right now.</div>;
  }

  /* ---- what the visitor still has to answer ---- */

  const hasThread = live || messages.length > 0;
  const { wantsIdentity, wantsOption, gated, emailTypo, blocked, canSkip } = gateFor({
    preChat,
    routing,
    identified,
    chosen: Boolean(chosen),
    hasThread,
    startDone,
    form,
    optionId,
    starting,
  });

  // The card inside the thread is the *other* way of asking for details, for
  // channels that don't put a form in front of the chat. A channel that has a
  // pre-chat form has already asked, and asking twice reads as the first one
  // having failed.
  const asking =
    !closed &&
    !preChat &&
    (appearance.askEmail || appearance.askPhone) &&
    !detailsSaved &&
    messages.length > 0;

  // The last thing the visitor themselves said — the only bubble a "Seen"
  // belongs under, and only once an agent has actually read it.
  const lastOwn = [...messages].reverse().find((m) => m.from === "visitor");
  const showSeen = Boolean(seenAt && lastOwn);

  return (
    <div className="nc" ref={rootRef}>
      <header className="nc__head">
        {team?.faces.length ? (
          /* Who is behind the counter. Overlapped left-to-right with the first
             face on top, so the stack reads as a group rather than a row.
             No per-face presence dot: a visitor cannot pick which of them
             answers, so five dots are five pieces of information they can't
             use — availability is the header's own subtitle. Who is online
             still decides *which* faces are shown, which is the useful half. */
          <div className="nc__faces" aria-label={`${team.total} people can answer`}>
            {team.faces.map((f, i) => (
              <span
                key={f.name + i}
                /* A face with its own colour is one of the app's avatar
                   gradients, which are picked to carry white initials — so its
                   label follows the circle, not the header. Only a face with no
                   colour sits directly on the accent and takes the accent's own
                   text colour. Getting this backwards puts near-black initials
                   on a mid-blue circle whenever a business picks a pale brand
                   colour, which is exactly when it's hardest to read. */
                className={f.color ? "nc__face" : "nc__face nc__face--plain"}
                style={{
                  zIndex: team.faces.length - i,
                  ...(f.color ? { background: f.color, color: "#fff" } : null),
                }}
                title={f.name}
              >
                {f.avatarUrl ? (
                  <img src={f.avatarUrl} alt="" loading="lazy" />
                ) : (
                  <b>{f.initials}</b>
                )}
              </span>
            ))}
            {team.total > team.faces.length ? (
              <span className="nc__face nc__face--more">
                <b>+{team.total - team.faces.length}</b>
              </span>
            ) : null}
          </div>
        ) : (
          <div className="nc__mark" aria-hidden="true">
            {initials(appearance.title)}
            <i className={online ? "nc__pip nc__pip--online" : "nc__pip"} />
          </div>
        )}
        <div className="nc__headtext">
          <div className="nc__title">{appearance.title}</div>
          <div className="nc__sub">{online ? appearance.subtitle : appearance.awayMessage}</div>
        </div>
      </header>

      <div className="nc__thread" ref={threadRef}>
        {messages.length === 0 && appearance.greeting ? (
          <div className="nc__greeting">{fillVisitorName(appearance.greeting, visitorName)}</div>
        ) : null}

        {/* Who we think they are, while it can still be corrected. Offered only
            before the first message: after that there is a thread on this
            person's record, and "not you?" would be an offer to abandon it. */}
        {visitorName && !hasThread ? (
          <div className="nc__asme">
            Chatting as {visitorName.split(/\s+/)[0]}
            <button type="button" onClick={() => void forgetMe()}>
              Not you?
            </button>
          </div>
        ) : null}

        {gated ? (
          <div className="nc__prechat">
            {/* What they need, then who they are.
                
                The menu goes first because it is the question the visitor came
                with an answer to: "billing" costs one tap and is the thing that
                decides who picks this up. Name and email are our questions, not
                theirs, and a form that opens with them reads as a gate to get
                past rather than a conversation starting. It is also the order
                every conversational widget has converged on — topic buttons up
                front, contact details once the person is already engaged. */}
            {wantsOption && routing ? (
              /* Pills rather than rows or a <select>. A dropdown on a phone is a
                 modal sheet to answer something that should cost one tap, and
                 full-width rows turn eight short labels into eight lines of
                 mostly empty space. Wrapping pills let the labels set their own
                 width and the list take only the height it needs. */
              <div className="nc__options" role="group" aria-label={routing.prompt}>
                <p className="nc__optionsq">{routing.prompt}</p>
                <div className="nc__optionlist">
                  {routing.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={optionId === o.id ? "nc__option on" : "nc__option"}
                      aria-pressed={optionId === o.id}
                      onClick={() => setOptionId(o.id)}
                    >
                      {o.icon ? <span aria-hidden="true">{o.icon}</span> : null}
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {wantsIdentity && preChat ? (
              <>
                {preChat.intro ? <p className="nc__prechatintro">{preChat.intro}</p> : null}
                {preChat.name.enabled ? (
                  <label className="nc__pcfield">
                    <span>
                      {preChat.nameLabel}
                      {preChat.name.required ? null : <em> (optional)</em>}
                    </span>
                    <input
                      type="text"
                      autoComplete="name"
                      value={form.name}
                      placeholder="Your name"
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </label>
                ) : null}
                {preChat.email.enabled ? (
                  <label className="nc__pcfield">
                    <span>
                      {preChat.emailLabel}
                      {preChat.email.required ? null : <em> (optional)</em>}
                    </span>
                    <input
                      type="email"
                      autoComplete="email"
                      value={form.email}
                      placeholder="you@example.com"
                      aria-invalid={emailTypo || undefined}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                    />
                    {emailTypo ? (
                      <small className="nc__pcerr">That doesn’t look like an email address.</small>
                    ) : null}
                  </label>
                ) : null}
                {preChat.phone.enabled ? (
                  <label className="nc__pcfield">
                    <span>
                      {preChat.phoneLabel}
                      {preChat.phone.required ? null : <em> (optional)</em>}
                    </span>
                    <input
                      type="tel"
                      autoComplete="tel"
                      value={form.phone}
                      placeholder="+44 7700 900123"
                      onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                    />
                  </label>
                ) : null}
              </>
            ) : null}            {startError ? <p className="nc__askerr">{startError}</p> : null}

            <button
              type="button"
              className="nc__prechatgo"
              disabled={blocked}
              onClick={() => void startChat()}
            >
              {starting ? "Starting…" : preChat?.submitLabel || "Start chat"}
            </button>
            {canSkip ? (
              <button
                type="button"
                className="nc__prechatskip"
                onClick={() => void startChat(true)}
                disabled={starting}
              >
                {preChat?.skipLabel || "Skip"}
              </button>
            ) : null}
          </div>
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
              {endsRun ? (
                <div className="nc__time">
                  {clockTime(m.at)}
                  {showSeen && m.id === lastOwn?.id ? <span className="nc__seen">Seen</span> : null}
                </div>
              ) : null}
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

        {/* Asked inside the conversation rather than as a permanent band above
            the composer: it is one question, asked once, and it should read as
            part of the chat and then be gone — not as a second input the
            visitor has to look past every time they write. */}
        {asking ? (
          <div className="nc__ask">
            {appearance.askEmail ? (
              <>
                <label htmlFor="nc-email">{appearance.askEmailLabel}</label>
                <input
                  id="nc-email"
                  type="email"
                  value={email}
                  placeholder="you@example.com"
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveDetails();
                    }
                  }}
                />
              </>
            ) : null}
            {appearance.askPhone ? (
              <>
                <label htmlFor="nc-phone" className="nc__asklabel2">
                  {appearance.askPhoneLabel}
                </label>
                <input
                  id="nc-phone"
                  type="tel"
                  value={phone}
                  placeholder="+44 7700 900123"
                  onChange={(e) => setPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveDetails();
                    }
                  }}
                />
              </>
            ) : null}
            <button
              type="button"
              className="nc__asksave"
              onClick={saveDetails}
              disabled={!email.trim() && !phone.trim()}
            >
              Save
            </button>
            {detailsError ? (
              <p className="nc__askerr">That didn’t save — check it and try again.</p>
            ) : null}
          </div>
        ) : null}

        {/* The end of the conversation, drawn as an event in it rather than as a
            banner over it — it happened at a moment, and it belongs after the
            last thing anybody said. */}
        {closed ? (
          <div className="nc__closed">
            {appearance.closedMessage ? <p>{appearance.closedMessage}</p> : null}
            <button type="button" className="nc__newchat" onClick={startNewChat}>
              {appearance.newChatLabel || "Start a new chat"}
            </button>
          </div>
        ) : null}

        {/* Said once, in the thread, so it is clear it actually landed. */}
        {detailsSaved ? (
          <div className="nc__note">
            {detailsSaved.linked
              ? "Thanks — we’ve found your details."
              : "Thanks — we’ll use that to reply."}
          </div>
        ) : null}
      </div>

      {/* Hidden rather than disabled while the form is up, or once the chat has
          been closed: a greyed-out message box reads as something broken, and in
          both cases there is exactly one thing to do and it is on screen. */}
      {gated || closed ? null : (
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
      )}

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
