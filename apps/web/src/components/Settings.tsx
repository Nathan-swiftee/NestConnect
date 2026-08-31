import { useEffect, useRef, useState, type ChangeEvent, type ComponentType, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { embedSnippet, type EmbedKind } from "../lib/nestchat-embed";
import type {
  ChannelType,
  Inbox,
  Label,
  Role,
  RoutingStrategy,
  Team,
  Template,
  TemplateCategory,
  WhatsAppVertical,
  BroadcastResult,
  OpeningHours,
  OpeningDay,
  OpeningHoursDay,
  NestChatAppearance,
} from "@ding/schemas";
import { WHATSAPP_VERTICALS, OPENING_DAYS } from "@ding/schemas";
import {
  useContacts,
  useCreateInbox,
  useCreateLabel,
  useCreateTeam,
  useCreateTemplate,
  useCreateUser,
  useDeleteInbox,
  useDeleteLabel,
  useDeleteTeam,
  useDeleteTemplate,
  useDeleteUser,
  useInboxes,
  useLabels,
  useNestchatSettings,
  useUpdateNestchat,
  useUpdateLabel,
  useIntegrations,
  useMe,
  usePeople,
  useReorderTeams,
  useRerouteInbox,
  useSetDefaultTemplate,
  useSyncTemplates,
  useTeams,
  useTemplates,
  useUpdateInbox,
  useUpdateIntegrations,
  useUpdateTeam,
  useUpdateTemplate,
  useUpdateUser,
  useWhatsappProfile,
  useUpdateWhatsappProfile,
  useSetWhatsappProfilePhoto,
  useSendBroadcast,
} from "../hooks";
import { initials, avatarBg } from "../lib/format";
import { api } from "../lib/api";
import { TEMPLATE_CATEGORIES, approvalMeta, countVariables } from "./TemplatePicker";
import {
  BellIcon,
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
  SearchIcon,
  SparkleIcon,
  StarIcon,
  StorageIcon,
  TeamGlyph,
  TEAM_ICON_KEYS,
  TEAM_ICONS,
  TrashIcon,
  XIcon,
} from "../lib/icons";

/** A settings destination. Leaves are grouped into the left-rail primary
 *  sections; each section surfaces its leaves as the top sub-navigation. */
type Leaf =
  | "channels"
  | "nestchat"
  | "templates"
  | "profile"
  | "broadcast"
  | "teams"
  | "people"
  | "labels"
  | "connections"
  | "storage"
  | "email"
  | "ai"
  | "push";
type SetupSub = "connections" | "storage" | "email" | "ai" | "push";
/** The integrations that open a credential sheet from their card. */
type SetupKey = "google" | "meta" | "storage" | "resend" | "smtp" | "anthropic" | "push";

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
      { key: "nestchat", label: "NestChat widget" },
      { key: "templates", label: "Templates" },
      { key: "profile", label: "Business profile" },
      { key: "broadcast", label: "Broadcast" },
    ],
  },
  {
    key: "org",
    label: "Organisation",
    Icon: TeamGlyph,
    leaves: [
      { key: "teams", label: "Teams" },
      { key: "people", label: "People" },
      { key: "labels", label: "Labels" },
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
      { key: "ai", label: "AI" },
      { key: "push", label: "Push" },
    ],
  },
];

/** Per-sub heading + blurb for the Integrations panes (one component, four sub-tabs). */
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
  ai: {
    h: "AI assist",
    p: "Claude writes nothing on its own — it polishes what an agent has already drafted, on request.",
  },
  push: {
    h: "Push notifications",
    p: "How a new message reaches the phone app, and the Firebase project it travels through.",
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
            {active === "nestchat" && <NestChatPane onToast={onToast} />}
            {active === "templates" && <TemplatesPane onToast={onToast} />}
            {active === "profile" && <ProfilePane onToast={onToast} />}
            {active === "broadcast" && <BroadcastPane onToast={onToast} />}
            {active === "teams" && <TeamsPane onToast={onToast} />}
            {active === "people" && <PeoplePane onToast={onToast} />}
            {active === "labels" && <LabelsPane onToast={onToast} />}
            {(active === "connections" ||
              active === "storage" ||
              active === "email" ||
              active === "ai" ||
              active === "push") && <SetupPane sub={active} onToast={onToast} />}
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
    label: "WhatsApp",
    desc: "A WhatsApp Business number via Meta — one click, or paste credentials.",
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
    type: "nestchat",
    label: "NestChat",
    desc: "Our own live chat, embedded on your website. Nothing to connect — it's ours.",
    handleLabel: "Website",
    handlePlaceholder: "swiftee.co.uk",
    // No credentials: there is no third party to authenticate with. The widget
    // key that identifies this channel is minted for us, not pasted in.
    fields: [],
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

  const editingInbox = inboxes.data?.find((i) => i.id === editingId) ?? null;

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>Channels <span className="setcount">{inboxes.data?.length ?? 0}</span></h2>
          <p>WhatsApp numbers and shared email inboxes. Each routes to one or more teams.</p>
        </div>
        <button className="btn-primary" onClick={() => setConnecting(true)}>
          <PlusIcon /> Add channel
        </button>
      </div>

      <div className="cardgrid">
        {inboxes.data?.map((i) => {
          const cm = channelMeta(i.type);
          const Glyph = cm.Glyph;
          const connected = i.connected !== false;
          return (
            <button className="chcard" key={i.id} onClick={() => setEditingId(i.id)}>
              <div className="chcard__top">
                <span className="chcard__ic" style={{ color: cm.color }}>
                  <Glyph />
                </span>
                <span className="chcard__name">
                  <b>{i.name}</b>
                  <small>{i.handle}</small>
                </span>
              </div>
              <div className="chcard__foot">
                <span className="chcard__route" title={i.teamIds.map(teamName).join(", ")}>
                  {summariseTeams(i.teamIds.map(teamName)) || "Unrouted"} · {i.routingStrategy.replace(/_/g, " ")}
                </span>
                <span className={"connpill " + (connected ? "on" : "off")} title={connected ? "Integration live" : "Add credentials to go live"}>
                  <span className="connpill__dot" />
                  {connected ? "Connected" : "Setup needed"}
                </span>
              </div>
            </button>
          );
        })}
        <button className="chcard chcard--add" onClick={() => setConnecting(true)}>
          <PlusIcon />
          <span>Add a channel</span>
        </button>
      </div>

      {connecting && (
        <ConnectChannel
          onDone={() => setConnecting(false)}
          onConnected={(handle) => setRouteHandle(handle)}
          onToast={onToast}
        />
      )}
      {editingInbox && (
        <ChannelEditor
          inbox={editingInbox}
          onDone={() => setEditingId(null)}
          onDelete={() => remove(editingInbox.id, editingInbox.name)}
          onToast={onToast}
        />
      )}
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
  // Pre-fill the non-secret config (e.g. Phone number ID) so it's visible and
  // verifiable; secret fields (tokens) stay blank and are kept unless re-entered.
  const [cfg, setCfg] = useState<Record<string, string>>(inbox.channelConfigPublic ?? {});
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
    <div className="modal" onClick={onDone}>
      <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <h2>Edit channel</h2>
          <button type="button" className="modal__x" onClick={onDone} aria-label="Close"><XIcon /></button>
        </div>
        <div className="modal__body">
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
      {kind && kind.fields.length > 0 && (
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
                  placeholder={f.secret ? "leave blank to keep current" : f.placeholder}
                />
              </label>
            ))}
          </div>
        </div>
      )}
        </div>
        <div className="modal__foot modal__foot--split">
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
      <div className="modal" onClick={onDone}>
        <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
          <div className="modal__head">
            <h2>Connect a channel</h2>
            <button type="button" className="modal__x" onClick={onDone} aria-label="Close"><XIcon /></button>
          </div>
          <div className="modal__body">
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
        </div>
          </div>
        </div>
      </div>
    );
  }

  // Step 2 — integration details.
  const cm = channelMeta(kind.type);
  const Glyph = cm.Glyph;
  return (
    <div className="modal" onClick={onDone}>
      <form className="modal__box modal--form" onSubmit={submit} onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <span className="connect__kind">
            <span className="setrow__ic" style={{ color: cm.color }}><Glyph /></span>
            {kind.label}
          </span>
          <div className="connect__headacts">
            <button className="btn-ghost sm" type="button" onClick={() => { setKind(null); setCfg({}); }}>Change</button>
            <button type="button" className="modal__x" onClick={onDone} aria-label="Close"><XIcon /></button>
          </div>
        </div>
        <div className="modal__body">
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

      {kind.type === "whatsapp" && (
        <div style={{ display: "grid", gap: 8, margin: "4px 0 2px" }}>
          <button type="button" className="btn-primary" onClick={connectWhatsApp}>
            Connect with Facebook — one click
          </button>
          <div className="fieldhint" style={{ textAlign: "center" }}>
            — or paste your number’s Phone number ID + Access token from Meta’s API Setup page below —
          </div>
        </div>
      )}

      {kind.fields.length > 0 && (
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
      )}

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

        </div>
        <div className="modal__foot">
          <button className="btn-ghost" type="button" onClick={onDone}>Cancel</button>
          <button className="btn-primary" type="submit" disabled={create.isPending || !valid}>
            Connect channel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

/** First-response SLA presets offered per team (stored as minutes). */
const SLA_OPTIONS: { label: string; minutes: number | null }[] = [
  { label: "No SLA", minutes: null },
  { label: "5 minutes", minutes: 5 },
  { label: "10 minutes", minutes: 10 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
  { label: "8 hours", minutes: 480 },
  { label: "1 day", minutes: 1440 },
  { label: "48 hours", minutes: 2880 },
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

const LABEL_COLORS = ["#0FA47A", "#E68A00", "#5B8DEF", "#A06CF2", "#EF5B8D", "#E5484D", "#0EA5E9", "#8A968F"];

function LabelsPane({ onToast }: { onToast: (msg: string) => void }) {
  const labels = useLabels();
  const create = useCreateLabel();
  const update = useUpdateLabel();
  const del = useDeleteLabel();
  const [name, setName] = useState("");
  const [color, setColor] = useState(LABEL_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(LABEL_COLORS[0]);
  const list = labels.data ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n, color },
      {
        onSuccess: () => { setName(""); onToast(`Label “${n}” created`); },
        onError: () => onToast("Only admins & managers can create labels"),
      },
    );
  };
  const startEdit = (l: Label) => { setEditingId(l.id); setDraftName(l.name); setDraftColor(l.color); };
  const saveEdit = (id: string) => {
    const n = draftName.trim();
    if (!n) return;
    update.mutate(
      { id, input: { name: n, color: draftColor } },
      {
        onSuccess: () => { setEditingId(null); onToast("Label updated"); },
        onError: () => onToast("Couldn't update label"),
      },
    );
  };
  const remove = (id: string, labelName: string) => {
    if (!window.confirm(`Delete “${labelName}”? It will be removed from every conversation.`)) return;
    del.mutate(id, {
      onSuccess: () => { setEditingId(null); onToast(`Label “${labelName}” deleted`); },
      onError: () => onToast("Couldn't delete label"),
    });
  };

  const editLabel = list.find((l) => l.id === editingId) ?? null;

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>Labels <span className="setcount">{list.length}</span></h2>
          <p>Tag conversations by topic, priority or state (Billing, Complaint, VIP…). Apply them from a thread's Tag button and filter the inbox by any label from the sidebar.</p>
        </div>
      </div>
      <form className="setadd" onSubmit={submit}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New label name…" maxLength={40} />
        <div className="lblswatches">
          {LABEL_COLORS.map((c) => (
            <button key={c} type="button" className={"lblswatch" + (color === c ? " on" : "")} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Colour ${c}`} />
          ))}
        </div>
        <button className="btn-primary" type="submit" disabled={create.isPending || !name.trim()}>
          <PlusIcon /> Create label
        </button>
      </form>

      <div className="dwrap">
        <div className="dtable dtable--label">
          <div className="dtable__head">
            <span>Label</span>
            <span />
          </div>
          {list.map((l) => (
            <div className="dtable__row dtable__row--static" key={l.id}>
              <span className="dcell dname">
                <span className="cdot" style={{ background: l.color, width: 14, height: 14 }} />
                <span className="dcell__t">{l.name}</span>
              </span>
              <span className="dcell dacts">
                <button className="iconbtn" title="Edit label" onClick={() => startEdit(l)}><EditIcon /></button>
              </span>
            </div>
          ))}
          {list.length === 0 && <div className="dtable__empty">No labels yet — create one above.</div>}
        </div>
      </div>

      {editLabel && (
        <div className="modal" onClick={() => setEditingId(null)}>
          <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Edit label</h2>
              <button type="button" className="modal__x" onClick={() => setEditingId(null)} aria-label="Close"><XIcon /></button>
            </div>
            <div className="modal__body">
              <label className="field">
                <span>Label name</span>
                <input value={draftName} autoFocus maxLength={40} onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <div className="field">
                <span>Colour</span>
                <div className="lblswatches">
                  {LABEL_COLORS.map((c) => (
                    <button key={c} type="button" className={"lblswatch" + (draftColor === c ? " on" : "")} style={{ background: c }} onClick={() => setDraftColor(c)} aria-label={`Colour ${c}`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="modal__foot modal__foot--split">
              <button type="button" className="btn-ghost btn-danger" onClick={() => remove(editLabel.id, editLabel.name)}>
                <TrashIcon /> Delete
              </button>
              <div className="setform__footactions">
                <button className="btn-ghost" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                <button className="btn-primary" type="button" onClick={() => saveEdit(editLabel.id)} disabled={update.isPending || !draftName.trim()}>
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
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

  const editTeam = ordered.find((t) => t.id === editingId) ?? null;

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>Teams <span className="setcount">{ordered.length}</span></h2>
          <p>Channels route to teams; a person can belong to several. Reorder with the arrows and give each an icon.</p>
        </div>
        <form className="setinlineadd" onSubmit={submit}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New team name…" />
          <button className="btn-primary" type="submit" disabled={create.isPending || !name.trim()}>
            <PlusIcon /> Create
          </button>
        </form>
      </div>

      <div className="dwrap">
        <div className="dtable dtable--team">
          <div className="dtable__head">
            <span>Team</span>
            <span>Members</span>
            <span>SLA</span>
            <span />
          </div>
          {ordered.map((t, i) => {
            const n = memberCount(t.id);
            return (
              <div className="dtable__row dtable__row--static" key={t.id}>
                <span className="dcell dname">
                  <span className="chcard__ic" style={{ width: 34, height: 34 }}><TeamGlyph icon={t.icon} /></span>
                  <span className="dname__x"><span className="dcell__t">{t.name}</span></span>
                </span>
                <span className="dcell dcell--muted">{n} member{n === 1 ? "" : "s"}</span>
                <span className="dcell dcell--muted">{slaLabel(t.slaMinutes) || "—"}</span>
                <span className="dcell dacts">
                  <button className="iconbtn" title="Move up" disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)}><ChevronUp /></button>
                  <button className="iconbtn" title="Move down" disabled={i === ordered.length - 1 || reorder.isPending} onClick={() => move(i, 1)}><ChevronDown /></button>
                  <button className="iconbtn" title="Edit team" onClick={() => startEdit(t)}><EditIcon /></button>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {editTeam && (
        <div className="modal" onClick={() => setEditingId(null)}>
          <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Edit team</h2>
              <button type="button" className="modal__x" onClick={() => setEditingId(null)} aria-label="Close"><XIcon /></button>
            </div>
            <div className="modal__body">
              <label className="field">
                <span>Team name</span>
                <input value={draftName} autoFocus onChange={(e) => setDraftName(e.target.value)} />
              </label>
              <div className="field">
                <span>Icon</span>
                <div className="iconpick">
                  {TEAM_ICON_KEYS.map((k) => {
                    const Ic = TEAM_ICONS[k];
                    return (
                      <button key={k} type="button" className={"iconpick__btn" + (draftIcon === k ? " on" : "")} onClick={() => setDraftIcon(draftIcon === k ? null : k)} title={k} aria-label={k}>
                        <Ic />
                      </button>
                    );
                  })}
                </div>
              </div>
              <label className="field">
                <span>First-response SLA</span>
                <select value={draftSla ?? ""} onChange={(e) => setDraftSla(e.target.value ? Number(e.target.value) : null)}>
                  {SLA_OPTIONS.map((o) => (<option key={o.label} value={o.minutes ?? ""}>{o.label}</option>))}
                </select>
                <small className="fieldhint">New conversations routed to this team get a “respond within” timer; it clears on your first reply.</small>
              </label>
            </div>
            <div className="modal__foot modal__foot--split">
              <button type="button" className="btn-ghost btn-danger" onClick={() => remove(editTeam.id, editTeam.name)}>
                <TrashIcon /> Delete
              </button>
              <div className="setform__footactions">
                <button className="btn-ghost" type="button" onClick={() => setEditingId(null)}>Cancel</button>
                <button className="btn-primary" type="button" onClick={() => saveEdit(editTeam.id)} disabled={update.isPending || !draftName.trim()}>
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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

  const editMember = people.data?.find((m) => m.user.id === editId) ?? null;
  const editIsSelf = me.data?.user.id === editId;

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>People <span className="setcount">{people.data?.length ?? 0}</span></h2>
          <p>Team members who pick up conversations. Invited people get a link to set their own password.</p>
        </div>
        <button className="btn-primary" onClick={() => { setEditId(null); setOpen(true); }}>
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

      <div className="dwrap">
        <div className="dtable dtable--ppl">
          <div className="dtable__head">
            <span>Name</span>
            <span>Email</span>
            <span>Role</span>
            <span>Teams</span>
            <span />
          </div>
          {people.data?.map((m) => {
            const isSelf = me.data?.user.id === m.user.id;
            return (
              <div
                className="dtable__row"
                key={m.user.id}
                role="button"
                tabIndex={0}
                onClick={() => startEdit(m.user.id, m.user.name, m.user.role, m.teamIds)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startEdit(m.user.id, m.user.name, m.user.role, m.teamIds); } }}
              >
                <span className="dcell dname">
                  <span className="av dname__av" style={{ background: avatarBg(m.user.name, m.user.avatarColor) }}>
                    {m.user.avatarUrl ? <img className="av__photo" src={m.user.avatarUrl} alt="" /> : initials(m.user.name)}
                  </span>
                  <span className="dname__x">
                    <span className="dcell__t">{m.user.name}{isSelf && <span className="youtag">You</span>}</span>
                  </span>
                </span>
                <span className="dcell dcell--muted">{m.user.email}</span>
                <span className="dcell"><span className="dpill dpill--off" style={{ textTransform: "capitalize" }}>{m.user.role}</span></span>
                <span className="dcell dcell--muted" title={m.teamIds.map(teamName).join(", ")}>{summariseTeams(m.teamIds.map(teamName)) || "No team"}</span>
                <span className="dcell dcell--end"><span className="dchev"><EditIcon /></span></span>
              </div>
            );
          })}
        </div>
      </div>

      {open && (
        <div className="modal" onClick={() => setOpen(false)}>
          <form className="modal__box modal--form" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
            <div className="modal__head">
              <h2>Invite person</h2>
              <button type="button" className="modal__x" onClick={() => setOpen(false)} aria-label="Close"><XIcon /></button>
            </div>
            <div className="modal__body">
              <div className="setform__grid two">
                <label className="field">
                  <span>Name</span>
                  <input value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" required />
                </label>
                <label className="field">
                  <span>Email</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jane@swiftee.co.uk" required />
                </label>
              </div>
              <label className="field">
                <span>Role</span>
                <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
                </select>
              </label>
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
            </div>
            <div className="modal__foot">
              <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn-primary" type="submit" disabled={create.isPending || !valid}>Invite</button>
            </div>
          </form>
        </div>
      )}

      {editMember && (
        <div className="modal" onClick={() => setEditId(null)}>
          <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>Edit {editMember.user.name}</h2>
              <button type="button" className="modal__x" onClick={() => setEditId(null)} aria-label="Close"><XIcon /></button>
            </div>
            <div className="modal__body">
              <div className="setform__grid two">
                <label className="field">
                  <span>Name</span>
                  <input value={eName} autoFocus onChange={(e) => setEName(e.target.value)} placeholder="Full name" />
                </label>
                <label className="field">
                  <span>Role</span>
                  <select value={eRole} onChange={(e) => setERole(e.target.value as Role)}>
                    {ROLES.map((r) => (<option key={r.value} value={r.value}>{r.label}</option>))}
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
            </div>
            <div className={"modal__foot" + (editIsSelf ? "" : " modal__foot--split")}>
              {!editIsSelf && (
                <button type="button" className="btn-ghost btn-danger" onClick={() => remove(editMember.user.id, editMember.user.name)}>
                  <TrashIcon /> Remove
                </button>
              )}
              <div className="setform__footactions">
                <button className="btn-ghost" type="button" onClick={() => setEditId(null)}>Cancel</button>
                <button className="btn-primary" type="button" onClick={() => saveEdit(editMember.user.id)} disabled={update.isPending || !eName.trim()}>
                  Save changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Templates — WhatsApp message templates (24-hour window)            */
/* ------------------------------------------------------------------ */

/* ── NestChat widget ─────────────────────────────────────────────────────── */

/** The text fields, in the order the widget reads them out loud. */
const NESTCHAT_WORDS: Array<{
  key: keyof NestChatAppearance;
  label: string;
  hint?: string;
  multiline?: boolean;
}> = [
  { key: "title", label: "Header title" },
  { key: "subtitle", label: "Header subtitle", hint: "Shown while someone is online" },
  { key: "awayMessage", label: "Away message", hint: "Replaces the subtitle when nobody is", multiline: true },
  { key: "greeting", label: "Greeting", hint: "The first thing in an empty chat", multiline: true },
  { key: "placeholder", label: "Message box placeholder" },
  { key: "launcherLabel", label: "Launcher tooltip", hint: "On the floating bubble" },
  { key: "askEmailLabel", label: "Email prompt" },
];

/**
 * Settings › NestChat widget.
 *
 * A pane rather than another section of the Edit-channel modal: this is a dozen
 * fields plus an install snippet, and it is worth seeing what you are changing
 * while you change it. The preview beside the form is a stand-in drawn from the
 * live form state — the real widget renders in its own iframe from saved
 * settings, so it can't show what you haven't saved yet.
 */
function NestChatPane({ onToast }: { onToast: (msg: string) => void }) {
  const inboxes = useInboxes();
  const channels = (inboxes.data ?? []).filter((i) => i.type === "nestchat");
  const [selected, setSelected] = useState<string>();
  const inboxId = selected ?? channels[0]?.id;
  const settings = useNestchatSettings(inboxId);
  const update = useUpdateNestchat();

  const [draft, setDraft] = useState<NestChatAppearance>();
  const [embed, setEmbed] = useState<EmbedKind>("script");
  const [copied, setCopied] = useState(false);

  // Load the saved appearance into the form once per channel. Keyed on the
  // channel id so switching channels reloads, but typing doesn't get reverted
  // by a background refetch.
  const loadedFor = useRef<string>();
  useEffect(() => {
    if (!settings.data || loadedFor.current === settings.data.inboxId) return;
    loadedFor.current = settings.data.inboxId;
    setDraft(settings.data.appearance);
  }, [settings.data]);

  const set = <K extends keyof NestChatAppearance>(key: K, value: NestChatAppearance[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = () => {
    if (!inboxId || !draft) return;
    update.mutate(
      { inboxId, input: { appearance: draft } },
      {
        onSuccess: () => onToast("Widget updated"),
        onError: () => onToast("Only admins & managers can change the widget"),
      },
    );
  };

  // Built from the draft, not the saved settings, so the snippet you copy
  // matches the colour and label you are looking at.
  const snippet =
    settings.data && draft ? embedSnippet(embed, settings.data, draft) : "";

  const copy = () => {
    void navigator.clipboard.writeText(snippet).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => onToast("Couldn’t copy — select the snippet and copy it by hand"),
    );
  };

  if (!channels.length) {
    return (
      <div className="setpane setpane--wide">
        <div className="setpane__head">
          <h2>NestChat widget</h2>
          <p>Our own live chat, embedded on your website.</p>
        </div>
        <div className="setempty">
          <p>
            No NestChat channel yet. Add one under <strong>Channels</strong> and its widget appears
            here, ready to style and embed.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <h2>NestChat widget</h2>
        <p>How your live chat looks and what it says, and the snippet that puts it on your site.</p>
        <div className="setpane__headacts">
          {channels.length > 1 && (
            <select
              className="setfilterchip"
              value={inboxId}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Which NestChat channel"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={!draft || update.isPending}
          >
            {update.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>

      {!draft ? (
        <div className="setempty">
          <p>Loading the widget’s settings…</p>
        </div>
      ) : (
        <div className="ncw">
          <div className="ncw__form">
            <section className="ncw__group">
              <h3>Brand</h3>
              <div className="setform__grid two">
                <label className="field">
                  <span>Brand colour</span>
                  <div className="ncw__colour">
                    <input
                      type="color"
                      value={draft.accent}
                      onChange={(e) => set("accent", e.target.value)}
                      aria-label="Brand colour"
                    />
                    <input
                      value={draft.accent}
                      onChange={(e) => set("accent", e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </label>
                <label className="field">
                  <span>Text on the brand colour</span>
                  <div className="ncw__colour">
                    <input
                      type="color"
                      value={draft.accentText}
                      onChange={(e) => set("accentText", e.target.value)}
                      aria-label="Text on the brand colour"
                    />
                    <input
                      value={draft.accentText}
                      onChange={(e) => set("accentText", e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                </label>
              </div>
              <div className="setform__grid two">
                <label className="field">
                  <span>Theme</span>
                  <select
                    value={draft.theme}
                    onChange={(e) => set("theme", e.target.value as NestChatAppearance["theme"])}
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="auto">Match the visitor’s device</option>
                  </select>
                </label>
                <label className="field">
                  <span>Launcher corner</span>
                  <select
                    value={draft.position}
                    onChange={(e) =>
                      set("position", e.target.value as NestChatAppearance["position"])
                    }
                  >
                    <option value="right">Bottom right</option>
                    <option value="left">Bottom left</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="ncw__group">
              <h3>Words</h3>
              {NESTCHAT_WORDS.map((f) => (
                <label className="field" key={f.key}>
                  <span>
                    {f.label} {f.hint && <em>{f.hint}</em>}
                  </span>
                  {f.multiline ? (
                    <textarea
                      rows={2}
                      value={String(draft[f.key] ?? "")}
                      onChange={(e) => set(f.key, e.target.value as never)}
                    />
                  ) : (
                    <input
                      value={String(draft[f.key] ?? "")}
                      onChange={(e) => set(f.key, e.target.value as never)}
                    />
                  )}
                </label>
              ))}
            </section>

            <section className="ncw__group">
              <h3>Behaviour</h3>
              <label className={"check" + (draft.askEmail ? " on" : "")}>
                <input
                  type="checkbox"
                  checked={draft.askEmail}
                  onChange={(e) => set("askEmail", e.target.checked)}
                />
                Ask for an email address, so a reply can reach someone who has left
              </label>
              <label className={"check" + (draft.showBranding ? " on" : "")}>
                <input
                  type="checkbox"
                  checked={draft.showBranding}
                  onChange={(e) => set("showBranding", e.target.checked)}
                />
                Show “Powered by Nest Connect”
              </label>
            </section>
          </div>

          <div className="ncw__side">
            <NestChatPreview appearance={draft} />

            <section className="ncw__group">
              <h3>Install</h3>
              <div className="ncw__tabs" role="group" aria-label="Embed style">
                <button
                  type="button"
                  className={"setfilterchip" + (embed === "script" ? " on" : "")}
                  onClick={() => setEmbed("script")}
                >
                  Floating bubble
                </button>
                <button
                  type="button"
                  className={"setfilterchip" + (embed === "iframe" ? " on" : "")}
                  onClick={() => setEmbed("iframe")}
                >
                  Inline iframe
                </button>
              </div>
              <p className="fieldhint">
                {embed === "script"
                  ? "Paste both tags before </body> on every page. It draws the bubble and opens the chat in a frame of its own. Keep them together — the first carries the settings, and it survives plugins that combine and minify JavaScript."
                  : "Drops the chat straight into a page — a contact page, a help centre. Size it with the surrounding CSS."}
              </p>
              <pre className="ncw__snippet">{snippet}</pre>
              <button type="button" className="btn-ghost" onClick={copy}>
                {copied ? "Copied" : "Copy snippet"}
              </button>
              <p className="fieldhint">
                Widget key <code>{settings.data?.widgetKey}</code> — public by design; it identifies
                this channel and nothing more.
              </p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

/** A stand-in for the widget, drawn from the form as it is being edited. Close
 *  enough to judge colour and copy by; the real thing lives in its own bundle. */
function NestChatPreview({ appearance }: { appearance: NestChatAppearance }) {
  const dark = appearance.theme === "dark";
  return (
    <div
      className={"ncprev" + (dark ? " ncprev--dark" : "")}
      style={{ ["--pv-accent" as string]: appearance.accent, ["--pv-on" as string]: appearance.accentText }}
      aria-hidden="true"
    >
      <div className="ncprev__head">
        <div className="ncprev__title">{appearance.title}</div>
        <div className="ncprev__sub">{appearance.subtitle}</div>
      </div>
      <div className="ncprev__thread">
        <div className="ncprev__in">{appearance.greeting}</div>
        <div className="ncprev__out">Hi — do you deliver on Saturdays?</div>
        <div className="ncprev__in">We do, right up until 2pm.</div>
      </div>
      <div className="ncprev__composer">
        <span>{appearance.placeholder}</span>
        <i />
      </div>
      {appearance.showBranding && <div className="ncprev__brand">Powered by Nest Connect</div>}
    </div>
  );
}

/* ── templates ───────────────────────────────────────────────────────────── */

function TemplatesPane({ onToast }: { onToast: (msg: string) => void }) {
  const templates = useTemplates();
  const del = useDeleteTemplate();
  const sync = useSyncTemplates();
  const setDefault = useSetDefaultTemplate();
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

  const editingTpl = templates.data?.find((t) => t.id === editingId) ?? null;
  const showForm = open || !!editingTpl;
  const closeForm = () => { setOpen(false); setEditingId(null); };

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>Message templates <span className="setcount">{templates.data?.length ?? 0}</span></h2>
          <p>
            Pre-approved WhatsApp messages used to re-open a chat once its 24-hour window has
            closed. Variables like <code>{"{{1}}"}</code> are filled in when you send.
            {" "}Star one to make it the <b>default</b>: agents then keep typing normally in a closed
            chat and what they write becomes its <code>{"{{1}}"}</code>. Pick a template whose single
            variable is the message itself, not a name.
          </p>
        </div>
        <div className="setpane__headacts">
          <button className="btn-ghost" type="button" onClick={doSync} disabled={sync.isPending}>
            <RefreshIcon /> Sync from Meta
          </button>
          <button className="btn-primary" onClick={() => { setEditingId(null); setOpen(true); }}>
            <PlusIcon /> New template
          </button>
        </div>
      </div>

      <p className="fieldhint tpl-synchint">
        “Sync from Meta” pulls the approved templates from a connected WhatsApp number — it’s a
        no-op until you connect one under Channels.
      </p>

      <div className="dwrap">
        <div className="dtable dtable--tpl">
          <div className="dtable__head">
            <span>Name</span>
            <span>Category</span>
            <span>Language</span>
            <span>Status</span>
            <span>Message</span>
            <span />
          </div>
          {templates.data?.map((t) => {
            const ap = approvalMeta(t.approvalStatus);
            return (
              <div className="dtable__row dtable__row--static" key={t.id}>
                <span className="dcell dcell__t">
                  {t.name}
                  {t.isDefault && <span className="tpl-default">Default</span>}
                </span>
                <span className="dcell"><span className={"tpl-cat tpl-cat--" + t.category}>{t.category}</span></span>
                <span className="dcell dcell--muted">{t.language}</span>
                <span className="dcell"><span className={"tpl-appr " + ap.cls}><span className="tpl-appr__dot" />{ap.label}</span></span>
                <span className="dcell dcell--muted" title={t.body}>{t.body}</span>
                <span className="dcell dacts">
                  {/* The default is what the composer sends once a 24-hour
                      window has closed, with the agent's typed text filling its
                      variable — so only a one-variable template can carry it. */}
                  <button
                    className={"iconbtn" + (t.isDefault ? " on" : "")}
                    title={
                      t.isDefault
                        ? "Default template — click to unset"
                        : t.variableCount === 1
                          ? "Use as the default for closed windows"
                          : `Needs exactly one {{1}} variable to be the default (this has ${t.variableCount})`
                    }
                    aria-pressed={t.isDefault}
                    disabled={!t.isDefault && t.variableCount !== 1}
                    onClick={() => setDefault.mutate(t.isDefault ? null : t.id)}
                  >
                    <StarIcon filled={t.isDefault} />
                  </button>
                  <button className="iconbtn" title="Edit template" onClick={() => { setOpen(false); setEditingId(t.id); }}><EditIcon /></button>
                  <button className="iconbtn danger" title="Delete template" onClick={() => remove(t)}><TrashIcon /></button>
                </span>
              </div>
            );
          })}
        </div>
      </div>
      {templates.data && templates.data.length === 0 && (
        <div className="setzero">
          <p>No templates yet. Create one, or sync approved templates from a connected WhatsApp number.</p>
        </div>
      )}

      {showForm && (
        <div className="modal" onClick={closeForm}>
          <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()}>
            <div className="modal__head">
              <h2>{editingTpl ? "Edit template" : "New template"}</h2>
              <button type="button" className="modal__x" onClick={closeForm} aria-label="Close"><XIcon /></button>
            </div>
            <div className="modal__body">
              <TemplateForm template={editingTpl ?? undefined} onDone={closeForm} onToast={onToast} />
            </div>
          </div>
        </div>
      )}
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
    <form className="setform setform--flush" onSubmit={submit}>
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
/* WhatsApp business profile                                           */
/* ------------------------------------------------------------------ */

/** Friendly labels for Meta's fixed `vertical` (business category) enum. */
const VERTICAL_LABELS: Record<WhatsAppVertical, string> = {
  UNDEFINED: "Not set",
  OTHER: "Other",
  AUTO: "Automotive",
  BEAUTY: "Beauty, spa & salon",
  APPAREL: "Clothing & apparel",
  EDU: "Education",
  ENTERTAIN: "Entertainment",
  EVENT_PLAN: "Event planning & service",
  FINANCE: "Finance & banking",
  GROCERY: "Food & grocery",
  GOVT: "Public service",
  HOTEL: "Hotel & lodging",
  HEALTH: "Medical & health",
  NONPROFIT: "Non-profit",
  PROF_SERVICES: "Professional services",
  RETAIL: "Shopping & retail",
  TRAVEL: "Travel & transportation",
  RESTAURANT: "Restaurant",
  NOT_A_BIZ: "Not a business",
};

/** Add https:// to a bare domain so Meta accepts it (empty stays empty). */
function normalizeUrl(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

function ProfilePane({ onToast }: { onToast: (msg: string) => void }) {
  const inboxes = useInboxes();
  const waNumbers = (inboxes.data ?? []).filter((i) => i.type === "whatsapp");
  const [inboxId, setInboxId] = useState<string | null>(null);
  // Default to the first WhatsApp number once the list loads.
  useEffect(() => {
    if (!inboxId && waNumbers.length) setInboxId(waNumbers[0].id);
  }, [waNumbers, inboxId]);
  const selected = waNumbers.find((n) => n.id === inboxId) ?? null;
  const profile = useWhatsappProfile(selected?.connected ? inboxId : null);

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Business profile</h2>
          <p>
            The public card customers see on your WhatsApp number — your “about” line,
            description, category and contact details. Changes go straight to Meta.
          </p>
        </div>
      </div>

      {inboxes.isSuccess && waNumbers.length === 0 && (
        <div className="setempty">
          Connect a WhatsApp number under Channels first — a business profile lives on a number.
        </div>
      )}

      {waNumbers.length > 0 && (
        <label className="field">
          <span>WhatsApp number{waNumbers.length > 1 ? " — each number has its own profile" : ""}</span>
          <select value={inboxId ?? ""} onChange={(e) => setInboxId(e.target.value)}>
            {waNumbers.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
                {n.channelConfigPublic?.displayNumber ? ` · ${n.channelConfigPublic.displayNumber}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}

      {selected && !selected.connected && (
        <div className="setempty">
          This number isn’t connected yet — add its Phone number ID and access token under
          Channels to edit its profile.
        </div>
      )}

      {selected && selected.connected && (
        <>
          {profile.isLoading && <div className="setempty">Loading profile from WhatsApp…</div>}
          {profile.isError && (
            <div className="setempty">
              Couldn’t load the profile from WhatsApp. {(profile.error as Error)?.message ?? ""}
            </div>
          )}
          {profile.data && (
            <ProfileForm key={inboxId} inboxId={inboxId as string} profile={profile.data} onToast={onToast} />
          )}
        </>
      )}
    </div>
  );
}

const DAY_LABELS: Record<OpeningDay, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};
const DEFAULT_DAY: OpeningHoursDay = { closed: false, open: "09:00", close: "17:00" };
function defaultHours(): OpeningHours {
  return {
    mon: { ...DEFAULT_DAY },
    tue: { ...DEFAULT_DAY },
    wed: { ...DEFAULT_DAY },
    thu: { ...DEFAULT_DAY },
    fri: { ...DEFAULT_DAY },
    sat: { closed: true, open: "10:00", close: "16:00" },
    sun: { closed: true, open: "10:00", close: "16:00" },
  };
}

function ProfileForm({
  inboxId,
  profile,
  onToast,
}: {
  inboxId: string;
  profile: import("@ding/schemas").WhatsAppBusinessProfile;
  onToast: (msg: string) => void;
}) {
  const update = useUpdateWhatsappProfile();
  const [about, setAbout] = useState(profile.about ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [address, setAddress] = useState(profile.address ?? "");
  const [email, setEmail] = useState(profile.email ?? "");
  const [vertical, setVertical] = useState<WhatsAppVertical>(profile.vertical ?? "UNDEFINED");
  const [web1, setWeb1] = useState(profile.websites?.[0] ?? "");
  const [web2, setWeb2] = useState(profile.websites?.[1] ?? "");
  const setPhoto = useSetWhatsappProfilePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [hours, setHours] = useState<OpeningHours>(profile.openingHours ?? defaultHours());
  const setDay = (d: OpeningDay, patch: Partial<OpeningHoursDay>) =>
    setHours((prev) => ({ ...prev, [d]: { ...prev[d], ...patch } }));
  const onPhoto = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPhoto.mutate(
      { inboxId, file },
      {
        onSuccess: () => onToast("Profile photo updated"),
        onError: (err) => onToast((err as Error)?.message ?? "Couldn’t update the photo"),
      },
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const websites = [web1, web2].map(normalizeUrl).filter(Boolean);
    update.mutate(
      { inboxId, input: { about, description, address, email, vertical, websites, openingHours: hours } },
      {
        onSuccess: () => onToast("Business profile saved"),
        onError: (err) => onToast((err as Error)?.message ?? "Couldn’t save the profile"),
      },
    );
  };

  return (
    <form className="setform" onSubmit={submit}>
      <div className="wa-photo">
        <div className="wa-photo__img">
          {profile.profilePictureUrl ? (
            <img src={profile.profilePictureUrl} alt="WhatsApp profile photo" />
          ) : (
            <span className="wa-photo__ph">No photo</span>
          )}
        </div>
        <div className="wa-photo__ctl">
          <button type="button" className="btn-ghost sm" onClick={() => fileRef.current?.click()} disabled={setPhoto.isPending}>
            {setPhoto.isPending ? "Uploading…" : profile.profilePictureUrl ? "Change photo" : "Add photo"}
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={onPhoto} />
          <small className="fieldhint">JPG or PNG, shown on your WhatsApp business card.</small>
        </div>
      </div>

      <label className="field">
        <span>
          About <em>{about.length}/139</em>
        </span>
        <input
          value={about}
          maxLength={139}
          autoComplete="off"
          onChange={(e) => setAbout(e.target.value)}
          placeholder="Here to help — reply anytime"
        />
        <small className="fieldhint">The short status line under your business name.</small>
      </label>

      <label className="field">
        <span>
          Description <em>{description.length}/512</em>
        </span>
        <textarea
          value={description}
          rows={3}
          maxLength={512}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What your business does, in a sentence or two."
        />
      </label>

      <div className="setform__grid two">
        <label className="field">
          <span>Category</span>
          <select value={vertical} onChange={(e) => setVertical(e.target.value as WhatsAppVertical)}>
            {WHATSAPP_VERTICALS.map((v) => (
              <option key={v} value={v}>
                {VERTICAL_LABELS[v]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Contact email</span>
          <input
            value={email}
            type="email"
            autoComplete="off"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hello@swiftee.co.uk"
          />
        </label>
      </div>

      <label className="field">
        <span>Address</span>
        <input
          value={address}
          autoComplete="off"
          onChange={(e) => setAddress(e.target.value)}
          placeholder="123 High Street, London"
        />
      </label>

      <div className="setform__grid two">
        <label className="field">
          <span>Website</span>
          <input
            value={web1}
            autoComplete="off"
            onChange={(e) => setWeb1(e.target.value)}
            placeholder="swiftee.co.uk"
          />
        </label>
        <label className="field">
          <span>Website 2</span>
          <input
            value={web2}
            autoComplete="off"
            onChange={(e) => setWeb2(e.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>

      <div className="field">
        <span>Opening hours <em>synced to WhatsApp call hours</em></span>
        <div className="wa-hours">
          {OPENING_DAYS.map((d) => {
            const day = hours[d];
            return (
              <div className={"wa-hours__row" + (day.closed ? " off" : "")} key={d}>
                <span className="wa-hours__day">{DAY_LABELS[d]}</span>
                <label className="wa-hours__sw">
                  <input
                    type="checkbox"
                    checked={!day.closed}
                    onChange={(e) => setDay(d, { closed: !e.target.checked })}
                  />
                  <span>{day.closed ? "Closed" : "Open"}</span>
                </label>
                {!day.closed && (
                  <span className="wa-hours__times">
                    <input type="time" value={day.open} onChange={(e) => setDay(d, { open: e.target.value })} />
                    <span className="wa-hours__to">–</span>
                    <input type="time" value={day.close} onChange={(e) => setDay(d, { close: e.target.value })} />
                  </span>
                )}
              </div>
            );
          })}
        </div>
        <small className="fieldhint">
          Saved in Nest Connect and pushed to WhatsApp as your <strong>call hours</strong> — when the number accepts
          WhatsApp voice calls (saving enables Calling on the number). WhatsApp has no general profile-hours field, so
          these don’t appear on the business card. Changes can take a few days to show for customers.
        </small>
      </div>

      <div className="setform__foot">
        <button className="btn-primary" type="submit" disabled={update.isPending}>
          {update.isPending ? "Saving…" : "Save profile"}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* WhatsApp broadcast                                                  */
/* ------------------------------------------------------------------ */

/** Parse a recipients textarea — one per line, "phone" or "phone, Name" —
 *  into de-duplicated {phone, name} rows, keeping only digits and a leading +. */
function parseRecipients(raw: string): { phone: string; name?: string }[] {
  const seen = new Set<string>();
  const out: { phone: string; name?: string }[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const [rawPhone, ...rest] = line.split(",");
    const phone = rawPhone.replace(/[^\d+]/g, "");
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    const name = rest.join(",").trim();
    out.push({ phone, name: name || undefined });
  }
  return out;
}

function BroadcastPane({ onToast }: { onToast: (msg: string) => void }) {
  const inboxes = useInboxes();
  const templates = useTemplates();
  const send = useSendBroadcast();

  const waNumbers = (inboxes.data ?? []).filter((i) => i.type === "whatsapp");
  const approved = (templates.data ?? []).filter((t) => t.approvalStatus === "approved");

  const [inboxId, setInboxId] = useState<string | null>(null);
  useEffect(() => {
    if (!inboxId && waNumbers.length) setInboxId(waNumbers[0].id);
  }, [waNumbers, inboxId]);
  const selected = waNumbers.find((n) => n.id === inboxId) ?? null;

  const [templateId, setTemplateId] = useState<string>("");
  const template = approved.find((t) => t.id === templateId) ?? null;
  const [params, setParams] = useState<string[]>([]);
  const [recipientsRaw, setRecipientsRaw] = useState("");
  const [result, setResult] = useState<BroadcastResult | null>(null);

  // Recipients can be picked from the customer directory or pasted as numbers.
  const contacts = useContacts();
  const [mode, setMode] = useState<"contacts" | "paste">("contacts");
  const [cq, setCq] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // Only customers reachable on WhatsApp (have a number) and not blocked.
  const reachable = (contacts.data ?? []).filter((c) => c.phone && !c.blocked);
  const cqFiltered = reachable.filter((c) => {
    const s = cq.trim().toLowerCase();
    return !s || [c.displayName, c.phone, c.company].some((v) => (v ?? "").toLowerCase().includes(s));
  });
  const togglePick = (id: string) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allChecked = cqFiltered.length > 0 && cqFiltered.every((c) => picked.has(c.id));
  const toggleAll = () =>
    setPicked((p) => {
      const n = new Set(p);
      if (allChecked) cqFiltered.forEach((c) => n.delete(c.id));
      else cqFiltered.forEach((c) => n.add(c.id));
      return n;
    });

  const recipients =
    mode === "contacts"
      ? reachable.filter((c) => picked.has(c.id)).map((c) => ({ phone: c.phone as string, name: c.displayName }))
      : parseRecipients(recipientsRaw);
  const varCount = template?.variableCount ?? 0;
  const paramsReady = Array.from({ length: varCount }).every((_, i) => (params[i] ?? "").trim().length > 0);
  const canSend =
    !!selected?.connected && !!template && recipients.length > 0 && paramsReady && !send.isPending;

  const doSend = () => {
    if (!selected || !template) return;
    setResult(null);
    send.mutate(
      {
        inboxId: selected.id,
        templateId: template.id,
        params: params.slice(0, varCount).map((p) => p ?? ""),
        recipients,
      },
      {
        onSuccess: (r) => {
          setResult(r);
          onToast(`Broadcast sent to ${r.sent}/${r.total} recipient${r.total === 1 ? "" : "s"}`);
        },
        onError: (err) => onToast((err as Error)?.message ?? "Couldn’t send the broadcast"),
      },
    );
  };

  return (
    <div className="setpane">
      <div className="setpane__head">
        <div>
          <h2>Broadcast</h2>
          <p>
            Send an approved template to many people at once. Each person gets their own 1:1
            WhatsApp message — the compliant way to reach a list. Replies land back in your inbox.
          </p>
        </div>
      </div>

      {inboxes.isSuccess && waNumbers.length === 0 && (
        <div className="setempty">
          Connect a WhatsApp number under Channels first — a broadcast is sent from a number.
        </div>
      )}

      {waNumbers.length > 0 && (
        <div className="setform">
          {waNumbers.length > 1 && (
            <label className="field">
              <span>Send from</span>
              <select value={inboxId ?? ""} onChange={(e) => setInboxId(e.target.value)}>
                {waNumbers.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                    {n.channelConfigPublic?.displayNumber ? ` · ${n.channelConfigPublic.displayNumber}` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}

          {selected && !selected.connected && (
            <div className="setempty">
              This number isn’t connected yet — add its Phone number ID and access token under
              Channels first.
            </div>
          )}

          <label className="field">
            <span>Template</span>
            <select
              value={templateId}
              onChange={(e) => {
                setTemplateId(e.target.value);
                setParams([]);
                setResult(null);
              }}
            >
              <option value="">Choose an approved template…</option>
              {approved.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {templates.isSuccess && approved.length === 0 && (
              <small className="fieldhint">
                No approved templates yet. Create and approve one under Templates, or sync from Meta.
              </small>
            )}
            {template && <small className="fieldhint">{template.body}</small>}
          </label>

          {varCount > 0 && (
            <div className="setform__grid two">
              {Array.from({ length: varCount }).map((_, i) => (
                <label className="field" key={i}>
                  <span>{`Value for {{${i + 1}}}`}</span>
                  <input
                    value={params[i] ?? ""}
                    autoComplete="off"
                    onChange={(e) => {
                      const next = params.slice();
                      next[i] = e.target.value;
                      setParams(next);
                    }}
                    placeholder={`{{${i + 1}}}`}
                  />
                </label>
              ))}
            </div>
          )}
          {varCount > 0 && (
            <small className="fieldhint">
              These values fill the template for every recipient. Per-person values aren’t
              supported here yet.
            </small>
          )}

          <div className="field">
            <span>
              Recipients {recipients.length > 0 && <em>{recipients.length}</em>}
            </span>
            <div className="bseg">
              <button type="button" className={mode === "contacts" ? "on" : ""} onClick={() => setMode("contacts")}>
                From customers
              </button>
              <button type="button" className={mode === "paste" ? "on" : ""} onClick={() => setMode("paste")}>
                Paste numbers
              </button>
            </div>

            {mode === "contacts" ? (
              <div className="bpick">
                <div className="setsearch bpick__search">
                  <SearchIcon />
                  <input value={cq} onChange={(e) => setCq(e.target.value)} placeholder="Search customers by name or number…" />
                </div>
                {reachable.length === 0 ? (
                  <div className="setempty">No customers with a WhatsApp number yet — add some under Customers.</div>
                ) : (
                  <>
                    <label className="bpick__all">
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} />
                      Select all{cq.trim() ? ` matching · ${cqFiltered.length}` : ` customers · ${cqFiltered.length}`}
                    </label>
                    <div className="bpick__list">
                      {cqFiltered.map((c) => (
                        <label key={c.id} className={"bpick__row" + (picked.has(c.id) ? " on" : "")}>
                          <input type="checkbox" checked={picked.has(c.id)} onChange={() => togglePick(c.id)} />
                          <span className="bpick__name">{c.displayName}</span>
                          <span className="bpick__phone">{c.phone}</span>
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <small className="fieldhint">Only customers with a WhatsApp number appear; blocked customers are excluded.</small>
              </div>
            ) : (
              <>
                <textarea
                  value={recipientsRaw}
                  rows={6}
                  onChange={(e) => setRecipientsRaw(e.target.value)}
                  placeholder={"One phone number per line, e.g.\n+447700900123\n+447700900124, Jane Smith"}
                />
                <small className="fieldhint">
                  Include the country code. Optionally add a name after a comma. Up to 500 per broadcast.
                </small>
              </>
            )}
          </div>

          <div className="setform__foot">
            <button className="btn-primary" type="button" onClick={doSend} disabled={!canSend}>
              {send.isPending
                ? "Sending…"
                : recipients.length > 0
                  ? `Send to ${recipients.length}`
                  : "Send broadcast"}
            </button>
          </div>

          {result && (
            <div className="bcast-result">
              <div className="bcast-result__summary">
                <span className="bcast-pill bcast-pill--ok">{result.sent} sent</span>
                {result.failed > 0 && (
                  <span className="bcast-pill bcast-pill--fail">{result.failed} failed</span>
                )}
              </div>
              {result.results.some((r) => !r.ok) && (
                <ul className="bcast-fails">
                  {result.results
                    .filter((r) => !r.ok)
                    .map((r, i) => (
                      <li key={`${r.phone}-${i}`}>
                        <b>{r.phone}</b> — {r.error ?? "failed"}
                      </li>
                    ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Setup — app-level integration credentials                          */
/* ------------------------------------------------------------------ */

/** One integration, as a card in the grid — the same shape a channel, label or
 *  team uses: identity on top, state along the bottom, click to edit. The
 *  credentials themselves live in a modal, so the pane stays scannable instead
 *  of being five stacked forms. */
function IntegrationCard({
  color,
  glyph,
  name,
  blurb,
  summary,
  on,
  label,
  onClick,
}: {
  color: string;
  glyph: React.ReactNode;
  name: string;
  blurb: string;
  summary: string;
  on: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button className="chcard" type="button" onClick={onClick}>
      <div className="chcard__top">
        <span className="chcard__ic" style={{ color }}>
          {glyph}
        </span>
        <span className="chcard__name">
          <b>{name}</b>
          <small>{blurb}</small>
        </span>
      </div>
      <div className="chcard__foot">
        <span className="chcard__route chcard__route--plain" title={summary}>
          {summary}
        </span>
        <span className={"connpill " + (on ? "on" : "off")}>
          <span className="connpill__dot" />
          {label}
        </span>
      </div>
    </button>
  );
}

/** The credential sheet behind a card. Plain .modal/.modal--form so it inherits
 *  every other settings dialog's chrome, scroll behaviour and mobile sheet. */
function SetupModal({
  title,
  onClose,
  foot,
  children,
}: {
  title: string;
  onClose: () => void;
  foot: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal__box modal--form" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__x" onClick={onClose} aria-label="Close">
            <XIcon />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        <div className="modal__foot">{foot}</div>
      </div>
    </div>
  );
}

function SetupPane({ sub, onToast }: { sub: SetupSub; onToast: (msg: string) => void }) {
  const integrations = useIntegrations();
  const update = useUpdateIntegrations();
  // Which credential sheet is open, if any.
  const [editing, setEditing] = useState<SetupKey | null>(null);
  const google = integrations.data?.google;
  const configured = Boolean(google?.configured);
  const meta = integrations.data?.meta;
  const metaConfigured = Boolean(meta?.configured);
  const storage = integrations.data?.storage;
  const storageConfigured = Boolean(storage?.configured);
  const smtp = integrations.data?.smtp;
  const smtpConfigured = Boolean(smtp?.configured);
  const resend = integrations.data?.resend;
  const resendConfigured = Boolean(resend?.configured);
  const anthropic = integrations.data?.anthropic;
  const anthropicConfigured = Boolean(anthropic?.configured);
  const push = integrations.data?.push;
  const pushConfigured = Boolean(push?.configured);
  // A test send goes via whichever transport is configured (Mailer tries Resend
  // first, then Gmail/SMTP), so enable the test whenever either is set up.
  const emailConfigured = resendConfigured || smtpConfigured;

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
  const [resendApiKey, setResendApiKey] = useState("");
  const [resendFrom, setResendFrom] = useState("");
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [expoAccessToken, setExpoAccessToken] = useState("");
  const [firebaseProjectId, setFirebaseProjectId] = useState("");
  const [firebaseProjectNumber, setFirebaseProjectNumber] = useState("");
  const [firebaseAppId, setFirebaseAppId] = useState("");
  const [firebaseStorageBucket, setFirebaseStorageBucket] = useState("");
  const [polishPrompt, setPolishPrompt] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  // Models this key can use. Empty + an error => the field degrades to free text.
  const [aiModels, setAiModels] = useState<{ id: string; name: string }[]>([]);
  const [aiModelsError, setAiModelsError] = useState("");
  const [aiModelsLoading, setAiModelsLoading] = useState(false);
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
    if (anthropic?.model !== undefined) setAnthropicModel(anthropic.model);
  }, [anthropic?.model]);
  useEffect(() => {
    if (push?.projectId !== undefined) setFirebaseProjectId(push.projectId);
  }, [push?.projectId]);
  useEffect(() => {
    if (push?.projectNumber !== undefined) setFirebaseProjectNumber(push.projectNumber);
  }, [push?.projectNumber]);
  useEffect(() => {
    if (push?.appId !== undefined) setFirebaseAppId(push.appId);
  }, [push?.appId]);
  useEffect(() => {
    if (push?.storageBucket !== undefined) setFirebaseStorageBucket(push.storageBucket);
  }, [push?.storageBucket]);
  // The prompt is long and hand-edited, so it prefills from the server (which
  // seeds it with DEFAULT_POLISH_PROMPT) rather than starting blank.
  useEffect(() => {
    if (anthropic?.polishPrompt !== undefined) setPolishPrompt(anthropic.polishPrompt);
  }, [anthropic?.polishPrompt]);
  useEffect(() => {
    if (smtp?.from !== undefined) setSmtpFrom(smtp.from);
  }, [smtp?.from]);
  useEffect(() => {
    if (resend?.from !== undefined) setResendFrom(resend.from);
  }, [resend?.from]);

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
        setEditing(null);
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
        setEditing(null);
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const savePush = () => {
    const input: {
      expoAccessToken?: string;
      firebaseProjectId?: string;
      firebaseProjectNumber?: string;
      firebaseAppId?: string;
      firebaseStorageBucket?: string;
    } = {};
    // The Firebase values are the project's public identifiers, so they send on
    // any change and an empty one clears back to the environment.
    if (firebaseProjectId.trim() !== (push?.projectId ?? "")) input.firebaseProjectId = firebaseProjectId.trim();
    if (firebaseProjectNumber.trim() !== (push?.projectNumber ?? ""))
      input.firebaseProjectNumber = firebaseProjectNumber.trim();
    if (firebaseAppId.trim() !== (push?.appId ?? "")) input.firebaseAppId = firebaseAppId.trim();
    if (firebaseStorageBucket.trim() !== (push?.storageBucket ?? ""))
      input.firebaseStorageBucket = firebaseStorageBucket.trim();
    // The token is write-only — only sent when the field has something in it,
    // so leaving it blank keeps whatever is already stored.
    const token = expoAccessToken.trim();
    if (token) input.expoAccessToken = token;
    if (Object.keys(input).length === 0) {
      onToast("Nothing to save — change a field first");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setExpoAccessToken("");
        onToast("Push settings saved");
        setEditing(null);
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
        setEditing(null);
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
        setEditing(null);
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const saveResend = () => {
    const input: { resendApiKey?: string; resendFrom?: string } = {};
    // From is non-secret — send when changed (empty clears). The API key is
    // write-only — send only when the field has a value.
    if (resendFrom.trim() !== (resend?.from ?? "")) input.resendFrom = resendFrom.trim();
    const key = resendApiKey.trim();
    if (key) input.resendApiKey = key;
    if (Object.keys(input).length === 0) {
      onToast("Enter your Resend API key to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setResendApiKey("");
        onToast("Resend settings saved");
        setEditing(null);
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  // Ask the key what it can run, when the sheet opens. Nothing is hardcoded:
  // available model ids differ per account and change over time.
  useEffect(() => {
    if (editing !== "anthropic" || !anthropicConfigured) return;
    let cancelled = false;
    setAiModelsLoading(true);
    setAiModelsError("");
    api
      .aiModels()
      .then((res) => {
        if (cancelled) return;
        setAiModels(res.models);
        setAiModelsError(res.error ?? "");
      })
      .catch(() => {
        if (!cancelled) setAiModelsError("Couldn't reach the server to list models");
      })
      .finally(() => {
        if (!cancelled) setAiModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [editing, anthropicConfigured]);

  const saveAnthropic = () => {
    const input: { anthropicApiKey?: string; anthropicModel?: string; anthropicPolishPrompt?: string } = {};
    // Model + prompt are non-secret — send when changed (empty resets to the
    // built-in default). The API key is write-only — send only when entered.
    if (anthropicModel.trim() !== (anthropic?.model ?? "")) input.anthropicModel = anthropicModel.trim();
    if (polishPrompt.trim() !== (anthropic?.polishPrompt ?? "")) input.anthropicPolishPrompt = polishPrompt.trim();
    const key = anthropicApiKey.trim();
    if (key) input.anthropicApiKey = key;
    if (Object.keys(input).length === 0) {
      onToast("Enter your Claude API key to save");
      return;
    }
    update.mutate(input, {
      onSuccess: () => {
        setAnthropicApiKey("");
        onToast("AI settings saved");
        setEditing(null);
      },
      onError: () => onToast("Only admins & managers can change setup"),
    });
  };

  const testAi = async () => {
    setAiTesting(true);
    try {
      const res = await api.testAi();
      // Show Claude's own words on failure — that's what names a bad model.
      onToast(res.ok ? `Claude replied: “${res.sample ?? ""}”` : res.error || "Claude couldn't be reached");
    } catch {
      onToast("Couldn't reach the server to test Claude");
    } finally {
      setAiTesting(false);
    }
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


  // Close the sheet once a save lands, so the card's summary + status pill are
  // the confirmation — the same rhythm as editing a channel, label or team.
  const close = () => setEditing(null);

  return (
    <div className="setpane setpane--wide">
      <div className="setpane__head">
        <div>
          <h2>{SETUP_HEAD[sub].h}</h2>
          <p>{SETUP_HEAD[sub].p}</p>
        </div>
      </div>

      <div className="cardgrid">
        {sub === "connections" && (
          <>
            <IntegrationCard
              color="#EA4335"
              glyph={<GmailGlyph />}
              name="Google / Gmail"
              blurb="One-click Gmail connect"
              summary={google?.clientId || "No client ID yet"}
              on={configured}
              label={configured ? "Configured" : "Not configured"}
              onClick={() => setEditing("google")}
            />
            <IntegrationCard
              color={channelMeta("whatsapp").color}
              glyph={(() => {
                const G = channelMeta("whatsapp").Glyph;
                return <G />;
              })()}
              name="Meta / WhatsApp"
              blurb="One-click WhatsApp connect"
              summary={meta?.appId ? `App ID ${meta.appId}` : "No app ID yet"}
              on={metaConfigured}
              label={metaConfigured ? "Configured" : "Not configured"}
              onClick={() => setEditing("meta")}
            />
          </>
        )}

        {sub === "storage" && (
          <IntegrationCard
            color="#F6821F"
            glyph={<StorageIcon />}
            name="Cloudflare R2"
            blurb="Media storage bucket"
            summary={storage?.bucket ? `Bucket ${storage.bucket}` : "Local disk — wiped on redeploy"}
            on={storageConfigured}
            label={storageConfigured ? "Storing in R2" : "Ephemeral disk"}
            onClick={() => setEditing("storage")}
          />
        )}

        {sub === "ai" && (
          <IntegrationCard
            color="#D97757"
            glyph={<SparkleIcon />}
            name="Claude"
            blurb="Polishes an agent’s draft on request"
            summary={anthropicConfigured ? (anthropic?.model ?? "") : "No API key yet"}
            on={anthropicConfigured}
            label={anthropicConfigured ? "Connected" : "Not connected"}
            onClick={() => setEditing("anthropic")}
          />
        )}

        {sub === "push" && (
          <IntegrationCard
            color="#FFA000"
            glyph={<BellIcon />}
            name="Firebase / Expo push"
            blurb="How a new message reaches the phone"
            summary={push?.projectId ? `Project ${push.projectId}` : "No Firebase project recorded"}
            on={pushConfigured}
            label={pushConfigured ? "Token set" : "Unauthenticated sends"}
            onClick={() => setEditing("push")}
          />
        )}

        {sub === "email" && (
          <>
            <IntegrationCard
              color="#5B8DEF"
              glyph={<MailIcon />}
              name="Resend"
              blurb="Recommended sender"
              summary={resend?.from || "No sender set"}
              on={resendConfigured}
              label={resendConfigured ? "Connected" : "Not connected"}
              onClick={() => setEditing("resend")}
            />
            <IntegrationCard
              color="#EA4335"
              glyph={<MailIcon />}
              name="SMTP"
              blurb="Fallback sender"
              summary={smtp?.host ? `${smtp.host}:${smtp.port ?? 587}` : "No server set"}
              on={smtpConfigured}
              label={smtpConfigured ? "Connected" : "Not connected"}
              onClick={() => setEditing("smtp")}
            />
          </>
        )}
      </div>

      {editing === "google" && (
        <SetupModal
          title="Google / Gmail"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" type="button" onClick={saveGoogle} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
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

          <div className="setform__sub">
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
        </SetupModal>
      )}

      {editing === "meta" && (
        <SetupModal
          title="Meta / WhatsApp"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" type="button" onClick={saveMeta} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
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

          <div className="setform__sub">
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
        </SetupModal>
      )}

      {editing === "push" && (
        <SetupModal
          title="Firebase / Expo push"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" type="button" onClick={savePush} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
          <p className="fieldhint">
            A notification travels app → Expo → Firebase → phone. Expo does the Firebase call using the service-account
            key uploaded to <b>EAS credentials</b> — that key is never held here, and there is nothing to paste for it.
            What this screen holds is the access token that authenticates <i>our</i> sends to Expo, and a record of which
            Firebase project the app is pointed at. Takes effect within seconds of saving — no redeploy.
          </p>

          <label className="field">
            <span>Expo access token</span>
            <input
              type="password"
              value={expoAccessToken}
              autoComplete="off"
              onChange={(e) => setExpoAccessToken(e.target.value)}
              placeholder={pushConfigured ? "Saved — leave blank to keep it" : "Optional, but recommended"}
            />
          </label>
          <p className="fieldhint">
            Expo accepts sends without a token. With one — and “enhanced security” switched on in your Expo account —
            anyone who learns a device’s push token still can’t send to that phone in your name.
          </p>

          <div className="setform__grid two">
            <label className="field">
              <span>Firebase project ID</span>
              <input
                value={firebaseProjectId}
                autoComplete="off"
                onChange={(e) => setFirebaseProjectId(e.target.value)}
                placeholder="e.g. nestconnect-d5489"
              />
            </label>
            <label className="field">
              <span>Sender ID (project number)</span>
              <input
                value={firebaseProjectNumber}
                autoComplete="off"
                onChange={(e) => setFirebaseProjectNumber(e.target.value)}
                placeholder="e.g. 186082168787"
              />
            </label>
            <label className="field">
              <span>Android app ID</span>
              <input
                value={firebaseAppId}
                autoComplete="off"
                onChange={(e) => setFirebaseAppId(e.target.value)}
                placeholder="1:000000000000:android:…"
              />
            </label>
            <label className="field">
              <span>Storage bucket</span>
              <input
                value={firebaseStorageBucket}
                autoComplete="off"
                onChange={(e) => setFirebaseStorageBucket(e.target.value)}
                placeholder="your-project.firebasestorage.app"
              />
            </label>
          </div>
          <p className="fieldhint">
            These four are the project’s public identifiers, copied from <code>google-services.json</code> in the mobile
            app. Nothing sends them anywhere — they’re recorded so that when pushes stop, “which Firebase project is the
            app actually on?” has an answer here rather than inside a build artefact. The app itself reads its copy at
            build time, so changing them here does not repoint a phone that’s already installed.
          </p>
        </SetupModal>
      )}

      {editing === "storage" && (
        <SetupModal
          title="Cloudflare R2"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={close}>
                Cancel
              </button>
              <button className="btn-primary" type="button" onClick={saveStorage} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
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
        </SetupModal>
      )}

      {editing === "resend" && (
        <SetupModal
          title="Email sending · Resend"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={testSmtp} disabled={smtpTesting || !emailConfigured}>
                {smtpTesting ? "Sending…" : "Send test email"}
              </button>
              <button className="btn-primary" type="button" onClick={saveResend} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
          <p className="fieldhint">
            Create an API key at <b>resend.com</b> → API Keys, and verify your sending domain (Domains). The from-address
            must be on a verified domain. Takes effect immediately — no redeploy needed.
          </p>

          <div className="setform__grid two">
            <label className="field">
              <span>Resend API key</span>
              <input
                type="password"
                autoComplete="off"
                value={resendApiKey}
                onChange={(e) => setResendApiKey(e.target.value)}
                placeholder={resendConfigured ? "••••• (hidden)" : "re_…"}
              />
            </label>
            <label className="field">
              <span>From address</span>
              <input
                value={resendFrom}
                autoComplete="off"
                onChange={(e) => setResendFrom(e.target.value)}
                placeholder="Nest Connect <noreply@yourdomain.com>"
              />
            </label>
          </div>
        </SetupModal>
      )}

      {editing === "anthropic" && (
        <SetupModal
          title="Claude (Anthropic)"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={testAi} disabled={aiTesting || !anthropicConfigured}>
                {aiTesting ? "Testing…" : "Test"}
              </button>
              <button className="btn-primary" type="button" onClick={saveAnthropic} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
          <p className="fieldhint">
            Create a key at <b>console.anthropic.com</b> → API Keys. With one set, a <b>Polish</b> button appears in the
            composer: one tap tidies the agent’s draft before they send it. Claude never sends anything itself, and
            never replies on its own — it only rewrites a draft the agent has already written.
          </p>
          <p className="fieldhint">
            Save the key first — the <b>Model</b> list below then fills itself from your own account, so there is no
            id to look up. Hit <b>Test</b> afterwards: it runs one real polish and reports back what Claude said.
          </p>

          <div className="setform__grid two">
            <label className="field">
              <span>API key</span>
              <input
                type="password"
                autoComplete="off"
                value={anthropicApiKey}
                onChange={(e) => setAnthropicApiKey(e.target.value)}
                placeholder={anthropicConfigured ? "••••• (hidden)" : "sk-ant-…"}
              />
            </label>
            <label className="field">
              <span>Model</span>
              {aiModels.length > 0 ? (
                <select value={anthropicModel} onChange={(e) => setAnthropicModel(e.target.value)}>
                  {/* Keep whatever is saved selectable even if the key no longer
                      lists it, so opening this sheet never silently changes it. */}
                  {anthropicModel && !aiModels.some((m) => m.id === anthropicModel) && (
                    <option value={anthropicModel}>{anthropicModel} (not offered by this key)</option>
                  )}
                  {aiModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name === m.id ? m.id : `${m.name} — ${m.id}`}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={anthropicModel}
                  autoComplete="off"
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  placeholder="claude-sonnet-4-5"
                />
              )}
              <em>
                {aiModelsLoading
                  ? "Loading the models your key can use…"
                  : aiModels.length > 0
                    ? `${aiModels.length} models available on this key`
                    : aiModelsError || "Save an API key, then reopen this to pick from your available models."}
              </em>
            </label>
          </div>

          <div className="setform__sub">
            <b>Polish instruction</b>
            <small>
              What Claude is told before it sees a draft. The rules below are what keep Polish safe: it may change
              how a message reads, never what it says. Edit to match your tone of voice — clear the box and save to
              restore the default.
            </small>
          </div>

          <label className="field">
            <span>Prompt</span>
            <textarea
              className="prompttext"
              rows={14}
              spellCheck={false}
              value={polishPrompt}
              onChange={(e) => setPolishPrompt(e.target.value)}
              placeholder="Loading the default instruction…"
            />
          </label>
        </SetupModal>
      )}

      {editing === "smtp" && (
        <SetupModal
          title="Email sending · SMTP"
          onClose={close}
          foot={
            <>
              <button className="btn-ghost" type="button" onClick={testSmtp} disabled={smtpTesting || !emailConfigured}>
                {smtpTesting ? "Sending…" : "Send test email"}
              </button>
              <button className="btn-primary" type="button" onClick={saveSmtp} disabled={update.isPending || integrations.isLoading}>
                Save
              </button>
            </>
          }
        >
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
        </SetupModal>
      )}
    </div>
  );
}

