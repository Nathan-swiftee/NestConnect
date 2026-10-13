import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAT_GROUP_NAME_MAX, type ChatMember, type ChatRoom } from "@ding/schemas";
import { api, chatLastSeen, seenAt, useChatMutation, useMe, usePeople } from "../../hooks";
import { CheckIcon, EditIcon, LogoutIcon, MoreIcon, PlusIcon, XIcon } from "../../lib/icons";
import { Avatar } from "../Avatar";
import { RoomAvatar } from "./RoomAvatar";

const GROUP_EMOJIS = ["💬", "🚚", "📦", "🛠️", "📞", "💼", "🎯", "⭐", "🔥", "☕", "🏢", "🧾"];

/** Beside the chat: who's in it, its name and icon, my mute and pin, and leaving. */
export function ChatInfoPanel({
  room,
  onClose,
  onLeft,
  onOpenRoom,
  onToast,
}: {
  room: ChatRoom;
  onClose: () => void;
  onLeft: () => void;
  onOpenRoom: (id: string) => void;
  onToast: (m: string) => void;
}) {
  const me = useMe().data?.user;
  const people = usePeople();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(room.name);
  const [adding, setAdding] = useState(false);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const fail = (e: unknown) => onToast((e as Error).message || "Couldn't do that");

  const update = useChatMutation((input: { name?: string; emoji?: string | null }) => api.updateChatGroup(room.id, input));
  const prefs = useChatMutation((input: { muted?: boolean; pinned?: boolean }) => api.setChatRoomPrefs(room.id, input));
  const add = useChatMutation((ids: string[]) => api.addChatMembers(room.id, ids));
  const remove = useChatMutation((userId: string) => api.removeChatMember(room.id, userId));
  const role = useChatMutation(({ userId, r }: { userId: string; r: "admin" | "member" }) => api.setChatMemberRole(room.id, userId, r));
  const leave = useChatMutation(() => api.leaveChatRoom(room.id));
  const direct = useChatMutation((userId: string) => api.openDirectChat(userId));
  const audits = useQuery({
    queryKey: ["chat", "audits", room.id],
    queryFn: () => api.chatAudits(room.id),
    enabled: me?.role === "admin" && room.kind !== "team",
  });

  const notIn = useMemo(() => {
    const ids = new Set(room.members.map((m) => m.id));
    return (people.data ?? []).map((m) => m.user).filter((u) => !ids.has(u.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [people.data, room.members]);

  const kindLine =
    room.kind === "direct"
      ? chatLastSeen(room.other) || "Direct chat"
      : `${room.kind === "team" ? "Team chat" : "Group"} · ${room.memberCount} member${room.memberCount === 1 ? "" : "s"}`;

  return (
    <aside className="tc-infopanel" aria-label={room.kind === "direct" ? "Contact info" : "Group info"}>
      <header className="tc-infopanel__head">
        <button type="button" className="iconbtn" aria-label="Close" onClick={onClose}>
          <XIcon />
        </button>
        <h2>{room.kind === "direct" ? "Contact info" : room.kind === "team" ? "Team chat info" : "Group info"}</h2>
      </header>
      <div className="tc-infopanel__body">
        <div className="tc-infopanel__hero">
          <RoomAvatar room={room} size={84} />
          {renaming ? (
            <form
              className="tc-rename"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                update.mutate({ name: name.trim() }, { onSuccess: () => setRenaming(false), onError: fail });
              }}
            >
              <input autoFocus value={name} maxLength={CHAT_GROUP_NAME_MAX} aria-label="Group name" onChange={(e) => setName(e.target.value)} />
              <button type="submit" className="iconbtn" aria-label="Save name" disabled={!name.trim()}>
                <CheckIcon />
              </button>
            </form>
          ) : (
            <h3 className="tc-infopanel__name">
              {room.name}
              {room.canManage && (
                <button type="button" className="iconbtn" aria-label="Rename group" onClick={() => { setName(room.name); setRenaming(true); }}>
                  <EditIcon />
                </button>
              )}
            </h3>
          )}
          <p className="tc-infopanel__kind">{kindLine}</p>
          {room.canManage && (
            <div className="tc-emojis tc-emojis--small" role="radiogroup" aria-label="Group icon">
              {GROUP_EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={room.emoji === e}
                  className={room.emoji === e ? "on" : ""}
                  onClick={() => update.mutate({ emoji: room.emoji === e ? null : e }, { onError: fail })}
                >
                  {e}
                </button>
              ))}
            </div>
          )}
        </div>

        {room.isMember && (
          <section className="tc-infopanel__sec">
            <Toggle label="Mute notifications" hint="No sound or push — an @mention still gets through." on={room.muted} onChange={(v) => prefs.mutate({ muted: v }, { onError: fail })} />
            <Toggle label="Pin chat" hint="Keep it at the top of your list." on={room.pinned} onChange={(v) => prefs.mutate({ pinned: v }, { onError: fail })} />
          </section>
        )}

        {room.kind !== "direct" && (
          <section className="tc-infopanel__sec">
            <h4>
              {room.memberCount} member{room.memberCount === 1 ? "" : "s"}
            </h4>
            {room.kind === "team" && <p className="fieldhint">Everyone on the team is in its chat. Change who's on it in Settings › Teams.</p>}
            {room.canManage && !adding && (
              <button type="button" className="tc-pickrow tc-pickrow--new" onClick={() => setAdding(true)}>
                <span className="tc-av tc-av--new" aria-hidden="true">
                  <PlusIcon />
                </span>
                <span className="tc-pickrow__name">Add people</span>
              </button>
            )}
            {adding && (
              <div className="tc-adding">
                {notIn.length ? (
                  notIn.map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      className={"tc-pickrow" + (toAdd.has(u.id) ? " on" : "")}
                      onClick={() =>
                        setToAdd((cur) => {
                          const next = new Set(cur);
                          if (next.has(u.id)) next.delete(u.id);
                          else next.add(u.id);
                          return next;
                        })
                      }
                    >
                      <Avatar name={u.name} email={u.email} color={u.avatarColor} src={u.avatarUrl} size={32} fontSize={12} />
                      <span className="tc-pickrow__name">{u.name}</span>
                      <span className={"tc-check" + (toAdd.has(u.id) ? " on" : "")}>{toAdd.has(u.id) && <CheckIcon />}</span>
                    </button>
                  ))
                ) : (
                  <p className="fieldhint">Everyone's already in it.</p>
                )}
                <div className="tc-adding__acts">
                  <button type="button" className="btn-ghost" onClick={() => { setAdding(false); setToAdd(new Set()); }}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={!toAdd.size || add.isPending}
                    onClick={() =>
                      add.mutate([...toAdd], {
                        onSuccess: () => {
                          setAdding(false);
                          setToAdd(new Set());
                        },
                        onError: fail,
                      })
                    }
                  >
                    Add {toAdd.size || ""}
                  </button>
                </div>
              </div>
            )}
            {room.members.map((m) => (
              <MemberRow
                key={m.id}
                m={m}
                isMe={m.id === me?.id}
                groupAdmin={room.kind === "group" && m.role === "admin"}
                canManage={room.canManage && m.id !== me?.id}
                menuOpen={menuFor === m.id}
                onMenu={() => setMenuFor(menuFor === m.id ? null : m.id)}
                onMessage={() => {
                  setMenuFor(null);
                  direct.mutate(m.id, { onSuccess: (r) => onOpenRoom(r.id), onError: fail });
                }}
                onRole={(r) => {
                  setMenuFor(null);
                  role.mutate({ userId: m.id, r }, { onError: fail });
                }}
                onRemove={() => {
                  setMenuFor(null);
                  if (window.confirm(`Remove ${m.name} from “${room.name}”?`)) remove.mutate(m.id, { onError: fail });
                }}
              />
            ))}
          </section>
        )}

        {me?.role === "admin" && audits.data && audits.data.length > 0 && (
          <section className="tc-infopanel__sec">
            <h4>Read by admins</h4>
            <p className="fieldhint">When an admin who isn't in this chat opened it.</p>
            {audits.data.slice(0, 10).map((a, i) => (
              <div key={i} className="tc-info__row">
                <Avatar name={a.person.name} color={a.person.avatarColor} src={a.person.avatarUrl} size={26} fontSize={10} />
                <span className="tc-info__name">{a.person.name}</span>
                <span className="tc-info__at">{seenAt(a.at)}</span>
              </div>
            ))}
          </section>
        )}

        {room.canLeave && (
          <section className="tc-infopanel__sec">
            <button
              type="button"
              className="tc-danger"
              onClick={() => {
                if (!window.confirm(`Leave “${room.name}”? You can be added back by one of its admins.`)) return;
                leave.mutate(undefined, {
                  onSuccess: () => {
                    onToast(`You left “${room.name}”`);
                    onLeft();
                  },
                  onError: fail,
                });
              }}
            >
              <LogoutIcon /> Leave group
            </button>
          </section>
        )}
        <p className="tc-infopanel__note">Admins in your workspace can read team chats.</p>
      </div>
    </aside>
  );
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="tc-toggle" onClick={() => onChange(!on)}>
      <span className="tc-toggle__text">
        <span className="tc-toggle__label">{label}</span>
        <span className="tc-toggle__hint">{hint}</span>
      </span>
      <span className={"switch" + (on ? " on" : "")}>
        <span className="switch__dot" />
      </span>
    </button>
  );
}

function MemberRow({
  m,
  isMe,
  groupAdmin,
  canManage,
  menuOpen,
  onMenu,
  onMessage,
  onRole,
  onRemove,
}: {
  m: ChatMember;
  isMe: boolean;
  groupAdmin: boolean;
  canManage: boolean;
  menuOpen: boolean;
  onMenu: () => void;
  onMessage: () => void;
  onRole: (r: "admin" | "member") => void;
  onRemove: () => void;
}) {
  return (
    <div className="tc-member">
      <span className="tc-av" style={{ width: 36, height: 36 }}>
        <Avatar name={m.name} color={m.avatarColor} src={m.avatarUrl} size={36} fontSize={13} />
        {m.online && <span className="tc-av__dot" aria-label="Online" />}
      </span>
      <span className="tc-member__main">
        <span className="tc-member__name">{isMe ? "You" : m.name}</span>
        <span className="tc-member__sub">{chatLastSeen(m) || " "}</span>
      </span>
      {groupAdmin && <span className="tc-member__badge">Group admin</span>}
      {!isMe && (
        <div className="tc-member__menuwrap">
          <button type="button" className="iconbtn" aria-label={`Options for ${m.name}`} onClick={onMenu}>
            <MoreIcon />
          </button>
          {menuOpen && (
            <div className="menu tc-member__menu" role="menu">
              <button type="button" role="menuitem" onClick={onMessage}>
                Message {m.name.split(" ")[0]}
              </button>
              {canManage && (
                <button type="button" role="menuitem" onClick={() => onRole(groupAdmin ? "member" : "admin")}>
                  {groupAdmin ? "Remove as group admin" : "Make group admin"}
                </button>
              )}
              {canManage && (
                <button type="button" role="menuitem" className="danger" onClick={onRemove}>
                  Remove from group
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
