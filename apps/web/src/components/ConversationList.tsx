import { useConversations } from "../hooks";
import { relativeTime, initials, slaCountdown } from "../lib/format";
import { channelMeta, SearchIcon, MenuIcon, CmdIcon } from "../lib/icons";

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
          <input placeholder="Search conversations, contacts…" aria-label="Search" />
        </div>
        <div className="chips">
          <button className="chip active">All</button>
          <button className="chip">Unread</button>
          <button className="chip">Assigned to me</button>
        </div>
      </div>

      <div className="convs">
        {isLoading && <div className="empty">Loading…</div>}
        {data && data.length === 0 && <div className="empty">Nothing here — inbox zero.</div>}
        {data?.map((c) => {
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
