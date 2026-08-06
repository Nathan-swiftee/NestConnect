import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useConversations, useTeams } from "../hooks";
import { relativeTime, initials, slaCountdown, timeUntil } from "../lib/format";
import { channelMeta, SearchIcon, MenuIcon, CmdIcon, SnoozeIcon } from "../lib/icons";
import { useHoverGlide } from "../lib/useHoverGlide";

type Filter = "all" | "unread" | "unassigned" | "groups" | "closed";

interface Props {
  view: string;
  title: string;
  count: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenCmdk: () => void;
  onOpenDrawer?: () => void;
}

export function ConversationList({ view, title, count, selectedId, onSelect, onOpenCmdk, onOpenDrawer }: Props) {
  const { data, isLoading } = useConversations(view);
  const teams = useTeams();
  const teamName = (id?: string | null) => (id ? teams.data?.find((t) => t.id === id)?.name : undefined);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const hasGroups = (data ?? []).some((c) => c.channel === "whatsapp_group");
  const shown = (data ?? []).filter((c) => {
    const closed = c.status === "closed";
    // Closed lives only under its own filter; every other filter hides it.
    if (filter === "closed" ? !closed : closed) return false;
    if (filter === "unread" && !c.unread) return false;
    if (filter === "unassigned" && c.assigneeUserId) return false;
    if (filter === "groups" && c.channel !== "whatsapp_group") return false;
    if (query && !`${c.contact.displayName} ${c.preview} ${c.subject ?? ""}`.toLowerCase().includes(query))
      return false;
    return true;
  });

  // "Mine" is already assignee-filtered, so an Unassigned filter is redundant there.
  const showUnassigned = view !== "mine";
  // A team inbox already scopes to one team, so the per-card team label is redundant there.
  const showTeamTag = !view.startsWith("team:");
  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    ...(showUnassigned ? [{ key: "unassigned" as Filter, label: "Unassigned" }] : []),
    ...(hasGroups ? [{ key: "groups" as Filter, label: "Groups" }] : []),
    { key: "closed", label: "Closed" },
  ];

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

  return (
    <section className="list" aria-label="Conversations">
      <div className="list__head">
        <div className="list__title">
          <button className="list__burger" onClick={onOpenDrawer} aria-label="Open menu" title="Menu">
            <MenuIcon />
          </button>
          <h1>{title}</h1>
          <span className="badge">{count}</span>
          <button className="kbd" onClick={onOpenCmdk} title="Command menu" aria-label="Command menu">
            <CmdIcon />
            <span>K</span>
          </button>
        </div>
        <div className="search">
          <SearchIcon />
          <input
            placeholder="Search conversations, contacts…"
            aria-label="Search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
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
            </button>
          ))}
        </div>
      </div>

      <div className="convs" key={view}>
        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && shown.length === 0 && (
          <div className="empty">
            {filter === "groups"
              ? "No group chats here."
              : filter === "closed"
                ? "No closed conversations."
                : filter === "unassigned"
                  ? "Nothing unassigned — all picked up."
                  : "Nothing here — inbox zero."}
          </div>
        )}
        {shown.map((c) => {
          const cm = channelMeta(c.channel);
          const owned = !!c.assigneeUserId;
          const Glyph = cm.Glyph;
          return (
            <button
              key={c.id}
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
          );
        })}
      </div>
    </section>
  );
}
