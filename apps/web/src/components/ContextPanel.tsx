import { useEffect, useState, type FormEvent } from "react";
import { GROUP_MAX_MEMBERS, type ChannelType, type Contact } from "@ding/schemas";
import {
  useAddParticipant,
  useConversation,
  usePeople,
  useRemoveParticipant,
  useTeams,
  useUpdateContact,
} from "../hooks";
import { initials, slaCountdown } from "../lib/format";
import { channelMeta, PhoneIcon, MailIcon, ProfileIcon, XIcon, ChevronRight } from "../lib/icons";

interface Props {
  conversationId: string | null;
  onToast: (msg: string) => void;
  onClose?: () => void;
}

/** Pin a customer to a team/person so their future conversations auto-route.
 *  Lives in the details panel so an agent can set it straight from a chat. */
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
    <div className="block">
      <div className="t">Auto-routing</div>
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
    </div>
  );
}

export function ContextPanel({ conversationId, onToast, onClose }: Props) {
  const { data: conv } = useConversation(conversationId);
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
  const highPriority = conv.priority === "high" || conv.priority === "urgent";
  const others = (["whatsapp", "email", "whatsapp_group"] as ChannelType[]).filter((t) => t !== conv.channel);
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
              <button title="Call"><PhoneIcon /></button>
              <button title="Email"><MailIcon /></button>
              <button title="Profile"><ProfileIcon /></button>
            </div>
          )}
        </div>

        <div className="block">
          <div className="t">Assignment</div>
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
              <span
                className="prio"
                style={highPriority ? undefined : { background: "var(--surface-2)", color: "var(--text-muted)" }}
              >
                {conv.priority}
              </span>
            </span>
          </div>
        </div>

        <RoutingBlock contact={conv.contact} isGroup={isGroup} onToast={onToast} />

        {conv.slaDueAt && (
          <div className="block">
            <div className="t">SLA</div>
            <div className="slabox">
              <div className="txt">
                <small>First response due in</small>
                <span className="cd">{slaCountdown(conv.slaDueAt, now)}</span>
              </div>
            </div>
          </div>
        )}

        <div className="block">
          <div className="t">Labels</div>
          <div className="lbls">
            {conv.labels.length === 0 && (
              <span style={{ color: "var(--text-faint)", fontSize: 12.5 }}>No labels</span>
            )}
            {conv.labels.map((l) => (
              <span key={l.id} className="lbl-chip">
                <span className="d" style={{ background: l.color }} />
                {l.name}
              </span>
            ))}
          </div>
        </div>

        {isGroup ? (
          <>
            {conv.inviteLink && (
              <div className="block">
                <div className="t">Invite link</div>
                <div className="invite">
                  <code>{conv.inviteLink}</code>
                  <button type="button" onClick={copyInvite}>Copy</button>
                </div>
              </div>
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
            <div className="block">
              <div className="t">Contact</div>
              <div className="kv">
                <span className="k">Phone</span>
                <span className="v">{conv.contact.phone ?? "—"}</span>
              </div>
              <div className="kv">
                <span className="k">Email</span>
                <span className="v" style={{ fontWeight: 550, fontSize: 12.5 }}>{conv.contact.email ?? "—"}</span>
              </div>
            </div>

            <div className="block">
              <div className="t">Across channels</div>
              {others.map((t) => {
                const cm = channelMeta(t);
                const Glyph = cm.Glyph;
                return (
                  <button key={t} className="xthread">
                    <div className="ic" style={{ background: cm.color }}>
                      <Glyph />
                    </div>
                    <div className="m">
                      <b>{cm.label}</b>
                      <small>View history</small>
                    </div>
                    <span className="n"><ChevronRight /></span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
