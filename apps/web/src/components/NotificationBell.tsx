import { useState } from "react";
import { useNotifications, useMarkNotificationsRead } from "../hooks";
import { relativeTime } from "../lib/format";
import { BellIcon, AtIcon, SnoozeIcon } from "../lib/icons";
import type { Notification } from "@ding/schemas";

/**
 * The bell: a per-user notification history (mentions, snoozed chats coming
 * due). High-frequency events like a brand-new inbound chat stay sound-only and
 * never appear here. Opening a notification jumps to its conversation.
 */
export function NotificationBell({ onOpenConversation }: { onOpenConversation: (id: string) => void }) {
  const { data } = useNotifications();
  const markRead = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const list = data ?? [];
  const unread = list.filter((n) => !n.read).length;

  const openNotif = (n: Notification) => {
    if (!n.read) markRead.mutate([n.id]);
    if (n.conversationId) onOpenConversation(n.conversationId);
    setOpen(false);
  };

  return (
    <div className="notif">
      <button
        className={"list__refresh notif__bell" + (unread ? " has-unread" : "")}
        onClick={() => setOpen((v) => !v)}
        title="Notifications"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <BellIcon />
        {unread > 0 && <span className="notif__badge">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <>
          <div className="notif__backdrop" onClick={() => setOpen(false)} />
          <div className="notif__panel" role="dialog" aria-label="Notifications">
            <div className="notif__head">
              <b>Notifications</b>
              {unread > 0 && (
                <button type="button" className="notif__clear" onClick={() => markRead.mutate(undefined)}>
                  Mark all read
                </button>
              )}
            </div>
            <div className="notif__list">
              {list.length === 0 ? (
                <p className="notif__empty">You’re all caught up.</p>
              ) : (
                list.map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    className={"notif__item" + (n.read ? "" : " unread")}
                    onClick={() => openNotif(n)}
                  >
                    <span className={"notif__ic notif__ic--" + n.type}>
                      {n.type === "mention" ? <AtIcon /> : <SnoozeIcon />}
                    </span>
                    <span className="notif__meta">
                      <b>{n.title}</b>
                      {n.body && <small>{n.body}</small>}
                      <span className="notif__time">{relativeTime(n.createdAt)}</span>
                    </span>
                    {!n.read && <span className="notif__unreaddot" aria-hidden="true" />}
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
