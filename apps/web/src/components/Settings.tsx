import { useState, type FormEvent } from "react";
import type { ChannelType, Role, RoutingStrategy } from "@ding/schemas";
import {
  useCreateInbox,
  useCreateTeam,
  useCreateUser,
  useDeleteTeam,
  useDeleteUser,
  useInboxes,
  useMe,
  usePeople,
  useTeams,
  useUpdateTeam,
  useUpdateUser,
} from "../hooks";
import { initials } from "../lib/format";
import { channelMeta, EditIcon, PlusIcon, TeamIcon, TrashIcon, XIcon } from "../lib/icons";

type Tab = "channels" | "teams" | "people";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "channels", label: "Channels" },
  { key: "teams", label: "Teams" },
  { key: "people", label: "People" },
];

const ROLES: { value: Role; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const STRATEGIES: { value: RoutingStrategy; label: string }[] = [
  { value: "manual", label: "Up for grabs (manual)" },
  { value: "round_robin", label: "Round robin" },
  { value: "load_balanced", label: "Load balanced" },
  { value: "most_idle", label: "Most idle" },
];

export function Settings({ onClose, onToast }: Props) {
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
          {tab === "channels" && <ChannelsPane onToast={onToast} />}
          {tab === "teams" && <TeamsPane onToast={onToast} />}
          {tab === "people" && <PeoplePane onToast={onToast} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Channels                                                            */
/* ------------------------------------------------------------------ */

interface ChannelField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
  optional?: boolean;
}
interface ChannelKind {
  type: ChannelType;
  label: string;
  desc: string;
  handleLabel: string;
  handlePlaceholder: string;
  fields: ChannelField[];
}

const CHANNEL_KINDS: ChannelKind[] = [
  {
    type: "whatsapp",
    label: "WhatsApp number",
    desc: "A WhatsApp Business number via the Meta Cloud API.",
    handleLabel: "Business phone number",
    handlePlaceholder: "+44 20 7946 0100",
    fields: [
      { key: "phoneNumberId", label: "Phone number ID", placeholder: "1029384756…" },
      { key: "accessToken", label: "Access token", placeholder: "EAAG…", secret: true },
      { key: "wabaId", label: "WhatsApp Business Account ID", placeholder: "Optional", optional: true },
      { key: "verifyToken", label: "Webhook verify token", placeholder: "A phrase you choose", optional: true },
    ],
  },
  {
    type: "email",
    label: "Email inbox",
    desc: "A shared mailbox, forwarded into Nest Connect.",
    handleLabel: "Inbox address",
    handlePlaceholder: "support@swiftee.co.uk",
    fields: [
      { key: "providerToken", label: "Postmark server token", placeholder: "server-token…", secret: true },
      { key: "fromName", label: "From name", placeholder: "Swiftee Support", optional: true },
    ],
  },
];

function ChannelsPane({ onToast }: { onToast: (msg: string) => void }) {
  const inboxes = useInboxes();
  const teams = useTeams();
  const [connecting, setConnecting] = useState(false);
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Channels</h2>
          <p>WhatsApp numbers and shared email inboxes. Each routes to one or more teams.</p>
        </div>
        {!connecting && (
          <button className="btn-primary" onClick={() => setConnecting(true)}>
            <PlusIcon /> Add channel
          </button>
        )}
      </div>

      {connecting && <ConnectChannel onDone={() => setConnecting(false)} onToast={onToast} />}

      <div className="setlist">
        {inboxes.data?.map((i) => {
          const cm = channelMeta(i.type);
          const Glyph = cm.Glyph;
          const connected = i.connected !== false;
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
              <span className={"connpill " + (connected ? "on" : "off")} title={connected ? "Integration live" : "Add credentials to go live"}>
                <span className="connpill__dot" />
                {connected ? "Connected" : "Setup needed"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ConnectChannel({ onDone, onToast }: { onDone: () => void; onToast: (msg: string) => void }) {
  const teams = useTeams();
  const create = useCreateInbox();
  const [kind, setKind] = useState<ChannelKind | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<RoutingStrategy>("manual");

  const setField = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleTeam = (id: string) =>
    setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  const requiredOk = kind
    ? kind.fields.filter((f) => !f.optional).every((f) => (cfg[f.key] ?? "").trim().length > 0)
    : false;
  const valid = Boolean(kind && handle.trim() && teamIds.length && requiredOk);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!kind || !valid) return;
    const channelConfig: Record<string, string> = {};
    for (const f of kind.fields) {
      const val = (cfg[f.key] ?? "").trim();
      if (val) channelConfig[f.key] = val;
    }
    create.mutate(
      {
        type: kind.type,
        name: name.trim() || handle.trim(),
        handle: handle.trim(),
        teamIds,
        routingStrategy: strategy,
        channelConfig,
      },
      {
        onSuccess: () => {
          onToast(`${kind.label} connected`);
          onDone();
        },
        onError: () => onToast("Only admins/managers can add channels"),
      },
    );
  };

  // Step 1 — pick a channel type.
  if (!kind) {
    return (
      <div className="connect">
        <div className="connect__head">
          <b>Connect a channel</b>
          <button className="btn-ghost sm" onClick={onDone}>Cancel</button>
        </div>
        <div className="kindgrid">
          {CHANNEL_KINDS.map((k) => {
            const cm = channelMeta(k.type);
            const Glyph = cm.Glyph;
            return (
              <button key={k.type} className="kindcard" onClick={() => setKind(k)}>
                <span className="kindcard__ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
                <b>{k.label}</b>
                <small>{k.desc}</small>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Step 2 — integration details.
  const cm = channelMeta(kind.type);
  const Glyph = cm.Glyph;
  return (
    <form className="connect" onSubmit={submit}>
      <div className="connect__head">
        <span className="connect__kind">
          <span className="setrow__ic" style={{ color: cm.color }}>
            <Glyph />
          </span>
          {kind.label}
        </span>
        <button className="btn-ghost sm" type="button" onClick={() => { setKind(null); setCfg({}); }}>
          Change
        </button>
      </div>

      <div className="setform__grid two">
        <label className="field">
          <span>{kind.handleLabel}</span>
          <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder={kind.handlePlaceholder} required />
        </label>
        <label className="field">
          <span>Display name <em>optional</em></span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={handle || "Shown in the sidebar"} />
        </label>
      </div>

      <div className="connect__creds">
        <div className="connect__credhead">Integration</div>
        <div className="setform__grid two">
          {kind.fields.map((f) => (
            <label className="field" key={f.key}>
              <span>
                {f.label} {f.optional && <em>optional</em>}
              </span>
              <input
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={cfg[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </label>
          ))}
        </div>
      </div>

      <div className="setform__grid two">
        <div className="field">
          <span>Route to team(s)</span>
          <div className="checks">
            {teams.data?.map((t) => (
              <label key={t.id} className={"check" + (teamIds.includes(t.id) ? " on" : "")}>
                <input type="checkbox" checked={teamIds.includes(t.id)} onChange={() => toggleTeam(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        </div>
        <label className="field">
          <span>Assignment</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}>
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="setform__foot">
        <button className="btn-ghost" type="button" onClick={onDone}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={create.isPending || !valid}>
          Connect channel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

function TeamsPane({ onToast }: { onToast: (msg: string) => void }) {
  const teams = useTeams();
  const people = usePeople();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const del = useDeleteTeam();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  const startEdit = (id: string, current: string) => { setEditingId(id); setDraft(current); };
  const saveEdit = (id: string) => {
    const n = draft.trim();
    if (!n) return;
    update.mutate(
      { id, input: { name: n } },
      {
        onSuccess: () => { setEditingId(null); onToast("Team renamed"); },
        onError: () => onToast("Couldn't rename team"),
      },
    );
  };
  const remove = (id: string, teamName: string) => {
    if (!window.confirm(`Delete “${teamName}”? Its channels and people will be detached.`)) return;
    del.mutate(id, {
      onSuccess: () => onToast(`Team “${teamName}” deleted`),
      onError: () => onToast("Couldn't delete team"),
    });
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
          const editing = editingId === t.id;
          return (
            <div className="setrow" key={t.id}>
              <span className="setrow__ic">
                <TeamIcon />
              </span>
              {editing ? (
                <div className="setrow__inline">
                  <input
                    value={draft}
                    autoFocus
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit(t.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <button className="btn-primary sm" onClick={() => saveEdit(t.id)} disabled={!draft.trim()}>Save</button>
                  <button className="btn-ghost sm" onClick={() => setEditingId(null)}>Cancel</button>
                </div>
              ) : (
                <>
                  <div className="setrow__main">
                    <b>{t.name}</b>
                    <small>{n} member{n === 1 ? "" : "s"}</small>
                  </div>
                  <div className="rowacts">
                    <button className="iconbtn" title="Rename" onClick={() => startEdit(t.id, t.name)}>
                      <EditIcon />
                    </button>
                    <button className="iconbtn danger" title="Delete team" onClick={() => remove(t.id, t.name)}>
                      <TrashIcon />
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

function PeoplePane({ onToast }: { onToast: (msg: string) => void }) {
  const people = usePeople();
  const teams = useTeams();
  const me = useMe();
  const create = useCreateUser();
  const update = useUpdateUser();
  const del = useDeleteUser();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [teamIds, setTeamIds] = useState<string[]>([]);

  const [editId, setEditId] = useState<string | null>(null);
  const [eRole, setERole] = useState<Role>("agent");
  const [eTeams, setETeams] = useState<string[]>([]);

  const toggleTeam = (id: string) => setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const toggleETeam = (id: string) => setETeams((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
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

  const startEdit = (id: string, r: Role, t: string[]) => {
    setOpen(false);
    setEditId(id); setERole(r); setETeams(t);
  };
  const saveEdit = (id: string) => {
    update.mutate(
      { id, input: { role: eRole, teamIds: eTeams } },
      {
        onSuccess: () => { setEditId(null); onToast("Member updated"); },
        onError: () => onToast("Couldn't update member"),
      },
    );
  };
  const remove = (id: string, who: string) => {
    if (!window.confirm(`Remove ${who}? They'll lose access and be unassigned.`)) return;
    del.mutate(id, {
      onSuccess: () => onToast(`${who} removed`),
      onError: () => onToast("Couldn't remove member"),
    });
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>People</h2>
          <p>Team members who pick up conversations. New people sign in with the demo password.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditId(null); setOpen((o) => !o); }}>
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
        {people.data?.map((m) => {
          const isSelf = me.data?.user.id === m.user.id;
          const editing = editId === m.user.id;
          return (
            <div className="setmember" key={m.user.id}>
              <div className="setrow">
                <span className="av" style={{ background: m.user.avatarColor, width: 34, height: 34, fontSize: 12 }}>
                  {initials(m.user.name)}
                </span>
                <div className="setrow__main">
                  <b>{m.user.name}{isSelf && <span className="youtag">You</span>}</b>
                  <small>{m.user.email}</small>
                </div>
                <div className="setrow__meta">
                  <span className="setrow__tag">{m.user.role}</span>
                  <span className="setrow__routing">{m.teamIds.map(teamName).join(", ") || "No team"}</span>
                </div>
                <div className="rowacts">
                  <button className="iconbtn" title="Edit member" onClick={() => startEdit(m.user.id, m.user.role, m.teamIds)}>
                    <EditIcon />
                  </button>
                  {!isSelf && (
                    <button className="iconbtn danger" title="Remove member" onClick={() => remove(m.user.id, m.user.name)}>
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </div>

              {editing && (
                <div className="editbox">
                  <div className="setform__grid">
                    <label className="field">
                      <span>Role</span>
                      <select value={eRole} onChange={(e) => setERole(e.target.value as Role)}>
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
                        <label key={t.id} className={"check" + (eTeams.includes(t.id) ? " on" : "")}>
                          <input type="checkbox" checked={eTeams.includes(t.id)} onChange={() => toggleETeam(t.id)} />
                          {t.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div className="setform__foot">
                    <button className="btn-ghost" type="button" onClick={() => setEditId(null)}>Cancel</button>
                    <button className="btn-primary" type="button" onClick={() => saveEdit(m.user.id)} disabled={update.isPending}>
                      Save changes
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
