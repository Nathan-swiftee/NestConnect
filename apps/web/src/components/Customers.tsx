import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Contact, Team } from "@ding/schemas";
import {
  useContact,
  useContacts,
  useCreateContact,
  usePeople,
  useTeams,
  useUpdateContact,
} from "../hooks";
import { initials, relativeTime, avatarBg } from "../lib/format";
import { TagEditor } from "./TagEditor";
import {
  channelMeta,
  EditIcon,
  PhoneIcon,
  PlusIcon,
  RouteIcon,
  SearchIcon,
  XIcon,
} from "../lib/icons";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onOpenConversation: (id: string) => void;
  /** When opened from a chat's "profile" action, expand this customer's row. */
  focusContactId?: string | null;
}

/** The team-routing + person-routing controls that pin a customer's new
 *  conversations. Shared by the add form and the row editor. */
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

function AddCustomer({
  suggestions,
  onDone,
  onToast,
}: {
  suggestions: string[];
  onDone: () => void;
  onToast: (msg: string) => void;
}) {
  const teams = useTeams();
  const people = usePeople();
  const create = useCreateContact();
  const [displayName, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
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
        onSuccess: () => {
          onToast(`Added ${name}`);
          onDone();
        },
        onError: () => onToast("Couldn't add customer"),
      },
    );
  };

  return (
    <form className="connect" onSubmit={submit}>
      <div className="connect__head">
        <b>New customer</b>
        <button className="btn-ghost sm" type="button" onClick={onDone}>
          Cancel
        </button>
      </div>
      <div className="setform__grid two">
        <label className="field">
          <span>Name</span>
          <input value={displayName} autoFocus onChange={(e) => setName(e.target.value)} placeholder="The Ivy House" required />
        </label>
        <label className="field">
          <span>
            Company / label <em>optional</em>
          </span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Venue · Bristol" />
        </label>
        <label className="field">
          <span>
            Phone <em>optional</em>
          </span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+44 117 496 0122" />
        </label>
        <label className="field">
          <span>
            Email <em>optional</em>
          </span>
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
      <div className="setform__foot">
        <button className="btn-ghost" type="button" onClick={onDone}>
          Cancel
        </button>
        <button className="btn-primary" type="submit" disabled={create.isPending || !displayName.trim()}>
          Add customer
        </button>
      </div>
    </form>
  );
}

function CustomerEditor({
  contact,
  suggestions,
  onDone,
  onToast,
  onOpenConversation,
}: {
  contact: Contact;
  suggestions: string[];
  onDone: () => void;
  onToast: (msg: string) => void;
  onOpenConversation: (id: string) => void;
}) {
  const teams = useTeams();
  const people = usePeople();
  const update = useUpdateContact();
  const detail = useContact(contact.id);
  const [displayName, setName] = useState(contact.displayName);
  const [company, setCompany] = useState(contact.company ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [tags, setTags] = useState<string[]>(contact.tags ?? []);
  const [ownerTeamId, setOwnerTeamId] = useState<string | null>(contact.ownerTeamId ?? null);
  const [ownerUserId, setOwnerUserId] = useState<string | null>(contact.ownerUserId ?? null);

  const save = () => {
    update.mutate(
      {
        id: contact.id,
        input: {
          displayName: displayName.trim() || contact.displayName,
          company: company.trim(),
          phone: phone.trim(),
          email: email.trim(),
          tags,
          ownerTeamId,
          ownerUserId,
        },
      },
      {
        onSuccess: () => {
          onToast("Customer updated");
          onDone();
        },
        onError: () => onToast("Couldn't update customer"),
      },
    );
  };

  const convos = detail.data?.conversations ?? [];

  return (
    <div className="editbox">
      <div className="setform__grid two">
        <label className="field">
          <span>Name</span>
          <input value={displayName} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Company / label</span>
          <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Venue · Bristol" />
        </label>
        <label className="field">
          <span>Phone</span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Add a number" />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Add an address" />
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
                <button
                  className="custconv"
                  key={c.id}
                  onClick={() => onOpenConversation(c.id)}
                  title="Open conversation"
                >
                  <span className="custconv__ic" style={{ color: cm.color }}>
                    <Glyph />
                  </span>
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

      <div className="setform__foot">
        <button className="btn-ghost" type="button" onClick={onDone}>
          Cancel
        </button>
        <button className="btn-primary" type="button" onClick={save} disabled={update.isPending || !displayName.trim()}>
          Save changes
        </button>
      </div>
    </div>
  );
}

export function Customers({ onClose, onToast, onOpenConversation, focusContactId }: Props) {
  const contacts = useContacts();
  const teams = useTeams();
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(focusContactId ?? null);
  const focusRef = useRef<HTMLDivElement | null>(null);

  // Opened from a chat's "profile" action: expand and scroll to that customer.
  useEffect(() => {
    if (!focusContactId) return;
    setEditingId(focusContactId);
    setAdding(false);
    const t = window.setTimeout(() => focusRef.current?.scrollIntoView({ block: "center" }), 60);
    return () => window.clearTimeout(t);
  }, [focusContactId]);

  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? "team";
  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts.data ?? []) for (const t of c.tags ?? []) set.add(t);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [contacts.data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = contacts.data ?? [];
    if (!needle) return list;
    return list.filter((c) =>
      [c.displayName, c.company, c.phone, c.email, ...(c.tags ?? [])]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle)),
    );
  }, [contacts.data, q]);

  return (
    <div className="settings" role="region" aria-label="Customers">
      <header className="settings__head">
        <h1>Customers</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close customers" title="Close">
          <XIcon />
        </button>
      </header>
      <div className="settings__pane">
        <div className="setpane">
          <div className="setpane__head">
            <div>
              <h2>Customers</h2>
              <p>Everyone who's messaged you, plus contacts you add by hand. Tag them and pin a customer to a team so their messages always land in the right place.</p>
            </div>
            {!adding && (
              <button className="btn-primary" onClick={() => { setAdding(true); setEditingId(null); }}>
                <PlusIcon /> Add customer
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 bg-surface-2 border border-solid border-transparent rounded-full py-2 px-4 mb-4 text-faint [transition:border-color_.14s,background_.14s] focus-within:border-brand focus-within:bg-surface focus-within:shadow-[0_0_0_3px_var(--brand-ring)] [&>svg]:w-4 [&>svg]:h-4 [&>svg]:flex-none">
            <SearchIcon />
            <input className="flex-1 min-w-0 bg-transparent border-0 [outline:none] text-md text-fg placeholder:text-faint" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, company, number, email or tag…" />
          </div>

          {adding && (
            <AddCustomer suggestions={allTags} onDone={() => setAdding(false)} onToast={onToast} />
          )}

          <div className="setlist">
            {filtered.map((c) => {
              const editing = editingId === c.id;
              const owner = c.ownerTeamId
                ? { label: teamName(c.ownerTeamId), pinned: true }
                : c.ownerUserId
                  ? { label: "Direct", pinned: true }
                  : { label: "Automatic", pinned: false };
              return (
                <div className="setmember" key={c.id} ref={c.id === focusContactId ? focusRef : undefined}>
                  <div className="setrow">
                    <span className="av" style={{ background: avatarBg(c.displayName, c.avatarColor), width: 38, height: 38, fontSize: 13 }}>
                      {initials(c.displayName)}
                    </span>
                    <div className="setrow__main">
                      <b>{c.displayName}</b>
                      <small>{c.company || c.phone || c.email || "No details yet"}</small>
                    </div>
                    <div className="flex flex-wrap gap-[5px] justify-end flex-initial min-w-0 max-w-[38%] max-[820px]:justify-start max-[820px]:max-w-full max-[820px]:order-4 max-[820px]:basis-full">
                      {(c.tags ?? []).slice(0, 3).map((t) => (
                        <span className="text-2xs font-[650] py-[3px] px-2 rounded-full bg-surface-2 text-muted whitespace-nowrap overflow-hidden text-ellipsis max-w-[110px]" key={t}>{t}</span>
                      ))}
                      {(c.tags?.length ?? 0) > 3 && <span className="text-2xs font-[650] py-[3px] px-2 rounded-full bg-surface-2 text-faint whitespace-nowrap overflow-hidden text-ellipsis max-w-[110px]">+{(c.tags?.length ?? 0) - 3}</span>}
                    </div>
                    <span
                      className={
                        "inline-flex items-center gap-[5px] flex-none text-2xs font-bold py-1 px-2 rounded-full [&>svg]:w-[13px] [&>svg]:h-[13px] max-[820px]:order-3 " +
                        (owner.pinned ? "bg-brand-tint text-brand-strong" : "bg-surface-2 text-faint")
                      }
                      title={owner.pinned ? `Pinned to ${owner.label}` : "Follows channel routing"}
                    >
                      <RouteIcon /> {owner.label}
                    </span>
                    <div className="rowacts">
                      <button
                        className="iconbtn"
                        title="Edit customer"
                        onClick={() => { setEditingId(editing ? null : c.id); setAdding(false); }}
                      >
                        <EditIcon />
                      </button>
                    </div>
                  </div>
                  {editing && (
                    <CustomerEditor
                      contact={c}
                      suggestions={allTags}
                      onDone={() => setEditingId(null)}
                      onToast={onToast}
                      onOpenConversation={onOpenConversation}
                    />
                  )}
                </div>
              );
            })}
            {contacts.data && filtered.length === 0 && (
              <div className="flex flex-col items-center text-center gap-3 py-11 px-5 text-muted [&>p]:m-0 [&>p]:text-sm [&>p]:max-w-[340px] [&>p]:leading-[1.45]">
                {q ? (
                  <p>No customers match “{q}”.</p>
                ) : (
                  <>
                    <span className="w-[52px] h-[52px] rounded-16 bg-surface-2 grid place-items-center text-faint [&>svg]:w-6 [&>svg]:h-6"><PhoneIcon /></span>
                    <p>No customers yet. They appear here automatically when someone messages you — or add one now.</p>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
