import { useEffect, useMemo, useState } from "react";
import type { OpsRevision, OpsSop } from "@ding/schemas";
import { describeOpsChanges, opsProgress } from "@ding/schemas";
import { api } from "../../lib/api";
import { useOpsAcks, useOpsLibrary, useOpsMutation, useOpsSop, useOpsStatus, useOpsVersions, useTeams } from "../../hooks";
import { relativeTime } from "../../lib/format";
import {
  AlertIcon,
  BackIcon,
  CheckIcon,
  DocIcon,
  EditIcon,
  HistoryIcon,
  LinkIcon,
  PrintIcon,
  ProfileIcon,
} from "../../lib/icons";
import { Avatar } from "../Avatar";
import { KnowledgeView } from "../organisations/KnowledgeEditor";
import { errMessage, OpsModal, OpsTile, periodLabel, shortDate, TeamChips } from "./parts";

/** One SOP, to read, tick through or confirm — and for editors, to manage. */
export function OpsReader({
  id,
  onBack,
  onEdit,
  onToast,
}: {
  id: string;
  onBack: () => void;
  onEdit: () => void;
  onToast: (m: string) => void;
}) {
  const sopQ = useOpsSop(id);
  const status = useOpsStatus();
  const canEdit = !!status.data?.canEdit;
  const sop = sopQ.data;
  const [modal, setModal] = useState<"versions" | "acks" | "publish" | null>(null);

  if (sopQ.isLoading) return <div className="setempty">Loading…</div>;
  if (sopQ.isError || !sop) {
    return (
      <div className="ops-read">
        <button type="button" className="org-back" onClick={onBack}><BackIcon /> Business Ops</button>
        <div className="setzero"><p>This SOP isn't available — it may have been deleted, or it isn't for your teams.</p></div>
      </div>
    );
  }

  return (
    <article className="ops-read ops-print" style={{ ["--c" as string]: sop.color }}>
      <div className="ops-read__bar no-print">
        <button type="button" className="org-back" onClick={onBack}><BackIcon /> Business Ops</button>
        <div className="ops-read__acts">
          <button type="button" className="btn-ghost ops-act" onClick={() => setModal("versions")} disabled={sop.version === 0} title={sop.version === 0 ? "Not published yet" : "Every published version"}>
            <HistoryIcon /> History
          </button>
          <button type="button" className="btn-ghost ops-act" onClick={printSop}><PrintIcon /> Print</button>
          {canEdit && sop.mustRead && sop.version > 0 && (
            <button type="button" className="btn-ghost ops-act" onClick={() => setModal("acks")}><ProfileIcon /> Who's read it</button>
          )}
          {canEdit && <button type="button" className="btn-ghost ops-act" onClick={onEdit}><EditIcon /> Edit</button>}
          {canEdit && sop.status === "draft" && (
            <button type="button" className="btn-primary ops-act" onClick={() => setModal("publish")}>Publish</button>
          )}
        </div>
      </div>

      <Hero sop={sop} />
      <Banners sop={sop} canEdit={canEdit} onPublish={() => setModal("publish")} onToast={onToast} />

      {sop.warnings && (
        <section className="ops-warn" aria-label="Before you start">
          <span className="ops-warn__ic"><AlertIcon /></span>
          <div>
            <h3>Before you start</h3>
            <p>{sop.warnings}</p>
          </div>
        </section>
      )}

      {sop.steps.length > 0 && <Steps sop={sop} onToast={onToast} />}

      {sop.body && (
        <section className="ops-block">
          <h3 className="ops-block__h">Details</h3>
          <KnowledgeView html={sop.body} />
        </section>
      )}

      {sop.resources.length > 0 && (
        <section className="ops-block">
          <h3 className="ops-block__h">Files and links</h3>
          <ul className="ops-res">
            {sop.resources.map((r) => (
              <li key={r.id}>
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="ops-res__a">
                  <span className="ops-res__ic">{r.kind === "file" ? <DocIcon /> : <LinkIcon />}</span>
                  <span className="ops-res__t">{r.title}</span>
                  <span className="ops-res__k">{r.kind === "file" ? "File" : hostOf(r.url)}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="ops-read__foot">
        {sop.version > 0 ? `Version ${sop.version}` : "Not published yet"}
        {sop.publishedAt && ` · published ${shortDate(sop.publishedAt)}`}
        {sop.updatedBy && ` · last edited by ${sop.updatedBy.name} ${relativeTime(sop.updatedAt)}`}
      </footer>

      {modal === "versions" && <VersionsModal sop={sop} onClose={() => setModal(null)} />}
      {modal === "acks" && <AcksModal sop={sop} onClose={() => setModal(null)} />}
      {modal === "publish" && <PublishModal sop={sop} onClose={() => setModal(null)} onToast={onToast} />}
    </article>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

/** Print just the SOP: everything else is hidden while the dialog is open. */
function printSop() {
  document.body.classList.add("ops-printing");
  const done = () => {
    document.body.classList.remove("ops-printing");
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
}

function Hero({ sop }: { sop: OpsSop }) {
  const teams = useTeams().data ?? [];
  const lib = useOpsLibrary("");
  const collection = lib.data?.collections.find((c) => c.id === sop.collectionId);
  return (
    <header className="ops-readhero">
      <OpsTile icon={sop.icon} color={sop.color} size={64} />
      <div className="ops-readhero__main">
        {collection && <span className="ops-readhero__col">{collection.icon} {collection.name}</span>}
        <h2>{sop.title}</h2>
        {sop.summary && <p className="ops-readhero__sum">{sop.summary}</p>}
        <div className="ops-readhero__meta">
          <TeamChips sop={sop} teams={teams} max={4} />
          {sop.status === "draft" && <span className="ops-chip ops-chip--draft">Draft</span>}
          {sop.status === "archived" && <span className="ops-chip">Archived</span>}
          {sop.mustRead && <span className="ops-chip ops-chip--must">Must read</span>}
          {sop.version > 0 && <span className="ops-chip">v{sop.version}</span>}
          {sop.owner && <span className="ops-readhero__owner">Owner: {sop.owner.name}</span>}
          {sop.reviewEveryMonths && sop.reviewDueAt && (
            <span className={"ops-readhero__owner" + (sop.reviewOverdue ? " ops-overdue" : "")}>
              {sop.reviewOverdue ? "Review overdue since" : "Next review"} {shortDate(sop.reviewDueAt)}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}

function Banners({ sop, canEdit, onPublish, onToast }: { sop: OpsSop; canEdit: boolean; onPublish: () => void; onToast: (m: string) => void }) {
  const ack = useOpsMutation(() => api.ackOpsSop(sop.id));
  const reviewed = useOpsMutation(() => api.reviewedOpsSop(sop.id));
  const restore = useOpsMutation(() => api.restoreOpsSop(sop.id));
  const versions = useOpsVersions(sop.id, canEdit && sop.version > 0);
  const latest = versions.data?.[0];
  const unpublished = canEdit && sop.status === "published" && latest ? describeOpsChanges(latest, sop) : [];

  return (
    <div className="ops-banners no-print">
      {sop.status === "draft" && (
        <div className="ops-banner ops-banner--draft">
          <div><b>Draft</b> — only admins and managers can see this. Publish it when it's ready for its teams.</div>
          {canEdit && <button type="button" className="btn-primary sm" onClick={onPublish}>Publish</button>}
        </div>
      )}
      {sop.status === "archived" && (
        <div className="ops-banner">
          <div><b>Archived</b> — out of the library for everyone but editors.</div>
          {canEdit && (
            <button
              type="button"
              className="btn-ghost sm"
              onClick={() => restore.mutate(undefined, { onSuccess: () => onToast("Restored"), onError: (e) => onToast(errMessage(e, "Couldn't restore it")) })}
            >
              Restore
            </button>
          )}
        </div>
      )}
      {sop.needsMyAck && (
        <div className="ops-banner ops-banner--ack">
          <div>
            <b>{sop.myAck ? `Updated to version ${sop.version}` : "This is a must-read"}</b>
            <span>{sop.myAck ? ` — you confirmed v${sop.myAck.version}. Read what's changed, then confirm again.` : " — read it through, then confirm you have."}</span>
          </div>
          <button
            type="button"
            className="btn-primary sm"
            disabled={ack.isPending}
            onClick={() => ack.mutate(undefined, { onSuccess: () => onToast("Thanks — confirmed"), onError: (e) => onToast(errMessage(e, "Couldn't confirm")) })}
          >
            <CheckIcon /> I've read this
          </button>
        </div>
      )}
      {sop.mustRead && sop.myAck && !sop.needsMyAck && sop.myAck.version === sop.version && (
        <div className="ops-banner ops-banner--ok">
          <div><CheckIcon /> You confirmed version {sop.version} {relativeTime(sop.myAck.at)}.</div>
        </div>
      )}
      {canEdit && sop.reviewOverdue && (
        <div className="ops-banner ops-banner--review">
          <div><b>Due for review</b> — is this still how it's done? If so, mark it reviewed; if not, edit it and publish a new version.</div>
          <button
            type="button"
            className="btn-ghost sm"
            onClick={() =>
              reviewed.mutate(undefined, {
                onSuccess: (s) => onToast(s.reviewDueAt ? `Reviewed — next review ${shortDate(s.reviewDueAt)}` : "Reviewed"),
                onError: (e) => onToast(errMessage(e, "Couldn't save that")),
              })
            }
          >
            Still right — mark reviewed
          </button>
        </div>
      )}
      {unpublished.length > 0 && (
        <div className="ops-banner ops-banner--quiet">
          <div>
            Edited since v{sop.version} ({unpublished.join(", ").toLowerCase()}).
            {sop.mustRead ? " Readers see the edits now; publish a new version to ask them to confirm again." : " Publish a new version to keep a record of it."}
          </div>
          <button type="button" className="btn-ghost sm" onClick={onPublish}>Publish v{sop.version + 1}</button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- steps ---------------------------------- */

function Steps({ sop, onToast }: { sop: OpsSop; onToast: (m: string) => void }) {
  const [checklist, setChecklist] = useState(sop.myChecklist.length > 0);
  const [done, setDone] = useState<number[]>(sop.myChecklist);
  useEffect(() => setDone(sop.myChecklist), [sop.id, sop.myChecklist]);
  const save = useOpsMutation((next: number[]) => api.setOpsChecklist(sop.id, next));
  const progress = opsProgress(sop.steps.length, done);
  const [zoom, setZoom] = useState<string | null>(null);

  const toggle = (i: number) => {
    const next = done.includes(i) ? done.filter((x) => x !== i) : [...done, i].sort((a, b) => a - b);
    setDone(next);
    save.mutate(next, { onError: (e) => { setDone(done); onToast(errMessage(e, "Couldn't save your tick")); } });
  };

  return (
    <section className="ops-block">
      <div className="ops-steps__head">
        <h3 className="ops-block__h">Steps <span className="setcount">{sop.steps.length}</span></h3>
        <label className="ops-steps__mode no-print">
          <span>Checklist</span>
          <button type="button" role="switch" aria-checked={checklist} aria-label="Checklist mode" className={"switch sm" + (checklist ? " on" : "")} onClick={() => setChecklist((v) => !v)}>
            <span className="switch__dot" />
          </button>
        </label>
      </div>
      {checklist && (
        <div className="ops-progress no-print" aria-live="polite">
          <div className="ops-progress__bar"><span style={{ width: `${progress.pct}%` }} /></div>
          <span className="ops-progress__t">{progress.done === progress.total ? "All done 🎉" : `${progress.done} of ${progress.total} done`}</span>
          {progress.done > 0 && (
            <button type="button" className="btn-ghost sm" onClick={() => { setDone([]); save.mutate([]); }}>Reset</button>
          )}
        </div>
      )}
      <ol className={"ops-steps" + (checklist ? " ops-steps--check" : "")}>
        {sop.steps.map((s, i) => {
          const ticked = checklist && done.includes(i);
          return (
            <li key={i} className={"ops-step" + (ticked ? " done" : "")}>
              {checklist ? (
                <button type="button" className="ops-step__n ops-step__tick" role="checkbox" aria-checked={ticked} aria-label={`Step ${i + 1}: ${s.text}`} onClick={() => toggle(i)}>
                  {ticked ? <CheckIcon /> : i + 1}
                </button>
              ) : (
                <span className="ops-step__n">{i + 1}</span>
              )}
              <div className="ops-step__body">
                <p className="ops-step__t">{s.text}</p>
                {s.imageUrl && (
                  <button type="button" className="ops-step__img" onClick={() => setZoom(s.imageUrl!)} aria-label="Enlarge picture">
                    <img src={s.imageUrl} alt="" loading="lazy" />
                  </button>
                )}
                {s.link && (
                  <a className="ops-step__link" href={s.link} target="_blank" rel="noopener noreferrer"><LinkIcon /> {hostOf(s.link)}</a>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {zoom && (
        <div className="ops-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="Picture">
          <img src={zoom} alt="" />
        </div>
      )}
    </section>
  );
}

/* --------------------------------- modals --------------------------------- */

export function PublishModal({ sop, onClose, onPublished, onToast }: { sop: OpsSop; onClose: () => void; onPublished?: () => void; onToast: (m: string) => void }) {
  const [note, setNote] = useState("");
  const publish = useOpsMutation(() => api.publishOpsSop(sop.id, note.trim()));
  const first = sop.version === 0;
  return (
    <OpsModal
      title={first ? "Publish this SOP" : `Publish version ${sop.version + 1}`}
      onClose={onClose}
      onSubmit={() =>
        publish.mutate(undefined, {
          onSuccess: (s) => { onToast(first ? "Published" : `Published v${s.version}`); onClose(); onPublished?.(); },
          onError: (e) => onToast(errMessage(e, "Couldn't publish it")),
        })
      }
      foot={
        <div className="setform__footactions">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={publish.isPending}>{first ? "Publish" : `Publish v${sop.version + 1}`}</button>
        </div>
      }
    >
      <p className="ops-modal__lead">
        {first ? "It goes into the library for " : "The new version replaces the old one for "}
        <b>{sop.allTeams ? "every team" : `${sop.teamIds.length} team${sop.teamIds.length === 1 ? "" : "s"}`}</b>
        {sop.mustRead ? ", and everyone in them is asked to read and confirm it." : "."}
        {sop.reviewEveryMonths ? ` Its next review will be due in ${periodLabel(sop.reviewEveryMonths)}.` : ""}
      </p>
      <label className="field">
        <span>What changed? <em>optional, shown in its history</em></span>
        <input value={note} autoFocus maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder={first ? "First version" : "Added the alarm code step"} />
      </label>
    </OpsModal>
  );
}

function VersionsModal({ sop, onClose }: { sop: OpsSop; onClose: () => void }) {
  const versions = useOpsVersions(sop.id);
  const list = versions.data ?? [];
  const [openV, setOpenV] = useState<number | null>(null);
  const shown = list.find((v) => v.version === openV);
  return (
    <OpsModal title={shown ? `Version ${shown.version}` : "Version history"} onClose={onClose} wide>
      {versions.isLoading && <div className="setempty">Loading…</div>}
      {shown ? (
        <div className="ops-oldver">
          <button type="button" className="org-back" onClick={() => setOpenV(null)}><BackIcon /> All versions</button>
          <h3>{shown.title}</h3>
          {shown.summary && <p className="org-muted">{shown.summary}</p>}
          {shown.warnings && <div className="ops-warn ops-warn--sm"><span className="ops-warn__ic"><AlertIcon /></span><p>{shown.warnings}</p></div>}
          <ol className="ops-steps ops-steps--compact">
            {shown.steps.map((s, i) => (
              <li key={i} className="ops-step"><span className="ops-step__n">{i + 1}</span><div className="ops-step__body"><p className="ops-step__t">{s.text}</p></div></li>
            ))}
          </ol>
          {shown.body && <KnowledgeView html={shown.body} />}
        </div>
      ) : (
        <ol className="ops-versions">
          {list.map((v, i) => (
            <VersionRow key={v.version} v={v} prev={list[i + 1] ?? null} current={v.version === sop.version} onOpen={() => setOpenV(v.version)} />
          ))}
        </ol>
      )}
    </OpsModal>
  );
}

function VersionRow({ v, prev, current, onOpen }: { v: OpsRevision; prev: OpsRevision | null; current: boolean; onOpen: () => void }) {
  const changes = useMemo(() => describeOpsChanges(prev, v), [prev, v]);
  return (
    <li className="ops-versions__row">
      <span className={"ops-versions__v" + (current ? " on" : "")}>v{v.version}</span>
      <div className="ops-versions__body">
        <b>{v.note || (changes.length ? changes[0] : "No visible changes")}</b>
        {changes.length > 0 && <small>{changes.join(" · ")}</small>}
        <small className="ops-versions__who">
          {v.publishedBy?.name ?? "Someone"} · {shortDate(v.publishedAt)}
          {current && " · current"}
        </small>
      </div>
      <button type="button" className="btn-ghost sm" onClick={onOpen}>View</button>
    </li>
  );
}

function AcksModal({ sop, onClose }: { sop: OpsSop; onClose: () => void }) {
  const report = useOpsAcks(sop.id);
  const people = report.data?.people ?? [];
  const confirmed = people.filter((p) => p.ackedVersion === sop.version);
  const waiting = people.filter((p) => p.ackedVersion !== sop.version);
  const pct = people.length ? Math.round((confirmed.length / people.length) * 100) : 0;
  return (
    <OpsModal title="Who's read it" onClose={onClose}>
      {report.isLoading && <div className="setempty">Loading…</div>}
      {report.data && (
        <>
          <div className="ops-acksum">
            <div className="ops-progress__bar"><span style={{ width: `${pct}%` }} /></div>
            <span><b>{confirmed.length} of {people.length}</b> confirmed version {sop.version}</span>
          </div>
          {people.length === 0 && <p className="org-muted">Nobody is in its teams yet.</p>}
          {waiting.length > 0 && (
            <>
              <h4 className="ops-acks__h">Waiting · {waiting.length}</h4>
              <ul className="ops-acks">
                {waiting.map((p) => (
                  <li key={p.userId}>
                    <Avatar name={p.name} color={p.avatarColor} src={p.avatarUrl} className="av ops-acks__av" />
                    <span>{p.name}</span>
                    <small>{p.ackedVersion ? `confirmed v${p.ackedVersion} ${relativeTime(p.ackedAt!)}` : "not yet"}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {confirmed.length > 0 && (
            <>
              <h4 className="ops-acks__h">Confirmed · {confirmed.length}</h4>
              <ul className="ops-acks">
                {confirmed.map((p) => (
                  <li key={p.userId}>
                    <Avatar name={p.name} color={p.avatarColor} src={p.avatarUrl} className="av ops-acks__av" />
                    <span>{p.name}</span>
                    <small className="ops-acks__ok"><CheckIcon /> {relativeTime(p.ackedAt!)}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </OpsModal>
  );
}
