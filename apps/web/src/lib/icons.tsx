import type { ChannelType } from "@ding/schemas";
import type { JSX } from "react";

/* Icons render raw <svg>; size + color come from parent CSS (currentColor). */

export const Logo = () => (
  <svg viewBox="0 0 24 24" fill="none">
    <path d="M12 3C7 3 3 6.5 3 11c0 2.3 1.1 4.3 2.9 5.7L5 21l4.6-2c.8.2 1.6.3 2.4.3 5 0 9-3.5 9-8s-4-8-9-8Z" fill="currentColor" />
    <circle cx="17.5" cy="6.5" r="2.5" fill="#F5A524" />
  </svg>
);

export const InboxIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M3 12h5l2 3h4l2-3h5M4 6h16a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a1 1 0 0 1 1-1Z" />
  </svg>
);
export const ContactsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="9" cy="8" r="3.2" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 7.5a3 3 0 0 1 0 6M17.5 19a5 5 0 0 0-3-4.6" />
  </svg>
);
export const InsightsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 20V10M12 20V4M19 20v-7" /></svg>
);
export const SettingsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M22 12h-3M5 12H2M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1M18.4 18.4l-2.1-2.1M7.7 7.7 5.6 5.6" />
  </svg>
);
export const ThemeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
);
export const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="11" cy="11" r="7" /><path d="m20 20-3-3" /></svg>
);
export const PlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg>
);
export const ChevronDown = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m6 9 6 6 6-6" /></svg>
);
export const SnoozeIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></svg>
);
export const TagIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" /></svg>
);
export const DetailsIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></svg>
);
export const SendIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
);
export const AttachIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8-8a3.3 3.3 0 0 1 4.7 4.7l-8 8a1.6 1.6 0 0 1-2.3-2.3l7.4-7.4" /></svg>
);
export const EmojiIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" /><path d="M9 9.5h.01M15 9.5h.01" strokeWidth="2.4" /></svg>
);
export const NoteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16v10H9l-5 4V5Z" /></svg>
);
export const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5c0 8 7 15 15 15l-1.5-4-4-1-2 2c-2.5-1.3-4.7-3.5-6-6l2-2-1-4L4 5Z" /></svg>
);
export const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
);
export const ProfileIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 20a8 8 0 0 1 16 0" /></svg>
);
export const RouteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
);
export const TeamIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="9" cy="8" r="3" /><path d="M3.5 18.5a5.5 5.5 0 0 1 11 0M16 6a3 3 0 0 1 0 6" /></svg>
);
export const CmdIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M8 9h8M8 13h5" /><rect x="3" y="4" width="18" height="16" rx="3" /></svg>
);
export const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M20 6 9 17l-5-5" /></svg>
);
export const CheckCircleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></svg>
);
export const ReopenIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5" /></svg>
);
export const BackIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1"><path d="M15 18l-6-6 6-6" /></svg>
);
export const MenuIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
);
export const SoundOnIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></svg>
);
export const SoundOffIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 9 5 6M21 9l-5 6" /></svg>
);
export const XIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const BoltIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" /></svg>
);
export const ChevronRight = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m9 6 6 6-6 6" /></svg>
);
export const EditIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20h4L18.5 9.5a2 2 0 0 0-2.8-2.8L5 17.2 4 20Z" /><path d="M13.5 6.5l4 4" /></svg>
);
export const TrashIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M10 11v6M14 11v6" /></svg>
);
export const CheckSingle = () => (
  <svg viewBox="0 0 18 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 8l4 4 9-10" /></svg>
);
export const CheckDouble = () => (
  <svg viewBox="0 0 22 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 8l3.5 3.5L12 2" /><path d="M9 11l1 1 8.5-9.5" /></svg>
);

/* Channel badges: filled, centred in the 24×24 box so they sit true at
   tiny sizes (the old stroked glyphs read dated and off-centre). */
const WaGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M12.04 2.5c-5.2 0-9.42 4.22-9.42 9.42 0 1.66.44 3.28 1.26 4.71L2.5 21.5l4.99-1.31a9.4 9.4 0 0 0 4.55 1.16c5.2 0 9.42-4.22 9.42-9.42 0-2.52-.98-4.89-2.76-6.67a9.36 9.36 0 0 0-6.66-2.76Zm5.5 13.4c-.23.65-1.36 1.25-1.87 1.32-.48.07-1.09.1-1.76-.11-.4-.13-.93-.3-1.6-.59-2.82-1.22-4.66-4.06-4.8-4.25-.14-.19-1.15-1.53-1.15-2.92 0-1.39.73-2.07.99-2.36.26-.28.57-.35.76-.35.19 0 .38 0 .54.01.17.01.41-.07.64.49.23.57.8 1.97.87 2.11.07.14.12.31.02.5-.09.19-.14.31-.28.47-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.69-.81.88-1.09.19-.28.37-.23.64-.14.26.1 1.66.78 1.94.93.28.14.47.21.54.32.07.12.07.7-.16 1.35Z" />
  </svg>
);
const GroupGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M8.5 11.4a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Zm7 .1a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Zm-7 1.3c-3 0-5.6 1.55-5.6 3.85V18.4h11.2v-1.75c0-2.3-2.6-3.85-5.6-3.85Zm7 .25c-.44 0-.86.04-1.26.11 1.05.86 1.66 1.98 1.66 3.24v1.4h5.2v-1.6c0-2.02-2.55-3.15-5.6-3.15Z" />
  </svg>
);
const EmailGlyph = () => (
  <svg viewBox="0 0 24 24" fill="currentColor">
    <path d="M4 5h16c1.1 0 2 .9 2 2v.5l-10 5.6L2 7.5V7c0-1.1.9-2 2-2Zm18 4.8V17c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V9.8l9.52 5.33c.3.16.66.16.96 0L22 9.8Z" />
  </svg>
);

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
