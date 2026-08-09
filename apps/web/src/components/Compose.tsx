import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Contact } from "@ding/schemas";
import { useContacts } from "../hooks";
import { api } from "../lib/api";
import { channelMeta, XIcon, BackIcon, SearchIcon } from "../lib/icons";
import { useScrollLock } from "../lib/useScrollLock";

type Channel = "whatsapp" | "email";

/** A channel's glyph in its brand colour — the per-customer "reachable on" cue. */
function ChanIcon({ channel }: { channel: Channel }) {
  const cm = channelMeta(channel);
  const Glyph = cm.Glyph;
  return (
    <span className="compose__chico" style={{ color: cm.color }} title={cm.label}>
      <Glyph />
    </span>
  );
}

/** One channel a customer can be started on (disabled when they lack the address). */
function ChannelPick({
  channel,
  disabled,
  busy,
  hint,
  onPick,
}: {
  channel: Channel;
  disabled: boolean;
  busy: boolean;
  hint: string;
  onPick: () => void;
}) {
  const cm = channelMeta(channel);
  const Glyph = cm.Glyph;
  return (
    <button type="button" className="compose__chan" disabled={disabled || busy} onClick={onPick}>
      <span className="compose__chanic" style={{ background: cm.color }}>
        <Glyph />
      </span>
      <span className="compose__chanm">
        <b>{cm.label}</b>
        <small>{busy ? "Opening…" : disabled ? "No address on file" : hint}</small>
      </span>
    </button>
  );
}

/**
 * Start a brand-new outbound conversation: pick an existing customer (or add
 * one), then choose the channel to reach them on. Delegates to the shared
 * find-or-create "reach" endpoint, then opens the resulting thread.
 */
export function Compose({
  onClose,
  onOpen,
  onToast,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  onToast: (msg: string) => void;
}) {
  const { data: contacts } = useContacts();
  const boxRef = useRef<HTMLDivElement>(null);
  useScrollLock(boxRef);
  const [tab, setTab] = useState<"pick" | "new">("pick");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Contact | null>(null);
  const [busy, setBusy] = useState<Channel | null>(null);
  // New-customer fields.
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");

  const filtered = (contacts ?? [])
    .filter((c) => {
      const s = q.trim().toLowerCase();
      if (!s) return true;
      return [c.displayName, c.company, c.email, c.phone].some((v) => (v ?? "").toLowerCase().includes(s));
    })
    .slice(0, 50);

  const start = async (contact: Contact, channel: Channel) => {
    setBusy(channel);
    try {
      const { conversationId } = await api.reachContact(contact.id, channel);
      onOpen(conversationId);
    } catch {
      const need = channel === "email" ? "an email address" : "a phone number";
      onToast(`Couldn't start ${channelMeta(channel).label} — the customer needs ${need} and a connected inbox.`);
      setBusy(null);
    }
  };

  const createAndStart = async (channel: Channel) => {
    if (!name.trim()) {
      onToast("Give the customer a name first.");
      return;
    }
    setBusy(channel);
    try {
      const contact = await api.createContact({
        displayName: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
      });
      const { conversationId } = await api.reachContact(contact.id, channel);
      onOpen(conversationId);
    } catch {
      onToast("Couldn't start that conversation. Check the details and try again.");
      setBusy(null);
    }
  };

  const waHint = "Pick an approved template";
  const emailHint = "Write a new email";

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div className="modal__box compose" ref={boxRef} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>New message</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>

        {selected ? (
          // ── Step 2: choose the channel to reach the picked customer on ──
          <div className="modal__body">
            <button type="button" className="compose__back" onClick={() => setSelected(null)}>
              <BackIcon /> Choose a different customer
            </button>
            <div className="compose__who">
              <span className="compose__av" style={{ background: selected.avatarColor }}>
                {selected.displayName.slice(0, 2).toUpperCase()}
              </span>
              <span className="compose__whom">
                <b>{selected.displayName}</b>
                {selected.company && <small>{selected.company}</small>}
              </span>
            </div>
            <div className="compose__chans">
              <ChannelPick
                channel="whatsapp"
                disabled={!selected.phone}
                busy={busy === "whatsapp"}
                hint={waHint}
                onPick={() => start(selected, "whatsapp")}
              />
              <ChannelPick
                channel="email"
                disabled={!selected.email}
                busy={busy === "email"}
                hint={emailHint}
                onPick={() => start(selected, "email")}
              />
            </div>
          </div>
        ) : (
          <div className="modal__body">
            <div className="compose__tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "pick"} className={tab === "pick" ? "on" : ""} onClick={() => setTab("pick")}>
                Existing customer
              </button>
              <button type="button" role="tab" aria-selected={tab === "new"} className={tab === "new" ? "on" : ""} onClick={() => setTab("new")}>
                New customer
              </button>
            </div>

            {tab === "pick" ? (
              <>
                <div className="compose__search">
                  <SearchIcon />
                  <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customers by name, company, email or phone…" aria-label="Search customers" />
                </div>
                <div className="compose__list">
                  {filtered.length === 0 ? (
                    <p className="compose__empty">No customers match — try “New customer”.</p>
                  ) : (
                    filtered.map((c) => (
                      <button type="button" key={c.id} className="compose__row" onClick={() => setSelected(c)}>
                        <span className="compose__av" style={{ background: c.avatarColor }}>
                          {c.displayName.slice(0, 2).toUpperCase()}
                        </span>
                        <span className="compose__rowm">
                          <b>{c.displayName}</b>
                          <small>{c.company || c.email || c.phone || ""}</small>
                        </span>
                        <span className="compose__rowchans">
                          {c.phone && <ChanIcon channel="whatsapp" />}
                          {c.email && <ChanIcon channel="email" />}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="compose__new">
                <label className="field">
                  <span>Name</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" autoFocus />
                </label>
                <label className="field">
                  <span>Phone (WhatsApp)</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 7…" inputMode="tel" />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" inputMode="email" />
                </label>
                <div className="compose__chans">
                  <ChannelPick channel="whatsapp" disabled={!phone.trim()} busy={busy === "whatsapp"} hint={waHint} onPick={() => createAndStart("whatsapp")} />
                  <ChannelPick channel="email" disabled={!email.trim()} busy={busy === "email"} hint={emailHint} onPick={() => createAndStart("email")} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
