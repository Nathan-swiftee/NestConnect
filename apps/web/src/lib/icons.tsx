/**
 * The icon set, rendered for the web.
 *
 * The geometry lives in `@ding/design/icons` and is shared with the app — this
 * file is only the rendering. That split exists because it used to not: there
 * were two hand-maintained icon files with a comment on each asking whoever
 * edited one to edit the other, and they drifted into eight stroke weights and
 * a dozen glyphs the app never got.
 *
 * Two rules are applied *here*, once, rather than per glyph, because per-glyph
 * is exactly how the old set lost them: every outline gets round caps and round
 * joins, and every outline gets the same stroke weight. About fifty of the
 * previous sixty-seven icons ended in butt caps and mitred corners — that, more
 * than any individual drawing, is what read as "boxy".
 *
 * Size and colour still come from the parent's CSS (`currentColor`, `width`),
 * so nothing here takes props.
 */
import type { ChannelType } from "@ding/schemas";
import type { JSX } from "react";
import {
  ICON_STROKE,
  channelIcons,
  icons,
  logo,
  teamIcons,
  tickIcons,
  type IconSpec,
} from "@ding/design/icons";

/** One glyph: outline first, then any solid shapes on top of it. */
function Glyph({ spec, fillOverride }: { spec: IconSpec; fillOverride?: string }): JSX.Element {
  return (
    <svg viewBox={spec.viewBox ?? "0 0 24 24"} fill="none" strokeLinecap="round" strokeLinejoin="round">
      {spec.d ? (
        <path d={spec.d} stroke="currentColor" strokeWidth={ICON_STROKE} fill={fillOverride ?? "none"} />
      ) : null}
      {spec.fill ? <path d={spec.fill} fill="currentColor" /> : null}
    </svg>
  );
}

/** Turn a spec into a zero-prop component — how every icon below is declared. */
const g =
  (spec: IconSpec) =>
  (): JSX.Element =>
    <Glyph spec={spec} />;

/* ── navigation ──────────────────────────────────────────────────────────── */

export const InboxIcon = g(icons.inbox);
export const ContactsIcon = g(icons.contacts);
export const InsightsIcon = g(icons.insights);
export const SettingsIcon = g(icons.settings);
/** Moon — shown in light mode (click to go dark). */
export const ThemeIcon = g(icons.theme);
/** Sun — shown in dark mode (click to go light). */
export const SunIcon = g(icons.sun);
export const SearchIcon = g(icons.search);
export const MenuIcon = g(icons.menu);
export const MoreIcon = g(icons.more);

/* ── arrows and chevrons ─────────────────────────────────────────────────── */

export const PlusIcon = g(icons.plus);
export const XIcon = g(icons.x);
export const CheckIcon = g(icons.check);
export const BackIcon = g(icons.back);
export const ChevronDown = g(icons.chevronDown);
export const ChevronUp = g(icons.chevronUp);
export const ChevronRight = g(icons.chevronRight);
/** Double chevron pointing left — "collapse the sidebar away". */
export const ChevronsLeftIcon = g(icons.chevronsLeft);
export const SendIcon = g(icons.send);
export const ReplyIcon = g(icons.reply);
export const ForwardIcon = g(icons.forward);
export const DownloadIcon = g(icons.download);
export const RefreshIcon = g(icons.refresh);
export const ReopenIcon = g(icons.reopen);
/** Door with an arrow leaving it — sign out. */
export const LogoutIcon = g(icons.logout);

/* ── conversation state ──────────────────────────────────────────────────── */

export const ClockIcon = g(icons.clock);
export const SnoozeIcon = g(icons.snooze);
export const CheckCircleIcon = g(icons.checkCircle);
/** Exclamation-in-a-circle — used for a failed/undelivered message tick. */
export const AlertIcon = g(icons.alert);
export const EyeIcon = g(icons.eye);
export const ProfileIcon = g(icons.profile);
export const LockIcon = g(icons.lock);
export const TagIcon = g(icons.tag);
export const BellIcon = g(icons.bell);
export const AtIcon = g(icons.at);

/* ── the composer and the thread ─────────────────────────────────────────── */

export const AttachIcon = g(icons.attach);
export const EmojiIcon = g(icons.emoji);
export const NoteIcon = g(icons.note);
export const MicIcon = g(icons.mic);
export const ImageIcon = g(icons.image);
/** Four-point sparkle — AI assist (the composer's Polish action). */
export const SparkleIcon = g(icons.sparkle);
export const BoltIcon = g(icons.bolt);
export const ComposeIcon = g(icons.compose);
export const EditIcon = g(icons.edit);
export const TrashIcon = g(icons.trash);
export const DocIcon = g(icons.doc);
export const LinkIcon = g(icons.link);
export const SoundOnIcon = g(icons.soundOn);
export const SoundOffIcon = g(icons.soundOff);
export const PlayIcon = g(icons.play);
export const PauseIcon = g(icons.pause);
export const StorageIcon = g(icons.storage);
export const RouteIcon = g(icons.route);
/** Sidebar panel with a left column — the "show inboxes" affordance. */
export const PanelLeftIcon = g(icons.panelLeft);
export const DetailsIcon = g(icons.details);
export const CmdIcon = g(icons.cmd);
export const MailIcon = g(icons.mail);
export const PhoneIcon = g(icons.phone);

/** Default-marker star. Filled when it IS the default, outline when it could be. */
export const StarIcon = ({ filled = false }: { filled?: boolean }): JSX.Element => (
  <Glyph spec={icons.star} fillOverride={filled ? "currentColor" : undefined} />
);

/* ── read receipts ───────────────────────────────────────────────────────── */

export const CheckSingle = g(tickIcons.checkSingle);
export const CheckDouble = g(tickIcons.checkDouble);

/* ── channel marks ───────────────────────────────────────────────────────── */

const WaGlyph = g(channelIcons.whatsapp);
const GroupGlyph = g(channelIcons.group);
const EmailGlyph = g(channelIcons.email);
/** Gmail envelope (the tell-tale "M" valley). Colour it via the parent. */
export const GmailGlyph = g(channelIcons.gmail);

export interface ChannelMeta {
  color: string;
  label: string;
  Glyph: () => JSX.Element;
}

export function channelMeta(type: ChannelType): ChannelMeta {
  switch (type) {
    case "whatsapp":
      return { color: "var(--wa)", label: "WhatsApp", Glyph: WaGlyph };
    case "whatsapp_group":
      return { color: "var(--group)", label: "WhatsApp group", Glyph: GroupGlyph };
    case "email":
      return { color: "var(--email)", label: "Email", Glyph: EmailGlyph };
  }
}

/* ── the team icon library (chosen in Settings › Teams) ──────────────────── */

export const TEAM_ICONS: Record<string, () => JSX.Element> = Object.fromEntries(
  Object.entries(teamIcons).map(([name, spec]) => [name, g(spec)]),
);
export const TEAM_ICON_KEYS = Object.keys(TEAM_ICONS);

export function TeamGlyph({ icon }: { icon?: string | null }): JSX.Element {
  // `users` is the fallback rather than a dedicated glyph: a team with no icon
  // chosen is still a group of people, and one less drawing to keep in step.
  const Ic = (icon && TEAM_ICONS[icon]) || TEAM_ICONS.users;
  return <Ic />;
}

/* ── the mark ────────────────────────────────────────────────────────────── */

export const Logo = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d={logo.bubble} fill="currentColor" />
    <path d={logo.dot} fill={logo.dotColor} />
  </svg>
);
