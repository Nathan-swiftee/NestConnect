import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { OpsSop, OpsSopInput } from "@ding/schemas";
import { OPS_COLORS, OPS_TEMPLATES, splitIntoSteps } from "@ding/schemas";
import { api } from "../../lib/api";
import { useOpsLibrary, useOpsMutation, useOpsSop, usePeople, useTeams } from "../../hooks";
import { BackIcon, DocIcon, GripIcon, ImageIcon, LinkIcon, PlusIcon, TrashIcon, XIcon } from "../../lib/icons";
import { KnowledgeEditor } from "../organisations/KnowledgeEditor";
import { CollectionModal, ColorPicker, IconPicker } from "./OpsCollections";
import { PublishModal } from "./OpsReader";
import { errMessage, OpsModal, OpsTile, periodLabel } from "./parts";

interface StepDraft {
  key: number;
  text: string;
  imageUrl: string | null;
  link: string | null;
}
interface ResourceDraft {
  key: number;
  kind: "link" | "file";
  title: string;
  url: string;
}
interface Draft {
  title: string;
  icon: string;
  color: string;
  summary: string;
  warnings: string;
  steps: StepDraft[];
  body: string;
  resources: ResourceDraft[];
  collectionId: string | null;
  teamIds: string[];
  allTeams: boolean;
  mustRead: boolean;
  reviewEveryMonths: number | null;
  ownerUserId: string | null;
}

let seq = 0;
const nextKey = () => ++seq;
const REVIEW_PERIODS = [1, 3, 6, 12, 24];

function fromSop(s: OpsSop): Draft {
  return {
    title: s.title,
    icon: s.icon,
    color: s.color,
    summary: s.summary,
    warnings: s.warnings,
    steps: s.steps.map((x) => ({ key: nextKey(), text: x.text, imageUrl: x.imageUrl ?? null, link: x.link ?? null })),
    body: s.body,
    resources: s.resources.map((r) => ({ key: nextKey(), kind: r.kind, title: r.title, url: r.url })),
    collectionId: s.collectionId,
    teamIds: s.teamIds,
    allTeams: s.allTeams,
    mustRead: s.mustRead,
    reviewEveryMonths: s.reviewEveryMonths,
    ownerUserId: s.owner?.id ?? null,
  };
}

function fromTemplate(key: string): Draft {
  const t = OPS_TEMPLATES.find((x) => x.key === key) ?? OPS_TEMPLATES[0]!;
  return {
    title: "",
    icon: t.icon,
    color: OPS_COLORS[0],
    summary: t.summary,
    warnings: t.warnings,
    steps: (t.steps.length ? t.steps : [""]).map((text) => ({ key: nextKey(), text, imageUrl: null, link: null })),
    body: "",
    resources: [],
    collectionId: null,
    teamIds: [],
    allTeams: false,
    mustRead: false,
    reviewEveryMonths: null,
    ownerUserId: null,
  };
}

function toInput(d: Draft): OpsSopInput {
  return {
    title: d.title.trim(),
    icon: d.icon,
    color: d.color,
    summary: d.summary.trim(),
    warnings: d.warnings.trim(),
    steps: d.steps
      .filter((s) => s.text.trim())
      .map((s) => ({ text: s.text.trim(), imageUrl: s.imageUrl, link: s.link?.trim() ? normaliseLink(s.link.trim()) : null })),
    body: d.body,
    resources: d.resources.filter((r) => r.title.trim() && r.url.trim()).map((r) => ({ kind: r.kind, title: r.title.trim(), url: r.kind === "link" ? normaliseLink(r.url.trim()) : r.url })),
    collectionId: d.collectionId,
    teamIds: d.allTeams ? [] : d.teamIds,
    allTeams: d.allTeams,
    mustRead: d.mustRead,
    reviewEveryMonths: d.reviewEveryMonths,
    ...(d.ownerUserId ? { ownerUserId: d.ownerUserId } : {}),
  };
}

function normaliseLink(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

/** Write or change an SOP. A new one starts from a template. */
export function OpsEditor({
  id,
  onCancel,
  onSaved,
  onDeleted,
  onToast,
}: {
  id: string | null;
  onCancel: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onToast: (m: string) => void;
}) {
  const existing = useOpsSop(id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [initial, setInitial] = useState<string>("");
  useEffect(() => {
    if (id && existing.data && !draft) {
      const d = fromSop(existing.data);
      setDraft(d);
      setInitial(JSON.stringify(toInput(d)));
    }
  }, [id, existing.data, draft]);

  if (!id && !draft) {
    return (
      <TemplatePicker
        onCancel={onCancel}
        onPick={(key) => {
          const d = fromTemplate(key);
          setDraft(d);
          setInitial(JSON.stringify(toInput(d)));
        }}
      />
    );
  }
  if (id && existing.isError) return <div className="setzero"><p>Couldn't load this SOP.</p></div>;
  if (!draft) return <div className="setempty">Loading…</div>;
  return (
    <EditorForm
      sop={existing.data ?? null}
      draft={draft}
      setDraft={setDraft}
      dirty={JSON.stringify(toInput(draft)) !== initial}
      onCancel={onCancel}
      onSaved={onSaved}
      onDeleted={onDeleted}
      onToast={onToast}
    />
  );
}

function TemplatePicker({ onPick, onCancel }: { onPick: (key: string) => void; onCancel: () => void }) {
  return (
    <div className="ops-edit">
      <button type="button" className="org-back" onClick={onCancel}><BackIcon /> Business Ops</button>
      <div className="ops-tpl__head">
        <h2>New SOP</h2>
        <p>Start from a shape that fits — everything can be changed.</p>
      </div>
      <div className="ops-tpl">
        {OPS_TEMPLATES.map((t) => (
          <button key={t.key} type="button" className="ops-tpl__card" onClick={() => onPick(t.key)}>
            <span className="ops-tpl__ic" aria-hidden="true">{t.icon}</span>
            <b>{t.name}</b>
            <small>{t.description}</small>
            {t.steps.length > 0 && (
              <ol className="ops-tpl__steps" aria-hidden="true">
                {t.steps.slice(0, 3).map((s) => <li key={s}>{s}</li>)}
              </ol>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function EditorForm({
  sop,
  draft: d,
  setDraft,
  dirty,
  onCancel,
  onSaved,
  onDeleted,
  onToast,
}: {
  sop: OpsSop | null;
  draft: Draft;
  setDraft: (fn: (d: Draft | null) => Draft | null) => void;
  dirty: boolean;
  onCancel: () => void;
  onSaved: (id: string) => void;
  onDeleted: () => void;
  onToast: (m: string) => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((cur) => (cur ? { ...cur, [k]: v } : cur));
  const teams = useTeams().data ?? [];
  const people = usePeople().data ?? [];
  const collections = useOpsLibrary("").data?.collections ?? [];
  const [pasting, setPasting] = useState(false);
  const [newCollection, setNewCollection] = useState(false);
  const [publishing, setPublishing] = useState<OpsSop | null>(null);
  const [look, setLook] = useState(false);
  const save = useOpsMutation((input: OpsSopInput) => (sop ? api.updateOpsSop(sop.id, input) : api.createOpsSop(input)));
  const archive = useOpsMutation(() => (sop!.status === "archived" ? api.restoreOpsSop(sop!.id) : api.archiveOpsSop(sop!.id)));
  const remove = useOpsMutation(() => api.deleteOpsSop(sop!.id));

  const problems = useMemo(() => {
    const p: string[] = [];
    if (!d.title.trim()) p.push("a title");
    return p;
  }, [d.title]);
  const publishProblems = useMemo(() => {
    const p: string[] = [];
    if (!d.allTeams && !d.teamIds.length) p.push("choose who reads it");
    if (!d.steps.some((s) => s.text.trim()) && !d.body.replace(/<[^>]+>/g, "").trim()) p.push("add a step or some details");
    return p;
  }, [d.allTeams, d.teamIds, d.steps, d.body]);

  const submit = (thenPublish: boolean) => {
    if (problems.length) {
      onToast("Give the SOP a title first");
      return;
    }
    save.mutate(toInput(d), {
      onSuccess: (saved) => {
        if (thenPublish) setPublishing(saved);
        else {
          onToast(sop ? "Saved" : "Saved as a draft");
          onSaved(saved.id);
        }
      },
      onError: (e) => onToast(errMessage(e, "Couldn't save the SOP")),
    });
  };

  const cancel = () => {
    if (dirty && !window.confirm("Leave without saving your changes?")) return;
    onCancel();
  };

  const toggleTeam = (tid: string) => set("teamIds", d.teamIds.includes(tid) ? d.teamIds.filter((x) => x !== tid) : [...d.teamIds, tid]);
  const publishLabel = !sop || sop.version === 0 ? "Publish" : `Publish v${sop.version + 1}`;

  return (
    <div className="ops-edit">
      <div className="ops-edit__bar">
        <button type="button" className="org-back" onClick={cancel}><BackIcon /> {sop ? "Back to the SOP" : "Business Ops"}</button>
        <div className="ops-edit__acts">
          {dirty && <span className="ops-edit__dirty">Unsaved changes</span>}
          <button type="button" className="btn-ghost ops-act" onClick={() => submit(false)} disabled={save.isPending}>
            {!sop || sop.status === "draft" ? "Save draft" : "Save"}
          </button>
          {(!sop || sop.status !== "archived") && (
            <button
              type="button"
              className="btn-primary ops-act"
              onClick={() => submit(true)}
              disabled={save.isPending || publishProblems.length > 0}
              title={publishProblems.length ? `Before publishing: ${publishProblems.join(" and ")}` : undefined}
            >
              {publishLabel}
            </button>
          )}
        </div>
      </div>

      <div className="ops-edit__grid">
        <div className="ops-edit__main">
          <div className="ops-edit__titlerow">
            <button type="button" className="ops-edit__look" onClick={() => setLook((v) => !v)} aria-label="Icon and colour" title="Icon and colour" aria-expanded={look}>
              <OpsTile icon={d.icon} color={d.color} size={56} />
            </button>
            <input
              className="ops-edit__title"
              value={d.title}
              autoFocus={!sop}
              maxLength={160}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Name the procedure — e.g. Opening the warehouse"
              aria-label="Title"
            />
          </div>
          {look && (
            <div className="ops-edit__lookpanel">
              <IconPicker value={d.icon} onChange={(v) => set("icon", v)} />
              <ColorPicker value={d.color} onChange={(v) => set("color", v)} />
            </div>
          )}
          <label className="field">
            <span>Summary <em>one line on the card: when to use it</em></span>
            <input value={d.summary} maxLength={500} onChange={(e) => set("summary", e.target.value)} placeholder="First in, every morning before 8" />
          </label>

          <label className="field ops-edit__warn">
            <span>Before you start <em>warnings, shown first</em></span>
            <textarea rows={2} value={d.warnings} maxLength={4000} onChange={(e) => set("warnings", e.target.value)} placeholder="Never open the shutter alone. Wear gloves." />
          </label>

          <StepsEditor steps={d.steps} onChange={(s) => set("steps", s)} onPaste={() => setPasting(true)} onToast={onToast} />

          <div className="field">
            <span>Details <em>optional — anything the steps don't cover</em></span>
            <KnowledgeEditor value={d.body} onChange={(v) => set("body", v)} label="Details" placeholder="Who to call, exceptions, examples…" />
          </div>

          <ResourcesEditor resources={d.resources} onChange={(r) => set("resources", r)} onToast={onToast} />
        </div>

        <aside className="ops-edit__side">
          <div className="ops-side">
            <h3>Who reads it</h3>
            <label className="ops-side__row">
              <span><b>All teams</b><small>Everyone, including teams added later</small></span>
              <button type="button" role="switch" aria-checked={d.allTeams} aria-label="All teams" className={"switch sm" + (d.allTeams ? " on" : "")} onClick={() => set("allTeams", !d.allTeams)}>
                <span className="switch__dot" />
              </button>
            </label>
            {!d.allTeams && (
              <div className="ops-side__teams">
                {teams.map((t) => (
                  <label key={t.id} className={"ops-teamchk" + (d.teamIds.includes(t.id) ? " on" : "")}>
                    <input type="checkbox" checked={d.teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                    {t.name}
                  </label>
                ))}
                {teams.length === 0 && <p className="org-muted">No teams yet — add them in Settings › Teams.</p>}
              </div>
            )}
          </div>

          <div className="ops-side">
            <h3>Collection</h3>
            <select
              value={d.collectionId ?? ""}
              aria-label="Collection"
              onChange={(e) => (e.target.value === "__new" ? setNewCollection(true) : set("collectionId", e.target.value || null))}
            >
              <option value="">None</option>
              {collections.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
              <option value="__new">+ New collection…</option>
            </select>
          </div>

          <div className="ops-side">
            <h3>Reading</h3>
            <label className="ops-side__row">
              <span><b>Must read</b><small>Everyone it's for confirms each new version</small></span>
              <button type="button" role="switch" aria-checked={d.mustRead} aria-label="Must read" className={"switch sm" + (d.mustRead ? " on" : "")} onClick={() => set("mustRead", !d.mustRead)}>
                <span className="switch__dot" />
              </button>
            </label>
          </div>

          <div className="ops-side">
            <h3>Review</h3>
            <label className="field">
              <span>Review every</span>
              <select value={d.reviewEveryMonths ?? ""} onChange={(e) => set("reviewEveryMonths", e.target.value ? Number(e.target.value) : null)}>
                <option value="">Never — no reminders</option>
                {REVIEW_PERIODS.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Owner <em>reminded when it's due</em></span>
              <select value={d.ownerUserId ?? ""} onChange={(e) => set("ownerUserId", e.target.value || null)}>
                {!d.ownerUserId && <option value="">Whoever creates it</option>}
                {people.map((p) => <option key={p.user.id} value={p.user.id}>{p.user.name}</option>)}
              </select>
            </label>
          </div>

          {sop && (
            <div className="ops-side ops-side--danger">
              <button
                type="button"
                className="btn-ghost"
                onClick={() =>
                  archive.mutate(undefined, {
                    onSuccess: (s) => { onToast(s.status === "archived" ? "Archived" : "Restored"); onSaved(s.id); },
                    onError: (e) => onToast(errMessage(e, "Couldn't change that")),
                  })
                }
              >
                {sop.status === "archived" ? "Restore" : "Archive"}
              </button>
              <button
                type="button"
                className="btn-ghost danger"
                onClick={() => {
                  if (!window.confirm(`Delete “${sop.title}” and all its versions? This can't be undone. Archiving keeps it.`)) return;
                  remove.mutate(undefined, { onSuccess: () => { onToast("SOP deleted"); onDeleted(); }, onError: (e) => onToast(errMessage(e, "Couldn't delete it")) });
                }}
              >
                Delete
              </button>
            </div>
          )}
        </aside>
      </div>

      {pasting && (
        <PasteStepsModal
          onClose={() => setPasting(false)}
          onAdd={(lines) => {
            const keep = d.steps.filter((s) => s.text.trim() || s.imageUrl || s.link);
            set("steps", [...keep, ...lines.map((text) => ({ key: nextKey(), text, imageUrl: null, link: null }))]);
            setPasting(false);
            onToast(`${lines.length} step${lines.length === 1 ? "" : "s"} added`);
          }}
        />
      )}
      {newCollection && (
        <CollectionModal collection={null} onClose={() => setNewCollection(false)} onSaved={(c) => set("collectionId", c.id)} onToast={onToast} />
      )}
      {publishing && (
        <PublishModal
          sop={publishing}
          onClose={() => { setPublishing(null); onSaved(publishing.id); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}

/* ---------------------------------- steps ---------------------------------- */

function StepsEditor({
  steps,
  onChange,
  onPaste,
  onToast,
}: {
  steps: StepDraft[];
  onChange: (s: StepDraft[]) => void;
  onPaste: () => void;
  onToast: (m: string) => void;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [uploading, setUploading] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const forStep = useRef<number | null>(null);

  const patch = (key: number, p: Partial<StepDraft>) => onChange(steps.map((s) => (s.key === key ? { ...s, ...p } : s)));
  const move = (from: number, to: number) => {
    if (from === to) return;
    const n = [...steps];
    const [it] = n.splice(from, 1);
    n.splice(to, 0, it!);
    onChange(n);
  };
  const addAfter = (i: number) => {
    const n = [...steps];
    n.splice(i + 1, 0, { key: nextKey(), text: "", imageUrl: null, link: null });
    onChange(n);
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-step="${i + 1}"]`)?.focus(), 0);
  };
  const upload = async (f: File) => {
    const key = forStep.current;
    if (key == null) return;
    if (!f.type.startsWith("image/")) {
      onToast("That isn't a picture");
      return;
    }
    setUploading(key);
    try {
      const att = await api.uploadMedia(f, { kind: "image", filename: f.name });
      patch(key, { imageUrl: att.url });
    } catch {
      onToast("Couldn't upload that picture — please try again");
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="field">
      <div className="ops-stepsed__head">
        <span>Steps <em>drag to reorder · Enter adds the next one</em></span>
        <button type="button" className="btn-ghost sm" onClick={onPaste}>Paste a list</button>
      </div>
      <ol className={"ops-stepsed" + (dragging !== null ? " is-dragging" : "")}>
        {steps.map((s, i) => (
          <li
            key={s.key}
            className={"ops-stepsed__row" + (dragging === i ? " dragging" : "") + (over === i && dragging !== null && dragging !== i ? " over" : "")}
            onDragOver={(e: DragEvent) => {
              if (dragging === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragging !== null) move(dragging, i);
              setDragging(null);
              setOver(null);
            }}
          >
            <span
              className="ops-stepsed__grip"
              draggable
              onDragStart={(e) => {
                setDragging(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragEnd={() => { setDragging(null); setOver(null); }}
              title="Drag to reorder"
              aria-hidden="true"
            >
              <GripIcon />
            </span>
            <span className="ops-stepsed__n">{i + 1}</span>
            <div className="ops-stepsed__body">
              <textarea
                data-step={i}
                rows={1}
                value={s.text}
                maxLength={2000}
                onChange={(e) => patch(s.key, { text: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    addAfter(i);
                  }
                  if (e.key === "Backspace" && !s.text && steps.length > 1) {
                    e.preventDefault();
                    onChange(steps.filter((x) => x.key !== s.key));
                    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-step="${Math.max(0, i - 1)}"]`)?.focus(), 0);
                  }
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    const to = e.key === "ArrowUp" ? i - 1 : i + 1;
                    if (to >= 0 && to < steps.length) move(i, to);
                  }
                }}
                onPaste={(e) => {
                  const text = e.clipboardData.getData("text");
                  const lines = splitIntoSteps(text);
                  if (lines.length < 2) return;
                  // A list pasted into a step: one step per line.
                  e.preventDefault();
                  const n = [...steps];
                  const here: StepDraft = { ...s, text: (s.text ? `${s.text} ` : "") + lines[0] };
                  n.splice(i, 1, here, ...lines.slice(1).map((t) => ({ key: nextKey(), text: t, imageUrl: null, link: null })));
                  onChange(n);
                  onToast(`${lines.length} steps from the paste`);
                }}
                placeholder={i === 0 ? "What to do first" : "And then…"}
                aria-label={`Step ${i + 1}`}
                className="ops-stepsed__text"
              />
              {s.imageUrl && (
                <div className="ops-stepsed__img">
                  <img src={s.imageUrl} alt="" />
                  <button type="button" className="org-iconbtn" onClick={() => patch(s.key, { imageUrl: null })} aria-label="Remove picture"><XIcon /></button>
                </div>
              )}
              {s.link !== null && (
                <div className="ops-stepsed__link">
                  <LinkIcon />
                  <input value={s.link} autoFocus={!s.link} onChange={(e) => patch(s.key, { link: e.target.value })} placeholder="https://…" aria-label={`Link for step ${i + 1}`} />
                  <button type="button" className="org-iconbtn" onClick={() => patch(s.key, { link: null })} aria-label="Remove link"><XIcon /></button>
                </div>
              )}
            </div>
            <div className="ops-stepsed__tools">
              <button
                type="button"
                className="org-iconbtn"
                title="Add a picture"
                aria-label={`Add a picture to step ${i + 1}`}
                disabled={uploading === s.key}
                onClick={() => { forStep.current = s.key; fileRef.current?.click(); }}
              >
                <ImageIcon />
              </button>
              <button type="button" className="org-iconbtn" title="Add a link" aria-label={`Add a link to step ${i + 1}`} disabled={s.link !== null} onClick={() => patch(s.key, { link: "" })}>
                <LinkIcon />
              </button>
              <button type="button" className="org-iconbtn" title="Remove step" aria-label={`Remove step ${i + 1}`} onClick={() => onChange(steps.filter((x) => x.key !== s.key))}>
                <TrashIcon />
              </button>
            </div>
          </li>
        ))}
      </ol>
      <button type="button" className="ops-stepsed__add" onClick={() => addAfter(steps.length - 1)}><PlusIcon /> Add step</button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
    </div>
  );
}

function PasteStepsModal({ onClose, onAdd }: { onClose: () => void; onAdd: (lines: string[]) => void }) {
  const [text, setText] = useState("");
  const lines = splitIntoSteps(text);
  return (
    <OpsModal
      title="Paste a list as steps"
      onClose={onClose}
      onSubmit={() => lines.length && onAdd(lines)}
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={!lines.length}>
            {lines.length ? `Add ${lines.length} step${lines.length === 1 ? "" : "s"}` : "Add steps"}
          </button>
        </div>
      }
    >
      <p className="ops-modal__lead">Paste from a document, an email or notes. Each line becomes a step; numbers and bullets are taken off.</p>
      <textarea className="ops-paste" rows={9} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"1. Disarm the alarm\n2. Lights on\n3. Open the shutter"} aria-label="Steps to paste" />
      {lines.length > 0 && (
        <ol className="ops-paste__preview">
          {lines.slice(0, 8).map((l, i) => <li key={i}>{l}</li>)}
          {lines.length > 8 && <li className="org-muted">…and {lines.length - 8} more</li>}
        </ol>
      )}
    </OpsModal>
  );
}

/* -------------------------------- resources -------------------------------- */

function ResourcesEditor({ resources, onChange, onToast }: { resources: ResourceDraft[]; onChange: (r: ResourceDraft[]) => void; onToast: (m: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const patch = (key: number, p: Partial<ResourceDraft>) => onChange(resources.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const upload = async (f: File) => {
    setUploading(true);
    try {
      const att = await api.uploadMedia(f, { filename: f.name });
      onChange([...resources, { key: nextKey(), kind: "file", title: f.name.replace(/\.[^.]+$/, ""), url: att.url }]);
    } catch {
      onToast("Couldn't upload that file — please try again");
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className="field">
      <span>Files and links <em>forms, templates, the supplier's portal…</em></span>
      {resources.length > 0 && (
        <ul className="ops-resed">
          {resources.map((r) => (
            <li key={r.key}>
              <span className="ops-res__ic">{r.kind === "file" ? <DocIcon /> : <LinkIcon />}</span>
              <input value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} placeholder="Name" aria-label="Name" maxLength={160} />
              {r.kind === "link" ? (
                <input value={r.url} onChange={(e) => patch(r.key, { url: e.target.value })} placeholder="https://…" aria-label="Web address" />
              ) : (
                <span className="ops-resed__file">Uploaded file</span>
              )}
              <button type="button" className="org-iconbtn" onClick={() => onChange(resources.filter((x) => x.key !== r.key))} aria-label="Remove"><TrashIcon /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="ops-resed__add">
        <button type="button" className="btn-ghost sm" onClick={() => onChange([...resources, { key: nextKey(), kind: "link", title: "", url: "" }])}><LinkIcon /> Add a link</button>
        <button type="button" className="btn-ghost sm" disabled={uploading} onClick={() => fileRef.current?.click()}><DocIcon /> {uploading ? "Uploading…" : "Upload a file"}</button>
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void upload(f);
        }}
      />
    </div>
  );
}
