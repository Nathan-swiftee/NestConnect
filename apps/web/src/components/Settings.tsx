import { useState, type FormEvent } from "react";
import type { Role } from "@ding/schemas";
import { useCreateTeam, useCreateUser, useInboxes, usePeople, useTeams } from "../hooks";
import { initials } from "../lib/format";
import { channelMeta, PlusIcon, TeamIcon, XIcon } from "../lib/icons";

type Tab = "channels" | "teams" | "people";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
  onAddChannel: () => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "channels", label: "Channels" },
  { key: "teams", label: "Teams" },
  { key: "people", label: "People" },
];

export function Settings({ onClose, onToast, onAddChannel }: Props) {
  const [tab, setTab] = useState<Tab>("channels");
  return (
    <div className="settings" role="dialog" aria-label="Settings">
      <header className="settings__head">
        <h1>Settings</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close settings" title="Close">
          <XIcon />
        </button>
      </header>
      <div className="settings__body">
        <nav className="settings__tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={"settabs__btn" + (tab === t.key ? " active" : "")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings__pane">
          {tab === "channels" && <ChannelsPane onAddChannel={onAddChannel} />}
          {tab === "teams" && <TeamsPane onToast={onToast} />}
          {tab === "people" && <PeoplePane onToast={onToast} />}
        </div>
      </div>
    </div>
  );
}

function ChannelsPane({ onAddChannel }: { onAddChannel: () => void }) {
  const inboxes = useInboxes();
  const teams = useTeams();
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;
  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Channels</h2>
          <p>WhatsApp numbers and shared email inboxes. Each routes to one or more teams.</p>
        </div>
        <button className="btn-primary" onClick={onAddChannel}>
          <PlusIcon /> Add channel
        </button>
      </div>
      <div className="setlist">
        {inboxes.data?.map((i) => {
          const cm = channelMeta(i.type);
          const Glyph = cm.Glyph;
          return (
            <div className="setrow" key={i.id}>
              <span className="setrow__ic" style={{ color: cm.color }}>
                <Glyph />
              </span>
              <div className="setrow__main">
                <b>{i.name}</b>
                <small>{i.handle}</small>
              </div>
              <div className="setrow__meta">
                <span className="setrow__routing">{i.teamIds.map(teamName).join(", ") || "Unrouted"}</span>
                <span className="setrow__tag">{i.routingStrategy.replace(/_/g, " ")}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamsPane({ onToast }: { onToast: (msg: string) => void }) {
  const teams = useTeams();
  const people = usePeople();
  const create = useCreateTeam();
  const [name, setName] = useState("");
  const memberCount = (teamId: string) => (people.data ?? []).filter((m) => m.teamIds.includes(teamId)).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n },
      {
        onSuccess: () => { setName(""); onToast(`Team “${n}” created`); },
        onError: () => onToast("Only admins/managers can create teams"),
      },
    );
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Teams</h2>
          <p>Channels route to teams; a person can belong to several.</p>
        </div>
      </div>
      <form className="setadd" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name…" />
        <button className="btn-primary" type="submit" disabled={create.isPending || !name.trim()}>
          <PlusIcon /> Create team
        </button>
      </form>
      <div className="setlist">
        {teams.data?.map((t) => {
          const n = memberCount(t.id);
          return (
            <div className="setrow" key={t.id}>
              <span className="setrow__ic">
                <TeamIcon />
              </span>
              <div className="setrow__main">
                <b>{t.name}</b>
                <small>{n} member{n === 1 ? "" : "s"}</small>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const ROLES: { value: Role; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

function PeoplePane({ onToast }: { onToast: (msg: string) => void }) {
  const people = usePeople();
  const teams = useTeams();
  const create = useCreateUser();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [teamIds, setTeamIds] = useState<string[]>([]);

  const toggleTeam = (id: string) => setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;
  const valid = Boolean(name.trim() && email.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    create.mutate(
      { name: name.trim(), email: email.trim(), role, teamIds },
      {
        onSuccess: () => {
          onToast(`Invited ${name.trim()}`);
          setName(""); setEmail(""); setRole("agent"); setTeamIds([]); setOpen(false);
        },
        onError: () => onToast("Only admins/managers can add people"),
      },
    );
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>People</h2>
          <p>Team members who pick up conversations. New people sign in with the demo password.</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen((o) => !o)}>
          <PlusIcon /> Invite person
        </button>
      </div>

      {open && (
        <form className="setform" onSubmit={submit}>
          <div className="setform__grid">
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required />
            </label>
            <label className="field">
              <span>Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@swiftee.co.uk" required />
            </label>
            <label className="field">
              <span>Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="field">
            <span>Teams</span>
            <div className="checks">
              {teams.data?.map((t) => (
                <label key={t.id} className={"check" + (teamIds.includes(t.id) ? " on" : "")}>
                  <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
          <div className="setform__foot">
            <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn-primary" type="submit" disabled={create.isPending || !valid}>Invite</button>
          </div>
        </form>
      )}

      <div className="setlist">
        {people.data?.map((m) => (
          <div className="setrow" key={m.user.id}>
            <span className="av" style={{ background: m.user.avatarColor, width: 34, height: 34, fontSize: 12 }}>
              {initials(m.user.name)}
            </span>
            <div className="setrow__main">
              <b>{m.user.name}</b>
              <small>{m.user.email}</small>
            </div>
            <div className="setrow__meta">
              <span className="setrow__tag">{m.user.role}</span>
              <span className="setrow__routing">{m.teamIds.map(teamName).join(", ") || "No team"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
