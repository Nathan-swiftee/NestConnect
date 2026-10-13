import { useMemo, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { BulkContactsInput, Contact } from "@ding/schemas";
import { useAccounts, useMe, useMergeContacts } from "../hooks";
import { api } from "../lib/api";
import { Avatar } from "./Avatar";
import { TagIcon, TrashIcon, XIcon } from "../lib/icons";

/*
 * Customers › select: whatever you've ticked — related or not — merged into
 * one, tagged, put in an organisation, blocked, or deleted, in one go.
 */

/** The most that can be merged at once: past this it's a cleanup job, not a merge. */
export const MERGE_MAX = 20;

type Dialog = "merge" | "tag" | "org" | null;

export function CustomerBulkBar({
  selected,
  suggestions,
  shown,
  onSelectShown,
  onClear,
  onToast,
}: {
  /** The ticked customers (that still exist). */
  selected: Contact[];
  /** Every tag in the directory, offered when adding one. */
  suggestions: string[];
  /** How many the current filters show, for "Select all". */
  shown: number;
  onSelectShown: () => void;
  onClear: () => void;
  onToast: (m: string) => void;
}) {
  const qc = useQueryClient();
  const role = useMe().data?.user.role;
  const canDelete = role === "admin" || role === "manager";
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const n = selected.length;
  const allBlocked = n > 0 && selected.every((c) => c.blocked);

  const run = async (input: BulkContactsInput, said: (done: number) => string) => {
    setBusy(true);
    try {
      const res = await api.bulkContacts(input);
      onToast(said(res.done));
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["contact-duplicates"] });
      if (input.action === "delete") {
        qc.invalidateQueries({ queryKey: ["conversations"] });
        qc.invalidateQueries({ queryKey: ["views"] });
        onClear();
      }
      return true;
    } catch (err) {
      onToast(err instanceof Error && err.message ? err.message : "Couldn't do that");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const block = () => {
    const blocked = !allBlocked;
    if (blocked && !window.confirm(`Block ${people(n)}? Their messages stop reaching the inbox until they're unblocked.`)) return;
    void run({ action: "block", ids: selected.map((c) => c.id), blocked }, (d) =>
      d ? `${people(d)} ${blocked ? "blocked" : "unblocked"}${d < n ? ` (${n - d} already were)` : ""}` : `They're all ${blocked ? "blocked" : "unblocked"} already`,
    );
  };
  const remove = () => {
    if (!window.confirm(`Delete ${people(n)} and everything attached to them — their conversations included? This can't be undone.`)) return;
    void run({ action: "delete", ids: selected.map((c) => c.id) }, (d) => `${people(d)} deleted`);
  };

  return (
    <>
      <div className="custbulk" role="toolbar" aria-label="Selected customers">
        <span className="custbulk__n">
          <b>{n}</b> selected
        </span>
        {shown > n && (
          <button type="button" className="custbulk__link" onClick={onSelectShown}>
            Select all {shown}
          </button>
        )}
        <button type="button" className="custbulk__link" onClick={onClear}>
          Clear
        </button>
        <span className="custbulk__acts">
          <button
            type="button"
            className="btn-ghost"
            disabled={busy || n < 2 || n > MERGE_MAX}
            title={n < 2 ? "Select two or more to merge them" : n > MERGE_MAX ? `Merge up to ${MERGE_MAX} at a time` : "Merge into one customer"}
            onClick={() => setDialog("merge")}
          >
            Merge
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDialog("tag")}>
            <TagIcon /> Tag
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={() => setDialog("org")}>
            Organisation
          </button>
          <button type="button" className="btn-ghost" disabled={busy} onClick={block}>
            {allBlocked ? "Unblock" : "Block"}
          </button>
          {canDelete && (
            <button type="button" className="btn-ghost custbulk__danger" disabled={busy} onClick={remove}>
              <TrashIcon /> Delete
            </button>
          )}
        </span>
      </div>
      {dialog === "merge" && <MergeDialog selected={selected} onClose={() => setDialog(null)} onDone={onClear} onToast={onToast} />}
      {dialog === "tag" && <TagDialog selected={selected} suggestions={suggestions} onClose={() => setDialog(null)} run={run} />}
      {dialog === "org" && <OrgDialog selected={selected} onClose={() => setDialog(null)} onToast={onToast} />}
    </>
  );
}

function people(n: number): string {
  return `${n} customer${n === 1 ? "" : "s"}`;
}

function BulkModal({
  title,
  onClose,
  onSubmit,
  children,
  submit,
  busy,
}: {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  submit: string;
  busy?: boolean;
}) {
  const go = (e: FormEvent) => {
    e.preventDefault();
    onSubmit();
  };
  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box custbulk__modal" onClick={(e) => e.stopPropagation()} onSubmit={go}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {submit}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Merge whatever's ticked into the one you keep — they needn't share a number or email. */
function MergeDialog({
  selected,
  onClose,
  onDone,
  onToast,
}: {
  selected: Contact[];
  onClose: () => void;
  onDone: () => void;
  onToast: (m: string) => void;
}) {
  const merge = useMergeContacts();
  // The one with the most to it is the likeliest keeper.
  const [keep, setKeep] = useState(() => {
    const score = (c: Contact) => (c.phone ? 1 : 0) + (c.email ? 1 : 0) + (c.tags?.length ?? 0) / 10;
    return [...selected].sort((a, b) => score(b) - score(a))[0]!.id;
  });
  const winner = selected.find((c) => c.id === keep)!;
  const losers = selected.filter((c) => c.id !== keep);
  const submit = () =>
    merge.mutate(
      { winnerId: keep, loserIds: losers.map((c) => c.id) },
      {
        onSuccess: (res) => {
          onToast(`Merged ${people(losers.length + 1)} into ${res.contact.displayName}`);
          onDone();
          onClose();
        },
        onError: (err) => onToast(err instanceof Error && err.message ? err.message : "Couldn't merge them"),
      },
    );
  return (
    <BulkModal
      title={`Merge ${people(selected.length)}`}
      onClose={onClose}
      onSubmit={submit}
      busy={merge.isPending}
      submit={merge.isPending ? "Merging…" : `Merge into ${winner.displayName}`}
    >
      <p className="fieldhint">
        Pick the one to keep. The others' conversations, numbers, emails, tags and organisations move onto it, and they're
        deleted. This can't be undone.
      </p>
      <div className="custbulk__list" role="radiogroup" aria-label="Customer to keep">
        {selected.map((c) => (
          <label key={c.id} className={"custbulk__pick" + (c.id === keep ? " on" : "")}>
            <input type="radio" name="keep" checked={c.id === keep} onChange={() => setKeep(c.id)} />
            <Avatar name={c.displayName} email={c.email} color={c.avatarColor} className="av custbulk__av" />
            <span className="custbulk__who">
              <b>{c.displayName}</b>
              <small>{[c.phone, c.email].filter(Boolean).join(" · ") || "No number or email"}</small>
            </span>
            {c.id === keep && <span className="custbulk__keep">Keep</span>}
          </label>
        ))}
      </div>
    </BulkModal>
  );
}

/** Add a tag to everyone ticked, or take one off — leaving their other tags alone. */
function TagDialog({
  selected,
  suggestions,
  onClose,
  run,
}: {
  selected: Contact[];
  suggestions: string[];
  onClose: () => void;
  run: (input: BulkContactsInput, said: (done: number) => string) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Taking off: the tags they actually have between them.
  const onThem = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of selected) for (const t of c.tags ?? []) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  }, [selected]);
  const tags = text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const submit = async () => {
    if (!tags.length) return;
    setBusy(true);
    const ids = selected.map((c) => c.id);
    const label = tags.join(", ");
    const rest = (d: number) => ids.length - d;
    const ok = await run(mode === "add" ? { action: "tag", ids, add: tags } : { action: "tag", ids, remove: tags }, (d) =>
      mode === "add"
        ? d
          ? `Tagged ${people(d)} “${label}”${rest(d) ? ` (${rest(d)} already had it)` : ""}`
          : `They all have “${label}” already`
        : d
          ? `Took “${label}” off ${people(d)}${rest(d) ? ` (${rest(d)} didn't have it)` : ""}`
          : `None of them have “${label}”`,
    );
    setBusy(false);
    if (ok) onClose();
  };
  return (
    <BulkModal
      title={`Tag ${people(selected.length)}`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy || !tags.length}
      submit={mode === "add" ? "Add tag" : "Take off"}
    >
      <div className="custbulk__seg" role="radiogroup" aria-label="Add or take off">
        <button type="button" role="radio" aria-checked={mode === "add"} className={mode === "add" ? "on" : ""} onClick={() => setMode("add")}>
          Add
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "remove"}
          className={mode === "remove" ? "on" : ""}
          onClick={() => setMode("remove")}
          disabled={!onThem.length}
        >
          Take off
        </button>
      </div>
      <label className="field">
        <span>{mode === "add" ? "Tag (separate several with commas)" : "Tag to take off"}</span>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder={mode === "add" ? "VIP, Wholesale" : ""} autoFocus list="custbulk-tags" />
      </label>
      <datalist id="custbulk-tags">
        {(mode === "add" ? suggestions : onThem).map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      {mode === "remove" && (
        <div className="custbulk__chips">
          {onThem.map((t) => (
            <button key={t} type="button" className={"setfilterchip" + (tags.some((x) => x.toLowerCase() === t.toLowerCase()) ? " on" : "")} onClick={() => setText(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      <p className="fieldhint">Their other tags stay as they are.</p>
    </BulkModal>
  );
}

/** Put everyone ticked in an organisation (already there: left as they are). */
function OrgDialog({ selected, onClose, onToast }: { selected: Contact[]; onClose: () => void; onToast: (m: string) => void }) {
  const qc = useQueryClient();
  const accounts = useAccounts();
  const [accountId, setAccountId] = useState("");
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => [...(accounts.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [accounts.data]);
  const submit = async () => {
    if (!accountId) return;
    setBusy(true);
    try {
      const ids = selected.map((c) => c.id);
      // The organisation takes up to 200 at a time.
      for (let i = 0; i < ids.length; i += 200) await api.linkAccountContacts(accountId, { contactIds: ids.slice(i, i + 200) });
      onToast(`${people(ids.length)} added to ${list.find((a) => a.id === accountId)?.name ?? "the organisation"}`);
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["account"] });
      qc.invalidateQueries({ queryKey: ["contact-accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      onClose();
    } catch (err) {
      onToast(err instanceof Error && err.message ? err.message : "Couldn't add them");
    } finally {
      setBusy(false);
    }
  };
  return (
    <BulkModal
      title={`Add ${people(selected.length)} to an organisation`}
      onClose={onClose}
      onSubmit={submit}
      busy={busy || !accountId}
      submit={busy ? "Adding…" : "Add"}
    >
      <label className="field">
        <span>Organisation</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} required autoFocus>
          <option value="">{accounts.isLoading ? "Loading…" : list.length ? "Choose an organisation" : "No organisations yet"}</option>
          {list.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <p className="fieldhint">Anyone already in it stays as they are; the rest join it, keeping any other organisations they're in.</p>
    </BulkModal>
  );
}
