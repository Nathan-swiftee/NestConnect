import type { ConversationEvent } from "@ding/schemas";
import { useConversationEvents } from "../hooks";
import { relativeTime, seenAt } from "../lib/format";
import { Avatar } from "./Avatar";
import { HistoryIcon, XIcon } from "../lib/icons";

/**
 * The conversation log: everything that happened to this conversation besides
 * its messages — routed, assigned, moved, closed, snoozed, labelled… — newest
 * first, with who did it. Read-only. Opened from the thread header's Log button;
 * a drawer on the right on desktop, a full-screen sheet on a phone.
 * See docs/conversation-log.md.
 */
export function ConversationLog({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const { data: events, isLoading, isError } = useConversationEvents(conversationId);

  return (
    <div className="modal modal--side" onClick={onClose}>
      <div className="modal__box convlog" role="dialog" aria-label="Conversation log" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Conversation log</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body convlog__body">
          {isLoading ? (
            <p className="convlog__empty">Loading…</p>
          ) : isError ? (
            <p className="convlog__empty">Couldn't load the log. Try again in a moment.</p>
          ) : !events?.length ? (
            <div className="convlog__empty">
              <HistoryIcon />
              <p>Nothing logged yet. Assignments, status changes, labels and the like show up here as they happen.</p>
            </div>
          ) : (
            <ol className="convlog__list">
              {events.map((e) => (
                <LogEntry key={e.id} e={e} />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function LogEntry({ e }: { e: ConversationEvent }) {
  const exact = new Date(e.at).toLocaleString();
  const rel = relativeTime(e.at);
  return (
    <li className={"convlog__item convlog__item--" + e.actor.kind}>
      <span className="convlog__who" aria-hidden>
        {e.actor.kind === "agent" ? (
          <Avatar name={e.actor.name} color={e.actor.avatarColor} src={e.actor.avatarUrl} size={26} fontSize={10} />
        ) : (
          <span className="convlog__dot" />
        )}
      </span>
      <div className="convlog__main">
        <div className="convlog__text">{e.text}</div>
        {e.until && <div className="convlog__detail">Until {seenAt(e.until)}</div>}
        {e.detail && <div className="convlog__detail">{e.detail}</div>}
      </div>
      <time className="convlog__time" dateTime={e.at} title={exact}>
        {rel === "now" ? "now" : `${rel} ago`}
      </time>
    </li>
  );
}
