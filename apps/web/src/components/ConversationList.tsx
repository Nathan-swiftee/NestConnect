import { useLayoutEffect, useRef, useState } from "react";
import { useConversations } from "../hooks";
import { relativeTime, initials, slaCountdown } from "../lib/format";
import { channelMeta, SearchIcon, MenuIcon, CmdIcon } from "../lib/icons";

type Filter = "all" | "unread" | "groups" | "closed";

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
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const query = q.trim().toLowerCase();
  const hasGroups = (data ?? []).some((c) => c.channel === "whatsapp_group");
  const shown = (data ?? []).filter((c) => {
    const closed = c.status === "closed";
    // Closed lives only under its own filter; every other filter hides it.
    if (filter === "closed" ? !closed : closed) return false;
    if (filter === "unread" && !c.unread) return false;
    if (filter === "groups" && c.channel !== "whatsapp_group") return false;
    if (query && !`${c.contact.displayName} ${c.preview} ${c.subject ?? ""}`.toLowerCase().includes(query))
      return false;
    return true;
  });

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    ...(hasGroups ? [{ key: "groups" as Filter, label: "Groups" }] : []),
    { key: "closed", label: "Closed" },
  ];
  const chipRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const thumbRef = useRef<HTMLSpanElement>(null);
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
        <div className="chips">
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

      <div className="convs">
        {isLoading && <div className="empty">Loading…</div>}
        {!isLoading && shown.length === 0 && (
          <div className="empty">
            {filter === "groups"
              ? "No group chats here."
              : filter === "closed"
                ? "No closed conversations."
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
                  <span className={"tag " + (owned ? "owner" : "grab")}>
                    {owned ? "Yours" : "Up for grabs"}
                  </span>
                  {c.slaDueAt && (
                    <span className="sla">
                      <span className="d" />
                      {slaCountdown(c.slaDueAt)}
                    </span>
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
