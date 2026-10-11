import { useState } from "react";
import { createPortal } from "react-dom";
import type { AccountAlert, AccountResource, AccountSop, AccountStatus } from "@ding/schemas";
import { useSopRevisions } from "../../hooks";
import { relativeTime } from "../../lib/format";
import { AlertIcon, DocIcon, LinkIcon, BoltIcon, XIcon, ClockIcon, CheckIcon } from "../../lib/icons";
import { KnowledgeView } from "./KnowledgeEditor";

export const STATUS_LABEL: Record<AccountStatus, string> = { active: "Active", prospect: "Prospect", inactive: "Inactive" };
export const PRIORITY_LABEL: Record<AccountAlert["priority"], string> = { critical: "Critical", important: "Important", info: "Note" };

export function StatusPill({ status, archived }: { status: AccountStatus; archived?: boolean }) {
  if (archived) return <span className="org-status org-status--archived">Archived</span>;
  return <span className={`org-status org-status--${status}`}>{STATUS_LABEL[status]}</span>;
}

/** The pinned instructions — loud, short, first. */
export function AlertList({ alerts, compact }: { alerts: AccountAlert[]; compact?: boolean }) {
  if (!alerts.length) return null;
  return (
    <ul className={"org-alerts" + (compact ? " org-alerts--compact" : "")} aria-label="Important instructions">
      {alerts.map((a) => (
        <li key={a.id} className={`org-alert org-alert--${a.priority}`}>
          <span className="org-alert__ic" aria-hidden="true"><AlertIcon /></span>
          <span className="org-alert__body">
            <span className="org-alert__p">{PRIORITY_LABEL[a.priority]}</span>
            {a.body}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Where a resource opens: its link, or its stored file. */
export function resourceHref(r: AccountResource): string | null {
  if (r.kind === "file") return r.attachmentId ? `/api/media/${encodeURIComponent(r.attachmentId)}` : null;
  return r.url;
}

export function ResourceIcon({ kind }: { kind: AccountResource["kind"] }) {
  return kind === "file" ? <DocIcon /> : kind === "app" ? <BoltIcon /> : <LinkIcon />;
}

/** One resource as a link that opens it. */
export function ResourceLink({ r, showInstructions }: { r: AccountResource; showInstructions?: boolean }) {
  const href = resourceHref(r);
  return (
    <div className="org-res">
      <a className="org-res__a" href={href ?? undefined} target="_blank" rel="noopener noreferrer">
        <span className={`org-res__ic org-res__ic--${r.kind}`}><ResourceIcon kind={r.kind} /></span>
        <span className="org-res__t">
          <b>{r.title}</b>
          <small>{r.kind === "file" ? r.fileName ?? "Document" : r.url?.replace(/^https?:\/\//, "")}</small>
        </span>
      </a>
      {showInstructions && r.instructions && <p className="org-res__how">{r.instructions}</p>}
    </div>
  );
}

/**
 * An SOP, read the way it's used: warnings, then the steps as a checklist to
 * tick through (the ticks are only for whoever's reading — nothing is saved),
 * then the detailed instructions and the documents that go with it.
 */
export function SopReader({
  accountId,
  sop,
  resources,
  onClose,
  onEdit,
}: {
  accountId: string;
  sop: AccountSop;
  resources: AccountResource[];
  onClose: () => void;
  onEdit?: () => void;
}) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState(false);
  const revisions = useSopRevisions(history ? accountId : null, history ? sop.id : null);
  const own = resources.filter((r) => r.sopId === sop.id);
  const toggle = (i: number) =>
    setDone((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return createPortal(
    <div className="modal" onClick={onClose}>
      <div className="modal__box org-sopmodal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={sop.title}>
        <div className="modal__head">
          <div className="org-sopmodal__title">
            <span className="org-sopmodal__cat">{sop.category}</span>
            <h2>{sop.title}</h2>
            <small>
              {sop.status !== "active" && <span className={`org-sopst org-sopst--${sop.status}`}>{sop.status === "draft" ? "Draft — not yet in use" : "Archived — not current"}</span>}
              Version {sop.version} · updated {relativeTime(sop.updatedAt)}{sop.updatedBy ? ` by ${sop.updatedBy.name}` : ""}
            </small>
          </div>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body org-sop">
          {sop.summary && <p className="org-sop__summary">{sop.summary}</p>}
          {sop.warnings && (
            <div className="org-sop__warn" role="note">
              <AlertIcon />
              <span>{sop.warnings}</span>
            </div>
          )}
          {sop.steps.length > 0 && (
            <section>
              <h3>Steps <small>{done.size}/{sop.steps.length}</small></h3>
              <ol className="org-steps">
                {sop.steps.map((s, i) => (
                  <li key={i} className={done.has(i) ? "done" : ""}>
                    <button type="button" className="org-steps__tick" onClick={() => toggle(i)} aria-pressed={done.has(i)} aria-label={`Step ${i + 1} done`}>
                      {done.has(i) ? <CheckIcon /> : i + 1}
                    </button>
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {sop.body && (
            <section>
              <h3>Instructions</h3>
              <KnowledgeView html={sop.body} />
            </section>
          )}
          {own.length > 0 && (
            <section>
              <h3>Documents & tools</h3>
              <div className="org-reslist">
                {own.map((r) => <ResourceLink key={r.id} r={r} showInstructions />)}
              </div>
            </section>
          )}
          <section>
            <button type="button" className="org-linkbtn" onClick={() => setHistory((v) => !v)}>
              <ClockIcon /> {history ? "Hide earlier versions" : "Earlier versions"}
            </button>
            {history && (
              <div className="org-revs">
                {revisions.isLoading && <p className="org-muted">Loading…</p>}
                {revisions.data?.length === 0 && <p className="org-muted">This is the first version.</p>}
                {revisions.data?.map((r) => (
                  <details key={r.id} className="org-rev">
                    <summary>
                      Version {r.version} · {new Date(r.editedAt).toLocaleString()}{r.editedBy ? ` · ${r.editedBy.name}` : ""}
                    </summary>
                    {r.warnings && <p className="org-sop__warn"><AlertIcon /><span>{r.warnings}</span></p>}
                    {r.steps.length > 0 && <ol className="org-steps org-steps--plain">{r.steps.map((s, i) => <li key={i}><span>{s.text}</span></li>)}</ol>}
                    <KnowledgeView html={r.body} />
                  </details>
                ))}
              </div>
            )}
          </section>
        </div>
        {onEdit && (
          <div className="modal__foot">
            <div className="setform__footactions">
              <button type="button" className="btn-ghost" onClick={onClose}>Close</button>
              <button type="button" className="btn-primary" onClick={onEdit}>Edit SOP</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
