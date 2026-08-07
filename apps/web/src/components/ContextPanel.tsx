import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  GROUP_MAX_MEMBERS,
  type ChannelType,
  type Contact,
  type Conversation,
  type Priority,
} from "@ding/schemas";
import {
  useAddParticipant,
  useContact,
  useContacts,
  useConversation,
  usePeople,
  useRemoveParticipant,
  useSetPriority,
  useTeams,
  useUpdateContact,
} from "../hooks";
import { useQueryClient } from "@tanstack/react-query";
import { initials, relativeTime, slaCountdown } from "../lib/format";
import { api } from "../lib/api";
import { TagEditor } from "./TagEditor";
import { channelMeta, CheckIcon, ChevronDown, ChevronRight, PhoneIcon, MailIcon, ProfileIcon, XIcon } from "../lib/icons";

interface Props {
  conversationId: string | null;
  onToast: (msg: string) => void;
  onClose?: () => void;
  onOpenConversation?: (id: string) => void;
  onOpenProfile?: (contactId: string) => void;
}

type LabelChip = { id: string; name: string; color: string };

/** Section header used across the panel blocks. */
function Block({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <div className="block">
      <div className="t">
        {title}
        {count != null && count > 0 && <span className="count">{count}</span>}
      </div>
      {children}
    </div>
  );
}

/** Editable customer tags, saved to the contact as you add/remove them. */
function CustomerTags({ contact, onToast }: { contact: Contact; onToast: (m: string) => void }) {
  const contacts = useContacts();
  const update = useUpdateContact();
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  useEffect(() => {
    setTags(contact.tags ?? []);
  }, [contact.id, (contact.tags ?? []).join("")]);

  const suggestions = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts.data ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [contacts.data]);

  const save = (next: string[]) => {
    setTags(next);
    update.mutate(
      { id: contact.id, input: { tags: next } },
      { onError: () => onToast("Couldn't save tags") },
    );
  };

  return (
    <Block title="Tags">
      <TagEditor tags={tags} suggestions={suggestions} onChange={save} label="" />
    </Block>
  );
}

/** This customer's other threads — click to jump straight to one. */
function RecentConversations({
  contactId,
  currentId,
  onOpen,
}: {
  contactId: string;
  currentId: string | null;
  onOpen?: (id: string) => void;
}) {
  const detail = useContact(contactId);
  const convos: Conversation[] = detail.data?.conversations ?? [];

  return (
    <Block title="Recent conversations" count={convos.length}>
      {convos.length === 0 ? (
        <p className="custconvs__empty">{detail.isLoading ? "Loading…" : "No other conversations."}</p>
      ) : (
        <div className="custconvs">
          {convos.map((c) => {
            const cm = channelMeta(c.channel);
            const Glyph = cm.Glyph;
            const active = c.id === currentId;
            return (
              <button
                className={"custconv" + (active ? " is-active" : "")}
                key={c.id}
                onClick={() => !active && onOpen?.(c.id)}
                title={active ? "Current conversation" : "Open conversation"}
              >
                <span className="custconv__ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
                <span className="custconv__body">
                  <b>{c.subject || cm.label}</b>
                  <small>{c.preview || "No messages"}</small>
                </span>
                <span className={"custconv__st st-" + c.status}>{active ? "here" : c.status}</span>
                <span className="custconv__t">{relativeTime(c.lastActivityAt)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Block>
  );
}

/** The channels this customer can be reached on. Each is a switch: clicking one
 *  opens their thread on that channel (starting one if there isn't yet). */
function ChannelsBlock({
  contact,
  activeChannel,
  onSwitch,
}: {
  contact: Contact;
  activeChannel: ChannelType;
  onSwitch: (channel: "whatsapp" | "email") => Promise<void>;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const rows: { type: "whatsapp" | "email"; value: string }[] = [];
  if (contact.phone) rows.push({ type: "whatsapp", value: contact.phone });
  if (contact.email) rows.push({ type: "email", value: contact.email });

  return (
    <Block title="Channels">
      {rows.length === 0 ? (
        <p className="custconvs__empty">No phone or email on file.</p>
      ) : (
        <div className="chanrows">
          {rows.map((r) => {
            const cm = channelMeta(r.type);
            const Glyph = cm.Glyph;
            const active = activeChannel === r.type;
            const busy = pending === r.type;
            return (
              <button
                type="button"
                className={"chanrow" + (active ? " chanrow--active" : "")}
                key={r.type}
                disabled={active || busy}
                title={active ? "Current channel" : `Message on ${cm.label}`}
                onClick={
                  active
                    ? undefined
                    : async () => {
                        setPending(r.type);
                        try {
                          await onSwitch(r.type);
                        } finally {
                          setPending(null);
                        }
                      }
                }
              >
                <span className="chanrow__ic" style={{ background: cm.color }}>
                  <Glyph />
                </span>
                <span className="chanrow__m">
                  <b>{cm.label}</b>
                  <small>{r.value}</small>
                </span>
                {active ? (
                  <span className="chanrow__badge">Active</span>
                ) : busy ? (
                  <span className="chanrow__badge">Opening…</span>
                ) : (
                  <span className="chanrow__go" aria-hidden="true"><ChevronRight /></span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </Block>
  );
}

/** Colour + label for each priority level, used by the pill and its menu. */
const PRIO: Record<Priority, { label: string; dot: string; bg: string; fg: string }> = {
  urgent: { label: "Urgent", dot: "var(--danger)", bg: "var(--danger-tint)", fg: "var(--danger)" },
  high: { label: "High", dot: "#E68A00", bg: "var(--amber-tint)", fg: "#B36B00" },
  normal: { label: "Normal", dot: "var(--text-muted)", bg: "var(--surface-2)", fg: "var(--text-muted)" },
  low: { label: "Low", dot: "var(--text-faint)", bg: "var(--surface-2)", fg: "var(--text-faint)" },
};
const PRIO_ORDER: Priority[] = ["urgent", "high", "normal", "low"];

/** The priority pill, now a dropdown to set the conversation's priority. */
function PriorityControl({ conv, onToast }: { conv: Conversation; onToast: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const setPriority = useSetPriority();
  const cur = PRIO[conv.priority];
  const pick = (v: Priority) => {
    setOpen(false);
    if (v === conv.priority) return;
    setPriority.mutate(
      { id: conv.id, priority: v },
      { onSuccess: () => onToast(`Priority set to ${PRIO[v].label.toLowerCase()}`), onError: () => onToast("Couldn't set priority") },
    );
  };
  return (
    <span className="prioctl">
      <button
        type="button"
        className="prio prio-btn"
        style={{ background: cur.bg, color: cur.fg }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {cur.label}
        <ChevronDown />
      </button>
      {open && (
        <>
          <div className="prio-scrim" onClick={() => setOpen(false)} />
          <div className="priomenu" role="menu">
            {PRIO_ORDER.map((v) => (
              <button
                key={v}
                type="button"
                role="menuitem"
                className={"priomenu__it" + (conv.priority === v ? " on" : "")}
                onClick={() => pick(v)}
              >
                <span className="pdot" style={{ background: PRIO[v].dot }} />
                {PRIO[v].label}
                {conv.priority === v && <CheckIcon />}
              </button>
            ))}
          </div>
        </>
      )}
    </span>
  );
}

function AssignmentBlock({
  conv,
  teamName,
  onToast,
}: {
  conv: Conversation;
  teamName: (id: string) => string;
  onToast: (m: string) => void;
}) {
  return (
    <Block title="Assignment">
      <div className="kv">
        <span className="k">Assignee</span>
        <span className="v">{conv.assigneeUserId ? "You" : "Unassigned"}</span>
      </div>
      <div className="kv">
        <span className="k">Team</span>
        <span className="v">
          {(conv.assignedTeamId && teamName(conv.assignedTeamId)) || "—"}
          {!conv.assigneeUserId ? " · in queue" : ""}
        </span>
      </div>
      <div className="kv">
        <span className="k">Priority</span>
        <span className="v">
          <PriorityControl conv={conv} onToast={onToast} />
        </span>
      </div>
    </Block>
  );
}

function SlaBlock({ iso, now }: { iso: string; now: number }) {
  return (
    <Block title="SLA">
      <div className="slabox">
        <div className="txt">
          <small>First response due in</small>
          <span className="cd">{slaCountdown(iso, now)}</span>
        </div>
      </div>
    </Block>
  );
}

/** Conversation labels (VIP, Billing, …) — set on the thread, not the customer. */
function LabelsBlock({ labels }: { labels: LabelChip[] }) {
  return (
    <Block title="Labels">
      <div className="lbls">
        {labels.length === 0 && <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No labels</span>}
        {labels.map((l) => (
          <span key={l.id} className="lbl-chip">
            <span className="d" style={{ background: l.color }} />
            {l.name}
          </span>
        ))}
      </div>
    </Block>
  );
}

/** Pin a customer to a team/person so their future conversations auto-route. */
function RoutingBlock({ contact, isGroup, onToast }: { contact: Contact; isGroup: boolean; onToast: (m: string) => void }) {
  const teams = useTeams();
  const people = usePeople();
  const update = useUpdateContact();
  const [teamId, setTeamId] = useState(contact.ownerTeamId ?? "");
  const [userId, setUserId] = useState(contact.ownerUserId ?? "");
  useEffect(() => {
    setTeamId(contact.ownerTeamId ?? "");
    setUserId(contact.ownerUserId ?? "");
  }, [contact.id, contact.ownerTeamId, contact.ownerUserId]);

  const save = (patch: { ownerTeamId?: string | null; ownerUserId?: string | null }) =>
    update.mutate(
      { id: contact.id, input: patch },
      { onSuccess: () => onToast("Routing updated"), onError: () => onToast("Couldn't update routing") },
    );

  const who = isGroup ? "this group" : contact.displayName;
  return (
    <Block title="Auto-routing">
      <p className="routehint">New conversations from {who} go straight here.</p>
      <label className="routesel">
        <span>Team</span>
        <select
          value={teamId}
          onChange={(e) => {
            const v = e.target.value;
            setTeamId(v);
            save({ ownerTeamId: v || null });
          }}
        >
          <option value="">Automatic (channel routing)</option>
          {teams.data?.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </label>
      <label className="routesel">
        <span>Person</span>
        <select
          value={userId}
          onChange={(e) => {
            const v = e.target.value;
            setUserId(v);
            save({ ownerUserId: v || null });
          }}
        >
          <option value="">No one specific</option>
          {people.data?.map((m) => (
            <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
          ))}
        </select>
      </label>
    </Block>
  );
}

export function ContextPanel({ conversationId, onToast, onClose, onOpenConversation, onOpenProfile }: Props) {
  const { data: conv } = useConversation(conversationId);
  const qc = useQueryClient();
  const teams = useTeams();
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? "—";
  const addParticipant = useAddParticipant(conversationId ?? "");
  const removeParticipant = useRemoveParticipant(conversationId ?? "");
  const [now, setNow] = useState(() => Date.now());
  const [memberPhone, setMemberPhone] = useState("");
  const [memberName, setMemberName] = useState("");

  useEffect(() => {
    if (!conv?.slaDueAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [conv?.slaDueAt]);

  if (!conv) return <aside className="panel" aria-label="Details" />;

  const isGroup = conv.channel === "whatsapp_group";
  const memberCount = conv.participants.length;
  const GroupGlyph = channelMeta("whatsapp_group").Glyph;

  const addMember = (e: FormEvent) => {
    e.preventDefault();
    const phone = memberPhone.trim();
    if (!phone) return;
    addParticipant.mutate(
      { phone, name: memberName.trim() || undefined },
      {
        onSuccess: () => {
          setMemberPhone("");
          setMemberName("");
          onToast("Member added");
        },
        onError: () => onToast(`Groups cap at ${GROUP_MAX_MEMBERS} members`),
      },
    );
  };

  const copyInvite = () => {
    if (conv.inviteLink) {
      navigator.clipboard?.writeText(conv.inviteLink);
      onToast("Invite link copied");
    }
  };

  // Move this customer to another channel: open their thread there (starting one
  // if needed) and jump to it. Closing the panel reveals the thread on mobile.
  const switchChannel = async (channel: "whatsapp" | "email") => {
    try {
      const { conversationId } = await api.reachContact(conv.contact.id, channel);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversations"] }),
        qc.invalidateQueries({ queryKey: ["views"] }),
      ]);
      onOpenConversation?.(conversationId);
      onClose?.();
    } catch {
      const need = channel === "email" ? "an email address" : "a phone number";
      onToast(`Couldn't open ${channelMeta(channel).label} — check the customer has ${need} and a connected inbox.`);
    }
  };

  return (
    <aside className="panel" aria-label="Details">
      {onClose && (
        <div className="panel__mhead">
          <span>Details</span>
          <button onClick={onClose} aria-label="Close details" title="Close"><XIcon /></button>
        </div>
      )}
      <div className="panel__scroll">
        <div className="cust">
          <div className="big" style={{ background: conv.contact.avatarColor }}>
            {conv.contact.displayName.slice(0, 2).toUpperCase()}
          </div>
          <h3>{conv.contact.displayName}</h3>
          <div className="co">
            {isGroup ? (
              <span className="co-ch">
                <span className="co-ch__ic" style={{ color: "var(--group)" }}><GroupGlyph /></span>
                {memberCount} members
              </span>
            ) : (
              conv.contact.company
            )}
          </div>
          {!isGroup && (
            <div className="quick">
              {conv.contact.phone ? (
                <a className="qbtn" href={`tel:${conv.contact.phone}`} title={`Call ${conv.contact.phone}`}>
                  <PhoneIcon />
                </a>
              ) : (
                <button className="qbtn" disabled title="No phone number"><PhoneIcon /></button>
              )}
              {conv.contact.email ? (
                <a className="qbtn" href={`mailto:${conv.contact.email}`} title={`Email ${conv.contact.email}`}>
                  <MailIcon />
                </a>
              ) : (
                <button className="qbtn" disabled title="No email address"><MailIcon /></button>
              )}
              <button className="qbtn" title="Open full profile" onClick={() => onOpenProfile?.(conv.contact.id)}>
                <ProfileIcon />
              </button>
            </div>
          )}
        </div>

        {isGroup ? (
          <>
            <AssignmentBlock conv={conv} teamName={teamName} onToast={onToast} />
            <RoutingBlock contact={conv.contact} isGroup onToast={onToast} />
            {conv.slaDueAt && <SlaBlock iso={conv.slaDueAt} now={now} />}
            <LabelsBlock labels={conv.labels} />

            {conv.inviteLink && (
              <Block title="Invite link">
                <div className="invite">
                  <code>{conv.inviteLink}</code>
                  <button type="button" onClick={copyInvite}>Copy</button>
                </div>
              </Block>
            )}
            <div className="block">
              <div className="t">
                Members <span className="count">{memberCount} / {GROUP_MAX_MEMBERS}</span>
              </div>
              <div className="members">
                {conv.participants.map((p) => (
                  <div key={p.id} className="member">
                    <span className="mav" style={{ background: p.contact.avatarColor }}>
                      {initials(p.contact.displayName)}
                    </span>
                    <span className="mname">{p.contact.displayName}</span>
                    {p.role === "admin" && <span className="mrole">admin</span>}
                    <button
                      type="button"
                      className="rm"
                      title="Remove"
                      aria-label="Remove member"
                      onClick={() => removeParticipant.mutate(p.contact.id, { onSuccess: () => onToast("Member removed") })}
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
              {memberCount < GROUP_MAX_MEMBERS ? (
                <form className="addmember" onSubmit={addMember}>
                  <input value={memberPhone} onChange={(e) => setMemberPhone(e.target.value)} placeholder="+44 7…" />
                  <input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="Name (optional)" />
                  <button type="submit" disabled={addParticipant.isPending || !memberPhone.trim()}>Add</button>
                </form>
              ) : (
                <div className="capnote">Group is at the {GROUP_MAX_MEMBERS}-member limit.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <AssignmentBlock conv={conv} teamName={teamName} onToast={onToast} />
            <CustomerTags contact={conv.contact} onToast={onToast} />
            <RecentConversations contactId={conv.contact.id} currentId={conv.id} onOpen={onOpenConversation} />
            <ChannelsBlock contact={conv.contact} activeChannel={conv.channel} onSwitch={switchChannel} />
            <RoutingBlock contact={conv.contact} isGroup={false} onToast={onToast} />
            {conv.slaDueAt && <SlaBlock iso={conv.slaDueAt} now={now} />}
            <LabelsBlock labels={conv.labels} />
          </>
        )}
      </div>
    </aside>
  );
}
