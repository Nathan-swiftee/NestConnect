import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversations, useSearchConversations, useRefresh, useTeams } from "../hooks";
import { relativeTime, initials, slaCountdown, timeUntil } from "../lib/format";
import { channelMeta, SearchIcon, MenuIcon, CmdIcon, SnoozeIcon, RefreshIcon, ComposeIcon } from "../lib/icons";
import { useHoverGlide } from "../lib/useHoverGlide";
import { usePullToRefresh } from "../lib/usePullToRefresh";

type Filter = "all" | "unread" | "unassigned" | "groups" | "closed";

interface Props {
  view: string;
  title: string;
  count: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCmdk: () => void;
  onCompose: () => void;
  onOpenDrawer?: () => void;
}

export function ConversationList({ view, title, count, selectedId, onSelect, onOpenCmdk, onCompose, onOpenDrawer }: Props) {
  const listQuery = useConversations(view);
  const { data, isLoading } = listQuery;
  const teams = useTeams();
  const teamName = (id?: string | null) => (id ? teams.data?.find((t) => t.id === id)?.name : undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const { refresh, refreshing } = useRefresh();
  const convsRef = useRef<HTMLDivElement>(null);
  const { pull, armed, handlers } = usePullToRefresh(convsRef, refresh, refreshing);

  const query = q.trim();
  // A non-empty query switches the list to a global search — spanning every
  // conversation and message body, not just this view's loaded rows.
  const searching = query.length > 0;
  const search = useSearchConversations(query, searching);
  const hasGroups = (data ?? []).some((c) => c.channel === "whatsapp_group");
  const shown = searching
    ? search.data ?? []
    : (data ?? []).filter((c) => {
        const closed = c.status === "closed";
        // Closed lives only under its own filter; every other filter hides it.
        if (filter === "closed" ? !closed : closed) return false;
        if (filter === "unread" && !c.unread) return false;
        if (filter === "unassigned" && c.assigneeUserId) return false;
        if (filter === "groups" && c.channel !== "whatsapp_group") return false;
        return true;
      });

  // "Mine" is all-assigned-to-me and "Queue" is all-unassigned, so an Unassigned
  // filter is redundant in both.
  const showUnassigned = view !== "mine" && view !== "grabs";
  // A team inbox already scopes to one team, so the per-card team label is redundant there.
  const showTeamTag = !view.startsWith("team:");
  // Per-filter counts (WhatsApp-style) — computed from the view's data, ignoring search.
  const active = (data ?? []).filter((c) => c.status !== "closed");
  const countFor = (key: Filter): number =>
    key === "all"
      ? active.length
      : key === "unread"
        ? active.filter((c) => c.unread).length
        : key === "unassigned"
          ? active.filter((c) => !c.assigneeUserId).length
          : key === "groups"
            ? active.filter((c) => c.channel === "whatsapp_group").length
            : (data ?? []).filter((c) => c.status === "closed").length;
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all" as Filter, label: "All" },
    { key: "unread" as Filter, label: "Unread" },
    ...(showUnassigned ? [{ key: "unassigned" as Filter, label: "Unassigned" }] : []),
    ...(hasGroups ? [{ key: "groups" as Filter, label: "Groups" }] : []),
    { key: "closed" as Filter, label: "Closed" },
  ].map((f) => ({ ...f, count: countFor(f.key) }));

  // Fall back to All if the active filter isn't available in the current view/data.
  useEffect(() => {
    if ((filter === "unassigned" && !showUnassigned) || (filter === "groups" && !hasGroups)) {
      setFilter("all");
    }
  }, [filter, showUnassigned, hasGroups]);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const thumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: chipsRef, thumbRef: chipHoverRef, hoverProps } = useHoverGlide<HTMLDivElement>(".chip", "x");
  // Move the thumb directly on the DOM (no state → no extra render → no flash).
  useLayoutEffect(() => {
    const btn = chipRefs.current[filter];
    const thumb = thumbRef.current;
    if (btn && thumb) {
      thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
      thumb.style.width = `${btn.offsetWidth}px`;
    }
  }, [filter, hasGroups]);

  // Virtualize the row list so only the visible rows mount, however long the
  // (paginated) list grows. Rows self-measure, so variable heights are fine.
  const rowVirtualizer = useVirtualizer({
    count: shown.length,
    getScrollElement: () => convsRef.current,
    estimateSize: () => 78,
    overscan: 8,
    getItemKey: (i) => shown[i].id,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  // The active paginator (search vs the view list) — fetch the next page as the
  // last rows come into view, so we never load the whole inbox up front.
  const pager = searching ? search : listQuery;
  useEffect(() => {
    const last = virtualRows[virtualRows.length - 1];
    if (last && last.index >= shown.length - 6 && pager.hasNextPage && !pager.isFetchingNextPage) {
      void pager.fetchNextPage();
    }
  }, [virtualRows, shown.length, pager.hasNextPage, pager.isFetchingNextPage, pager.fetchNextPage]);

  return (
    <section className="list" aria-label="Conversations">
      <div className="list__head">
        <div className="list__title">
          <button className="list__burger" onClick={onOpenDrawer} aria-label="Open menu" title="Menu">
            <MenuIcon />
          </button>
          <h1>{title}</h1>
          <span className="badge">{count}</span>
          <button
            className={"list__refresh" + (refreshing ? " spinning" : "")}
            onClick={() => refresh()}
            disabled={refreshing}
            title="Refresh — fetch new messages"
            aria-label="Refresh"
          >
            <RefreshIcon />
          </button>
          <button className="kbd" onClick={onOpenCmdk} title="Command menu" aria-label="Command menu">
            <CmdIcon />
            <span>K</span>
          </button>
          <button className="list__compose" onClick={onCompose} title="New message" aria-label="New message">
            <ComposeIcon />
          </button>
        </div>
        <div className="search">
          <SearchIcon />
          <input
            placeholder="Search all conversations & messages…"
            aria-label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="search__clear" onClick={() => setQ("")} aria-label="Clear search" title="Clear">
              ✕
            </button>
          )}
        </div>
        {searching ? (
          <div className="list__searchnote">
            {search.isFetching ? "Searching…" : `${shown.length} result${shown.length === 1 ? "" : "s"} for “${query}”`}
          </div>
        ) : (
          <div className="chips" ref={chipsRef} {...hoverProps}>
            <span className="seg-hover" ref={chipHoverRef} />
            <span className="seg-thumb" ref={thumbRef} />
            {filters.map((f) => (
              <button
                key={f.key}
                ref={(el) => {
                  chipRefs.current[f.key] = el;
                }}
                className={"chip" + (filter === f.key ? " active" : "")}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                {f.count > 0 && <span className="chipcount">{f.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="convs" key={view} ref={convsRef} {...handlers}>
        <div
          className={"ptr" + (refreshing ? " loading" : armed ? " armed" : "")}
          style={{ height: refreshing ? 38 : pull, opacity: refreshing ? 1 : Math.min(1, pull / 42) }}
          aria-hidden={!refreshing && pull === 0}
        >
          <span className="ptr__spin">
            <RefreshIcon />
          </span>
        </div>
        {(searching ? search.isLoading : isLoading) && <div className="empty">Loading…</div>}
        {!(searching ? search.isLoading : isLoading) && shown.length === 0 && (
          <div className="empty">
            {searching
              ? `No conversations match “${query}”.`
              : filter === "groups"
                ? "No group chats here."
                : filter === "closed"
                  ? "No closed conversations."
                  : filter === "unassigned"
                    ? "Nothing unassigned — all picked up."
                    : "Nothing here — inbox zero."}
          </div>
        )}
        {shown.length > 0 && (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
            {virtualRows.map((vr) => {
              const c = shown[vr.index];
              if (!c) return null;
              const cm = channelMeta(c.channel);
              const owned = !!c.assigneeUserId;
              const Glyph = cm.Glyph;
              return (
                <div
                  key={vr.key}
                  data-index={vr.index}
                  ref={rowVirtualizer.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
                >
                  <button
                    className={"conv" + (c.unread ? " unread" : "") + (selectedId === c.id ? " active" : "")}
                    onClick={() => onSelect(c.id)}
                  >
              <div className="av" style={{ background: c.contact.avatarColor }}>
                {initials(c.contact.displayName)}
                <span className="ch" style={{ background: cm.color }}>
                  <Glyph />
                </span>
              </div>
              <div className="conv__main">
                <div className="conv__top">
                  <span className="conv__name">{c.contact.displayName}</span>
                  <span className="conv__time">{relativeTime(c.lastActivityAt)}</span>
                </div>
                <div className="conv__prev">
                  <p>{c.preview}</p>
                  {c.unread && c.unreadCount > 0 && (
                    <span className="unreadbubble" title={`${c.unreadCount} unread`}>
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="conv__meta">
                  {c.status === "snoozed" && c.snoozedUntil ? (
                    new Date(c.snoozedUntil).getTime() <= Date.now() ? (
                      <span className="snoozepill due" title={`Due since ${new Date(c.snoozedUntil).toLocaleString()}`}>
                        <SnoozeIcon />
                        Due now
                      </span>
                    ) : (
                      <span className="snoozepill" title={`Wakes ${new Date(c.snoozedUntil).toLocaleString()}`}>
                        <SnoozeIcon />
                        Snoozed · {timeUntil(c.snoozedUntil)} left
                      </span>
                    )
                  ) : (
                    <>
                      <span className={"tag " + (owned ? "owner" : "grab")}>
                        {owned ? "Yours" : "Queue"}
                      </span>
                      {showTeamTag && teamName(c.assignedTeamId) && (
                        <span className="teamtag" title={`Routed to ${teamName(c.assignedTeamId)}`}>
                          {teamName(c.assignedTeamId)}
                        </span>
                      )}
                      {c.slaDueAt &&
                        (new Date(c.slaDueAt).getTime() <= Date.now() ? (
                          <span className="sla breach" title="First-response SLA breached">
                            <span className="d" />
                            Overdue
                          </span>
                        ) : (
                          <span className="sla" title="Time left to first response">
                            <span className="d" />
                            {slaCountdown(c.slaDueAt)}
                          </span>
                        ))}
                    </>
                  )}
                </div>
              </div>
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {pager.isFetchingNextPage && <div className="empty">Loading more…</div>}
      </div>
    </section>
  );
}
