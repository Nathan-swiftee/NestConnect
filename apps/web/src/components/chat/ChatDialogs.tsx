import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAT_GROUP_NAME_MAX, type ChatMessage } from "@ding/schemas";
import { api, seenAt, useChatMutation, useMe, usePeople } from "../../hooks";
import { BackIcon, CheckDouble, CheckIcon, PlusIcon, SearchIcon, XIcon } from "../../lib/icons";
import { Avatar } from "../Avatar";

const GROUP_EMOJIS = ["💬", "🚚", "📦", "🛠️", "📞", "💼", "🎯", "⭐", "🔥", "☕", "🏢", "🧾"];

/** Start a chat: pick a person, or (managers and admins) set up a group. */
export function NewChatDialog({
  canCreateGroups,
  onClose,
  onOpened,
  onToast,
}: {
  canCreateGroups: boolean;
  onClose: () => void;
  onOpened: (roomId: string) => void;
  onToast: (m: string) => void;
}) {
  const me = useMe().data?.user;
  const people = usePeople();
  const [step, setStep] = useState<"pick" | "group">("pick");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const direct = useChatMutation((userId: string) => api.openDirectChat(userId));
  const group = useChatMutation(() => api.createChatGroup({ name: name.trim(), emoji, memberIds: [...chosen] }));

  const others = useMemo(
    () =>
      (people.data ?? [])
        .map((m) => m.user)
        .filter((u) => u.id !== me?.id)
        .filter((u) => !q.trim() || u.name.toLowerCase().includes(q.trim().toLowerCase()) || u.email.toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [people.data, me?.id, q],
  );

  const toggle = (id: string) =>
    setChosen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box tc-newchat" role="dialog" aria-label={step === "group" ? "New group" : "New chat"} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          {step === "group" ? (
            <button type="button" className="modal__x" aria-label="Back" onClick={() => setStep("pick")}>
              <BackIcon />
            </button>
          ) : null}
          <h2>{step === "group" ? "New group" : "New chat"}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body tc-newchat__body">
          {step === "group" && (
            <div className="tc-groupform">
              <div className="tc-groupform__row">
                <div className="tc-emojiwell" aria-label="Group icon">
                  {emoji ?? "💬"}
                </div>
                <label className="field tc-groupform__name">
                  <span>Group name</span>
                  <input
                    autoFocus
                    value={name}
                    maxLength={CHAT_GROUP_NAME_MAX}
                    placeholder="e.g. Dispatch London"
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              </div>
              <div className="tc-emojis" role="radiogroup" aria-label="Pick an icon">
                {GROUP_EMOJIS.map((e) => (
                  <button key={e} type="button" role="radio" aria-checked={emoji === e} className={emoji === e ? "on" : ""} onClick={() => setEmoji(emoji === e ? null : e)}>
                    {e}
                  </button>
                ))}
              </div>
              <p className="fieldhint">
                {chosen.size ? `${chosen.size} ${chosen.size === 1 ? "person" : "people"} added — you'll be the group's admin.` : "Add people below. You'll be the group's admin."}
              </p>
            </div>
          )}
          <div className="tc-search tc-search--dialog">
            <SearchIcon />
            <input type="search" placeholder="Search people" aria-label="Search people" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {step === "pick" && canCreateGroups && (
            <button type="button" className="tc-pickrow tc-pickrow--new" onClick={() => setStep("group")}>
              <span className="tc-av tc-av--new" aria-hidden="true">
                <PlusIcon />
              </span>
              <span className="tc-pickrow__name">New group</span>
            </button>
          )}
          <div className="tc-picklist" role="list">
            {others.map((u) => (
              <button
                key={u.id}
                type="button"
                role="listitem"
                className={"tc-pickrow" + (step === "group" && chosen.has(u.id) ? " on" : "")}
                disabled={direct.isPending}
                onClick={() =>
                  step === "group"
                    ? toggle(u.id)
                    : direct.mutate(u.id, { onSuccess: (room) => onOpened(room.id), onError: (e) => onToast((e as Error).message) })
                }
              >
                <Avatar name={u.name} email={u.email} color={u.avatarColor} src={u.avatarUrl} size={38} fontSize={13} />
                <span className="tc-pickrow__main">
                  <span className="tc-pickrow__name">{u.name}</span>
                  <span className="tc-pickrow__sub">{u.position || u.role.charAt(0).toUpperCase() + u.role.slice(1)}</span>
                </span>
                {step === "group" && <span className={"tc-check" + (chosen.has(u.id) ? " on" : "")}>{chosen.has(u.id) && <CheckIcon />}</span>}
              </button>
            ))}
            {!others.length && <p className="tc-empty">No one matches.</p>}
          </div>
        </div>
        {step === "group" && (
          <div className="modal__foot">
            <button type="button" className="btn-ghost" onClick={() => setStep("pick")}>
              Back
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={!name.trim() || group.isPending}
              onClick={() =>
                group.mutate(undefined, {
                  onSuccess: (room) => {
                    onToast(`“${room.name}” created`);
                    onOpened(room.id);
                  },
                  onError: (e) => onToast((e as Error).message),
                })
              }
            >
              Create group
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Who has read one of my messages, who only has it, and who hasn't yet. */
export function MessageInfoDialog({ message, onClose }: { message: ChatMessage; onClose: () => void }) {
  const info = useQuery({ queryKey: ["chat", "info", message.id], queryFn: () => api.chatMessageInfo(message.id), staleTime: 0 });
  const section = (title: string, rows: Array<{ id: string; name: string; avatarColor: string | null; avatarUrl: string | null; at?: string }>, read = false) =>
    rows.length ? (
      <section className="tc-info__sec">
        <h3>
          <span className={"tc-tick" + (read ? " read" : "")}>
            <CheckDouble />
          </span>
          {title}
        </h3>
        {rows.map((r) => (
          <div key={r.id} className="tc-info__row">
            <Avatar name={r.name} color={r.avatarColor} src={r.avatarUrl} size={30} fontSize={11} />
            <span className="tc-info__name">{r.name}</span>
            {r.at && <span className="tc-info__at">{seenAt(r.at)}</span>}
          </div>
        ))}
      </section>
    ) : null;
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box modal--dialog tc-info" role="dialog" aria-label="Message info" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Message info</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">
          <div className="tc-info__quote">{message.body}</div>
          {info.isLoading ? (
            <p className="tc-empty">Loading…</p>
          ) : info.data ? (
            <>
              {section("Read by", info.data.readBy.map((r) => ({ ...r.person, at: r.at })), true)}
              {section("Delivered to", info.data.deliveredTo.map((r) => ({ ...r.person, at: r.at })))}
              {info.data.waiting.length > 0 && (
                <section className="tc-info__sec">
                  <h3>Not delivered yet</h3>
                  {info.data.waiting.map((p) => (
                    <div key={p.id} className="tc-info__row">
                      <Avatar name={p.name} color={p.avatarColor} src={p.avatarUrl} size={30} fontSize={11} />
                      <span className="tc-info__name">{p.name}</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          ) : (
            <p className="tc-empty">Couldn't load this.</p>
          )}
        </div>
      </div>
    </div>
  );
}
