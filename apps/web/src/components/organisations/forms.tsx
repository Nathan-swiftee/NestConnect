import { useMemo, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import {
  ACCOUNT_STATUSES,
  SUGGESTED_SOP_CATEGORIES,
  type Account,
  type AccountContact,
  type AccountNote,
  type AccountResource,
  type AccountSop,
  type AccountStatus,
  type SopStatus,
} from "@ding/schemas";
import { api, type ApiError } from "../../lib/api";
import { useAccountMutation, useContacts, useMe, usePeople } from "../../hooks";
import { PlusIcon, TrashIcon, XIcon, ChevronUp, ChevronDown, SearchIcon } from "../../lib/icons";
import { Avatar } from "../Avatar";
import { TagEditor } from "../TagEditor";
import { KnowledgeEditor } from "./KnowledgeEditor";
import { STATUS_LABEL } from "./shared";

function errMessage(err: unknown, fallback: string): string {
  return (err as Error)?.message || fallback;
}

/** A modal shell, the app's own. */
function Modal({ title, onClose, children, foot, wide, onSubmit }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  foot: React.ReactNode;
  wide?: boolean;
  onSubmit?: (e: FormEvent) => void;
}) {
  // Portalled, and the submit kept to itself: these open from inside other
  // forms (a customer's profile), and a nested form — or a submit bubbling up
  // through React — would save that one too.
  return createPortal(
    <div className="modal" onClick={onClose}>
      <form className={"modal__box modal--form org-form" + (wide ? " org-modal--wide" : "")} onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); onSubmit?.(e); }}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__foot">{foot}</div>
      </form>
    </div>,
    document.body,
  );
}

/* --------------------------- organisation details --------------------------- */

export function AccountFormModal({
  account,
  initialName,
  linkContactId,
  onClose,
  onSaved,
  onOpenExisting,
  onToast,
}: {
  account: Account | null;
  /** A name to start from (typed into a search before choosing "Create"). */
  initialName?: string;
  /** Creating from a contact (inbox / customer profile): link them straight away. */
  linkContactId?: string;
  onClose: () => void;
  onSaved: (account: Account) => void;
  onOpenExisting?: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const people = usePeople();
  const save = useAccountMutation((v: { force?: boolean }) =>
    account
      ? api.updateAccount(account.id, fields())
      : api.createAccount({ ...fields(), force: v.force, contactId: linkContactId }),
  );
  const [name, setName] = useState(account?.name ?? initialName ?? "");
  const [legalName, setLegalName] = useState(account?.legalName ?? "");
  const [reference, setReference] = useState(account?.reference ?? "");
  const [summary, setSummary] = useState(account?.summary ?? "");
  const [overview, setOverview] = useState(account?.overview ?? "");
  const [status, setStatus] = useState<AccountStatus>(account?.status ?? "active");
  const [tags, setTags] = useState<string[]>(account?.tags ?? []);
  const [ownerUserId, setOwner] = useState<string>(account?.ownerUserId ?? "");
  const [phone, setPhone] = useState(account?.phone ?? "");
  const [email, setEmail] = useState(account?.email ?? "");
  const [website, setWebsite] = useState(account?.website ?? "");
  const [address, setAddress] = useState(account?.address ?? "");
  const [dupe, setDupe] = useState<{ id: string; name: string; archived: boolean; message: string } | null>(null);

  function fields() {
    return {
      name: name.trim(),
      legalName: legalName.trim() || null,
      reference: reference.trim() || null,
      summary: summary.trim(),
      overview: overview.trim(),
      status,
      tags,
      ownerUserId: ownerUserId || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      website: website.trim() || null,
      address: address.trim() || null,
    };
  }

  const submit = (force?: boolean) => {
    if (!name.trim()) return;
    save.mutate(
      { force },
      {
        onSuccess: (a) => {
          onToast(account ? "Organisation updated" : `Created ${a.name}`);
          onSaved(a);
        },
        onError: (err) => {
          const e = err as ApiError;
          const existing = (e.body as { details?: { existing?: { id: string; name: string; archived: boolean } } } | undefined)?.details?.existing;
          if (e.status === 409 && existing) setDupe({ ...existing, message: e.message });
          else onToast(errMessage(err, "Couldn't save the organisation"));
        },
      },
    );
  };

  return (
    <Modal
      title={account ? "Edit organisation" : "New organisation"}
      onClose={onClose}
      wide
      onSubmit={() => submit()}
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={save.isPending || !name.trim()}>
            {account ? "Save changes" : "Create organisation"}
          </button>
        </div>
      }
    >
      {dupe && (
        <div className="org-dupe" role="alert">
          <span>{dupe.message}.</span>
          <span className="org-dupe__acts">
            {onOpenExisting && (
              <button type="button" className="btn-primary sm" onClick={() => onOpenExisting(dupe.id)}>Open it</button>
            )}
            {!account && (
              <button type="button" className="btn-ghost sm" onClick={() => { setDupe(null); submit(true); }}>
                It's a different company — create anyway
              </button>
            )}
          </span>
        </div>
      )}
      <div className="setform__grid two">
        <label className="field">
          <span>Name</span>
          <input value={name} autoFocus onChange={(e) => { setName(e.target.value); setDupe(null); }} placeholder="ABC Magazines" required />
        </label>
        <label className="field">
          <span>Registered / legal name <em>optional</em></span>
          <input value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="ABC Magazines Ltd" />
        </label>
        <label className="field">
          <span>Account reference <em>optional</em></span>
          <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="SW-1042" />
        </label>
        <label className="field">
          <span>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as AccountStatus)}>
            {ACCOUNT_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      <label className="field">
        <span>In one line <em>optional</em></span>
        <input value={summary} maxLength={280} onChange={(e) => setSummary(e.target.value)} placeholder="Weekly magazine distribution across London" />
      </label>
      <label className="field">
        <span>Overview <em>optional</em></span>
        <textarea rows={4} value={overview} onChange={(e) => setOverview(e.target.value)} placeholder="Who they are, what we do for them, anything a new starter should know first." />
      </label>
      <div className="setform__grid two">
        <label className="field">
          <span>Account owner <em>optional</em></span>
          <select value={ownerUserId} onChange={(e) => setOwner(e.target.value)}>
            <option value="">No one</option>
            {(people.data ?? []).map((p) => <option key={p.user.id} value={p.user.id}>{p.user.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Website <em>optional</em></span>
          <input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://abcmagazines.co.uk" />
        </label>
        <label className="field">
          <span>Phone <em>optional</em></span>
          <input value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <label className="field">
          <span>Email <em>optional</em></span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="field">
        <span>Address <em>optional</em></span>
        <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <TagEditor tags={tags} suggestions={[]} onChange={setTags} />
    </Modal>
  );
}

/* ----------------------------------- SOPs ----------------------------------- */

export function SopEditorModal({
  accountId,
  sop,
  categories,
  onClose,
  onSaved,
  onToast,
}: {
  accountId: string;
  sop: AccountSop | null;
  categories: string[];
  onClose: () => void;
  onSaved: (sop: AccountSop) => void;
  onToast: (m: string) => void;
}) {
  const me = useMe();
  const isManager = me.data?.user.role === "admin" || me.data?.user.role === "manager";
  const [title, setTitle] = useState(sop?.title ?? "");
  const [category, setCategory] = useState(sop?.category ?? "General");
  const [summary, setSummary] = useState(sop?.summary ?? "");
  const [warnings, setWarnings] = useState(sop?.warnings ?? "");
  const [steps, setSteps] = useState<string[]>(sop?.steps.map((s) => s.text) ?? [""]);
  const [body, setBody] = useState(sop?.body ?? "");
  const [status, setStatus] = useState<SopStatus>(sop?.status ?? "active");
  const save = useAccountMutation(() => {
    const input = {
      title: title.trim(),
      category: category.trim() || "General",
      summary: summary.trim(),
      warnings: warnings.trim(),
      steps: steps.map((t) => t.trim()).filter(Boolean).map((text) => ({ text })),
      body,
      status,
    };
    return sop ? api.updateAccountSop(accountId, sop.id, input) : api.createAccountSop(accountId, input);
  });
  const cats = useMemo(() => [...new Set([...categories, ...SUGGESTED_SOP_CATEGORIES])], [categories]);

  const move = (i: number, d: -1 | 1) =>
    setSteps((s) => {
      const n = [...s];
      const j = i + d;
      if (j < 0 || j >= n.length) return s;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });

  return (
    <Modal
      title={sop ? `Edit SOP · v${sop.version}` : "New SOP"}
      onClose={onClose}
      wide
      onSubmit={() =>
        title.trim() &&
        save.mutate(undefined, {
          onSuccess: (s) => { onToast(sop ? `Saved — version ${s.version}` : "SOP added"); onSaved(s); },
          onError: (err) => onToast(errMessage(err, "Couldn't save the SOP")),
        })
      }
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={save.isPending || !title.trim()}>{sop ? "Save new version" : "Add SOP"}</button>
        </div>
      }
    >
      <div className="setform__grid two">
        <label className="field">
          <span>Title</span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="Weekly Magazine Distribution" required />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={category} list="org-sop-cats" onChange={(e) => setCategory(e.target.value)} />
          <datalist id="org-sop-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      </div>
      <label className="field">
        <span>When to use it <em>optional</em></span>
        <input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Every Thursday's magazine run, booked the day before" />
      </label>
      <label className="field">
        <span>Warnings <em>shown first, in red</em></span>
        <textarea rows={2} value={warnings} onChange={(e) => setWarnings(e.target.value)} placeholder="Only approved couriers. Never split the pallet." />
      </label>
      <div className="field">
        <span>Steps <em>read as a numbered checklist</em></span>
        <ol className="org-stepedit">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="org-stepedit__n">{i + 1}</span>
              <input value={s} onChange={(e) => setSteps((all) => all.map((x, j) => (j === i ? e.target.value : x)))} placeholder="What to do" />
              <button type="button" className="org-iconbtn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up"><ChevronUp /></button>
              <button type="button" className="org-iconbtn" onClick={() => move(i, 1)} disabled={i === steps.length - 1} aria-label="Move down"><ChevronDown /></button>
              <button type="button" className="org-iconbtn" onClick={() => setSteps((all) => all.filter((_, j) => j !== i))} aria-label="Remove step"><TrashIcon /></button>
            </li>
          ))}
        </ol>
        <button type="button" className="btn-ghost sm" onClick={() => setSteps((s) => [...s, ""])}><PlusIcon /> Add step</button>
      </div>
      <div className="field">
        <span>Detailed instructions <em>optional</em></span>
        <KnowledgeEditor value={body} onChange={setBody} label="Detailed instructions" placeholder="Anything the steps don't cover: contacts, exceptions, examples…" />
      </div>
      <label className="field">
        <span>Status</span>
        <select value={status} onChange={(e) => setStatus(e.target.value as SopStatus)}>
          <option value="active">Active — this is how it's done</option>
          <option value="draft">Draft — not shown as current yet</option>
          {(isManager || sop?.status === "archived") && <option value="archived">Archived — no longer used</option>}
        </select>
      </label>
    </Modal>
  );
}

/* ---------------------------------- notes ---------------------------------- */

export function NoteModal({ accountId, note, onClose, onToast }: {
  accountId: string;
  note: AccountNote | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [title, setTitle] = useState(note?.title ?? "");
  const [category, setCategory] = useState(note?.category ?? "General");
  const [body, setBody] = useState(note?.body ?? "");
  const save = useAccountMutation(() => {
    const input = { title: title.trim(), category: category.trim() || "General", body };
    return note ? api.updateAccountNote(accountId, note.id, input) : api.createAccountNote(accountId, input);
  });
  return (
    <Modal
      title={note ? "Edit note" : "New customer note"}
      onClose={onClose}
      wide
      onSubmit={() =>
        save.mutate(undefined, {
          onSuccess: () => { onToast(note ? "Note saved" : "Note added"); onClose(); },
          onError: (err) => onToast(errMessage(err, "Couldn't save the note")),
        })
      }
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={save.isPending || !body}>Save note</button>
        </div>
      }
    >
      <p className="capnote">Lasting knowledge about this customer — preferences, expectations, background. For something about one conversation, use a note in that conversation instead.</p>
      <div className="setform__grid two">
        <label className="field">
          <span>Title <em>optional</em></span>
          <input value={title} autoFocus onChange={(e) => setTitle(e.target.value)} placeholder="Communication preferences" />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} />
        </label>
      </div>
      <KnowledgeEditor value={body} onChange={setBody} label="Note" placeholder="Prefers WhatsApp; never call before 9am…" minHeight={140} />
    </Modal>
  );
}

/* -------------------------------- resources -------------------------------- */

export function ResourceModal({ accountId, resource, sops, onClose, onToast }: {
  accountId: string;
  resource: AccountResource | null;
  sops: AccountSop[];
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [kind, setKind] = useState<AccountResource["kind"]>(resource?.kind ?? "link");
  const [title, setTitle] = useState(resource?.title ?? "");
  const [description, setDescription] = useState(resource?.description ?? "");
  const [category, setCategory] = useState(resource?.category ?? "General");
  const [url, setUrl] = useState(resource?.url ?? "");
  const [instructions, setInstructions] = useState(resource?.instructions ?? "");
  const [sopId, setSopId] = useState(resource?.sopId ?? "");
  const [file, setFile] = useState<{ id: string; name: string } | null>(
    resource?.attachmentId ? { id: resource.attachmentId, name: resource.fileName ?? "File" } : null,
  );
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = useAccountMutation(() => {
    const href = url.trim() && !/^https?:\/\//i.test(url.trim()) ? `https://${url.trim()}` : url.trim();
    if (resource) {
      return api.updateAccountResource(accountId, resource.id, {
        title: title.trim(),
        description: description.trim(),
        category: category.trim() || "General",
        instructions: instructions.trim(),
        sopId: sopId || null,
        ...(resource.kind !== "file" ? { url: href } : {}),
      });
    }
    return api.createAccountResource(accountId, {
      kind,
      title: title.trim(),
      description: description.trim(),
      category: category.trim() || "General",
      url: kind === "file" ? null : href,
      instructions: instructions.trim(),
      attachmentId: kind === "file" ? file?.id ?? null : null,
      sopId: sopId || null,
    });
  });

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const att = await api.uploadMedia(f);
      setFile({ id: att.id, name: f.name });
      if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ""));
    } catch (err) {
      onToast(errMessage(err, "Upload failed"));
    } finally {
      setUploading(false);
    }
  };

  const valid = title.trim() && (kind === "file" ? !!file : !!url.trim());
  return (
    <Modal
      title={resource ? "Edit resource" : "Add a resource"}
      onClose={onClose}
      onSubmit={() =>
        valid &&
        save.mutate(undefined, {
          onSuccess: () => { onToast(resource ? "Saved" : "Added"); onClose(); },
          onError: (err) => onToast(errMessage(err, "Couldn't save")),
        })
      }
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={save.isPending || uploading || !valid}>Save</button>
        </div>
      }
    >
      {!resource && (
        <div className="pers-tabs" role="tablist" aria-label="Kind of resource">
          {(["link", "file", "app"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} className={"pers-tab" + (kind === k ? " on" : "")} onClick={() => setKind(k)}>
              {k === "link" ? "Link" : k === "file" ? "Document" : "External app"}
            </button>
          ))}
        </div>
      )}
      {kind === "file" ? (
        <div className="field">
          <span>File</span>
          <div className="org-upload">
            {file ? <b>{file.name}</b> : <span className="org-muted">{uploading ? "Uploading…" : "No file chosen"}</span>}
            {!resource && (
              <button type="button" className="btn-ghost sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {file ? "Replace" : "Choose file"}
              </button>
            )}
            <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
          </div>
        </div>
      ) : (
        <label className="field">
          <span>Web address</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={kind === "app" ? "https://www.routexl.com" : "https://docs.google.com/…"} required />
        </label>
      )}
      <div className="setform__grid two">
        <label className="field">
          <span>Name</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "app" ? "RouteXL" : kind === "file" ? "Drop list template" : "Booking portal"} required />
        </label>
        <label className="field">
          <span>Category</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Templates, Portals, Price lists…" />
        </label>
      </div>
      <label className="field">
        <span>What it is <em>optional</em></span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {(kind === "app" || instructions) && (
        <label className="field">
          <span>How to use it for this customer <em>optional</em></span>
          <textarea rows={3} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Import their CSV, optimise, export to the dispatch sheet." />
        </label>
      )}
      {sops.length > 0 && (
        <label className="field">
          <span>Goes with SOP <em>optional</em></span>
          <select value={sopId} onChange={(e) => setSopId(e.target.value)}>
            <option value="">None</option>
            {sops.filter((s) => s.status !== "archived").map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        </label>
      )}
    </Modal>
  );
}

/* ------------------------------ linking contacts ------------------------------ */

export function LinkContactModal({ accountId, linked, onClose, onToast }: {
  accountId: string;
  linked: AccountContact[];
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const contacts = useContacts();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [isPrimary, setPrimary] = useState(linked.length === 0);
  const link = useAccountMutation(() =>
    api.linkAccountContact(accountId, { contactId: picked!, role: role.trim() || null, department: department.trim() || null, isPrimary }),
  );
  const already = new Set(linked.map((l) => l.contactId));
  const list = (contacts.data ?? [])
    .filter((c) => !already.has(c.id) && !c.blocked)
    .filter((c) => {
      const s = q.trim().toLowerCase();
      return !s || [c.displayName, c.company, c.phone, c.email].some((v) => (v ?? "").toLowerCase().includes(s));
    })
    .slice(0, 50);
  const chosen = contacts.data?.find((c) => c.id === picked);

  return (
    <Modal
      title="Add a contact"
      onClose={onClose}
      onSubmit={() =>
        picked &&
        link.mutate(undefined, {
          onSuccess: () => { onToast(`${chosen?.displayName ?? "Contact"} added`); onClose(); },
          onError: (err) => onToast(errMessage(err, "Couldn't add the contact")),
        })
      }
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!picked || link.isPending}>Add to organisation</button>
        </div>
      }
    >
      {!picked ? (
        <>
          <div className="setsearch">
            <SearchIcon />
            <input value={q} autoFocus onChange={(e) => setQ(e.target.value)} placeholder="Search customers by name, number or email…" />
          </div>
          <div className="org-pick">
            {list.map((c) => (
              <button type="button" key={c.id} className="org-pick__row" onClick={() => setPicked(c.id)}>
                <Avatar name={c.displayName} email={c.email} color={c.avatarColor} className="av" />
                <span>
                  <b>{c.displayName}</b>
                  <small>{[c.phone, c.email].filter(Boolean).join(" · ") || "No contact details"}</small>
                </span>
              </button>
            ))}
            {contacts.data && list.length === 0 && <p className="org-muted">No customers match. Add them under Customers first.</p>}
          </div>
        </>
      ) : (
        <>
          <div className="org-pick__chosen">
            <b>{chosen?.displayName}</b>
            <button type="button" className="btn-ghost sm" onClick={() => setPicked(null)}>Change</button>
          </div>
          <div className="setform__grid two">
            <label className="field">
              <span>Role <em>optional</em></span>
              <input value={role} autoFocus onChange={(e) => setRole(e.target.value)} placeholder="Bookings Manager" />
            </label>
            <label className="field">
              <span>Department <em>optional</em></span>
              <input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Operations" />
            </label>
          </div>
          <label className="custblock">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(e.target.checked)} />
            <span><b>Primary contact</b><small>The first person to go to for this organisation.</small></span>
          </label>
        </>
      )}
    </Modal>
  );
}

/** Edit a contact's role at an organisation. */
export function ContactRoleModal({ accountId, link, onClose, onToast }: {
  accountId: string;
  link: AccountContact;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const [role, setRole] = useState(link.role ?? "");
  const [department, setDepartment] = useState(link.department ?? "");
  const [notes, setNotes] = useState(link.notes ?? "");
  const [isPrimary, setPrimary] = useState(link.isPrimary);
  const save = useAccountMutation(() =>
    api.updateAccountContact(accountId, link.contactId, { role: role.trim() || null, department: department.trim() || null, notes: notes.trim() || null, isPrimary }),
  );
  return (
    <Modal
      title={link.contact.displayName}
      onClose={onClose}
      onSubmit={() => save.mutate(undefined, { onSuccess: () => { onToast("Saved"); onClose(); }, onError: (err) => onToast(errMessage(err, "Couldn't save")) })}
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={save.isPending}>Save</button>
        </div>
      }
    >
      <div className="setform__grid two">
        <label className="field"><span>Role</span><input value={role} onChange={(e) => setRole(e.target.value)} /></label>
        <label className="field"><span>Department</span><input value={department} onChange={(e) => setDepartment(e.target.value)} /></label>
      </div>
      <label className="field"><span>Notes about them here <em>optional</em></span><textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <label className="custblock">
        <input type="checkbox" checked={isPrimary} onChange={(e) => setPrimary(e.target.checked)} />
        <span><b>Primary contact</b><small>The first person to go to for this organisation.</small></span>
      </label>
    </Modal>
  );
}
