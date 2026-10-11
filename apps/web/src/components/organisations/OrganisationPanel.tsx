import { useEffect, useState } from "react";
import type { AccountSop } from "@ding/schemas";
import { api } from "../../lib/api";
import { useAccountMutation, useAccounts, useContactAccounts, useConversationAccount } from "../../hooks";
import { ChevronRight, OrganisationsIcon, PlusIcon, SearchIcon, XIcon, DocIcon } from "../../lib/icons";
import { AccountFormModal } from "./forms";
import { AlertList, ResourceLink, SopReader } from "./shared";

/**
 * Find an organisation to link a contact to, or start a new one with the name
 * typed. Archived organisations aren't offered.
 */
function AccountPicker({ exclude, onPick, onCreate, onCancel }: {
  exclude: string[];
  onPick: (accountId: string) => void;
  onCreate: (name: string) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 200);
    return () => window.clearTimeout(t);
  }, [q]);
  const list = useAccounts({ search: debounced || undefined });
  const rows = (list.data ?? []).filter((a) => !exclude.includes(a.id)).slice(0, 8);
  return (
    <div className="org-picker">
      <div className="setsearch">
        <SearchIcon />
        <input
          value={q}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          // Enter mustn't submit a form this sits in (a customer's profile).
          onKeyDown={(e) => { if (e.key === "Enter") e.preventDefault(); }}
          placeholder="Search organisations…"
          aria-label="Search organisations"
        />
        <button type="button" className="org-iconbtn" onClick={onCancel} aria-label="Cancel"><XIcon /></button>
      </div>
      <div className="org-picker__list">
        {rows.map((a) => (
          <button key={a.id} type="button" onClick={() => onPick(a.id)}>
            <b>{a.name}</b>
            {a.reference && <small>{a.reference}</small>}
          </button>
        ))}
        {list.data && rows.length === 0 && debounced && <p className="org-muted">No organisation called “{debounced}”.</p>}
        <button type="button" className="org-picker__new" onClick={() => onCreate(q.trim())}>
          <PlusIcon /> {q.trim() ? `Create “${q.trim()}”` : "Create a new organisation"}
        </button>
      </div>
    </div>
  );
}

/**
 * The organisation beside a conversation: who this customer is, what everyone
 * must know (pinned instructions first), how their work is done, and where the
 * tools are. With several organisations and none chosen it asks rather than
 * guessing; with none it offers to link or create one.
 */
export function OrganisationBlock({
  conversationId,
  onOpenOrganisation,
  onToast,
}: {
  conversationId: string;
  onOpenOrganisation: (accountId: string) => void;
  onToast: (m: string) => void;
}) {
  const ctx = useConversationAccount(conversationId);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [reading, setReading] = useState<AccountSop | null>(null);
  const [changing, setChanging] = useState(false);
  const [moreRes, setMoreRes] = useState(false);
  const choose = useAccountMutation((accountId: string | null) => api.setConversationAccount(conversationId, accountId));
  const link = useAccountMutation((v: { accountId: string; contactId: string }) => api.linkAccountContact(v.accountId, { contactId: v.contactId }));

  useEffect(() => {
    setPicking(false);
    setChanging(false);
    setReading(null);
    setMoreRes(false);
  }, [conversationId]);

  if (ctx.isLoading) return <div className="psec org-psec"><div className="t">Organisation</div><p className="org-muted">Loading…</p></div>;
  if (ctx.isError || !ctx.data) return null;
  const c = ctx.data;
  const acc = c.account;

  const pick = (accountId: string) =>
    choose.mutate(accountId, { onSuccess: () => setChanging(false), onError: (err) => onToast((err as Error).message) });

  const linkContact = (accountId: string) =>
    link.mutate({ accountId, contactId: c.contactId }, {
      onSuccess: () => { setPicking(false); onToast("Linked"); },
      onError: (err) => onToast((err as Error).message),
    });

  const picker = picking && (
    <AccountPicker
      exclude={c.linked.map((l) => l.account.id)}
      onPick={linkContact}
      onCreate={(name) => { setPicking(false); setCreating(name || ""); }}
      onCancel={() => setPicking(false)}
    />
  );

  return (
    <div className="psec org-psec">
      <div className="t">Organisation</div>

      {/* Several organisations, none chosen: ask. */}
      {(c.needsChoice || changing) && (
        <div className="org-choose" role="group" aria-label="Which organisation is this conversation about?">
          <p>{c.needsChoice ? "This contact works with more than one organisation. Which is this conversation about?" : "Which organisation is this conversation about?"}</p>
          {c.linked.map((l) => (
            <button key={l.account.id} type="button" className={"org-choose__opt" + (acc?.account.id === l.account.id ? " on" : "")} disabled={choose.isPending} onClick={() => pick(l.account.id)}>
              <b>{l.account.name}</b>
              <small>{l.link.role ?? l.account.summary ?? ""}</small>
            </button>
          ))}
          {changing && <button type="button" className="btn-ghost sm" onClick={() => setChanging(false)}>Cancel</button>}
        </div>
      )}

      {/* No organisation. */}
      {!acc && !c.needsChoice && (
        picking ? picker : (
          <div className="org-none">
            <p className="org-muted">Not linked to an organisation.</p>
            <div className="org-none__acts">
              <button type="button" className="btn-ghost sm" onClick={() => setPicking(true)}><OrganisationsIcon /> Link to organisation</button>
            </div>
          </div>
        )
      )}

      {acc && !changing && (
        <div className="org-ctx">
          <button type="button" className="org-ctx__head" onClick={() => onOpenOrganisation(acc.account.id)} title="Open the full organisation profile">
            <span className="org-mark" aria-hidden="true">{acc.account.name.slice(0, 1).toUpperCase()}</span>
            <span className="org-ctx__name">
              <b>{acc.account.name}</b>
              <small>{[acc.link?.role, acc.account.reference].filter(Boolean).join(" · ") || acc.account.summary || "Customer organisation"}</small>
            </span>
            <ChevronRight />
          </button>
          {c.basis === "chosen" && !c.linked.some((l) => l.account.id === acc.account.id) && (
            <p className="org-muted org-ctx__note">Chosen for this conversation; this contact isn't linked to it any more.</p>
          )}

          <AlertList alerts={acc.alerts} compact />

          {acc.account.summary && acc.link?.role && <p className="org-ctx__summary">{acc.account.summary}</p>}

          {acc.sops.length > 0 && (
            <div className="org-ctx__sec">
              <div className="org-ctx__label">How we serve them</div>
              {acc.sops.map((s) => (
                <button key={s.id} type="button" className="org-ctx__sop" onClick={() => setReading(s)}>
                  <DocIcon />
                  <span><b>{s.title}</b><small>{s.category}</small></span>
                </button>
              ))}
            </div>
          )}

          {acc.resources.length > 0 && (
            <div className="org-ctx__sec">
              <div className="org-ctx__label">Resources</div>
              {(moreRes ? acc.resources : acc.resources.slice(0, 4)).map((r) => <ResourceLink key={r.id} r={r} />)}
              {acc.resources.length > 4 && (
                <button type="button" className="org-linkbtn" onClick={() => setMoreRes((v) => !v)}>
                  {moreRes ? "Show fewer" : `${acc.resources.length - 4} more`}
                </button>
              )}
            </div>
          )}

          {!acc.alerts.length && !acc.sops.length && !acc.resources.length && (
            <p className="org-muted">No instructions or procedures recorded yet.</p>
          )}

          <div className="org-ctx__foot">
            <button type="button" className="cact cact--primary" onClick={() => onOpenOrganisation(acc.account.id)}>
              Open organisation{acc.noteCount ? ` · ${acc.noteCount} note${acc.noteCount === 1 ? "" : "s"}` : ""}
            </button>
            {c.linked.length > 1 && <button type="button" className="org-linkbtn" onClick={() => setChanging(true)}>Change</button>}
            {c.basis === "chosen" && c.linked.length <= 1 && (
              <button type="button" className="org-linkbtn" onClick={() => choose.mutate(null)}>Clear</button>
            )}
            {!picking && <button type="button" className="org-linkbtn" onClick={() => setPicking(true)}><PlusIcon /> Link another</button>}
          </div>
          {picker}
        </div>
      )}

      {reading && (
        <SopReader accountId={reading.accountId} sop={reading} resources={acc?.resources ?? []} onClose={() => setReading(null)} />
      )}
      {creating !== null && (
        <AccountFormModal
          account={null}
          initialName={creating}
          linkContactId={c.contactId}
          onClose={() => setCreating(null)}
          onSaved={(a) => { setCreating(null); if (c.linked.length >= 1) pick(a.id); }}
          onOpenExisting={(id) => { setCreating(null); linkContact(id); }}
          onToast={onToast}
          key={creating}
        />
      )}
    </div>
  );
}

/** A contact's organisations, on their customer profile. */
export function ContactOrganisations({ contactId, onOpenOrganisation, onToast }: {
  contactId: string;
  onOpenOrganisation: (accountId: string) => void;
  onToast: (m: string) => void;
}) {
  const list = useContactAccounts(contactId);
  const [picking, setPicking] = useState(false);
  const [creating, setCreating] = useState(false);
  const link = useAccountMutation((accountId: string) => api.linkAccountContact(accountId, { contactId }));
  const unlink = useAccountMutation((accountId: string) => api.unlinkAccountContact(accountId, contactId));
  const rows = list.data ?? [];
  return (
    <div className="field">
      <span>Organisations {rows.length > 0 && `· ${rows.length}`}</span>
      {rows.length === 0 && !picking && <p className="custconvs__empty">{list.isLoading ? "Loading…" : "Not linked to an organisation."}</p>}
      <div className="org-contactorgs">
        {rows.map((r) => (
          <div key={r.account.id} className="org-contactorg">
            <button type="button" className="org-contactorg__main" onClick={() => onOpenOrganisation(r.account.id)}>
              <b>{r.account.name}</b>
              <small>{[r.link.role, r.link.isPrimary ? "Primary contact" : null].filter(Boolean).join(" · ") || r.account.summary || "Open organisation"}</small>
            </button>
            <button
              type="button"
              className="org-iconbtn"
              aria-label={`Remove from ${r.account.name}`}
              onClick={() =>
                window.confirm(`Remove this contact from ${r.account.name}? Their conversations stay as they are.`) &&
                unlink.mutate(r.account.id, { onError: (err) => onToast((err as Error).message) })
              }
            >
              <XIcon />
            </button>
          </div>
        ))}
      </div>
      {picking ? (
        <AccountPicker
          exclude={rows.map((r) => r.account.id)}
          onPick={(id) => link.mutate(id, { onSuccess: () => { setPicking(false); onToast("Linked"); }, onError: (err) => onToast((err as Error).message) })}
          onCreate={() => { setPicking(false); setCreating(true); }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <button type="button" className="btn-ghost sm org-addorg" onClick={() => setPicking(true)}><PlusIcon /> Add to organisation</button>
      )}
      {creating && (
        <AccountFormModal
          account={null}
          linkContactId={contactId}
          onClose={() => setCreating(false)}
          onSaved={() => setCreating(false)}
          onOpenExisting={(id) => { setCreating(false); link.mutate(id); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
