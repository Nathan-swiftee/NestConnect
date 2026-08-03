import { useState, type FormEvent } from "react";
import type { ChannelType, RoutingStrategy } from "@ding/schemas";
import { useCreateInbox, useMe } from "../hooks";

const TYPES: { value: ChannelType; label: string }[] = [
  { value: "email", label: "Email address" },
  { value: "whatsapp", label: "WhatsApp number" },
  { value: "whatsapp_group", label: "WhatsApp group" },
];
const STRATEGIES: { value: RoutingStrategy; label: string }[] = [
  { value: "manual", label: "Manual — up for grabs" },
  { value: "round_robin", label: "Round-robin" },
  { value: "load_balanced", label: "Load-balanced" },
  { value: "most_idle", label: "Most idle" },
];

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onSelectView: (key: string) => void;
}

export function CreateInboxModal({ onClose, onToast, onSelectView }: Props) {
  const { data: me } = useMe();
  const create = useCreateInbox();
  const [type, setType] = useState<ChannelType>("email");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [routing, setRouting] = useState<RoutingStrategy>("manual");

  const teams = me?.teams ?? [];
  const toggleTeam = (id: string) =>
    setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const valid = name.trim() && handle.trim() && teamIds.length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate(
      { type, name: name.trim(), handle: handle.trim(), teamIds, routingStrategy: routing },
      {
        onSuccess: (inbox) => {
          onToast(`Inbox “${inbox.name}” created`);
          onSelectView(`inbox:${inbox.id}`);
          onClose();
        },
      },
    );
  };

  const placeholder =
    type === "email" ? "support@swiftee.co.uk" : type === "whatsapp_group" ? "The Ivy House" : "+44 20 7946 0100";

  return (
    <div className="modal" onClick={onClose}>
      <form className="modal__box" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="modal__head">
          <h2>New inbox &amp; route</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal__body">
          <label className="field">
            <span>Channel</span>
            <select value={type} onChange={(e) => setType(e.target.value as ChannelType)}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={type === "email" ? "Support" : "Sales line"} required />
          </label>
          <label className="field">
            <span>{type === "email" ? "Address" : "Handle"}</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={placeholder} required />
          </label>
          <div className="field">
            <span>Owning team(s)</span>
            <div className="checks">
              {teams.map((t) => (
                <label key={t.id} className={"check" + (teamIds.includes(t.id) ? " on" : "")}>
                  <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
          <label className="field">
            <span>Routing</span>
            <select value={routing} onChange={(e) => setRouting(e.target.value as RoutingStrategy)}>
              {STRATEGIES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {create.isError && <div className="login__err">Couldn’t create inbox (admins/managers only).</div>}
        </div>
        <div className="modal__foot">
          <button type="button" className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={create.isPending || !valid}>
            {create.isPending ? "Creating…" : "Create inbox"}
          </button>
        </div>
      </form>
    </div>
  );
}
