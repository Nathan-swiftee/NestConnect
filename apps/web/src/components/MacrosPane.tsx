import { useMemo, useRef, useState, type FormEvent } from "react";
import type { Macro, Team } from "@ding/schemas";
import { MACRO_PREVIEW_FILL, macroFitsTeams, resolveTemplateDefault, searchMacros, TEMPLATE_TOKENS } from "@ding/schemas";
import { api } from "../lib/api";
import { useMacroMutation, useMacros, useMe, useTeams } from "../hooks";
import { CopyIcon, EditIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from "../lib/icons";

/**
 * Settings › Macros — saved replies an agent drops into the composer with "/"
 * or the Macros button, then edits before sending.
 *
 * Each macro belongs to team inboxes; none ticked means every team. Admins and
 * managers write them, everybody else reads the list so they know what's there.
 */

/** "Every team" — a filter value that can't collide with a team id. */
const EVERY = "__every__";

type Draft = { name: string; shortcut: string; body: string; teamIds: string[] };

const EMPTY: Draft = { name: "", shortcut: "", body: "", teamIds: [] };

export function MacrosPane({ onToast }: { onToast: (msg: string) => void }) {
  const macros = useMacros();
  const teams = useTeams();
  const me = useMe();
  const role = me.data?.user.role;
  const canEdit = role === "admin" || role === "manager";
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  /** The form: a macro being edited, or a new one (possibly a duplicate). */
  const [form, setForm] = useState<{ id: string | null; draft: Draft } | null>(null);
  const remove = useMacroMutation((id: string) => api.deleteMacro(id));

  const teamName = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t.name])), [teams.data]);
  const list = useMemo(() => {
    const all = macros.data ?? [];
    const byTeam =
      team === EVERY ? all.filter((m) => m.teamIds.length === 0) : team ? all.filter((m) => macroFitsTeams(m, [team])) : all;
    return searchMacros(byTeam, q);
  }, [macros.data, q, team]);

  const teamsLabel = (m: Macro) =>
    m.teamIds.length === 0
      ? "Every team"
      : m.teamIds
          .map((id) => teamName.get(id))
          .filter(Boolean)
          .join(", ");

  const del = (m: Macro) => {
    if (!window.confirm(`Delete “${m.name}”? Agents will no longer be able to use it.`)) return;
    remove.mutate(m.id, {
      onSuccess: () => {
        setForm(null);
        onToast(`Macro “${m.name}” deleted`);
      },
      onError: (err) => onToast(err instanceof Error ? err.message : "Couldn’t delete the macro"),
    });
  };
  const duplicate = (m: Macro) =>
    setForm({ id: null, draft: { name: `${m.name} (copy)`.slice(0, 80), shortcut: "", body: m.body, teamIds: [...m.teamIds] } });
  const edit = (m: Macro) =>
    setForm({ id: m.id, draft: { name: m.name, shortcut: m.shortcut ?? "", body: m.body, teamIds: [...m.teamIds] } });

  const total = macros.data?.length ?? 0;

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>
            Macros <span className="setcount">{total}</span>
          </h2>
          <p>
            Saved replies for the composer. Type <code>/</code> and the shortcut — or press <b>Macros</b> — and the text drops
            into the reply box, ready to edit before it’s sent. Placeholders like <code>{"{{contact.first_name}}"}</code> fill in
            for the conversation. Each macro shows in the team inboxes you pick; pick none and every team gets it.
          </p>
        </div>
        {canEdit && (
          <div className="setpane__headacts">
            <button className="btn-primary" type="button" onClick={() => setForm({ id: null, draft: EMPTY })}>
              <PlusIcon /> New macro
            </button>
          </div>
        )}
      </div>

      {total > 0 && (
        <div className="setbar">
          <div className="setsearch">
            <SearchIcon />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, shortcut or text…" aria-label="Search macros" />
          </div>
          <div className="routesel macro-teamfilter">
          <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Filter by team inbox">
            <option value="">All team inboxes</option>
            <option value={EVERY}>Every team only</option>
            {(teams.data ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="dwrap">
          <div className="dtable dtable--macro">
            <div className="dtable__head">
              <span>Name</span>
              <span>Team inboxes</span>
              <span>Text</span>
              <span />
            </div>
            {list.map((m) => (
              <div className="dtable__row dtable__row--static" key={m.id}>
                <span className="dcell dcell__t">
                  {m.name}
                  {m.shortcut && <span className="macro-sc">/{m.shortcut}</span>}
                </span>
                <span className={"dcell" + (m.teamIds.length === 0 ? " dcell--muted" : "")} title={teamsLabel(m)}>
                  {teamsLabel(m)}
                </span>
                <span className="dcell dcell--muted" title={m.body}>
                  {m.body}
                </span>
                <span className="dcell dacts">
                  {canEdit && (
                    <>
                      <button className="iconbtn" type="button" title="Duplicate" aria-label={`Duplicate ${m.name}`} onClick={() => duplicate(m)}>
                        <CopyIcon />
                      </button>
                      <button className="iconbtn" type="button" title="Edit macro" aria-label={`Edit ${m.name}`} onClick={() => edit(m)}>
                        <EditIcon />
                      </button>
                      <button className="iconbtn danger" type="button" title="Delete macro" aria-label={`Delete ${m.name}`} onClick={() => del(m)}>
                        <TrashIcon />
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))}
            {list.length === 0 && <div className="dtable__empty">No macros match.</div>}
          </div>
        </div>
      )}

      {macros.isSuccess && total === 0 && (
        <div className="setzero">
          <p>
            {canEdit
              ? "No macros yet. Create one for the replies your team types over and over — a delay notice, opening hours, a returns link."
              : "No macros yet. An admin or manager can add them here."}
          </p>
        </div>
      )}

      {form && (
        <MacroForm
          id={form.id}
          initial={form.draft}
          teams={teams.data ?? []}
          onClose={() => setForm(null)}
          onDelete={form.id ? () => del(macros.data!.find((m) => m.id === form.id)!) : undefined}
          onToast={onToast}
        />
      )}
    </div>
  );
}

function MacroForm({
  id,
  initial,
  teams,
  onClose,
  onDelete,
  onToast,
}: {
  id: string | null;
  initial: Draft;
  teams: Team[];
  onClose: () => void;
  onDelete?: () => void;
  onToast: (msg: string) => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const create = useMacroMutation((input: Draft) => api.createMacro(input));
  const update = useMacroMutation((input: Draft) => api.updateMacro(id!, input));
  const pending = create.isPending || update.isPending;
  const set = (patch: Partial<Draft>) => {
    setD((x) => ({ ...x, ...patch }));
    setError(null);
  };
  const shortcut = d.shortcut.trim().replace(/^\/+/, "").toLowerCase();
  const shortcutOk = shortcut === "" || /^[a-z0-9][a-z0-9_-]{0,31}$/.test(shortcut);
  const valid = d.name.trim().length > 0 && d.body.trim().length > 0 && shortcutOk;
  const toggleTeam = (t: string) => set({ teamIds: d.teamIds.includes(t) ? d.teamIds.filter((x) => x !== t) : [...d.teamIds, t] });

  /** A placeholder at the caret, like the template pre-fill menu. */
  const insert = (token: string) => {
    const el = bodyRef.current;
    const at = el?.selectionStart ?? d.body.length;
    const end = el?.selectionEnd ?? at;
    set({ body: `${d.body.slice(0, at)}{{${token}}}${d.body.slice(end)}` });
    requestAnimationFrame(() => {
      el?.focus();
      const caret = at + token.length + 4;
      el?.setSelectionRange(caret, caret);
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || pending) return;
    const input = { ...d, name: d.name.trim(), shortcut, body: d.body.trim() };
    const done = {
      onSuccess: () => {
        onToast(id ? "Macro updated" : `Macro “${input.name}” created`);
        onClose();
      },
      onError: (err: unknown) => setError(err instanceof Error ? err.message : "Couldn’t save the macro"),
    };
    if (id) update.mutate(input, done);
    else create.mutate(input, done);
  };

  const preview = d.body.trim() ? resolveTemplateDefault(d.body, MACRO_PREVIEW_FILL) : "";

  return (
    <div className="modal" onClick={onClose}>
      <form
        className="modal__box modal--form"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-label={id ? "Edit macro" : "New macro"}
      >
        <div className="modal__head">
          <h2>{id ? "Edit macro" : "New macro"}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">
          <div className="setform__grid two">
            <label className="field">
              <span>Name</span>
              <input value={d.name} autoFocus maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder="Delivery delayed" />
            </label>
            <label className="field">
              <span>
                Shortcut <em>optional</em>
              </span>
              <div className="macro-scfield">
                <span aria-hidden>/</span>
                <input
                  value={d.shortcut.replace(/^\/+/, "")}
                  maxLength={33}
                  autoComplete="off"
                  onChange={(e) => set({ shortcut: e.target.value })}
                  placeholder="delayed"
                  aria-label="Shortcut"
                />
              </div>
              <small className="fieldhint">
                {shortcutOk ? "Typed after / in the reply box." : "Letters, numbers, - or _ only, no spaces."}
              </small>
            </label>
          </div>
          <label className="field">
            <span>Text</span>
            <textarea
              ref={bodyRef}
              value={d.body}
              rows={6}
              maxLength={4000}
              onChange={(e) => set({ body: e.target.value })}
              placeholder={"Hi {{contact.first_name}}, sorry — your delivery is running late. …"}
            />
          </label>
          <div className="macro-tokens" aria-label="Insert a placeholder">
            {TEMPLATE_TOKENS.map((t) => (
              <button key={t.token} type="button" className="setfilterchip" onClick={() => insert(t.token)}>
                {t.label}
              </button>
            ))}
          </div>
          {preview && (
            <div className="macro-preview">
              <span>Preview</span>
              <p>{preview}</p>
            </div>
          )}
          <div className="field">
            <span>Team inboxes</span>
            <div className="checks">
              {teams.map((t) => (
                <label key={t.id} className={"check" + (d.teamIds.includes(t.id) ? " on" : "")}>
                  <input type="checkbox" checked={d.teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
            <small className="fieldhint">
              {d.teamIds.length === 0
                ? "None ticked — every team gets this macro."
                : "Shown in conversations for these teams. A conversation nobody's picked up yet uses its channel's teams."}
            </small>
          </div>
          {error && (
            <p className="macro-err" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className={"modal__foot" + (onDelete ? " modal__foot--split" : "")}>
          {onDelete && (
            <button type="button" className="btn-ghost btn-danger" onClick={onDelete}>
              <TrashIcon /> Delete
            </button>
          )}
          <div className="setform__footactions">
            <button className="btn-ghost" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" type="submit" disabled={!valid || pending}>
              {id ? "Save changes" : "Create macro"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
