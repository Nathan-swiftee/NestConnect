import { useEffect, useMemo, useState } from "react";
import type { AccountDetail, AccountSop, AccountStatus, AccountAlert, AccountNote, AccountResource, AccountContact } from "@ding/schemas";
import { ALERT_PRIORITIES } from "@ding/schemas";
import { api } from "../../lib/api";
import { useAccount, useAccountActivity, useAccountMutation, useAccounts, useMe } from "../../hooks";
import { relativeTime } from "../../lib/format";
import {
  AlertIcon,
  BackIcon,
  EditIcon,
  OrganisationsIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  XIcon,
  ContactsIcon,
  DocIcon,
  ClockIcon,
  ChevronRight,
} from "../../lib/icons";
import { Avatar } from "../Avatar";
import { KnowledgeView } from "./KnowledgeEditor";
import { AccountFormModal, ContactRoleModal, LinkContactModal, NoteModal, ResourceModal, SopEditorModal } from "./forms";
import { PRIORITY_LABEL, ResourceLink, SopReader, StatusPill, STATUS_LABEL } from "./shared";

type Tab = "overview" | "contacts" | "knowledge" | "resources" | "activity";

/**
 * Organisations: the directory of customer companies, and each one's profile —
 * who they are, who we deal with there, and how they're served.
 */
export function Organisations({
  focusAccountId,
  onClose,
  onToast,
  onOpenContact,
}: {
  focusAccountId?: string | null;
  onClose: () => void;
  onToast: (m: string) => void;
  /** Open a contact's customer profile (and from there, their conversations). */
  onOpenContact: (contactId: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(focusAccountId ?? null);
  useEffect(() => {
    if (focusAccountId) setOpenId(focusAccountId);
  }, [focusAccountId]);

  return (
    <div className="settings" role="region" aria-label="Organisations">
      <header className="settings__head">
        <h1>Organisations</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close organisations" title="Close"><XIcon /></button>
      </header>
      <div className="settings__pane">
        {openId ? (
          <Profile id={openId} onBack={() => setOpenId(null)} onOpen={setOpenId} onToast={onToast} onOpenContact={onOpenContact} />
        ) : (
          <Directory onOpen={setOpenId} onToast={onToast} />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- directory ------------------------------- */

function Directory({ onOpen, onToast }: { onOpen: (id: string) => void; onToast: (m: string) => void }) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState<AccountStatus | undefined>();
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(search.trim()), 200);
    return () => window.clearTimeout(t);
  }, [search]);
  const list = useAccounts({ search: debounced || undefined, status, archived });
  const rows = list.data ?? [];

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>Organisations <span className="setcount">{rows.length}</span></h2>
          <p>Every customer company, the people you deal with there, and exactly how they're served — so anyone can pick them up.</p>
        </div>
        <div className="setpane__headacts">
          <button className="btn-primary" onClick={() => setCreating(true)}><PlusIcon /> New organisation</button>
        </div>
      </div>

      <div className="setbar">
        <div className="setsearch">
          <SearchIcon />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, reference, summary or tag…" aria-label="Search organisations" />
        </div>
        {(["active", "prospect", "inactive"] as AccountStatus[]).map((s) => (
          <button key={s} type="button" className={"setfilterchip" + (status === s ? " on" : "")} aria-pressed={status === s} onClick={() => setStatus(status === s ? undefined : s)}>
            {STATUS_LABEL[s]}
          </button>
        ))}
        <button type="button" className={"setfilterchip" + (archived ? " on" : "")} aria-pressed={archived} onClick={() => setArchived((v) => !v)}>
          {archived ? "Hide archived" : "Show archived"}
        </button>
      </div>

      {list.isError && <div className="setempty">Couldn't load organisations. <button className="btn-ghost sm" onClick={() => list.refetch()}>Try again</button></div>}

      {rows.length > 0 && (
        <div className="dwrap">
          <div className="dtable org-table">
            <div className="dtable__head">
              <span>Organisation</span>
              <span>Status</span>
              <span>Contacts</span>
              <span>Knowledge</span>
              <span>Owner</span>
              <span>Updated</span>
              <span />
            </div>
            {rows.map((a) => (
              <div
                key={a.id}
                className={"dtable__row" + (a.archivedAt ? " dtable__row--blocked" : "")}
                role="button"
                tabIndex={0}
                onClick={() => onOpen(a.id)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(a.id); } }}
              >
                <span className="dcell dname">
                  <span className="org-mark" aria-hidden="true">{a.name.slice(0, 1).toUpperCase()}</span>
                  <span className="dname__x">
                    <span className="dcell__t">{a.name}{a.reference && <span className="org-ref">{a.reference}</span>}</span>
                    {a.summary && <span className="dcell__s">{a.summary}</span>}
                  </span>
                </span>
                <span className="dcell"><StatusPill status={a.status} archived={!!a.archivedAt} /></span>
                <span className="dcell">{a.contactCount || <span className="dcell--muted">—</span>}</span>
                <span className="dcell org-knowcell">
                  {a.alertCount > 0 && <span className="org-chip org-chip--alert" title="Pinned instructions"><AlertIcon /> {a.alertCount}</span>}
                  {a.sopCount > 0 && <span className="org-chip" title="Active SOPs"><DocIcon /> {a.sopCount} SOP{a.sopCount === 1 ? "" : "s"}</span>}
                  {!a.alertCount && !a.sopCount && <span className="dcell--muted">—</span>}
                </span>
                <span className="dcell dcell--muted">{a.ownerName ?? "—"}</span>
                <span className="dcell dcell--muted">{relativeTime(a.updatedAt)}</span>
                <span className="dcell dcell--end"><span className="dchev"><ChevronRight /></span></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {list.isLoading && <div className="setempty">Loading…</div>}
      {list.data && rows.length === 0 && (
        <div className="setzero">
          {debounced || status || archived ? (
            <p>No organisations match.</p>
          ) : (
            <>
              <span className="setzero__ic"><OrganisationsIcon /></span>
              <p>No organisations yet. Add your first customer company — its contacts, pinned instructions and procedures then show beside every conversation with them.</p>
              <button className="btn-primary" onClick={() => setCreating(true)}><PlusIcon /> New organisation</button>
            </>
          )}
        </div>
      )}

      {creating && (
        <AccountFormModal
          account={null}
          onClose={() => setCreating(false)}
          onSaved={(a) => { setCreating(false); onOpen(a.id); }}
          onOpenExisting={(id) => { setCreating(false); onOpen(id); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

/* -------------------------------- profile -------------------------------- */

function Profile({ id, onBack, onOpen, onToast, onOpenContact }: {
  id: string;
  onBack: () => void;
  onOpen: (id: string) => void;
  onToast: (m: string) => void;
  onOpenContact: (contactId: string) => void;
}) {
  const detail = useAccount(id);
  const me = useMe();
  const isManager = me.data?.user.role === "admin" || me.data?.user.role === "manager";
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const archive = useAccountMutation((archived: boolean) => api.archiveAccount(id, archived));

  if (detail.isLoading) return <div className="setpane setpane--wide"><div className="setempty">Loading…</div></div>;
  if (detail.isError || !detail.data) {
    return (
      <div className="setpane setpane--wide">
        <button className="org-back" onClick={onBack}><BackIcon /> Organisations</button>
        <div className="setempty">This organisation couldn't be loaded — it may have been removed, or belong to another workspace.</div>
      </div>
    );
  }
  const d = detail.data;
  const a = d.account;
  const archived = !!a.archivedAt;
  const activeSops = d.sops.filter((s) => s.status === "active");

  const tabs: Array<{ key: Tab; label: string; count?: number }> = [
    { key: "overview", label: "Overview" },
    { key: "contacts", label: "Contacts", count: d.contacts.length },
    { key: "knowledge", label: "Knowledge & SOPs", count: activeSops.length + d.notes.length },
    { key: "resources", label: "Resources", count: d.resources.length },
    { key: "activity", label: "Activity" },
  ];

  return (
    <div className="setpane setpane--wide org-profile">
      <button className="org-back" onClick={onBack}><BackIcon /> Organisations</button>
      <div className="org-hero">
        <span className="org-mark org-mark--lg" aria-hidden="true">{a.name.slice(0, 1).toUpperCase()}</span>
        <div className="org-hero__main">
          <h2>{a.name} <StatusPill status={a.status} archived={archived} /></h2>
          <p className="org-hero__sub">
            {[a.legalName, a.reference && `Ref ${a.reference}`, a.ownerName && `Owner: ${a.ownerName}`].filter(Boolean).join(" · ") || "No details yet"}
          </p>
          {a.summary && <p className="org-hero__summary">{a.summary}</p>}
          {a.tags.length > 0 && <div className="org-tags">{a.tags.map((t) => <span key={t} className="dtag">{t}</span>)}</div>}
        </div>
        <div className="setpane__headacts">
          {!archived && <button className="btn-ghost" onClick={() => setEditing(true)}><EditIcon /> Edit</button>}
          {isManager && (
            <button
              className="btn-ghost"
              disabled={archive.isPending}
              onClick={() => {
                if (!archived && !window.confirm(`Archive ${a.name}? It leaves the directory and the inbox, and becomes read-only. Contacts and conversations are not affected, and it can be restored.`)) return;
                archive.mutate(!archived, { onSuccess: () => onToast(archived ? "Restored" : "Archived"), onError: (e) => onToast((e as Error).message) });
              }}
            >
              {archived ? "Restore" : "Archive"}
            </button>
          )}
        </div>
      </div>
      {archived && <div className="org-archived">Archived {relativeTime(a.archivedAt!)} — read-only, and not shown in the inbox. Restore it to make changes.</div>}

      <div className="pers-tabs org-tabs" role="tablist" aria-label="Organisation sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={"pers-tab" + (tab === t.key ? " on" : "")} onClick={() => setTab(t.key)}>
            {t.label}{t.count ? <span className="org-tabn">{t.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="org-tabpane" role="tabpanel">
        {tab === "overview" && <OverviewTab d={d} readOnly={archived} onToast={onToast} onTab={setTab} />}
        {tab === "contacts" && <ContactsTab d={d} readOnly={archived} onToast={onToast} onOpenContact={onOpenContact} />}
        {tab === "knowledge" && <KnowledgeTab d={d} readOnly={archived} onToast={onToast} />}
        {tab === "resources" && <ResourcesTab d={d} readOnly={archived} onToast={onToast} />}
        {tab === "activity" && <ActivityTab id={id} />}
      </div>

      {editing && (
        <AccountFormModal account={a} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} onOpenExisting={(other) => { setEditing(false); onOpen(other); }} onToast={onToast} />
      )}
    </div>
  );
}

/* -------------------------------- overview -------------------------------- */

function OverviewTab({ d, readOnly, onToast, onTab }: { d: AccountDetail; readOnly: boolean; onToast: (m: string) => void; onTab: (t: Tab) => void }) {
  const a = d.account;
  const primary = d.contacts.find((c) => c.isPrimary) ?? d.contacts[0];
  const activeSops = d.sops.filter((s) => s.status === "active");
  return (
    <div className="org-grid">
      <div className="org-col">
        <AlertsEditor accountId={a.id} alerts={d.alerts} readOnly={readOnly} onToast={onToast} />
        <section className="org-card">
          <h3>Overview</h3>
          {a.overview ? <p className="org-pre">{a.overview}</p> : <p className="org-muted">No overview yet{readOnly ? "." : " — use Edit to add one."}</p>}
        </section>
        <section className="org-card">
          <h3>Procedures <button type="button" className="org-linkbtn" onClick={() => onTab("knowledge")}>All knowledge <ChevronRight /></button></h3>
          {activeSops.length === 0 ? (
            <p className="org-muted">No active SOPs yet.</p>
          ) : (
            <ul className="org-soplist">
              {activeSops.map((s) => (
                <li key={s.id}><button type="button" onClick={() => onTab("knowledge")}><b>{s.title}</b><small>{s.category}</small></button></li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="org-col org-col--side">
        <section className="org-card">
          <h3>Details</h3>
          <dl className="org-dl">
            {a.legalName && (<><dt>Legal name</dt><dd>{a.legalName}</dd></>)}
            {a.reference && (<><dt>Reference</dt><dd>{a.reference}</dd></>)}
            <dt>Account owner</dt><dd>{a.ownerName ?? "No one"}</dd>
            {primary && (<><dt>Main contact</dt><dd>{primary.contact.displayName}{primary.role ? ` · ${primary.role}` : ""}</dd></>)}
            {a.phone && (<><dt>Phone</dt><dd>{a.phone}</dd></>)}
            {a.email && (<><dt>Email</dt><dd><a href={`mailto:${a.email}`}>{a.email}</a></dd></>)}
            {a.website && (<><dt>Website</dt><dd><a href={a.website} target="_blank" rel="noopener noreferrer">{a.website.replace(/^https?:\/\//, "")}</a></dd></>)}
            {a.address && (<><dt>Address</dt><dd className="org-pre">{a.address}</dd></>)}
          </dl>
        </section>
        <section className="org-card">
          <h3>At a glance</h3>
          <dl className="org-dl">
            <dt>Contacts</dt><dd>{d.contacts.length}</dd>
            <dt>Active SOPs</dt><dd>{activeSops.length}</dd>
            <dt>Notes</dt><dd>{d.notes.length}</dd>
            <dt>Resources</dt><dd>{d.resources.length}</dd>
            <dt>Created</dt><dd>{new Date(a.createdAt).toLocaleDateString()}{a.createdBy ? ` by ${a.createdBy.name}` : ""}</dd>
            <dt>Last updated</dt><dd>{relativeTime(a.updatedAt)}{a.updatedBy ? ` by ${a.updatedBy.name}` : ""}</dd>
          </dl>
        </section>
      </div>
    </div>
  );
}

/** Pinned instructions, editable in place. */
function AlertsEditor({ accountId, alerts, readOnly, onToast }: { accountId: string; alerts: AccountAlert[]; readOnly: boolean; onToast: (m: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<AccountAlert["priority"]>("important");
  const save = useAccountMutation(() =>
    editingId ? api.updateAccountAlert(accountId, editingId, { body: body.trim(), priority }) : api.createAccountAlert(accountId, { body: body.trim(), priority }),
  );
  const remove = useAccountMutation((alertId: string) => api.deleteAccountAlert(accountId, alertId));
  const reset = () => { setAdding(false); setEditingId(null); setBody(""); setPriority("important"); };
  const form = (
    <form
      className="org-alertform"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return;
        save.mutate(undefined, { onSuccess: () => { onToast("Saved"); reset(); }, onError: (err) => onToast((err as Error).message) });
      }}
    >
      <textarea rows={2} value={body} autoFocus maxLength={600} onChange={(e) => setBody(e.target.value)} placeholder="Only approved couriers may handle this customer's deliveries." />
      <div className="org-alertform__row">
        <select value={priority} onChange={(e) => setPriority(e.target.value as AccountAlert["priority"])} aria-label="Priority">
          {ALERT_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <span className="flex-1" />
        <button type="button" className="btn-ghost sm" onClick={reset}>Cancel</button>
        <button type="submit" className="btn-primary sm" disabled={!body.trim() || save.isPending}>Save</button>
      </div>
    </form>
  );
  return (
    <section className="org-card org-card--alerts">
      <h3>
        Important instructions
        {!readOnly && !adding && !editingId && <button type="button" className="org-linkbtn" onClick={() => setAdding(true)}><PlusIcon /> Add</button>}
      </h3>
      {alerts.length === 0 && !adding && <p className="org-muted">Nothing pinned. Add what everyone must know before acting for this customer.</p>}
      <ul className="org-alerts">
        {alerts.map((al) =>
          editingId === al.id ? (
            <li key={al.id} className="org-alert-edit">{form}</li>
          ) : (
            <li key={al.id} className={`org-alert org-alert--${al.priority}`}>
              <span className="org-alert__ic" aria-hidden="true"><AlertIcon /></span>
              <span className="org-alert__body"><span className="org-alert__p">{PRIORITY_LABEL[al.priority]}</span>{al.body}</span>
              {!readOnly && (
                <span className="org-alert__acts">
                  <button type="button" className="org-iconbtn" aria-label="Edit" onClick={() => { setEditingId(al.id); setBody(al.body); setPriority(al.priority); setAdding(false); }}><EditIcon /></button>
                  <button type="button" className="org-iconbtn" aria-label="Remove" onClick={() => window.confirm("Remove this instruction?") && remove.mutate(al.id, { onError: (err) => onToast((err as Error).message) })}><TrashIcon /></button>
                </span>
              )}
            </li>
          ),
        )}
      </ul>
      {adding && form}
    </section>
  );
}

/* -------------------------------- contacts -------------------------------- */

function ContactsTab({ d, readOnly, onToast, onOpenContact }: { d: AccountDetail; readOnly: boolean; onToast: (m: string) => void; onOpenContact: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<AccountContact | null>(null);
  const unlink = useAccountMutation((contactId: string) => api.unlinkAccountContact(d.account.id, contactId));
  return (
    <section className="org-card">
      <h3>
        People at {d.account.name}
        {!readOnly && <button type="button" className="org-linkbtn" onClick={() => setAdding(true)}><PlusIcon /> Add people</button>}
      </h3>
      {d.contacts.length === 0 ? (
        <p className="org-muted">No contacts linked yet. Add the people who message you from this company — their conversations will then show this organisation.</p>
      ) : (
        <div className="org-people">
          {d.contacts.map((c) => (
            <div key={c.contactId} className="org-person">
              <Avatar name={c.contact.displayName} email={c.contact.email} color={c.contact.avatarColor} className="av" />
              <div className="org-person__main">
                <b>
                  {c.contact.displayName}
                  {c.isPrimary && <span className="org-chip org-chip--primary">Primary</span>}
                </b>
                <small>{[c.role, c.department].filter(Boolean).join(" · ") || "No role set"}</small>
                <small className="org-muted">{[c.contact.phone, c.contact.email].filter(Boolean).join(" · ")}</small>
                {c.notes && <small className="org-person__notes">{c.notes}</small>}
              </div>
              <div className="org-person__acts">
                <button type="button" className="btn-ghost sm" onClick={() => onOpenContact(c.contactId)}><ContactsIcon /> Profile & chats</button>
                {!readOnly && (
                  <>
                    <button type="button" className="org-iconbtn" aria-label="Edit role" onClick={() => setEditing(c)}><EditIcon /></button>
                    <button
                      type="button"
                      className="org-iconbtn"
                      aria-label="Remove from organisation"
                      onClick={() =>
                        window.confirm(`Remove ${c.contact.displayName} from ${d.account.name}? The contact and their conversations stay as they are.`) &&
                        unlink.mutate(c.contactId, { onSuccess: () => onToast("Removed"), onError: (err) => onToast((err as Error).message) })
                      }
                    >
                      <XIcon />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && <LinkContactModal accountId={d.account.id} linked={d.contacts} onClose={() => setAdding(false)} onToast={onToast} />}
      {editing && <ContactRoleModal accountId={d.account.id} link={editing} onClose={() => setEditing(null)} onToast={onToast} />}
    </section>
  );
}

/* ------------------------------- knowledge ------------------------------- */

function KnowledgeTab({ d, readOnly, onToast }: { d: AccountDetail; readOnly: boolean; onToast: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [showDrafts, setShowDrafts] = useState(true);
  const [showArchived, setShowArchived] = useState(false);
  const [reading, setReading] = useState<AccountSop | null>(null);
  const [editingSop, setEditingSop] = useState<AccountSop | "new" | null>(null);
  const [editingNote, setEditingNote] = useState<AccountNote | "new" | null>(null);
  const removeNote = useAccountMutation((noteId: string) => api.deleteAccountNote(d.account.id, noteId));
  const needle = q.trim().toLowerCase();
  const matches = (...texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle));
  const strip = (html: string) => html.replace(/<[^>]+>/g, " ");

  const sops = d.sops.filter(
    (s) =>
      (s.status === "active" || (s.status === "draft" && showDrafts) || (s.status === "archived" && showArchived)) &&
      matches(s.title, s.category, s.summary, s.warnings, s.steps.map((x) => x.text).join(" "), strip(s.body)),
  );
  const byCategory = useMemo(() => {
    const m = new Map<string, AccountSop[]>();
    for (const s of sops) m.set(s.category, [...(m.get(s.category) ?? []), s]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sops]);
  const notes = d.notes.filter((n) => matches(n.title, n.category, strip(n.body)));
  const categories = [...new Set(d.sops.map((s) => s.category))];
  // Keep the open reader on the latest version after a save.
  const current = reading ? d.sops.find((s) => s.id === reading.id) ?? reading : null;

  return (
    <div className="org-col">
      <div className="setbar">
        <div className="setsearch">
          <SearchIcon />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this customer's procedures and notes…" aria-label="Search knowledge" />
        </div>
        <button type="button" className={"setfilterchip" + (showDrafts ? " on" : "")} onClick={() => setShowDrafts((v) => !v)}>Drafts</button>
        <button type="button" className={"setfilterchip" + (showArchived ? " on" : "")} onClick={() => setShowArchived((v) => !v)}>Archived</button>
      </div>

      <section className="org-card">
        <h3>
          Standard operating procedures
          {!readOnly && <button type="button" className="org-linkbtn" onClick={() => setEditingSop("new")}><PlusIcon /> New SOP</button>}
        </h3>
        {byCategory.length === 0 && (
          <p className="org-muted">{needle ? "Nothing matches." : "No procedures yet. Write down how this customer's work is done — step by step, so anyone can do it."}</p>
        )}
        {byCategory.map(([cat, list]) => (
          <div key={cat} className="org-sopcat">
            <h4>{cat}</h4>
            {list.map((s) => (
              <button key={s.id} type="button" className={`org-sop-row org-sop-row--${s.status}`} onClick={() => setReading(s)}>
                <span className="org-sop-row__main">
                  <b>{s.title}</b>
                  <small>{s.summary || `${s.steps.length} step${s.steps.length === 1 ? "" : "s"}`}</small>
                </span>
                {s.warnings && <span className="org-chip org-chip--alert" title={s.warnings}><AlertIcon /></span>}
                {s.status !== "active" && <span className={`org-sopst org-sopst--${s.status}`}>{s.status === "draft" ? "Draft" : "Archived"}</span>}
                <span className="org-muted org-sop-row__v">v{s.version} · {relativeTime(s.updatedAt)}</span>
                <ChevronRight />
              </button>
            ))}
          </div>
        ))}
      </section>

      <section className="org-card">
        <h3>
          Customer notes
          {!readOnly && <button type="button" className="org-linkbtn" onClick={() => setEditingNote("new")}><PlusIcon /> Add note</button>}
        </h3>
        <p className="capnote">Lasting knowledge about the customer. Notes about a single conversation belong in that conversation.</p>
        {notes.length === 0 && <p className="org-muted">{needle ? "Nothing matches." : "No notes yet."}</p>}
        {notes.map((n) => (
          <article key={n.id} className="org-note">
            <header>
              <b>{n.title || "Note"}</b>
              <span className="org-chip">{n.category}</span>
              <span className="org-muted">{relativeTime(n.updatedAt)}{n.updatedBy ? ` · ${n.updatedBy.name}` : ""}</span>
              {!readOnly && (
                <span className="org-note__acts">
                  <button type="button" className="org-iconbtn" aria-label="Edit note" onClick={() => setEditingNote(n)}><EditIcon /></button>
                  <button type="button" className="org-iconbtn" aria-label="Delete note" onClick={() => window.confirm("Delete this note?") && removeNote.mutate(n.id, { onError: (err) => onToast((err as Error).message) })}><TrashIcon /></button>
                </span>
              )}
            </header>
            <KnowledgeView html={n.body} />
          </article>
        ))}
      </section>

      {current && (
        <SopReader
          accountId={d.account.id}
          sop={current}
          resources={d.resources}
          onClose={() => setReading(null)}
          onEdit={readOnly ? undefined : () => { setEditingSop(current); setReading(null); }}
        />
      )}
      {editingSop && (
        <SopEditorModal
          accountId={d.account.id}
          sop={editingSop === "new" ? null : editingSop}
          categories={categories}
          onClose={() => setEditingSop(null)}
          onSaved={(s) => { setEditingSop(null); setReading(s); }}
          onToast={onToast}
        />
      )}
      {editingNote && <NoteModal accountId={d.account.id} note={editingNote === "new" ? null : editingNote} onClose={() => setEditingNote(null)} onToast={onToast} />}
    </div>
  );
}

/* -------------------------------- resources -------------------------------- */

function ResourcesTab({ d, readOnly, onToast }: { d: AccountDetail; readOnly: boolean; onToast: (m: string) => void }) {
  const [editing, setEditing] = useState<AccountResource | "new" | null>(null);
  const remove = useAccountMutation((rid: string) => api.deleteAccountResource(d.account.id, rid));
  const groups = useMemo(() => {
    const m = new Map<string, AccountResource[]>();
    for (const r of d.resources) m.set(r.category, [...(m.get(r.category) ?? []), r]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [d.resources]);
  const sopTitle = (id: string | null) => (id ? d.sops.find((s) => s.id === id)?.title : undefined);
  return (
    <section className="org-card">
      <h3>
        Documents, links & apps
        {!readOnly && <button type="button" className="org-linkbtn" onClick={() => setEditing("new")}><PlusIcon /> Add resource</button>}
      </h3>
      {groups.length === 0 && <p className="org-muted">Nothing here yet. Add templates, price lists, booking portals, shared sheets and the external tools this customer's work needs.</p>}
      {groups.map(([cat, list]) => (
        <div key={cat} className="org-sopcat">
          <h4>{cat}</h4>
          {list.map((r) => (
            <div key={r.id} className="org-resrow">
              <ResourceLink r={r} showInstructions />
              <div className="org-resrow__meta">
                {r.description && <span>{r.description}</span>}
                {sopTitle(r.sopId) && <span className="org-chip"><DocIcon /> {sopTitle(r.sopId)}</span>}
              </div>
              {!readOnly && (
                <span className="org-resrow__acts">
                  <button type="button" className="org-iconbtn" aria-label="Edit" onClick={() => setEditing(r)}><EditIcon /></button>
                  <button type="button" className="org-iconbtn" aria-label="Remove" onClick={() => window.confirm(`Remove “${r.title}”?`) && remove.mutate(r.id, { onError: (err) => onToast((err as Error).message) })}><TrashIcon /></button>
                </span>
              )}
            </div>
          ))}
        </div>
      ))}
      {editing && <ResourceModal accountId={d.account.id} resource={editing === "new" ? null : editing} sops={d.sops} onClose={() => setEditing(null)} onToast={onToast} />}
    </section>
  );
}

/* -------------------------------- activity -------------------------------- */

function ActivityTab({ id }: { id: string }) {
  const log = useAccountActivity(id);
  return (
    <section className="org-card">
      <h3>Activity</h3>
      {log.isLoading && <p className="org-muted">Loading…</p>}
      {log.data?.length === 0 && <p className="org-muted">No changes recorded yet.</p>}
      <ol className="org-activity">
        {log.data?.map((e) => (
          <li key={e.id}>
            <span className="org-activity__ic"><ClockIcon /></span>
            <span className="org-activity__body">
              <b>{e.actor?.name ?? "Someone"}</b> {e.summary.charAt(0).toLowerCase() + e.summary.slice(1)}
              <small title={new Date(e.createdAt).toLocaleString()}>{relativeTime(e.createdAt)}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
