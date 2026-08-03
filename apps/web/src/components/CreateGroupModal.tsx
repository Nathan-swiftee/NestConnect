import { useState, type FormEvent } from "react";
import { GROUP_MAX_MEMBERS } from "@ding/schemas";
import { useCreateGroup, useViews } from "../hooks";
import { XIcon } from "../lib/icons";

interface Member {
  phone: string;
  name: string;
}
interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onSelectView: (key: string) => void;
}

export function CreateGroupModal({ onClose, onToast, onSelectView }: Props) {
  const { data: views } = useViews();
  const create = useCreateGroup();
  const groupInboxes = (views?.shared.inboxes ?? []).filter((i) => i.channel === "whatsapp_group");

  const [inboxId, setInboxId] = useState(groupInboxes[0]?.key.slice(6) ?? "");
  const [name, setName] = useState("");
  const [members, setMembers] = useState<Member[]>([{ phone: "", name: "" }]);

  const setMember = (i: number, patch: Partial<Member>) =>
    setMembers((ms) => ms.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const addRow = () => setMembers((ms) => (ms.length < GROUP_MAX_MEMBERS ? [...ms, { phone: "", name: "" }] : ms));
  const removeRow = (i: number) => setMembers((ms) => ms.filter((_, idx) => idx !== i));

  const cleanMembers = members
    .map((m) => ({ phone: m.phone.trim(), name: m.name.trim() || undefined }))
    .filter((m) => m.phone);
  const valid = Boolean(inboxId && name.trim() && cleanMembers.length > 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate(
      { inboxId, name: name.trim(), members: cleanMembers },
      {
        onSuccess: (conv) => {
          onToast(`Group “${name.trim()}” created`);
          onSelectView(`inbox:${conv.inboxId}`);
          onClose();
        },
      },
    );
  };

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal__head">
          <h2>New group space</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body">
          {groupInboxes.length === 0 && (
            <div className="login__err">
              Create a WhatsApp-group inbox first (New inbox &amp; route → WhatsApp group).
            </div>
          )}
          <label className="field">
            <span>Group inbox</span>
            <select value={inboxId} onChange={(e) => setInboxId(e.target.value)}>
              {groupInboxes.map((i) => (
                <option key={i.key} value={i.key.slice(6)}>{i.title}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Group name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="The Ivy House" required />
          </label>
          <div className="field">
            <span>
              Members <span className="count">{cleanMembers.length} / {GROUP_MAX_MEMBERS}</span>
            </span>
            <div className="memrows">
              {members.map((m, i) => (
                <div className="memrow" key={i}>
                  <input value={m.phone} onChange={(e) => setMember(i, { phone: e.target.value })} placeholder="+44 7…" />
                  <input value={m.name} onChange={(e) => setMember(i, { name: e.target.value })} placeholder="Name (optional)" />
                  <button type="button" className="rm" onClick={() => removeRow(i)} disabled={members.length === 1} aria-label="Remove member"><XIcon /></button>
                </div>
              ))}
            </div>
            {members.length < GROUP_MAX_MEMBERS && (
              <button type="button" className="addrow" onClick={addRow}>+ Add member</button>
            )}
          </div>
          {create.isError && <div className="login__err">Couldn’t create the group.</div>}
        </div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={create.isPending || !valid}>
            {create.isPending ? "Creating…" : "Create group"}
          </button>
        </div>
      </form>
    </div>
  );
}
