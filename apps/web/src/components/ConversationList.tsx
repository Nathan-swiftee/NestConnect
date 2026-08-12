import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useConversations, useSearchConversations, useRefresh, useSession, useTeams } from "../hooks";
import { listTime, slaCountdown, timeUntil } from "../lib/format";
import { Avatar } from "./Avatar";
import { channelMeta, SearchIcon, MenuIcon, CmdIcon, SnoozeIcon, RefreshIcon, ComposeIcon, PanelLeftIcon } from "../lib/icons";
import { NotificationBell } from "./NotificationBell";
import { useHoverGlide } from "../lib/useHoverGlide";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { applyListWidth, getListWidth, setListWidth, resetListWidth, LIST_MIN, LIST_MAX } from "../lib/layout";

type Filter = "all" | "unread" | "mine" | "unassigned" | "groups" | "closed";

interface Props {
  view: string;
  title: string;
  count: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCmdk: () => void;
  onCompose: () => void;
  onOpenDrawer?: () => void;
  /** Desktop only: true when the inbox sidebar is collapsed, so the list shows
   *  a button to bring it back. */
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
}

export function ConversationList({ view, title, count, selectedId, onSelect, onOpenCmdk, onCompose, onOpenDrawer, sidebarCollapsed, onExpandSidebar }: Props) {
  const listQuery = useConversations(view);
  const { data, isLoading } = listQuery;
  const teams = useTeams();
  const myId = useSession().data?.user.id;
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
        if (filter === "mine" && c.assigneeUserId !== myId) return false;
        if (filter === "unassigned" && c.assigneeUserId) return false;
        if (filter === "groups" && c.channel !== "whatsapp_group") return false;
        return true;
      });

  // "Mine" is all-assigned-to-me and "Queue" is all-unassigned, so an Unassigned
  // filter is redundant in both.
  const showUnassigned = view !== "mine" && view !== "grabs";
  // A "Yours" filter (assigned to me) is useful in shared team/channel inboxes,
  // where a mix of agents' conversations live; redundant in the personal views.
  const showMine = view.startsWith("team:") || view.startsWith("inbox:");
  // A team inbox already scopes to one team, so the per-card team label is redundant there.
  const showTeamTag = !view.startsWith("team:");
  // Per-filter counts (WhatsApp-style) — computed from the view's data, ignoring search.
  const active = (data ?? []).filter((c) => c.status !== "closed");
  const countFor = (key: Filter): number =>
    key === "all"
      ? active.length
      : key === "unread"
        ? active.filter((c) => c.unread).length
        : key === "mine"
          ? active.filter((c) => c.assigneeUserId === myId).length
          : key === "unassigned"
            ? active.filter((c) => !c.assigneeUserId).length
            : key === "groups"
              ? active.filter((c) => c.channel === "whatsapp_group").length
              : (data ?? []).filter((c) => c.status === "closed").length;
  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all" as Filter, label: "All" },
    { key: "unread" as Filter, label: "Unread" },
    ...(showMine ? [{ key: "mine" as Filter, label: "Yours" }] : []),
    ...(showUnassigned ? [{ key: "unassigned" as Filter, label: "Unassigned" }] : []),
    ...(hasGroups ? [{ key: "groups" as Filter, label: "Groups" }] : []),
    { key: "closed" as Filter, label: "Closed" },
  ].map((f) => ({ ...f, count: countFor(f.key) }));

  // Fall back to All if the active filter isn't available in the current view/data.
  useEffect(() => {
    if (
      (filter === "unassigned" && !showUnassigned) ||
      (filter === "mine" && !showMine) ||
      (filter === "groups" && !hasGroups)
    ) {
      setFilter("all");
    }
  }, [filter, showUnassigned, showMine, hasGroups]);
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const thumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: chipsRef, thumbRef: chipHoverRef, hoverProps } = useHoverGlide<HTMLDivElement>(".chip", "x");
  // A signature of the chip set + their live counts. Chip labels carry counts
  // ("All 3"), so their widths change when the view's counts change even though
  // `filter` doesn't — the thumb must re-measure then, or it sits on stale metrics.
  const filterSig = filters.map((f) => `${f.key}:${f.count}`).join("|");
  // Move the thumb directly on the DOM (no state → no extra render → no flash).
  useLayoutEffect(() => {
    const position = () => {
      const btn = chipRefs.current[filter];
      const thumb = thumbRef.current;
      if (btn && thumb && btn.offsetWidth) {
        thumb.style.transform = `translateX(${btn.offsetLeft}px)`;
        thumb.style.width = `${btn.offsetWidth}px`;
      }
    };
    position();
    // On first mount the metrics aren't settled yet (pane transition, web-font
    // reflow), so a single sync measure can land the thumb on the wrong chip
    // until the next click. Re-measure after layout + after fonts load, and
    // whenever the chips row resizes (list drag / device rotate).
    const raf = requestAnimationFrame(() => requestAnimationFrame(position));
    document.fonts?.ready?.then(position).catch(() => {});
    let ro: ResizeObserver | undefined;
    const container = chipsRef.current;
    if (container && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => position());
      ro.observe(container);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }, [filter, hasGroups, filterSig]);

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

  // Drag the right edge to widen/narrow the list. The width lives in a CSS var
  // written straight to the DOM per frame — no React re-render while dragging —
  // and is persisted to localStorage only on release.
  const [resizing, setResizing] = useState(false);
  // Bumped on keyboard/reset changes so aria-valuenow re-reads the live width
  // (drag itself stays re-render-free — the CSS var drives the visual resize).
  const [, bumpWidth] = useState(0);
  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = getListWidth();
    setResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => applyListWidth(startW + (ev.clientX - startX));
    const onUp = () => {
      setResizing(false);
      setListWidth(getListWidth());
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  const nudgeResize = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") setListWidth(getListWidth() - 16);
    else if (e.key === "ArrowRight") setListWidth(getListWidth() + 16);
    else return;
    e.preventDefault();
    bumpWidth((n) => n + 1);
  };
  const resetResize = () => {
    resetListWidth();
    bumpWidth((n) => n + 1);
  };

  return (
    <section className={"list" + (resizing ? " is-resizing" : "")} aria-label="Conversations">
      <div className="list__head">
        <div className="list__title">
          <button className="list__burger" onClick={onOpenDrawer} aria-label="Open menu" title="Menu">
            <MenuIcon />
          </button>
          {sidebarCollapsed && onExpandSidebar && (
            <button className="list__expand" onClick={onExpandSidebar} aria-label="Show inboxes" title="Show inboxes">
              <PanelLeftIcon />
            </button>
          )}
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
          <NotificationBell onOpenConversation={onSelect} />
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
              // Badge the most recent channel used (a thread can span channels).
              const cm = channelMeta(c.lastChannel ?? c.channel);
              // Ownership is viewer-relative: "Yours" only when it's assigned to
              // me; a teammate's chat shows their name; unassigned shows "Queue".
              const mine = !!c.assigneeUserId && c.assigneeUserId === myId;
              const assignedOther = !!c.assigneeUserId && !mine;
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
              <Avatar name={c.contact.displayName} email={c.contact.email} color={c.contact.avatarColor} className="av">
                <span className="ch" style={{ background: cm.color }}>
                  <Glyph />
                </span>
              </Avatar>
              <div className="conv__main">
                <div className="conv__top">
                  <span className="conv__name">{c.contact.displayName}</span>
                  <span className="conv__time">{listTime(c.lastActivityAt)}</span>
                </div>
                <div className="conv__prev">
                  <p>{c.preview}</p>
                  {c.unread &&
                    (c.unreadCount > 0 ? (
                      <span className="unreadbubble" title={`${c.unreadCount} unread`}>
                        {c.unreadCount > 99 ? "99+" : c.unreadCount}
                      </span>
                    ) : (
                      <span className="unreaddot" title="Unread" aria-label="Unread" />
                    ))}
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
                      <span
                        className={"tag " + (mine ? "owner" : assignedOther ? "assigned" : "grab")}
                        title={assignedOther && c.assigneeName ? `Assigned to ${c.assigneeName}` : undefined}
                      >
                        {mine ? "Yours" : assignedOther ? c.assigneeName?.split(" ")[0] ?? "Assigned" : "Queue"}
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

      <div
        className={"list__resizer" + (resizing ? " active" : "")}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize conversation list"
        aria-valuenow={getListWidth()}
        aria-valuemin={LIST_MIN}
        aria-valuemax={LIST_MAX}
        tabIndex={0}
        title="Drag to resize · double-click to reset"
        onPointerDown={startResize}
        onDoubleClick={resetResize}
        onKeyDown={nudgeResize}
      >
        <span className="list__resizer-bar" />
      </div>
    </section>
  );
}
