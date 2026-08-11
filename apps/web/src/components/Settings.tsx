import { useEffect, useState, type ComponentType, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ChannelType, Inbox, Role, RoutingStrategy, Team, Template, TemplateCategory } from "@ding/schemas";
import {
  useCreateInbox,
  useCreateTeam,
  useCreateTemplate,
  useCreateUser,
  useDeleteInbox,
  useDeleteTeam,
  useDeleteTemplate,
  useDeleteUser,
  useInboxes,
  useIntegrations,
  useMe,
  usePeople,
  useReorderTeams,
  useRerouteInbox,
  useSyncTemplates,
  useTeams,
  useTemplates,
  useUpdateInbox,
  useUpdateIntegrations,
  useUpdateTeam,
  useUpdateTemplate,
  useUpdateUser,
} from "../hooks";
import { initials, avatarBg } from "../lib/format";
import { api } from "../lib/api";
import { TEMPLATE_CATEGORIES, approvalMeta, countVariables } from "./TemplatePicker";
import {
  BoltIcon,
  channelMeta,
  ChevronDown,
  ChevronUp,
  EditIcon,
  GmailGlyph,
  InboxIcon,
  MailIcon,
  PlusIcon,
  RefreshIcon,
  StorageIcon,
  TeamGlyph,
  TEAM_ICON_KEYS,
  TEAM_ICONS,
  TrashIcon,
  XIcon,
} from "../lib/icons";

/** A settings destination. Leaves are grouped into the left-rail primary
 *  sections; each section surfaces its leaves as the top sub-navigation. */
type Leaf = "channels" | "templates" | "teams" | "people" | "connections" | "storage" | "email";
type SetupSub = "connections" | "storage" | "email";

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

interface NavSection {
  key: string;
  label: string;
  Icon: ComponentType;
  leaves: { key: Leaf; label: string }[];
}

/** Left-rail sections (primary nav) → their sub-nav leaves (secondary nav).
 *  A section's first leaf is what its rail button opens. */
const NAV: NavSection[] = [
  {
    key: "messaging",
    label: "Messaging",
    Icon: InboxIcon,
    leaves: [
      { key: "channels", label: "Channels" },
      { key: "templates", label: "Templates" },
    ],
  },
  {
    key: "org",
    label: "Organisation",
    Icon: TeamGlyph,
    leaves: [
      { key: "teams", label: "Teams" },
      { key: "people", label: "People" },
    ],
  },
  {
    key: "integrations",
    label: "Integrations",
    Icon: BoltIcon,
    leaves: [
      { key: "connections", label: "Connections" },
      { key: "storage", label: "Storage" },
      { key: "email", label: "Email" },
    ],
  },
];

/** Per-sub heading + blurb for the Integrations panes (one component, three sub-tabs). */
const SETUP_HEAD: Record<SetupSub, { h: string; p: string }> = {
  connections: {
    h: "Connections",
    p: "App-level OAuth credentials behind one-click channel connections, set once for the whole workspace.",
  },
  storage: {
    h: "Storage",
    p: "Where sent & received media — photos, files and voice notes — is stored.",
  },
  email: {
    h: "Email",
    p: "The app’s own transactional email: invites, password resets and the test send.",
  },
};

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
  const [active, setActive] = useState<Leaf>("channels");
  // The active primary section is whichever one owns the active leaf.
  const section = NAV.find((s) => s.leaves.some((l) => l.key === active)) ?? NAV[0];
  // Keep one pane key per section so switching *sub*-tabs within Integrations
  // doesn't remount SetupPane (it holds unsaved form state); switching sections
  // still swaps the key and plays the pane-in transition.
  const paneKey = section.key === "integrations" ? "integrations" : active;

  return (
    <div className="settings" role="region" aria-label="Settings">
      <header className="settings__head">
        <h1>Settings</h1>
        <button className="settings__x" onClick={onClose} aria-label="Close settings" title="Close">
          <XIcon />
        </button>
      </header>
      <div className="settings__body">
        <nav className="settings__nav" aria-label="Settings sections">
          {NAV.map((s) => {
            const on = s.key === section.key;
            return (
              <button
                key={s.key}
                type="button"
                className={"setnav__item" + (on ? " active" : "")}
                aria-current={on ? "page" : undefined}
                onClick={() => setActive(s.leaves[0].key)}
              >
                <span className="setnav__ic">
                  <s.Icon />
                </span>
                <span className="setnav__lbl">{s.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="settings__main">
          <nav className="settings__sub" aria-label={`${section.label} settings`}>
            {section.leaves.map((l) => (
              <button
                key={l.key}
                type="button"
                className={"setsub__btn" + (active === l.key ? " active" : "")}
                aria-current={active === l.key ? "page" : undefined}
                onClick={() => setActive(l.key)}
              >
                {l.label}
              </button>
            ))}
          </nav>

          <div className="settings__pane" key={paneKey}>
            {active === "channels" && <ChannelsPane onToast={onToast} />}
            {active === "templates" && <TemplatesPane onToast={onToast} />}
            {active === "teams" && <TeamsPane onToast={onToast} />}
            {active === "people" && <PeoplePane onToast={onToast} />}
            {(active === "connections" || active === "storage" || active === "email") && (
              <SetupPane sub={active} onToast={onToast} />
            )}
          </div>
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
  // After a one-click (OAuth) connect the new inbox is unrouted — open its editor
  // as soon as it appears so the admin chooses where it routes.
  const [routeHandle, setRouteHandle] = useState<string | null>(null);
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;

  useEffect(() => {
    if (!routeHandle) return;
    const match = inboxes.data?.find((i) => i.handle.toLowerCase() === routeHandle.toLowerCase());
    if (match) {
      setConnecting(false);
      setEditingId(match.id);
      setRouteHandle(null);
      onToast("Connected — choose where this inbox routes");
    }
  }, [routeHandle, inboxes.data, onToast]);

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

      {connecting && (
        <ConnectChannel
          onDone={() => setConnecting(false)}
          onConnected={(handle) => setRouteHandle(handle)}
          onToast={onToast}
        />
      )}

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
  const reroute = useRerouteInbox();
  const kind = CHANNEL_KINDS.find((k) => k.type === inbox.type);
  const [name, setName] = useState(inbox.name);
  const [teamIds, setTeamIds] = useState<string[]>(inbox.teamIds);
  const [strategy, setStrategy] = useState<RoutingStrategy>(inbox.routingStrategy);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [moveOpen, setMoveOpen] = useState(false);

  const setField = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }));
  const toggleTeam = (id: string) =>
    setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const valid = name.trim().length > 0 && teamIds.length > 0;
  // Did the team routing actually change? (order-independent)
  const teamsChanged = [...teamIds].sort().join(",") !== [...inbox.teamIds].sort().join(",");

  const save = () => {
    const channelConfig: Record<string, string> = {};
    for (const f of kind?.fields ?? []) {
      const v = (cfg[f.key] ?? "").trim();
      if (v) channelConfig[f.key] = v;
    }
    const wantsMove = teamsChanged && moveOpen;
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
        onSuccess: () => {
          if (wantsMove) {
            // Team routing changed and the admin opted in → move existing open chats.
            reroute.mutate(inbox.id, {
              onSuccess: (r) => {
                onToast(r.moved ? `Channel updated — ${r.moved} open chat${r.moved === 1 ? "" : "s"} moved` : "Channel updated");
                onDone();
              },
              onError: () => { onToast("Channel updated, but couldn't move existing chats"); onDone(); },
            });
          } else {
            onToast("Channel updated");
            onDone();
          }
        },
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
      {teamsChanged && (
        <label className="reroutecheck">
          <input type="checkbox" checked={moveOpen} onChange={(e) => setMoveOpen(e.target.checked)} />
          <span>Also move this channel’s open conversations to the new routing (chats on a team it no longer serves).</span>
        </label>
      )}
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
          <button className="btn-primary" type="button" onClick={save} disabled={update.isPending || reroute.isPending || !valid}>
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

function ConnectChannel({
  onDone,
  onConnected,
  onToast,
}: {
  onDone: () => void;
  onConnected: (handle: string) => void;
  onToast: (msg: string) => void;
}) {
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
        const handle = data.email ?? data.number ?? "";
        // Hand the new inbox's handle up so its routing editor opens; if we can't
        // identify it, just close the connect flow with a confirmation.
        if (handle) {
          onConnected(handle);
        } else {
          const who = data.provider === "whatsapp" ? "WhatsApp" : "Gmail";
          onToast(`${who} connected`);
          onDone();
        }
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
  // The most recent invite's set-password link, shown so the admin can share it
  // when no transactional email is connected yet.
  const [invite, setInvite] = useState<{ name: string; url: string; emailed: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [eName, setEName] = useState("");
  const [eRole, setERole] = useState<Role>("agent");
  const [eTeams, setETeams] = useState<string[]>([]);

  const toggleTeam = (id: string) => setTeamIds((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const toggleETeam = (id: string) => setETeams((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const teamName = (id: string) => teams.data?.find((t) => t.id === id)?.name ?? id;
  const valid = Boolean(name.trim() && email.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const who = name.trim();
    create.mutate(
      { name: who, email: email.trim(), role, teamIds },
      {
        onSuccess: (result) => {
          if (result.invite) {
            setInvite({ name: who, url: result.invite.url, emailed: result.invite.emailed });
            setCopied(false);
            onToast(result.invite.emailed ? `Invite emailed to ${email.trim()}` : `Invited ${who} — share their link below`);
          } else {
            onToast(`Invited ${who}`);
          }
          setName(""); setEmail(""); setRole("agent"); setTeamIds([]); setOpen(false);
        },
        onError: () => onToast("Only admins/managers can add people"),
      },
    );
  };

  const copyInvite = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      onToast("Invite link copied");
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      onToast("Couldn't copy — select the link and copy manually");
    }
  };

  const startEdit = (id: string, n: string, r: Role, t: string[]) => {
    setOpen(false);
    setEditId(id); setEName(n); setERole(r); setETeams(t);
  };
  const saveEdit = (id: string) => {
    const trimmed = eName.trim();
    if (!trimmed) return;
    update.mutate(
      { id, input: { name: trimmed, role: eRole, teamIds: eTeams } },
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
          <p>Team members who pick up conversations. Invited people get a link to set their own password.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditId(null); setOpen((o) => !o); }}>
          <PlusIcon /> Invite person
        </button>
      </div>

      {invite && (
        <div className="invitebox">
          <div className="invitebox__head">
            <b>{invite.emailed ? `Invite emailed to ${invite.name}` : `Invite ${invite.name}`}</b>
            <button className="iconbtn" title="Dismiss" onClick={() => setInvite(null)}>
              <XIcon />
            </button>
          </div>
          <p>
            {invite.emailed
              ? "They'll get an email with a link to set their own password. You can also share this link directly:"
              : "Email isn't connected yet, so send this set-password link to them directly. It expires in 7 days."}
          </p>
          <div className="copyrow">
            <input readOnly value={invite.url} onFocus={(e) => e.target.select()} />
            <button className="btn-primary" type="button" onClick={copyInvite}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        </div>
      )}

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
                <span className="av" style={{ background: avatarBg(m.user.name, m.user.avatarColor), width: 34, height: 34, fontSize: 12 }}>
                  {m.user.avatarUrl ? <img className="av__photo" src={m.user.avatarUrl} alt="" /> : initials(m.user.name)}
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
                  <button className="iconbtn" title="Edit member" onClick={() => startEdit(m.user.id, m.user.name, m.user.role, m.teamIds)}>
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
                      <span>Name</span>
                      <input value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Full name" />
                    </label>
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
                    <button className="btn-primary" type="button" onClick={() => saveEdit(m.user.id)} disabled={update.isPending || !eName.trim()}>
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
/* Templates — WhatsApp message templates (24-hour window)            */
/* ------------------------------------------------------------------ */

function TemplatesPane({ onToast }: { onToast: (msg: string) => void }) {
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const sync = useSyncTemplates();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const doSync = () => {
    sync.mutate(undefined, {
      onSuccess: (r) => onToast(`Synced ${r.synced} template${r.synced === 1 ? "" : "s"}`),
      onError: () => onToast("Only admins & managers can manage templates"),
    });
  };
  const remove = (t: Template) => {
    if (!window.confirm(`Delete “${t.name}”? Agents will no longer be able to send it.`)) return;
    del.mutate(t.id, {
      onSuccess: () => { setEditingId(null); onToast(`Template “${t.name}” deleted`); },
      onError: () => onToast("Only admins & managers can manage templates"),
    });
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Message templates</h2>
          <p>
            Pre-approved WhatsApp messages used to re-open a chat once its 24-hour window has
            closed. Variables like <code>{"{{1}}"}</code> are filled in when you send.
          </p>
        </div>
        <div className="setpane__headacts">
          <button className="btn-ghost" type="button" onClick={doSync} disabled={sync.isPending}>
            <RefreshIcon /> Sync from Meta
          </button>
          {!open && (
            <button className="btn-primary" onClick={() => { setEditingId(null); setOpen(true); }}>
              <PlusIcon /> New template
            </button>
          )}
        </div>
      </div>

      <p className="fieldhint tpl-synchint">
        “Sync from Meta” pulls the approved templates from a connected WhatsApp number — it’s a
        no-op until you connect one under Channels.
      </p>

      {open && <TemplateForm onDone={() => setOpen(false)} onToast={onToast} />}

      <div className="setlist">
        {templates.data?.map((t) => {
          const editing = editingId === t.id;
          const ap = approvalMeta(t.approvalStatus);
          return (
            <div className="setmember" key={t.id}>
              <div className="tpl-item">
                <div className="tpl-item__main">
                  <div className="tpl-item__top">
                    <b className="tpl-item__name">{t.name}</b>
                    <span className={"tpl-cat tpl-cat--" + t.category}>{t.category}</span>
                    <span className="tpl-lang">{t.language}</span>
                    <span className={"tpl-appr " + ap.cls}>
                      <span className="tpl-appr__dot" />
                      {ap.label}
                    </span>
                  </div>
                  <div className="tpl-item__body">{t.body}</div>
                </div>
                <div className="rowacts">
                  <button
                    className="iconbtn"
                    title="Edit template"
                    onClick={() => { setOpen(false); setEditingId(editing ? null : t.id); }}
                  >
                    <EditIcon />
                  </button>
                  <button className="iconbtn danger" title="Delete template" onClick={() => remove(t)}>
                    <TrashIcon />
                  </button>
                </div>
              </div>
              {editing && (
                <TemplateForm template={t} onDone={() => setEditingId(null)} onToast={onToast} />
              )}
            </div>
          );
        })}
        {templates.data && templates.data.length === 0 && !open && (
          <div className="setempty">
            No templates yet. Create one, or sync approved templates from a connected WhatsApp number.
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateForm({
  template,
  onDone,
  onToast,
}: {
  template?: Template;
  onDone: () => void;
  onToast: (msg: string) => void;
}) {
  const create = useCreateTemplate();
  const update = useUpdateTemplate();
  const editing = !!template;
  const [name, setName] = useState(template?.name ?? "");
  const [category, setCategory] = useState<TemplateCategory>(template?.category ?? "utility");
  const [language, setLanguage] = useState(template?.language ?? "en");
  const [body, setBody] = useState(template?.body ?? "");

  const nameOk = /^[a-z0-9_]+$/.test(name);
  const varCount = countVariables(body);
  const valid = nameOk && language.trim().length >= 2 && body.trim().length > 0;
  const pending = create.isPending || update.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const input = { name, category, language: language.trim(), body };
    if (editing) {
      update.mutate(
        { id: template.id, input },
        {
          onSuccess: () => { onToast("Template updated"); onDone(); },
          onError: () => onToast("Only admins & managers can manage templates"),
        },
      );
    } else {
      create.mutate(input, {
        onSuccess: () => { onToast(`Template “${name}” created`); onDone(); },
        onError: () => onToast("Only admins & managers can manage templates"),
      });
    }
  };

  return (
    <form className={editing ? "editbox" : "setform"} onSubmit={submit}>
      <div className="setform__grid two">
        <label className="field">
          <span>Name</span>
          <input
            value={name}
            autoComplete="off"
            autoFocus
            onChange={(e) => setName(e.target.value)}
            placeholder="order_confirmation"
          />
          <small className="fieldhint">
            Lower-case letters, numbers and underscores only.
            {name && !nameOk ? " That name isn’t valid." : ""}
          </small>
        </label>
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
            {TEMPLATE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field tpl-langfield">
        <span>Language</span>
        <input value={language} autoComplete="off" onChange={(e) => setLanguage(e.target.value)} placeholder="en" />
      </label>
      <label className="field">
        <span>
          Body {varCount > 0 && <em>{varCount} variable{varCount === 1 ? "" : "s"}</em>}
        </span>
        <textarea
          value={body}
          rows={4}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{1}}, your order {{2}} is on its way!"
        />
        <small className="fieldhint">
          Use <code>{"{{1}}"}</code>, <code>{"{{2}}"}</code> … for values filled in when the template is sent.
        </small>
      </label>
      <div className="setform__foot">
        <button className="btn-ghost" type="button" onClick={onDone}>Cancel</button>
        <button className="btn-primary" type="submit" disabled={pending || !valid}>
          {editing ? "Save changes" : "Create template"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Setup — app-level integration credentials                          */
/* ------------------------------------------------------------------ */

function SetupPane({ sub, onToast }: { sub: SetupSub; onToast: (msg: string) => void }) {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  const google = integrations.data?.google;
  const configured = Boolean(google?.configured);
  const meta = integrations.data?.meta;
  const metaConfigured = Boolean(meta?.configured);
  const storage = integrations.data?.storage;
  const storageConfigured = Boolean(storage?.configured);
  const smtp = integrations.data?.smtp;
  const smtpConfigured = Boolean(smtp?.configured);

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [pubsubTopic, setPubsubTopic] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [metaConfigId, setMetaConfigId] = useState("");
  const [r2AccountId, setR2AccountId] = useState("");
  const [r2Bucket, setR2Bucket] = useState("");
  const [r2AccessKeyId, setR2AccessKeyId] = useState("");
  const [r2SecretAccessKey, setR2SecretAccessKey] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpTesting, setSmtpTesting] = useState(false);
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
  useEffect(() => {
    if (storage?.accountId !== undefined) setR2AccountId(storage.accountId);
  }, [storage?.accountId]);
  useEffect(() => {
    if (storage?.bucket !== undefined) setR2Bucket(storage.bucket);
  }, [storage?.bucket]);
  useEffect(() => {
    if (smtp?.host !== undefined) setSmtpHost(smtp.host);
  }, [smtp?.host]);
  useEffect(() => {
    if (smtp?.port !== undefined) setSmtpPort(String(smtp.port));
  }, [smtp?.port]);
  useEffect(() => {
    if (smtp?.username !== undefined) setSmtpUsername(smtp.username);
  }, [smtp?.username]);
  useEffect(() => {
    if (smtp?.from !== undefined) setSmtpFrom(smtp.from);
  }, [smtp?.from]);

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

  const saveStorage = () => {
    const input: {
      r2AccountId?: string;
      r2Bucket?: string;
      r2AccessKeyId?: string;
      r2SecretAccessKey?: string;
    } = {};
    // Account id + bucket are non-secret — send when changed (empty clears).
    if (r2AccountId.trim() !== (storage?.accountId ?? "")) input.r2AccountId = r2AccountId.trim();
    if (r2Bucket.trim() !== (storage?.bucket ?? "")) input.r2Bucket = r2Bucket.trim();
    // Keys are write-only — only send when the field has a value.
    const akid = r2AccessKeyId.trim();
    const secret = r2SecretAccessKey.trim();
    if (akid) input.r2AccessKeyId = akid;
    if (secret) input.r2SecretAccessKey = secret;
    if (Object.keys(input).length === 0) {
      onToast("Enter your R2 details to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setR2AccessKeyId("");
        setR2SecretAccessKey("");
        onToast("Storage settings saved");
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const saveSmtp = () => {
    const input: {
      smtpHost?: string;
      smtpPort?: number;
      smtpUsername?: string;
      smtpPassword?: string;
      smtpFrom?: string;
    } = {};
    // Host/port/username/from are non-secret — send when changed (empty clears).
    if (smtpHost.trim() !== (smtp?.host ?? "")) input.smtpHost = smtpHost.trim();
    if (smtpPort.trim() && Number(smtpPort) !== (smtp?.port ?? 587)) input.smtpPort = Number(smtpPort);
    if (smtpUsername.trim() !== (smtp?.username ?? "")) input.smtpUsername = smtpUsername.trim();
    if (smtpFrom.trim() !== (smtp?.from ?? "")) input.smtpFrom = smtpFrom.trim();
    // The app password is write-only — send only when the field has a value.
    const pw = smtpPassword.trim();
    if (pw) input.smtpPassword = pw;
    if (Object.keys(input).length === 0) {
      onToast("Enter your SMTP details to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setSmtpPassword("");
        onToast("Email settings saved");
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const testSmtp = async () => {
    setSmtpTesting(true);
    try {
      const res = await api.testSmtp();
      onToast(res.sent ? "Test email sent — check your inbox" : `Couldn't send: ${res.error ?? "not configured"}`);
    } catch {
      onToast("Couldn't send test email");
    } finally {
      setSmtpTesting(false);
    }
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
          <h2>{SETUP_HEAD[sub].h}</h2>
          <p>{SETUP_HEAD[sub].p}</p>
        </div>
      </div>

      {sub === "connections" && (
      <>
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
      </>
      )}

      {sub === "storage" && (
      <div className="setupcard">
        <div className="setupcard__head">
          <span className="setrow__ic" style={{ color: "#F6821F" }}>
            <StorageIcon />
          </span>
          <div className="setrow__main">
            <b>Cloud storage · Cloudflare R2</b>
            <small>Where sent &amp; received media (photos, files, voice notes) is stored.</small>
          </div>
          <span
            className={"connpill " + (storageConfigured ? "on" : "off")}
            title={storageConfigured ? "Media is stored durably in R2" : "Using local disk — files are lost on redeploy"}
          >
            <span className="connpill__dot" />
            {storageConfigured ? "Storing in R2" : "Using ephemeral disk"}
          </span>
        </div>

        <p className="fieldhint">
          Without R2, uploaded media lives on the server’s local disk, which is wiped on every redeploy. Add a
          Cloudflare R2 bucket and an <b>Object Read &amp; Write</b> API token to keep media permanently. Takes effect
          within a few seconds of saving — no redeploy needed.
        </p>

        <div className="setform__grid two">
          <label className="field">
            <span>Account ID</span>
            <input
              value={r2AccountId}
              autoComplete="off"
              onChange={(e) => setR2AccountId(e.target.value)}
              placeholder="e.g. 8f2a…c1 (Cloudflare account id)"
            />
          </label>
          <label className="field">
            <span>Bucket</span>
            <input
              value={r2Bucket}
              autoComplete="off"
              onChange={(e) => setR2Bucket(e.target.value)}
              placeholder="e.g. nest-media"
            />
          </label>
        </div>

        <div className="setform__grid two">
          <label className="field">
            <span>Access Key ID</span>
            <input
              type="password"
              autoComplete="off"
              value={r2AccessKeyId}
              onChange={(e) => setR2AccessKeyId(e.target.value)}
              placeholder={storageConfigured ? "••••• (hidden)" : "R2 token access key id"}
            />
          </label>
          <label className="field">
            <span>Secret Access Key</span>
            <input
              type="password"
              autoComplete="off"
              value={r2SecretAccessKey}
              onChange={(e) => setR2SecretAccessKey(e.target.value)}
              placeholder={storageConfigured ? "••••• (hidden)" : "R2 token secret"}
            />
          </label>
        </div>

        <p className="fieldhint">
          In Cloudflare → R2: create a bucket, then under <b>Manage R2 API Tokens</b> create a token with
          Object Read &amp; Write permission. Copy the Account ID, Access Key ID and Secret here. Clear the bucket to
          switch back to disk.
        </p>

        <div className="setform__foot">
          <button className="btn-primary" type="button" onClick={saveStorage} disabled={update.isPending || integrations.isLoading}>
            Save
          </button>
        </div>
      </div>
      )}

      {sub === "email" && (
      <div className="setupcard">
        <div className="setupcard__head">
          <span className="setrow__ic" style={{ color: "#EA4335" }}>
            <MailIcon />
          </span>
          <div className="setrow__main">
            <b>Email sending · SMTP</b>
            <small>The app’s own emails — invites, password resets and the test send below.</small>
          </div>
          <span
            className={"connpill " + (smtpConfigured ? "on" : "off")}
            title={smtpConfigured ? "Transactional email is configured" : "No sender — invites show a link to copy instead"}
          >
            <span className="connpill__dot" />
            {smtpConfigured ? "Email connected" : "Not connected"}
          </span>
        </div>

        <p className="fieldhint">
          Works with Gmail using an <b>app password</b> (Google Account → Security → 2-Step Verification → App
          passwords). Host <b>smtp.gmail.com</b>, port <b>587</b>, username = your Gmail address. Takes effect
          immediately — no redeploy needed.
        </p>

        <div className="setform__grid two">
          <label className="field">
            <span>SMTP host</span>
            <input value={smtpHost} autoComplete="off" onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.gmail.com" />
          </label>
          <label className="field">
            <span>Port</span>
            <input value={smtpPort} autoComplete="off" inputMode="numeric" onChange={(e) => setSmtpPort(e.target.value)} placeholder="587" />
          </label>
        </div>
        <div className="setform__grid two">
          <label className="field">
            <span>Username (email)</span>
            <input value={smtpUsername} autoComplete="off" onChange={(e) => setSmtpUsername(e.target.value)} placeholder="you@gmail.com" />
          </label>
          <label className="field">
            <span>App password</span>
            <input
              type="password"
              autoComplete="off"
              value={smtpPassword}
              onChange={(e) => setSmtpPassword(e.target.value)}
              placeholder={smtpConfigured ? "••••• (hidden)" : "16-character app password"}
            />
          </label>
        </div>
        <div className="setform__grid two">
          <label className="field">
            <span>From address</span>
            <input value={smtpFrom} autoComplete="off" onChange={(e) => setSmtpFrom(e.target.value)} placeholder="Defaults to the username" />
          </label>
        </div>

        <div className="setform__foot">
          <button className="btn-ghost" type="button" onClick={testSmtp} disabled={smtpTesting || !smtpConfigured}>
            {smtpTesting ? "Sending…" : "Send test email"}
          </button>
          <button className="btn-primary" type="button" onClick={saveSmtp} disabled={update.isPending || integrations.isLoading}>
            Save
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
