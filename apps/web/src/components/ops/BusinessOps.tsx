import { useEffect, useMemo, useState } from "react";
import type { OpsCollection, OpsFilter, OpsSopCard } from "@ding/schemas";
import { opsCardMatches, sortOpsCards } from "@ding/schemas";
import { useMe, useOpsLibrary, useOpsStatus, useTeams } from "../../hooks";
import { relativeTime } from "../../lib/format";
import { pushRecentOps, readRecentOps } from "../../lib/ops";
import { ClockIcon, EditIcon, OpsIcon, PlusIcon, SearchIcon, XIcon } from "../../lib/icons";
import { OpsEditor } from "./OpsEditor";
import { OpsReader } from "./OpsReader";
import { CollectionModal } from "./OpsCollections";
import { OpsTile, SopFlags, TeamChips } from "./parts";

type View = { kind: "library" } | { kind: "sop"; id: string } | { kind: "edit"; id: string | null };

/**
 * Business Ops: the workspace's own SOPs. The library, an SOP to read (or tick
 * through, or confirm), and — for admins and managers — the editor. See
 * docs/business-ops.md.
 */
export function BusinessOps({
  focusSopId,
  onClose,
  onToast,
}: {
  /** Open straight on one SOP (a must-read or review notification). */
  focusSopId?: string | null;
  onClose: () => void;
  onToast: (m: string) => void;
}) {
  const me = useMe();
  const userId = me.data?.user.id;
  const [view, setView] = useState<View>(focusSopId ? { kind: "sop", id: focusSopId } : { kind: "library" });
  const [recent, setRecent] = useState<string[]>([]);
  useEffect(() => setRecent(readRecentOps(userId)), [userId]);
  useEffect(() => {
    if (focusSopId) setView({ kind: "sop", id: focusSopId });
  }, [focusSopId]);

  const open = (id: string) => {
    setRecent(pushRecentOps(userId, id));
    setView({ kind: "sop", id });
  };

  return (
    <div className="settings ops" role="region" aria-label="Business Ops">
      <header className="settings__head">
        <h1 className="ops-title">
          <span className="ops-title__ic" aria-hidden="true"><OpsIcon /></span> Business Ops
        </h1>
        <button className="settings__x" onClick={onClose} aria-label="Close Business Ops" title="Close"><XIcon /></button>
      </header>
      <div className="settings__pane ops-pane" key={view.kind === "library" ? "library" : `${view.kind}:${"id" in view ? view.id : ""}`}>
        {view.kind === "library" && (
          <Library recent={recent} onOpen={open} onNew={() => setView({ kind: "edit", id: null })} onToast={onToast} />
        )}
        {view.kind === "sop" && (
          <OpsReader
            id={view.id}
            onBack={() => setView({ kind: "library" })}
            onEdit={() => setView({ kind: "edit", id: view.id })}
            onToast={onToast}
          />
        )}
        {view.kind === "edit" && (
          <OpsEditor
            id={view.id}
            onCancel={() => setView(view.id ? { kind: "sop", id: view.id } : { kind: "library" })}
            onSaved={(id) => open(id)}
            onDeleted={() => setView({ kind: "library" })}
            onToast={onToast}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------- the library ------------------------------- */

function Library({
  recent,
  onOpen,
  onNew,
  onToast,
}: {
  recent: string[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onToast: (m: string) => void;
}) {
  const status = useOpsStatus();
  const canEdit = !!status.data?.canEdit;
  const teams = useTeams().data ?? [];
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<OpsFilter>("all");
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [editingCollection, setEditingCollection] = useState<OpsCollection | "new" | null>(null);
  useEffect(() => {
    const t = window.setTimeout(() => setQ(search.trim()), 200);
    return () => window.clearTimeout(t);
  }, [search]);
  const lib = useOpsLibrary(q);
  const all = lib.data?.sops ?? [];
  const collections = lib.data?.collections ?? [];
  const shown = useMemo(() => sortOpsCards(all.filter((s) => opsCardMatches(s, filter, collectionId))), [all, filter, collectionId]);
  const count = (f: OpsFilter) => all.filter((s) => opsCardMatches(s, f)).length;
  const recentCards = recent.map((id) => all.find((s) => s.id === id)).filter((s): s is OpsSopCard => !!s && s.status !== "archived").slice(0, 4);
  const waiting = status.data?.pendingAcks ?? 0;
  const browsing = !q && filter === "all" && !collectionId;
  const activeCollection = collections.find((c) => c.id === collectionId);

  const chips: Array<{ key: OpsFilter; label: string; show: boolean }> = [
    { key: "all", label: "All", show: true },
    { key: "must_read", label: "Must read", show: true },
    { key: "review", label: "Due for review", show: canEdit },
    { key: "drafts", label: "Drafts", show: canEdit },
    { key: "archived", label: "Archived", show: canEdit },
  ];

  return (
    <div className="ops-lib">
      <section className="ops-hero">
        <div className="ops-hero__text">
          <h2>How we do things</h2>
          <p>The procedures your teams follow — step by step, always the latest version.</p>
        </div>
        <div className="ops-hero__search">
          <SearchIcon />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search every SOP — titles, steps and details"
            aria-label="Search SOPs"
          />
          {search && (
            <button type="button" className="ops-hero__clear" onClick={() => setSearch("")} aria-label="Clear search"><XIcon /></button>
          )}
        </div>
        {canEdit && (
          <button type="button" className="btn-primary ops-hero__new" onClick={onNew}><PlusIcon /> New SOP</button>
        )}
      </section>

      {waiting > 0 && filter !== "must_read" && (
        <button type="button" className="ops-waiting" onClick={() => { setFilter("must_read"); setCollectionId(null); }}>
          <span className="ops-waiting__n">{waiting}</span>
          <span>
            <b>{waiting === 1 ? "A must-read is waiting for you" : `${waiting} must-reads are waiting for you`}</b>
            <small>Read {waiting === 1 ? "it" : "them"} through and confirm — it only takes a minute.</small>
          </span>
        </button>
      )}

      {browsing && recentCards.length > 0 && (
        <section className="ops-section">
          <h3 className="ops-section__h"><ClockIcon /> Recently viewed</h3>
          <div className="ops-recent">
            {recentCards.map((s) => (
              <button key={s.id} type="button" className="ops-recent__item" onClick={() => onOpen(s.id)}>
                <OpsTile icon={s.icon} color={s.color} size={28} />
                <span>{s.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {(collections.length > 0 || canEdit) && !q && (
        <section className="ops-section">
          <h3 className="ops-section__h">Collections</h3>
          <div className="ops-cols">
            {collections.map((c) => (
              <div key={c.id} className={"ops-col" + (collectionId === c.id ? " on" : "")} style={{ ["--c" as string]: c.color }}>
                <button
                  type="button"
                  className="ops-col__main"
                  aria-pressed={collectionId === c.id}
                  onClick={() => setCollectionId(collectionId === c.id ? null : c.id)}
                >
                  <OpsTile icon={c.icon} color={c.color} size={38} />
                  <span className="ops-col__txt">
                    <b>{c.name}</b>
                    <small>{c.sopCount} SOP{c.sopCount === 1 ? "" : "s"}</small>
                  </span>
                </button>
                {canEdit && (
                  <button type="button" className="ops-col__edit" onClick={() => setEditingCollection(c)} aria-label={`Edit ${c.name}`} title="Edit collection">
                    <EditIcon />
                  </button>
                )}
              </div>
            ))}
            {canEdit && (
              <button type="button" className="ops-col ops-col--new" onClick={() => setEditingCollection("new")}>
                <span className="ops-col__plus"><PlusIcon /></span>
                <span className="ops-col__txt"><b>New collection</b><small>Group related SOPs</small></span>
              </button>
            )}
          </div>
        </section>
      )}

      <section className="ops-section">
        <div className="ops-filterbar">
          <h3 className="ops-section__h">
            {q ? `Results for “${q}”` : activeCollection ? activeCollection.name : "All SOPs"}
            <span className="setcount">{shown.length}</span>
          </h3>
          <div className="ops-filters" role="group" aria-label="Filter SOPs">
            {chips.filter((c) => c.show).map((c) => {
              const n = c.key === "all" ? 0 : count(c.key);
              return (
                <button
                  key={c.key}
                  type="button"
                  className={"setfilterchip" + (filter === c.key ? " on" : "")}
                  aria-pressed={filter === c.key}
                  onClick={() => setFilter(c.key)}
                >
                  {c.label}
                  {n > 0 && <span className="ops-filters__n">{n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {lib.isError && (
          <div className="setempty">Couldn't load the library. <button className="btn-ghost sm" onClick={() => lib.refetch()}>Try again</button></div>
        )}
        {lib.isLoading && <div className="setempty">Loading…</div>}

        {shown.length > 0 && (
          <div className="ops-grid">
            {shown.map((s) => (
              <button key={s.id} type="button" className={"ops-card" + (s.status !== "published" ? " ops-card--quiet" : "")} onClick={() => onOpen(s.id)} style={{ ["--c" as string]: s.color }}>
                <span className="ops-card__top">
                  <OpsTile icon={s.icon} color={s.color} size={44} />
                  <span className="ops-card__flags"><SopFlags sop={s} /></span>
                </span>
                <b className="ops-card__title">{s.title}</b>
                {s.summary ? <span className="ops-card__sum">{s.summary}</span> : <span className="ops-card__sum ops-card__sum--none">No summary</span>}
                <span className="ops-card__teams"><TeamChips sop={s} teams={teams} /></span>
                <span className="ops-card__foot">
                  <span>{s.stepCount} step{s.stepCount === 1 ? "" : "s"}</span>
                  {s.version > 0 && <span>v{s.version}</span>}
                  <span className="ops-card__when">Updated {relativeTime(s.updatedAt)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {lib.data && shown.length === 0 && (
          <div className="setzero ops-zero">
            {all.length === 0 && !q ? (
              <>
                <span className="setzero__ic"><OpsIcon /></span>
                {canEdit ? (
                  <>
                    <p>No SOPs yet. Write down how something is done once — opening up, a refund, what to do when it goes wrong — and every team it's for can follow it.</p>
                    <button className="btn-primary" onClick={onNew}><PlusIcon /> Write the first SOP</button>
                  </>
                ) : (
                  <p>Nothing here for your teams yet. When an admin or manager publishes an SOP for one of your teams, it shows up here.</p>
                )}
              </>
            ) : (
              <p>{q ? `Nothing matches “${q}”.` : filter === "must_read" ? "No must-reads here." : filter === "review" ? "Nothing is due for review — everything's up to date." : filter === "drafts" ? "No drafts." : filter === "archived" ? "Nothing archived." : "No SOPs in this collection yet."}</p>
            )}
          </div>
        )}
      </section>

      {editingCollection && (
        <CollectionModal
          collection={editingCollection === "new" ? null : editingCollection}
          onClose={() => setEditingCollection(null)}
          onDeleted={(id) => { if (collectionId === id) setCollectionId(null); }}
          onToast={onToast}
        />
      )}
    </div>
  );
}
