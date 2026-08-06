import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useHoverGlide } from "../lib/useHoverGlide";
import type { ChannelType, Inbox, Role, RoutingStrategy, Team } from "@ding/schemas";
import {
  useCreateInbox,
  useCreateTeam,
  useCreateUser,
  useDeleteInbox,
  useDeleteTeam,
  useDeleteUser,
  useInboxes,
  useIntegrations,
  useMe,
  usePeople,
  useReorderTeams,
  useTeams,
  useUpdateInbox,
  useUpdateIntegrations,
  useUpdateTeam,
  useUpdateUser,
} from "../hooks";
import { initials } from "../lib/format";
import {
  channelMeta,
  ChevronDown,
  ChevronUp,
  EditIcon,
  GmailGlyph,
  PlusIcon,
  TeamGlyph,
  TEAM_ICON_KEYS,
  TEAM_ICONS,
  TrashIcon,
  XIcon,
} from "../lib/icons";

type Tab = "channels" | "teams" | "people" | "setup";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "channels", label: "Channels" },
  { key: "teams", label: "Teams" },
  { key: "people", label: "People" },
  { key: "setup", label: "Setup" },
];

const ROLES: { value: Role; label: string }[] = [
  { value: "agent", label: "Agent" },
  { value: "manager", label: "Manager" },
  { value: "admin", label: "Admin" },
];

const STRATEGIES: { value: RoutingStrategy; label: string }[] = [
  { value: "manual", label: "Queue (manual)" },
  { value: "round_robin", label: "Round robin" },
  { value: "load_balanced", label: "Load balanced" },
  { value: "most_idle", label: "Most idle" },
];

/** Show up to `max` team names, then "+N", so a person/channel on many teams
 *  can't blow out the row. Full list stays available via the title attribute. */
function summariseTeams(names: string[], max = 2): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} +${names.length - max}`;
}

export function Settings({ onClose, onToast }: Props) {
  const [tab, setTab] = useState<Tab>("channels");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabThumbRef = useRef<HTMLSpanElement>(null);
  const { containerRef: tabsRef, thumbRef: tabHoverRef, hoverProps: tabHover } = useHoverGlide<HTMLElement>(".settabs__btn", "xy");
  // Slide the tab thumb to the active tab — works for both the vertical (desktop)
  // and horizontal (mobile) layouts by matching its full box.
  useLayoutEffect(() => {
    const move = () => {
      const btn = tabRefs.current[tab];
      const thumb = tabThumbRef.current;
      if (btn && thumb) {
        thumb.style.transform = `translate(${btn.offsetLeft}px, ${btn.offsetTop}px)`;
        thumb.style.width = `${btn.offsetWidth}px`;
        thumb.style.height = `${btn.offsetHeight}px`;
      }
    };
    move();
    window.addEventListener("resize", move);
    return () => window.removeEventListener("resize", move);
  }, [tab]);

  return (
    <div className="settings" role="region" aria-label="Settings">
      <header className="settings__head">
        <h1>Settings</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close settings" title="Close">
          <XIcon />
        </button>
      </header>
      <div className="settings__body">
        <nav className="settings__tabs" ref={tabsRef} {...tabHover}>
          <span className="settabs__hover" ref={tabHoverRef} />
          <span className="settabs__thumb" ref={tabThumbRef} />
          {TABS.map((t) => (
            <button
              key={t.key}
              ref={(el) => {
                tabRefs.current[t.key] = el;
              }}
              className={"settabs__btn" + (tab === t.key ? " active" : "")}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings__pane" key={tab}>
          {tab === "channels" && <ChannelsPane onToast={onToast} />}
          {tab === "teams" && <TeamsPane onToast={onToast} />}
          {tab === "people" && <PeoplePane onToast={onToast} />}
          {tab === "setup" && <SetupPane onToast={onToast} />}
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
  const del = useDeleteInbox();
  const [connecting, setConnecting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;

  const remove = (id: string, name: string) => {
    if (!window.confirm(`Delete “${name}”? This removes the channel and its conversations.`)) return;
    del.mutate(id, {
      onSuccess: () => { setEditingId(null); onToast(`Channel “${name}” deleted`); },
      onError: () => onToast("Only admins & managers can delete channels"),
    });
  };

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
          const editing = editingId === i.id;
          return (
            <div className="setmember" key={i.id}>
              <div className="setrow">
                <span className="setrow__ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
                <div className="setrow__main">
                  <b>{i.name}</b>
                  <small>{i.handle}</small>
                </div>
                <div className="setrow__meta">
                  <span className="setrow__routing" title={i.teamIds.map(teamName).join(", ")}>
                    {summariseTeams(i.teamIds.map(teamName)) || "Unrouted"}
                  </span>
                  <span className="setrow__tag">{i.routingStrategy.replace(/_/g, " ")}</span>
                </div>
                <span className={"connpill " + (connected ? "on" : "off")} title={connected ? "Integration live" : "Add credentials to go live"}>
                  <span className="connpill__dot" />
                  {connected ? "Connected" : "Setup needed"}
                </span>
                <div className="rowacts">
                  <button className="iconbtn" title="Edit channel" onClick={() => setEditingId(editing ? null : i.id)}>
                    <EditIcon />
                  </button>
                  <button className="iconbtn danger" title="Delete channel" onClick={() => remove(i.id, i.name)}>
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {editing && (
                <ChannelEditor
                  inbox={i}
                  onDone={() => setEditingId(null)}
                  onDelete={() => remove(i.id, i.name)}
                  onToast={onToast}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ChannelEditor({
  inbox,
  onDone,
  onDelete,
  onToast,
}: {
  inbox: Inbox;
  onDone: () => void;
  onDelete: () => void;
  onToast: (msg: string) => void;
}) {
  const teams = useTeams();
  const update = useUpdateInbox();
  const kind = CHANNEL_KINDS.find((k) => k.type === inbox.type);
  const [name, setName] = useState(inbox.name);
  const [teamIds, setTeamIds] = useState<string[]>(inbox.teamIds);
  const [strategy, setStrategy] = useState<RoutingStrategy>(inbox.routingStrategy);
  const [cfg, setCfg] = useState<Record<string, string>>({});

  const setField = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleTeam = (id: string) =>
    setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const valid = name.trim().length > 0 && teamIds.length > 0;

  const save = () => {
    const channelConfig: Record<string, string> = {};
    for (const f of kind?.fields ?? []) {
      const v = (cfg[f.key] ?? "").trim();
      if (v) channelConfig[f.key] = v;
    }
    update.mutate(
      {
        id: inbox.id,
        input: {
          name: name.trim(),
          teamIds,
          routingStrategy: strategy,
          ...(Object.keys(channelConfig).length ? { channelConfig } : {}),
        },
      },
      {
        onSuccess: () => { onToast("Channel updated"); onDone(); },
        onError: () => onToast("Only admins & managers can edit channels"),
      },
    );
  };

  return (
    <div className="editbox">
      <div className="setform__grid two">
        <label className="field">
          <span>Display name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={inbox.handle} />
        </label>
        <label className="field">
          <span>Assignment</span>
          <select value={strategy} onChange={(e) => setStrategy(e.target.value as RoutingStrategy)}>
            {STRATEGIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </label>
      </div>
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
      {kind && (
        <div className="connect__creds">
          <div className="connect__credhead">Update credentials <em>— leave blank to keep current</em></div>
          <div className="setform__grid two">
            {kind.fields.map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <input
                  type={f.secret ? "password" : "text"}
                  autoComplete="off"
                  value={cfg[f.key] ?? ""}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder="••••••••"
                />
              </label>
            ))}
          </div>
        </div>
      )}
      <div className="setform__foot setform__foot--split">
        <button className="btn-ghost btn-danger" type="button" onClick={onDelete}>
          <TrashIcon /> Delete channel
        </button>
        <div className="setform__footactions">
          <button className="btn-ghost" type="button" onClick={onDone}>Cancel</button>
          <button className="btn-primary" type="button" onClick={save} disabled={update.isPending || !valid}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectChannel({ onDone, onToast }: { onDone: () => void; onToast: (msg: string) => void }) {
  const teams = useTeams();
  const create = useCreateInbox();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ChannelKind | null>(null);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<RoutingStrategy>("manual");

  const setField = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleTeam = (id: string) =>
    setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));

  // Gmail & WhatsApp skip the manual credential form entirely: they run the
  // provider's consent flow in a popup, which lands on our callback and creates
  // the inbox itself.
  const connectOAuth = (path: string, label: string) => {
    const popup = window.open(path, "channel-oauth", "width=560,height=720,menubar=no,toolbar=no");
    if (!popup) onToast(`Allow pop-ups for this site to connect ${label}`);
  };
  const connectGmail = () => connectOAuth("/api/channels/google/oauth/start", "Gmail");
  const connectWhatsApp = () => connectOAuth("/api/channels/meta/oauth/start", "WhatsApp");

  // The popup posts its result back to this window when it finishes.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as
        | { source?: string; ok?: boolean; provider?: string; email?: string; number?: string; error?: string }
        | null;
      if (!data || data.source !== "ding-oauth") return; // ignore unrelated messages
      if (data.ok) {
        qc.invalidateQueries({ queryKey: ["inboxes"] });
        qc.invalidateQueries({ queryKey: ["views"] });
        const who = data.provider === "whatsapp" ? "WhatsApp" : "Gmail";
        const detail = data.number ?? data.email ?? "";
        onToast(`${who} connected${detail ? ` (${detail})` : ""}`);
        onDone();
      } else {
        onToast(data.error || "Couldn't connect the channel");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [qc, onToast, onDone]);

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
          <button className="kindcard" onClick={connectGmail}>
            <span className="kindcard__ic" style={{ color: "#EA4335" }}>
              <GmailGlyph />
            </span>
            <b>Gmail</b>
            <small>Connect with Google — one click, no tokens to copy.</small>
          </button>
          <button className="kindcard" onClick={connectWhatsApp}>
            <span className="kindcard__ic" style={{ color: channelMeta("whatsapp").color }}>
              {(() => {
                const G = channelMeta("whatsapp").Glyph;
                return <G />;
              })()}
            </span>
            <b>WhatsApp</b>
            <small>Connect with Facebook — one click via Meta, no tokens to copy.</small>
          </button>
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

/** First-response SLA presets offered per team (stored as minutes). */
const SLA_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "No SLA", minutes: null },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "8 hours", minutes: 480 },
  { label: "1 day", minutes: 1440 },
];

/** Short human label for an SLA target, e.g. 90 → "1h 30m". */
export function slaLabel(minutes?: number | null): string | null {
  if (!minutes) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function TeamsPane({ onToast }: { onToast: (msg: string) => void }) {
  const teams = useTeams();
  const people = usePeople();
  const create = useCreateTeam();
  const update = useUpdateTeam();
  const del = useDeleteTeam();
  const reorder = useReorderTeams();
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const [draftSla, setDraftSla] = useState<number | null>(null);
  const ordered = teams.data ?? [];
  const memberCount = (teamId: string) => (people.data ?? []).filter((m) => m.teamIds.includes(teamId)).length;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n },
      {
        onSuccess: () => { setName(""); onToast(`Team “${n}” created`); },
        onError: () => onToast("Only admins & managers can create teams"),
      },
    );
  };

  const startEdit = (t: Team) => {
    setEditingId(t.id);
    setDraftName(t.name);
    setDraftIcon(t.icon ?? null);
    setDraftSla(t.slaMinutes ?? null);
  };
  const saveEdit = (id: string) => {
    const n = draftName.trim();
    if (!n) return;
    update.mutate(
      { id, input: { name: n, icon: draftIcon, slaMinutes: draftSla } },
      {
        onSuccess: () => { setEditingId(null); onToast("Team updated"); },
        onError: () => onToast("Couldn't update team"),
      },
    );
  };
  const remove = (id: string, teamName: string) => {
    if (!window.confirm(`Delete “${teamName}”? Its channels and people will be detached.`)) return;
    del.mutate(id, {
      onSuccess: () => { setEditingId(null); onToast(`Team “${teamName}” deleted`); },
      onError: () => onToast("Couldn't delete team"),
    });
  };
  const move = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= ordered.length) return;
    const ids = ordered.map((t) => t.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    reorder.mutate(ids);
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Teams</h2>
          <p>Channels route to teams; a person can belong to several. Reorder with the arrows and give each an icon.</p>
        </div>
      </div>
      <form className="setadd" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name…" />
        <button className="btn-primary" type="submit" disabled={create.isPending || !name.trim()}>
          <PlusIcon /> Create team
        </button>
      </form>
      <div className="setlist">
        {ordered.map((t, i) => {
          const n = memberCount(t.id);
          const editing = editingId === t.id;
          return (
            <div className="setmember" key={t.id}>
              <div className="setrow">
                <span className="setrow__ic">
                  <TeamGlyph icon={t.icon} />
                </span>
                <div className="setrow__main">
                  <b>{t.name}</b>
                  <small>
                    {n} member{n === 1 ? "" : "s"}
                    {slaLabel(t.slaMinutes) ? ` · SLA ${slaLabel(t.slaMinutes)}` : ""}
                  </small>
                </div>
                <div className="rowacts">
                  <button className="iconbtn" title="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}>
                    <ChevronUp />
                  </button>
                  <button className="iconbtn" title="Move down" disabled={i === ordered.length - 1 || reorder.isPending} onClick={() => move(i, 1)}>
                    <ChevronDown />
                  </button>
                  <button className="iconbtn" title="Edit team" onClick={() => (editing ? setEditingId(null) : startEdit(t))}>
                    <EditIcon />
                  </button>
                  <button className="iconbtn danger" title="Delete team" onClick={() => remove(t.id, t.name)}>
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {editing && (
                <div className="editbox">
                  <label className="field">
                    <span>Team name</span>
                    <input
                      value={draftName}
                      autoFocus
                      onChange={(e) => setDraftName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveEdit(t.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  </label>
                  <div className="field">
                    <span>Icon</span>
                    <div className="iconpick">
                      {TEAM_ICON_KEYS.map((k) => {
                        const Ic = TEAM_ICONS[k];
                        return (
                          <button
                            key={k}
                            type="button"
                            className={"iconpick__btn" + (draftIcon === k ? " on" : "")}
                            onClick={() => setDraftIcon(draftIcon === k ? null : k)}
                            title={k}
                            aria-label={k}
                          >
                            <Ic />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label className="field">
                    <span>First-response SLA</span>
                    <select
                      value={draftSla ?? ""}
                      onChange={(e) => setDraftSla(e.target.value ? Number(e.target.value) : null)}
                    >
                      {SLA_OPTIONS.map((o) => (
                        <option key={o.label} value={o.minutes ?? ""}>{o.label}</option>
                      ))}
                    </select>
                    <small className="fieldhint">New conversations routed to this team get a “respond within” timer; it clears on your first reply.</small>
                  </label>
                  <div className="setform__foot">
                    <button className="btn-ghost" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                    <button className="btn-primary" type="button" onClick={() => saveEdit(t.id)} disabled={update.isPending || !draftName.trim()}>
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
                  <span className="setrow__routing" title={m.teamIds.map(teamName).join(", ")}>
                    {summariseTeams(m.teamIds.map(teamName)) || "No team"}
                  </span>
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

/* ------------------------------------------------------------------ */
/* Setup — app-level integration credentials                          */
/* ------------------------------------------------------------------ */

function SetupPane({ onToast }: { onToast: (msg: string) => void }) {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const google = integrations.data?.google;
  const configured = Boolean(google?.configured);
  const meta = integrations.data?.meta;
  const metaConfigured = Boolean(meta?.configured);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pubsubTopic, setPubsubTopic] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [metaConfigId, setMetaConfigId] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Prefill non-secret values from the stored settings once they load.
  useEffect(() => {
    if (google?.clientId !== undefined) setClientId(google.clientId);
  }, [google?.clientId]);
  useEffect(() => {
    if (google?.pubsubTopic !== undefined) setPubsubTopic(google.pubsubTopic);
  }, [google?.pubsubTopic]);
  useEffect(() => {
    if (meta?.appId !== undefined) setMetaAppId(meta.appId);
  }, [meta?.appId]);
  useEffect(() => {
    if (meta?.configId !== undefined) setMetaConfigId(meta.configId);
  }, [meta?.configId]);

  const saveGoogle = () => {
    const input: {
      googleClientId?: string;
      googleClientSecret?: string;
      googlePubsubTopic?: string;
    } = {};
    const id = clientId.trim();
    const secret = clientSecret.trim();
    if (id) input.googleClientId = id;
    if (secret) input.googleClientSecret = secret; // only send the secret when set
    // Send the topic only when it changed (empty clears it → polling-only).
    if (pubsubTopic.trim() !== (google?.pubsubTopic ?? "")) {
      input.googlePubsubTopic = pubsubTopic.trim();
    }
    if (input.googleClientId === undefined && input.googleClientSecret === undefined && input.googlePubsubTopic === undefined) {
      onToast("Enter a Client ID and Secret to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setClientSecret("");
        onToast("Google settings saved");
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const saveMeta = () => {
    const input: { metaAppId?: string; metaAppSecret?: string; metaConfigId?: string } = {};
    const id = metaAppId.trim();
    const secret = metaAppSecret.trim();
    if (id) input.metaAppId = id;
    if (secret) input.metaAppSecret = secret; // only send the secret when set
    if (metaConfigId.trim() !== (meta?.configId ?? "")) input.metaConfigId = metaConfigId.trim();
    if (input.metaAppId === undefined && input.metaAppSecret === undefined && input.metaConfigId === undefined) {
      onToast("Enter an App ID and Secret to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setMetaAppSecret("");
        onToast("Meta settings saved");
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const copy = async (value: string | undefined, key: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      onToast(`${label} copied`);
      window.setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
    } catch {
      onToast("Couldn't copy — select the URL and copy manually");
    }
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Setup</h2>
          <p>App-level credentials that power one-click channel connections, set once for the whole workspace.</p>
        </div>
      </div>

      <div className="setupcard">
        <div className="setupcard__head">
          <span className="setrow__ic" style={{ color: "#EA4335" }}>
            <GmailGlyph />
          </span>
          <div className="setrow__main">
            <b>Google / Gmail</b>
            <small>The OAuth 2.0 client behind “Connect with Google”.</small>
          </div>
          <span className={"connpill " + (configured ? "on" : "off")} title={configured ? "Ready to connect Gmail accounts" : "Add a Client ID and Secret to enable"}>
            <span className="connpill__dot" />
            {configured ? "Connected app configured" : "Not configured"}
          </span>
        </div>

        <p className="fieldhint">
          These are the app-level Google OAuth credentials from your Google Cloud project’s OAuth 2.0 Client ID. People then connect their own Gmail with one click.
        </p>

        <div className="setform__grid two">
          <label className="field">
            <span>Client ID</span>
            <input
              value={clientId}
              autoComplete="off"
              onChange={(e) => setClientId(e.target.value)}
              placeholder="1029384756-abc123.apps.googleusercontent.com"
            />
          </label>
          <label className="field">
            <span>Client Secret</span>
            <input
              type="password"
              autoComplete="off"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={configured ? "••••• (hidden)" : "GOCSPX-…"}
            />
          </label>
        </div>

        <div className="field">
          <span>Redirect URI</span>
          <div className="copyrow">
            <input readOnly value={google?.redirectUri ?? ""} onFocus={(e) => e.target.select()} />
            <button className="btn-ghost" type="button" onClick={() => copy(google?.redirectUri, "redirect", "Redirect URI")}>
              {copiedKey === "redirect" ? "Copied" : "Copy"}
            </button>
          </div>
          <small className="fieldhint">Add this exact URL to your Google Cloud OAuth client’s Authorized redirect URIs.</small>
        </div>

        <div className="setupcard__sub">
          <b>Real-time delivery (optional)</b>
          <small>
            Gmail is checked every minute by default. For near-instant delivery, create a Google Cloud Pub/Sub
            topic, add the push endpoint below as its subscription, then paste the topic name here. Leave blank to
            keep polling.
          </small>
        </div>

        <div className="field">
          <span>Pub/Sub topic</span>
          <input
            value={pubsubTopic}
            autoComplete="off"
            onChange={(e) => setPubsubTopic(e.target.value)}
            placeholder="projects/your-project/topics/gmail-push"
          />
        </div>

        <div className="field">
          <span>Push endpoint</span>
          <div className="copyrow">
            <input readOnly value={google?.pushEndpoint ?? ""} onFocus={(e) => e.target.select()} />
            <button className="btn-ghost" type="button" onClick={() => copy(google?.pushEndpoint, "push", "Push endpoint")}>
              {copiedKey === "push" ? "Copied" : "Copy"}
            </button>
          </div>
          <small className="fieldhint">Register this as your Pub/Sub push subscription’s endpoint URL.</small>
        </div>

        <div className="setform__foot">
          <button className="btn-primary" type="button" onClick={saveGoogle} disabled={update.isPending || integrations.isLoading}>
            Save
          </button>
        </div>
      </div>

      <div className="setupcard">
        <div className="setupcard__head">
          <span className="setrow__ic" style={{ color: channelMeta("whatsapp").color }}>
            {(() => {
              const G = channelMeta("whatsapp").Glyph;
              return <G />;
            })()}
          </span>
          <div className="setrow__main">
            <b>Meta / WhatsApp</b>
            <small>The Meta app behind “Connect with Facebook” for WhatsApp.</small>
          </div>
          <span
            className={"connpill " + (metaConfigured ? "on" : "off")}
            title={metaConfigured ? "Ready to connect WhatsApp numbers" : "Add an App ID and Secret to enable"}
          >
            <span className="connpill__dot" />
            {metaConfigured ? "Connected app configured" : "Not configured"}
          </span>
        </div>

        <p className="fieldhint">
          These are the app-level credentials from your Meta app (App ID + Secret). People then connect their
          WhatsApp Business number with one click via Meta Business Suite.
        </p>

        <div className="setform__grid two">
          <label className="field">
            <span>App ID</span>
            <input
              value={metaAppId}
              autoComplete="off"
              onChange={(e) => setMetaAppId(e.target.value)}
              placeholder="1234567890123456"
            />
          </label>
          <label className="field">
            <span>App Secret</span>
            <input
              type="password"
              autoComplete="off"
              value={metaAppSecret}
              onChange={(e) => setMetaAppSecret(e.target.value)}
              placeholder={metaConfigured ? "••••• (hidden)" : "app secret"}
            />
          </label>
        </div>

        <div className="field">
          <span>Redirect URI</span>
          <div className="copyrow">
            <input readOnly value={meta?.redirectUri ?? ""} onFocus={(e) => e.target.select()} />
            <button className="btn-ghost" type="button" onClick={() => copy(meta?.redirectUri, "meta-redirect", "Redirect URI")}>
              {copiedKey === "meta-redirect" ? "Copied" : "Copy"}
            </button>
          </div>
          <small className="fieldhint">Add this exact URL under Facebook Login → Valid OAuth Redirect URIs.</small>
        </div>

        <div className="setupcard__sub">
          <b>Guided onboarding (optional)</b>
          <small>
            Paste your WhatsApp Embedded Signup configuration id to turn the popup into Meta’s guided number
            onboarding. Leave blank to connect an existing number via standard login.
          </small>
        </div>

        <div className="field">
          <span>Embedded Signup config id</span>
          <input
            value={metaConfigId}
            autoComplete="off"
            onChange={(e) => setMetaConfigId(e.target.value)}
            placeholder="Optional — e.g. 987654321098765"
          />
        </div>

        <div className="setform__foot">
          <button className="btn-primary" type="button" onClick={saveMeta} disabled={update.isPending || integrations.isLoading}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
