import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Contact, Team } from "@ding/schemas";
import {
  useContact,
  useContacts,
  useCreateContact,
  useDeleteContact,
  usePeople,
  useTeams,
  useUpdateContact,
} from "../hooks";
import { relativeTime } from "../lib/format";
import { Avatar } from "./Avatar";
import { TagEditor } from "./TagEditor";
import {
  channelMeta,
  EditIcon,
  PhoneIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
} from "../lib/icons";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onOpenConversation: (id: string) => void;
  /** When opened from a chat's "profile" action, edit this customer. */
  focusContactId?: string | null;
}

/** The team-routing + person-routing controls that pin a customer's new
 *  conversations. Shared by the add + edit modal. */
function RoutingPicker({
  teams,
  people,
  ownerTeamId,
  ownerUserId,
  onTeam,
  onUser,
}: {
  teams: Team[];
  people: { user: { id: string; name: string } }[];
  ownerTeamId: string | null;
  ownerUserId: string | null;
  onTeam: (id: string | null) => void;
  onUser: (id: string | null) => void;
}) {
  const auto = !ownerTeamId && !ownerUserId;
  return (
    <>
      <div className="field">
        <span>Auto-route new conversations to</span>
        <div className="checks">
          <label className={"check" + (auto ? " on" : "")}>
            <input
              type="radio"
              checked={auto}
              onChange={() => {
                onTeam(null);
                onUser(null);
              }}
            />
            Automatic
          </label>
          {teams.map((t) => (
            <label key={t.id} className={"check" + (ownerTeamId === t.id ? " on" : "")}>
              <input
                type="radio"
                checked={ownerTeamId === t.id}
                onChange={() => onTeam(ownerTeamId === t.id ? null : t.id)}
              />
              {t.name}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        <span>
          Straight to a person <em>optional</em>
        </span>
        <select value={ownerUserId ?? ""} onChange={(e) => onUser(e.target.value || null)}>
          <option value="">No one specific</option>
          {people.map((p) => (
            <option key={p.user.id} value={p.user.id}>
              {p.user.name}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** One modal for both adding and editing a customer. */
function CustomerModal({
  contact,
  suggestions,
  onClose,
  onToast,
  onOpenConversation,
}: {
  contact: Contact | null;
  suggestions: string[];
  onClose: () => void;
  onToast: (msg: string) => void;
  onOpenConversation: (id: string) => void;
}) {
  const isEdit = !!contact;
  const teams = useTeams();
  const people = usePeople();
  const create = useCreateContact();
  const update = useUpdateContact();
  const del = useDeleteContact();
  const detail = useContact(contact?.id ?? null);
  const [displayName, setName] = useState(contact?.displayName ?? "");
  const [company, setCompany] = useState(contact?.company ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [tags, setTags] = useState<string[]>(contact?.tags ?? []);
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(contact?.ownerTeamId ?? null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(contact?.ownerUserId ?? null);
  const [blocked, setBlocked] = useState(contact?.blocked ?? false);
  const busy = create.isPending || update.isPending || del.isPending;

  const remove = () => {
    if (!contact) return;
    if (!window.confirm(`Delete ${contact.displayName}? This permanently removes the customer and their conversation history.`)) return;
    del.mutate(contact.id, {
      onSuccess: () => { onToast(`${contact.displayName} deleted`); onClose(); },
      onError: () => onToast("Couldn't delete customer"),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    if (isEdit && contact) {
      update.mutate(
        {
          id: contact.id,
          input: {
            displayName: name,
            company: company.trim(),
            phone: phone.trim(),
            email: email.trim(),
            tags,
            ownerTeamId,
            ownerUserId,
            blocked,
          },
        },
        {
          onSuccess: () => {
            onToast("Customer updated");
            onClose();
          },
          onError: () => onToast("Couldn't update customer"),
        },
      );
    } else {
      create.mutate(
        {
          displayName: name,
          company: company.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          tags,
          ownerTeamId,
          ownerUserId,
        },
        {
          onSuccess: (res) => {
            // Get-or-create: if the phone/email already matched a customer, we
            // opened theirs instead of forking a duplicate — say so.
            onToast(res.existed ? `Already on file — ${res.contact.displayName}` : `Added ${name}`);
            onClose();
          },
          onError: () => onToast("Couldn't add customer"),
        },
      );
    }
  };

  const convos = detail.data?.conversations ?? [];

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box modal--form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal__head">
          <h2>{isEdit ? "Edit customer" : "New customer"}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">
          <div className="setform__grid two">
            <label className="field">
              <span>Name</span>
              <input value={displayName} autoFocus onChange={(e) => setName(e.target.value)} placeholder="The Ivy House" required />
            </label>
            <label className="field">
              <span>Company / label <em>optional</em></span>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Venue · Bristol" />
            </label>
            <label className="field">
              <span>Phone <em>optional</em></span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 117 496 0122" />
            </label>
            <label className="field">
              <span>Email <em>optional</em></span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ops@theivyhouse.co.uk" />
            </label>
          </div>
          <TagEditor tags={tags} suggestions={suggestions} onChange={setTags} />
          <RoutingPicker
            teams={teams.data ?? []}
            people={people.data ?? []}
            ownerTeamId={ownerTeamId}
            ownerUserId={ownerUserId}
            onTeam={setOwnerTeamId}
            onUser={setOwnerUserId}
          />
          {isEdit && (
            <div className="field">
              <span>Conversations {convos.length > 0 && `· ${convos.length}`}</span>
              {convos.length === 0 ? (
                <p className="custconvs__empty">{detail.isLoading ? "Loading…" : "No conversations yet."}</p>
              ) : (
                <div className="custconvs">
                  {convos.map((c) => {
                    const cm = channelMeta(c.channel);
                    const Glyph = cm.Glyph;
                    return (
                      <button className="custconv" key={c.id} type="button" onClick={() => onOpenConversation(c.id)} title="Open conversation">
                        <span className="custconv__ic" style={{ color: cm.color }}><Glyph /></span>
                        <span className="custconv__body">
                          <b>{c.subject || cm.label}</b>
                          <small>{c.preview || "No messages"}</small>
                        </span>
                        <span className={"custconv__st st-" + c.status}>{c.status}</span>
                        <span className="custconv__t">{relativeTime(c.lastActivityAt)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {isEdit && (
            <label className={"custblock" + (blocked ? " on" : "")}>
              <input type="checkbox" checked={blocked} onChange={(e) => setBlocked(e.target.checked)} />
              <span>
                <b>Block this customer</b>
                <small>Their inbound messages are dropped and they’re hidden from the directory.</small>
              </span>
            </label>
          )}
        </div>
        <div className={"modal__foot" + (isEdit ? " modal__foot--split" : "")}>
          {isEdit && (
            <button type="button" className="btn-ghost btn-danger" onClick={remove}>
              <TrashIcon /> Delete
            </button>
          )}
          <div className="setform__footactions">
            <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={busy || !displayName.trim()}>
              {isEdit ? "Save changes" : "Add customer"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

export function Customers({ onClose, onToast, onOpenConversation, focusContactId }: Props) {
  const contacts = useContacts();
  const teams = useTeams();
  const [q, setQ] = useState("");
  const [showBlocked, setShowBlocked] = useState(false);
  // null = closed; { contact: null } = add; { contact } = edit.
  const [modal, setModal] = useState<{ contact: Contact | null } | null>(null);

  // Opened from a chat's "profile" action: open that customer's editor.
  useEffect(() => {
    if (!focusContactId) return;
    const c = (contacts.data ?? []).find((x) => x.id === focusContactId);
    if (c) setModal({ contact: c });
  }, [focusContactId, contacts.data]);

  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? "team";
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts.data ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [contacts.data]);

  const blockedCount = (contacts.data ?? []).filter((c) => c.blocked).length;
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = contacts.data ?? [];
    if (!showBlocked) list = list.filter((c) => !c.blocked);
    if (!needle) return list;
    return list.filter((c) =>
      [c.displayName, c.company, c.phone, c.email, ...(c.tags ?? [])]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle)),
    );
  }, [contacts.data, q, showBlocked]);

  const routing = (c: Contact) =>
    c.ownerTeamId
      ? { label: teamName(c.ownerTeamId), pinned: true }
      : c.ownerUserId
        ? { label: "Direct", pinned: true }
        : { label: "Automatic", pinned: false };

  return (
    <div className="settings" role="region" aria-label="Customers">
      <header className="settings__head">
        <h1>Customers</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close customers" title="Close">
          <XIcon />
        </button>
      </header>
      <div className="settings__pane">
        <div className="setpane setpane--wide">
          <div className="setpane__head">
            <div>
              <h2>Customers <span className="setcount">{contacts.data?.length ?? 0}</span></h2>
              <p>Everyone who's messaged you, plus contacts you add by hand. Tag them and pin a customer to a team so their messages always land in the right place.</p>
            </div>
            <button className="btn-primary" onClick={() => setModal({ contact: null })}>
              <PlusIcon /> Add customer
            </button>
          </div>

          <div className="setbar">
            <div className="setsearch">
              <SearchIcon />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company, number, email or tag…" />
            </div>
            {blockedCount > 0 && (
              <button
                type="button"
                className={"setfilterchip" + (showBlocked ? " on" : "")}
                onClick={() => setShowBlocked((v) => !v)}
              >
                {showBlocked ? "Hide blocked" : `Show blocked · ${blockedCount}`}
              </button>
            )}
          </div>

          <div className="dwrap">
            <div className="dtable dtable--cust">
              <div className="dtable__head">
                <span>Name</span>
                <span>Company</span>
                <span>Contact</span>
                <span>Channels</span>
                <span>Tags</span>
                <span>Routing</span>
                <span />
              </div>
              {filtered.map((c) => {
                const r = routing(c);
                return (
                  <div
                    className={"dtable__row" + (c.blocked ? " dtable__row--blocked" : "")}
                    key={c.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setModal({ contact: c })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setModal({ contact: c }); }
                    }}
                  >
                    <span className="dcell dname">
                      <Avatar name={c.displayName} email={c.email} color={c.avatarColor} className="dname__av av" />
                      <span className="dname__x">
                        <span className="dcell__t">
                          {c.displayName}
                          {c.blocked && <span className="dbadge dbadge--blocked">Blocked</span>}
                        </span>
                      </span>
                    </span>
                    <span className="dcell dcell--muted">{c.company || "—"}</span>
                    <span className="dcell">
                      {c.phone ? <div className="dcell__t" style={{ fontWeight: 550, fontSize: "var(--fs-sm)" }}>{c.phone}</div> : null}
                      {c.email ? <div className="dcell__s">{c.email}</div> : null}
                      {!c.phone && !c.email ? <span className="dcell--muted">—</span> : null}
                    </span>
                    <span className="dcell dchips">
                      {c.phone && (
                        <span title="WhatsApp" style={{ color: channelMeta("whatsapp").color, display: "inline-flex" }}>
                          {(() => { const G = channelMeta("whatsapp").Glyph; return <G />; })()}
                        </span>
                      )}
                      {c.email && (
                        <span title="Email" style={{ color: channelMeta("email").color, display: "inline-flex" }}>
                          {(() => { const G = channelMeta("email").Glyph; return <G />; })()}
                        </span>
                      )}
                      {!c.phone && !c.email && <span className="dcell--muted">—</span>}
                    </span>
                    <span className="dcell dtags">
                      {(c.tags ?? []).slice(0, 3).map((t) => <span className="dtag" key={t}>{t}</span>)}
                      {(c.tags?.length ?? 0) > 3 && <span className="dtag">+{(c.tags?.length ?? 0) - 3}</span>}
                      {(c.tags?.length ?? 0) === 0 && <span className="dcell--muted">—</span>}
                    </span>
                    <span className="dcell">
                      <span className={"dpill " + (r.pinned ? "dpill--on" : "dpill--off")} title={r.pinned ? `Pinned to ${r.label}` : "Follows channel routing"}>
                        <RouteIcon /> {r.label}
                      </span>
                    </span>
                    <span className="dcell dcell--end"><span className="dchev"><EditIcon /></span></span>
                  </div>
                );
              })}
            </div>
          </div>

          {contacts.data && filtered.length === 0 && (
            <div className="setzero">
              {q ? (
                <p>No customers match “{q}”.</p>
              ) : (
                <>
                  <span className="setzero__ic"><PhoneIcon /></span>
                  <p>No customers yet. They appear here automatically when someone messages you — or add one now.</p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {modal && (
        <CustomerModal
          contact={modal.contact}
          suggestions={allTags}
          onClose={() => setModal(null)}
          onToast={onToast}
          onOpenConversation={onOpenConversation}
        />
      )}
    </div>
  );
}
